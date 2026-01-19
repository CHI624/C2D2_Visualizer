"""
Pseudo-Counterfactual Effect Example
in which an optimal choice may involve changing the result of
an investigation through intervention
"""

from pgmpy.factors.discrete import TabularCPD
from cdn import CDN


def ex2_util(states):
    return 1 if states['A'] == states['B'] else 0


model = CDN(nodes=['A', 'B'],
            edges=[('A', 'B')],
            cpds=[TabularCPD('A', 2, [[0.5], [0.5]]),
                  TabularCPD('B', 2, [[0.001, 0.999], [0.999, 0.001]], evidence=['A'], evidence_card=[2])],
            actions=[{"node": 'B', "action_type": 'do', "value": 0, "time_cost": 2},
                     {"node": 'B', "action_type": 'do',
                      "value": 1, "time_cost": 2},
                     {"node": 'B', "action_type": 'do_none', "time_cost": 0},
                     {"node": 'B', "action_type": 'inv', "time_cost": 1}],
            util_func=ex2_util,
            util_nodes=['A', 'B'])
