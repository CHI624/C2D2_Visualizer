"""
Unit tests for the CDN class.
These tests check the expected behavior of the class methods
and ensure that the class is functioning correctly.

All test methods must be prefixed with "test_".
Use pytest approx to check for floating point (EU) equality.

Run using "pytest test.py" in the terminal.
"""

import pytest
from pgmpy.factors.discrete.CPD import TabularCPD
from cdn import CDN
import time


@pytest.fixture
def simple_cdn():
    """
    Simple two node model to sanity check the CDN class.
    """
    def util(states):
        return 2 * states['A'] + states['B']
    model = CDN(nodes=['A', 'B'],
                edges=[('A', 'B')],
                cpds=[TabularCPD('A', 2, [[0.5], [0.5]]),
                      TabularCPD('B', 2, [[0.2, 0.8], [0.8, 0.2]], evidence=['A'], evidence_card=[2])],
                actions=[{"node": 'A', "action_type": 'inv', "time_cost": 1},
                         {"node": 'B', "action_type": 'do',
                          "value": 0, "time_cost": 2},
                         {"node": 'B', "action_type": 'do', "value": 1, "time_cost": 2}],
                util_func=util,
                util_nodes=['A', 'B'])
    return model


def test_simple_cdn_expected_utility_one_known_node(simple_cdn):
    """ 
    Test the expected utility of the model with one known evidence.
    """
    assert simple_cdn.EU({}, {}, False) == pytest.approx(1.5, 0.1)
    assert simple_cdn.EU({'B': 0}, {}, False) == pytest.approx(1, 0.1)
    assert simple_cdn.EU({'B': 1}, {}, False) == pytest.approx(2, 0.1)
    assert simple_cdn.EU({}, {'A': 0}, False) == pytest.approx(0.8, 0.1)
    assert simple_cdn.EU({}, {'A': 1}, False) == pytest.approx(2.2, 0.1)
    assert simple_cdn.EU({'B': 0}, {}, False, True) == pytest.approx(1.6, 0.1)
    assert simple_cdn.EU({'B': 1}, {}, False, True) == pytest.approx(1.4, 0.1)
    assert simple_cdn.chance_node({}, {}, {}, {}, {"node": 'A', "action_type": 'inv',
                                                   "time_cost": 1}, 1, False, False, "CES")[1] == pytest.approx(1.5, 0.1)


def test_simple_cdn_expected_utility_both_known_nodes(simple_cdn):
    """ 
    Test the expected utility of the model with both nodes known.
    """
    assert simple_cdn.EU({'A': 0, 'B': 0}, {}, False,
                         True) == pytest.approx(0, 0.1)
    assert simple_cdn.EU({'A': 0, 'B': 1}, {}, False,
                         True) == pytest.approx(1, 0.1)
    assert simple_cdn.EU({'A': 1, 'B': 0}, {}, False,
                         True) == pytest.approx(2, 0.1)
    assert simple_cdn.EU({'A': 1, 'B': 1}, {}, False,
                         True) == pytest.approx(3, 0.1)


@pytest.fixture
def more_actions_model():
    """
    The same simple model as above, but with more actions.
    """
    def util(states):
        return 2 * states['A'] + states['B']
    model = CDN(nodes=['A', 'B'],
                edges=[('A', 'B')],
                cpds=[TabularCPD('A', 2, [[0.5], [0.5]]),
                      TabularCPD('B', 2, [[0.2, 0.8], [0.8, 0.2]], evidence=['A'], evidence_card=[2])],
                actions=[{"node": 'A', "action_type": 'inv', "time_cost": 1},
                         {"node": 'A', "action_type": 'inv_none', "time_cost": 0},
                         {"node": 'B', "action_type": 'do',
                          "value": 0, "time_cost": 2},
                         {"node": 'B', "action_type": 'do',
                          "value": 1, "time_cost": 2},
                         {"node": 'B', "action_type": 'do_none', "time_cost": 0},],
                util_func=util,
                util_nodes=['A', 'B'])
    return model


def test_expected_utility_with_none_actions_one_known_node(more_actions_model):
    """
    Test the expected utility of a model with none actions, with one known node.
    """
    assert more_actions_model.EU({}, {}, False) == pytest.approx(1.5, 0.1)
    assert more_actions_model.EU({'B': 0}, {}, False) == pytest.approx(1, 0.1)
    assert more_actions_model.EU({'B': 1}, {}, False) == pytest.approx(2, 0.1)
    assert more_actions_model.EU(
        {}, {'A': 0}, False) == pytest.approx(0.8, 0.1)
    assert more_actions_model.EU(
        {}, {'A': 1}, False) == pytest.approx(2.2, 0.1)
    assert more_actions_model.EU(
        {'B': 0}, {}, False, True) == pytest.approx(1.6, 0.1)
    assert more_actions_model.EU(
        {'B': 1}, {}, False, True) == pytest.approx(1.4, 0.1)
    assert more_actions_model.chance_node({}, {}, {}, {}, {"node": 'A', "action_type": 'inv',
                                                           "time_cost": 1}, 1, False, False, "CES")[1] == pytest.approx(1.5, 0.1)


def test_expected_utility_with_none_actions_both_known_node(more_actions_model):
    """
    Test the expected utility of a model with none actions, with two known nodes.
    """
    assert more_actions_model.EU(
        {'A': 0, 'B': 0}, {}, True) == pytest.approx(0, 0.1)
    assert more_actions_model.EU(
        {'A': 0, 'B': 1}, {}, True) == pytest.approx(1, 0.1)
    assert more_actions_model.EU(
        {'A': 1, 'B': 0}, {}, True) == pytest.approx(2, 0.1)
    assert more_actions_model.EU(
        {'A': 1, 'B': 1}, {}, True) == pytest.approx(3, 0.1)


@pytest.fixture
def confounding_model():
    """
    Defines a model with the confounding effect.
    """
    def util(states):
        A = states['A']
        B = states['B']
        if A == 0 and B == 0:
            return 1
        elif A == 0 and B == 1:
            return 0
        elif A == 1 and B == 0:
            return 2
        elif A == 1 and B == 1:
            return 4
    model = CDN(nodes=['A', 'B'],
                edges=[('A', 'B')],
                cpds=[TabularCPD('A', 2, [[0.5], [0.5]]),
                      TabularCPD('B', 2, [[0.2, 0.5], [0.8, 0.5]], evidence=['A'], evidence_card=[2])],
                actions=[{'node': 'A', 'action_type': 'inv', 'time_cost': 1},
                         {'node': 'B', 'action_type': 'do',
                          'value': 0, 'time_cost': 2},
                         {'node': 'B', 'action_type': 'do', 'value': 1, 'time_cost': 2},],
                util_func=util,
                util_nodes=['A', 'B'])
    return model


def test_expected_utility_confounding_model(confounding_model):
    """
    Test the expected utility of the confounding model with one known node.
    """
    assert (confounding_model.EU({}, {}, False) == pytest.approx(1.6, 0.1))
    assert (confounding_model.EU({'B': 1}, {'A': 1}, False) == 4)
    assert (confounding_model.EU({'B': 1}, {'A': 0}, False) == 0)
    assert (confounding_model.EU({'B': 0}, {'A': 1}, False) == 2)
    assert (confounding_model.EU({'B': 0}, {'A': 0}, False) == 1)

    assert (confounding_model.EU({'B': 1}, {}, False) == pytest.approx(2, 0.1))
    assert (confounding_model.EU({'B': 0}, {},
            False) == pytest.approx(1.5, 0.1))
    assert (confounding_model.EU({}, {'A': 0}, False)
            == pytest.approx(0.2, 0.1))
    assert (confounding_model.EU({}, {'A': 1}, False) == pytest.approx(3, 0.1))


def test_expectimax_returns_optimal_action_simple_model(simple_cdn):
    """
    Test that expectimax_search returns the optimal action for the simple model.
    
    In the simple model with utility = 2*A + B:
    - Observing A costs 1 time unit and enables better decisions downstream
    - Intervening B=1 costs 2 time units and gives immediate utility of 2
    - Intervening B=0 costs 2 time units and gives immediate utility of 1
    
    With time=3, the optimal first action should be to observe A (time_cost=1).
    After observing, the agent can intervene optimally with remaining time=2.
    """
    best_action, expected_utility = simple_cdn.expectimax_search(
        node_type="max",
        do_evidence={},
        inv_evidence={},
        do_none_evidence={},
        inv_none_evidence={},
        committed_action=None,
        time=3,
        pcc=False,
        obs_only=False,
        method="CES"
    )
    
    # The optimal action should be to observe A
    assert best_action is not None
    assert best_action["node"] == "A"
    assert best_action["action_type"] == "inv"
    assert best_action["time_cost"] == 1
    # Expected utility when observing A first, then intervening optimally
    assert expected_utility == pytest.approx(2.0, 0.1)


def test_expectimax_chooses_intervention_over_observation(simple_cdn):
    """
    Test that expectimax correctly chooses intervention when it's better.
    
    With limited time (time=2), the optimal action should be to intervene on B
    because:
    - Observing A costs 1 but leaves time=1, and with time=1 we can't do anything else
    - Intervening B=1 costs 2 and gives immediate utility of 2
    - Intervening B=0 costs 2 and gives immediate utility of 1
    
    So the best action is to do B=1 for utility of 2.
    """
    best_action, expected_utility = simple_cdn.expectimax_search(
        node_type="max",
        do_evidence={},
        inv_evidence={},
        do_none_evidence={},
        inv_none_evidence={},
        committed_action=None,
        time=2,
        pcc=False,
        obs_only=False,
        method="CES"
    )
    
    # The optimal action should be to intervene B=1 (highest immediate utility)
    assert best_action is not None
    assert best_action["node"] == "B"
    assert best_action["action_type"] == "do"
    assert best_action["value"] == 1
    assert expected_utility == pytest.approx(2, 0.1)


def test_expectimax_with_known_evidence(simple_cdn):
    """
    Test that expectimax produces better outcomes when evidence is already known.
    This also ensures doesn't investigate unnecessary actions.
    
    When A is already observed to be 1 (inv_evidence={'A': 1}):
    - We know B has P(B=1|A=1) = 0.2 and P(B=0|A=1) = 0.8
    - The utility with no interventions is 2*1 + 0.2*1 + 0.8*0 = 2.2
    - Intervening B=1 gives utility of 2*1 + 1 = 3
    - Intervening B=0 gives utility of 2*1 + 0 = 2
    
    So with time=3, the best action is to intervene B=1.
    """
    best_action, expected_utility = simple_cdn.expectimax_search(
        node_type="max",
        do_evidence={},
        inv_evidence={"A": 1},
        do_none_evidence={},
        inv_none_evidence={},
        committed_action=None,
        time=3,
        pcc=False,
        obs_only=False,
        method="CES"
    )
    
    assert best_action is not None
    assert best_action["node"] == "B"
    assert best_action["value"] == 1
    assert expected_utility == pytest.approx(3, 0.1)


def test_expectimax_no_actions_available(simple_cdn):
    """
    Test that expectimax returns None action when time runs out.
    """
    best_action, expected_utility = simple_cdn.expectimax_search(
        node_type="max",
        do_evidence={},
        inv_evidence={},
        do_none_evidence={},
        inv_none_evidence={},
        committed_action=None,
        time=0,
        pcc=False,
        obs_only=False,
        method="CES"
    )
    
    # With no time, no action should be available
    assert best_action is None
    # Expected utility should be the default utility with no interventions
    assert expected_utility == pytest.approx(1.5, 0.1)


def test_policy_iteration(simple_cdn):
    """
    Test the policy iteration method on the simple CDN model.
    Checks that the policy is generated and that it is a dictionary.
    """
    policy, values = simple_cdn.policy_iteration(
        do_evidence={},
        inv_evidence={},
        do_none_evidence={},
        inv_none_evidence={},
        time=3,
        obs_only=False,
        max_iterations=1000,
        gamma=0.95
    )
    
    # Check that we got a policy
    assert policy is not None
    assert isinstance(policy, dict)
    
    # Check that we got values
    assert values is not None
    assert isinstance(values, dict)
    
    # Check that the policy is non-empty
    assert len(policy) > 0
    
    # Check that values correspond to states in the policy
    assert len(values) == len(policy)


def test_policy_iteration_vs_expectimax(simple_cdn):
    """
    Test the policies generated by policy iteration against the expectimax search.
    Also checks the time taken for each method.
    """
    # Run policy iteration
    pi_train_start = time.time()
    policy, values = simple_cdn.policy_iteration(
        do_evidence={},
        inv_evidence={},
        do_none_evidence={},
        inv_none_evidence={},
        time=3,
        obs_only=False,
        max_iterations=1000,
        gamma=0.95
    )
    pi_train_time = time.time() - pi_train_start
    
    # Run expectimax search
    es_start = time.time()
    best_action_es, expected_utility_es = simple_cdn.expectimax_search(
        node_type="max",
        do_evidence={},
        inv_evidence={},
        do_none_evidence={},
        inv_none_evidence={},
        committed_action=None,
        time=3,
        pcc=False,
        obs_only=False,
        method="CES"
    )
    es_time = time.time() - es_start
    
    # Verify both methods return valid results
    assert policy is not None
    assert best_action_es is not None
    
    # Check that policy iteration produces a policy
    assert isinstance(policy, dict)
    assert len(policy) > 0
    
    # Get the initial state key for lookup
    initial_state_key = (
        frozenset({}.items()),
        frozenset({}.items()),
        frozenset({}.items()),
        frozenset({}.items()),
        3
    )
    
    # Both should recommend actions in the initial state
    pi_start = time.time()
    pi_action = policy.get(initial_state_key)
    pi_time = time.time() - pi_start
    assert pi_action is not None
    
    # The actions should be the same or produce similar utilities
    # (they might not be identical but should both be optimal)
    assert pi_action["node"] == best_action_es["node"] or \
           abs(values.get(initial_state_key, 0) - expected_utility_es) < 0.15
    
    print(f"\nPolicy Iteration training time: {pi_train_time:.4f}s")
    print(f"Policy Iteration lookup time: {pi_time:.4f}s")
    print(f"Expectimax Search time: {es_time:.4f}s")

def test_policy_iteration_more_actions(more_actions_model):
    """
    Test that policy iteration can handle a model with more actions.
    Also checks the time taken for each method.
    """
    # Run policy iteration
    pi_train_start = time.time()
    policy, values = more_actions_model.policy_iteration(
        do_evidence={},
        inv_evidence={},
        do_none_evidence={},
        inv_none_evidence={},
        time=3,
        obs_only=False,
        max_iterations=1000,
        gamma=0.95
    )
    pi_train_time = time.time() - pi_train_start
    
    # Check that we got a policy
    assert policy is not None
    assert isinstance(policy, dict)
    
    # Check that we got values
    assert values is not None
    assert isinstance(values, dict)
    
    # Check that the policy is non-empty
    assert len(policy) > 0
    
    # Check that values correspond to states in the policy
    assert len(values) == len(policy)

    # use expectimax to get the best action for the initial state
    es_start = time.time()
    best_action_es, expected_utility_es = more_actions_model.expectimax_search(
        node_type="max",
        do_evidence={},
        inv_evidence={},
        do_none_evidence={},
        inv_none_evidence={},
        committed_action=None,
        time=3,
        pcc=False,
        obs_only=False,
        method="CES"
    )
    es_time = time.time() - es_start
    
    # check that the policy action matches the expectimax action
    initial_state_key = (
        frozenset({}.items()),
        frozenset({}.items()),
        frozenset({}.items()),
        frozenset({}.items()),
        3
    )
    pi_start = time.time()
    pi_action = policy.get(initial_state_key)
    pi_time = time.time() - pi_start
    assert pi_action is not None
    assert pi_action["node"] == best_action_es["node"]
    assert pi_action["action_type"] == best_action_es["action_type"]
    
    print(f"\nPolicy Iteration training time: {pi_train_time:.4f}s")
    print(f"Policy Iteration lookup time: {pi_time:.4f}s")
    print(f"Expectimax Search time: {es_time:.4f}s")

def test_policy_iteration_confounding_model(confounding_model):
    """
    Test that policy iteration can handle a model with confounding effects.
    Also checks the time taken for each method.
    """
    # Run policy iteration
    pi_train_start = time.time()
    policy, values = confounding_model.policy_iteration(
        do_evidence={},
        inv_evidence={},
        do_none_evidence={},
        inv_none_evidence={},
        time=3,
        obs_only=False,
        max_iterations=1000,
        gamma=0.95
    )
    pi_train_time = time.time() - pi_train_start
    
    # Check that we got a policy
    assert policy is not None
    assert isinstance(policy, dict)
    
    # Check that we got values
    assert values is not None
    assert isinstance(values, dict)
    
    # Check that the policy is non-empty
    assert len(policy) > 0
    
    # Check that values correspond to states in the policy
    assert len(values) == len(policy)

    # use expectimax to get the best action for the initial state
    es_start = time.time()
    best_action_es, expected_utility_es = confounding_model.expectimax_search(
        node_type="max",
        do_evidence={},
        inv_evidence={},
        do_none_evidence={},
        inv_none_evidence={},
        committed_action=None,
        time=3,
        pcc=False,
        obs_only=False,
        method="CES"
    )
    es_time = time.time() - es_start
    
    # check that the policy action matches the expectimax action
    initial_state_key = (
        frozenset({}.items()),
        frozenset({}.items()),
        frozenset({}.items()),
        frozenset({}.items()),
        3
    )
    pi_start = time.time()
    pi_action = policy.get(initial_state_key)
    pi_time = time.time() - pi_start
    assert pi_action is not None
    assert pi_action["node"] == best_action_es["node"]
    assert pi_action["action_type"] == best_action_es["action_type"]
    
    print(f"\nPolicy Iteration training time: {pi_train_time:.4f}s")
    print(f"Policy Iteration lookup time: {pi_time:.4f}s")
    print(f"Expectimax Search time: {es_time:.4f}s")