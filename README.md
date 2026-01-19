TODO:
 - [x] Combine code from ARL_ACDN and arl_vis
 - [x] Debug, fix, make sure things work
 - [x] Run tests, make sure they pass
 - [x] Run simulation, make sure it's the same
 - [ ] Refactor and document code
    - [x] Run code coverage and remove unused code
    - [x] test.py
    - [ ] cdn.py
        - TODO [ ] use a state (or evidence?) object instead of individual evidence parameters
        - TODO [ ] use a simulation parameter object instead of individual parameters
    - [x] sim.py
    - [x] gui.py
    - [x] generate_tables.py
 - [x] Write README tutorial stuff
    - [x] start by copying ARL_SOP_BN README
- [x] Make a kind of worksheet for people new to the project

# ARL-starter-code
Tutorial for ARL research code, including CDN, causal expectimax search, conditional course of actions (CCOA) generation, and simulation/visualization

Welcome to the github repository storing the code for Constrained Causal Decision Delimmas (C2D2). Below is a quick-start guide for defining causal decision problems and generating a test table of simulation results.

# Future Work and Suggestions
I put this section first in the hopes that it will be read, even if nothing else is. Here are some suggestions for future work, as well as some things I should have done:

- start by creating unit tests for any method you write. You'll probably have to solve some examples on paper before writing your method anyway, so you might as well write the tests first. This will help you catch bugs and make sure your code is correct. I promise, it will actually save you time in the long run.
- I have prepended the names of all class methods not used outside of the class with an underscore.
- cdn should utilize a state object instead of individual evidence parameters. This will make it easier to pass around the state of the model and make it more readable. This is currently done in gui.py if you want to see an example.
- similarly, cdn should utilize a simulation parameter object (inv_only, pcc, etc) instead of individual parameters. This will make it easier to pass around the simulation parameters and make it more readable.
- I wrote generate_tables.py with a tight deadline and for a specific paper, it should be refactored to be more flexible and easier to use. Right now, there are a lot of hardcoded values, that really should be variables.
- COA should probably be a seperate class from CDN, where a COA object has a CDN object (using OOP composition)
 

# How to define CDNs (Causal Decision Networks)
The CDN class is encoded in the file "cdn.py." This object is parameterized by (nodes, edges, cpds, actions, util_func, util_nodes).
A CDN contains a pgmpy Bayesian Network ([text](https://pgmpy.org/models/bayesiannetwork.html)), as well as other values useful for computing decision problems.
- nodes: a list of string names denoting the nodes in the Bayesian Network
- edges: a list of edges in (parent, child) format, where parent and child are capital letter node names
- cpds: a list containing pgmpy CPDs for each node in the network (conditional probability distributions): [text](https://pgmpy.org/factors/discrete.html#module-pgmpy.factors.discrete.CPD)
- actions: a list of legal actions in the decision problem
    - each action is a dictionary object containing the corresponding node name, action type, set value for intervention (do) actions, and associated time cost
    - action types include: do (intervene), inv (investigation), do_none, and inv_none
- util_func: a function paramaterized by a dictionary with key:value for each parameter in the model's utility function
- util_nodes: a list of capital letter node names for the nodes evaluated by the utility function

An example CDN instantiation is given below:
```
def example_util(states):
        return states['A'] + states['B']
example_model = CDN(nodes=['A', 'B'],
            edges=[('A', 'B')],
            cpds=[TabularCPD('A', 2, [[0.5], [0.5]]),
                    TabularCPD('B', 2, [[0.2, 0.5], [0.8, 0.5]], evidence=['A'], evidence_card=[2])],
            actions=[{"node":'A', "action_type":'inv', "time_cost":1}, 
                        {"node":'B', "action_type":'do', "value":0, "time_cost":2},
                        {"node":'B', "action_type":'do', "value":1, "time_cost":2},
                        {"node":'B', "action_type":'do_none', "time_cost":0}],
            util_func=ex0_util,
            util_nodes=['A', 'B'])
```

# How to run simulations and generate the test table
To run a simulation and generate a Microsoft Excel (.xlsx) table output of the results navigate to "test.py".
- To modify the test parameters, first navigate to and expand the "generate_simulation_results_table" function.
- Within this function the simulation's CDNs, and simulation parameters are instantiated.
    - "columns" holds the algorithms used in the simulation..
        - 'EDT_ES': Evidential Decision Theory, Expectimax Search
        - 'CDT_ES': Causal Decision Theory, Expectimax Search
        - 'EDT_CES': Evidential Decision Theory, Causal Expectimax Search
        - 'CDT_CES': Causal Decistion Theory, Causal Expectimax Search
        - 'RDT_CES': Regret Decision Theory, Causal Expectimax Search
    - "num_trials" is the integer number of Monte Carlo repitions to run
    - "secondary_table_limit" is the number of trials to include in the more detailed, algorithm by algorithm secondary sheets
    - "table_rows" is a list of 3-tuples (name, model, time_limit) of models and time limits to test for each algorithm
    - "table_columns" is a list of 4-tuples (name, search_method, obs_only, pcc)
        - the search method can be either the string "ES" for Expectimax Search, or "CES" for Causal Expectimax Search
        - "obs_only" is the boolean for observation only (True if the model can collect only investigative evidence, False if it can collect both investigative and interventional evidence)
        - "pcc" is the boolean for Pseudo-Counterfactual (True if RDT, False otherwise)
    - To control if the simulation randomizes each model's CPDs, set "randomize_models=True" in the call of sim_n_trials
- **TO GENERATE THE TEST TABLE, CALL THE "generate_simulation_results_table" FROM WITHIN "test.py"**
- To simply run the suite of pytest tests covering the code, first comment out or delete any call to "generate_simulation_results_table" within "test.py", then navigate the src and run "pytest test.py".


# How to run the GUI
To run the GUI, navigate to "gui.py" and run the file. The GUI will open and allow you to select click through potential actions and observe the results.