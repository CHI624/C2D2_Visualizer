"""
Possum Effect Example
in which the best choice may be to make no choice at all

Uses the same util function as the standard confounding example.
"""

from pgmpy.factors.discrete import TabularCPD
from cdn import CDN


def ex0_util(states):
    return {(0, 0): 1, (0, 1): 0, (1, 0): 2, (1, 1): 4}[(states['A'], states['B'])]


model = CDN(nodes=['A', 'B'],
            edges=[('A', 'B')],
            cpds=[TabularCPD('A', 2, [[0.5], [0.5]]),
                  TabularCPD('B', 2, [[0.2, 0.5], [0.8, 0.5]], evidence=['A'], evidence_card=[2])],
            actions=[{"node": 'B', "action_type": 'do', "value": 0, "time_cost": 2},
                     {"node": 'B', "action_type": 'do_none', "time_cost": 0}],
            util_func=ex0_util,
            util_nodes=['A', 'B'])
