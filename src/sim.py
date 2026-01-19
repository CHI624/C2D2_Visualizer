"""
This module contains simulation functions for running monte Carlo simulations of our search methods.
"""

import warnings
import numpy as np
from pgmpy.factors.discrete import State
from pgmpy.sampling import BayesianModelSampling
import networkx as nx


warnings.simplefilter(action='ignore', category=FutureWarning)
warnings.simplefilter(action='ignore', category=DeprecationWarning)


def sim_n_trials(cdn, time_limit, num_trials, method, pcc, obs_only=False, randomize_models=False):
    """
    Performs a simulation of the given model for a number of trials.
    Each trial consists of generating a hidden state and then finding the optimal action
    sequence to take given that hidden state and time limit.

    Args:
        cdn: The model to be simulated.
        time_limit: The time limit for each trial.
        num_trials: The number of trials to run.
        method: The search method to use for finding the optimal action sequence.
        pcc: Wether or not to perform pseudo-counterfactual queries.
        obs_only: Whether or not to treat all evidence as tier-1 investigative evidence.
        randomize_models: Whether to randomize the CPDs of the model before each trial.
    Returns:
        A dictionary containing the average utility, standard error, first trials action sequence,
        the hidden state course of actions, and trial moves and states.
    """
    utilities = []
    hidden_states = []
    actions_and_states = []

    for t in range(num_trials):
        inference = BayesianModelSampling(cdn.model)
        if t in cdn.starting_hidden_states.keys():
            hidden_state = cdn.starting_hidden_states[(t)]
        else:
            hidden_state = inference.forward_sample(
                size=1, show_progress=False)
            hidden_states.append(hidden_state)
            cdn.starting_hidden_states[(t)] = hidden_state

        if randomize_models:
            cdn, time_limit, num_trials, method, pcc, obs_only = _randomize_cpds(
                cdn, time_limit, num_trials, method, pcc, obs_only)

        utility, action_state = _simulate(
            cdn, hidden_state.copy(), inference, time_limit, method, pcc, obs_only)
        actions_and_states.append(action_state)
        utilities.append(utility)

    avg_utility = np.mean(utilities)
    standard_error = np.std(utilities) / np.sqrt(num_trials)

    return {"avg_utility": avg_utility, "standard_error": standard_error,
            "actions_and_states": actions_and_states}


# TODO why is the returned action from search sometimes None if there are legal actions?
def _simulate(cdn, hidden_state, inference, time, search_method, pcc, obs_only=False):
    """
    generate a hidden state from the model
    generate a sequence of actions from the model
    while there are legal actions:
    get the best next action from the model
        if the action is an inv, get the value for the node from the hidden state
        if the action is a do, set the value of the node and update the hidden state
    return the list of actions, the updated hidden_state, and the final utility
    """
    do_ev, inv_ev, do_none_ev, inv_none_ev = {}, {}, {}, {}
    actions = []
    # contains the hidden state at each step, as well as the action taken
    action_state = [hidden_state.copy().to_dict(orient="records")]

    while cdn.legal_actions(do_ev, inv_ev, do_none_ev, inv_none_ev, time, pcc):
        action, _ = cdn.expectimax_search("max", do_ev, inv_ev, do_none_ev,
                               inv_none_ev, None, time, obs_only, search_method)

        if action is None:
            print("No action found")
            break

        match action["action_type"]:
            case "inv_none":
                inv_none_ev[action["node"]] = None
            case "do_none":
                do_none_ev[action["node"]] = None
            case "inv":
                inv_ev[action["node"]] = hidden_state[action["node"]][0]
            case "do":
                do_ev, inv_ev, hidden_state = _apply_do_action(
                    do_ev, inv_ev, hidden_state, action, cdn, inference)
            case _:
                raise ValueError(
                    f"Unknown action type: {action['action_type']}")

        action_state.append(action)
        action_state.append(hidden_state.copy().to_dict(orient="records"))

        actions.append(action)
        time -= action["time_cost"]

    as_dict = hidden_state.to_dict(orient='list')
    flattened = {key: value[0] for key, value in as_dict.items()}
    evidence = {key: value for key, value in flattened.items()
                if key in cdn.util_nodes}
    utility = cdn.util_func(evidence)

    return utility, action_state


def _apply_do_action(do_ev, inv_ev, hidden_state, action, cdn, inference):
    """
    Applies a "do" action to the hidden state and updates the evidence accordingly.
    """
    do_ev[action["node"]] = action["value"]
    hidden_state[action["node"]] = action["value"]

    descendants = nx.descendants(cdn.model, action["node"])

    evidence = hidden_state.copy()
    evidence = evidence.to_dict(orient='list')
    evidence = [State(key, val[0]) for key,
                val in evidence.items() if key not in descendants]

    new_state_sample = inference.rejection_sample(
        evidence=evidence, size=1, show_progress=False).to_dict(orient='list')
    for descendant in descendants:
        hidden_state[descendant] = new_state_sample[descendant][0]

    do_ev = {key: val for key,
             val in do_ev.items() if key not in descendants}
    inv_ev = {key: val for key,
              val in inv_ev.items() if key not in descendants}

    return do_ev, inv_ev, hidden_state


def _randomize_cpds(cdn, time, num_trials, method, pcc, obs_only=False):
    """
    Randomizes the model by generating new CPDs for all nodes

    Returns the randomized model, time, number of trials, method, pcc, 
    and obs_only to be used in the simulation.
    """
    cdn_cardinalities = {node: cdn.model.get_cardinality(
        node) for node in cdn.model.nodes}
    cdn.model.get_random_cpds(n_states=cdn_cardinalities, inplace=True)
    for cpd in cdn.model.get_cpds():
        cpd.normalize()
    for cpd in cdn.model.get_cpds():
        if cpd.variable in cdn.util_nodes:
            cpd.values = cpd.values * 10
            cpd.normalize()
    return cdn, time, num_trials, method, pcc, obs_only
