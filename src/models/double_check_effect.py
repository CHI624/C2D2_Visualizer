"""
double-check effect example model
in which the best policy is to investigate the outcome of 
an intervention and repeat if the result is unsatisfactory
"""
from pgmpy.factors.discrete import TabularCPD
from cdn import CDN


def ex3_util(states):
    return states['B']


model = CDN(nodes=['A', 'B'],
            edges=[('A', 'B')],
            cpds=[TabularCPD('A', 2, [[0.5], [0.5]]),
                  TabularCPD('B', 2, [[0.2, 0.8], [0.8, 0.2]], evidence=['A'], evidence_card=[2])],
            actions=[{"node": 'A', "action_type": 'do', "value": 0, "time_cost": 2},
                     {"node": 'A', "action_type": 'do',
                      "value": 1, "time_cost": 2},
                     {"node": 'A', "action_type": 'inv', "time_cost": 1},
                     {"node": 'B', "action_type": 'inv', "time_cost": 1},
                     {"node": 'B', "action_type": 'inv_none', "time_cost": 0}],
            util_func=ex3_util,
            util_nodes=['B'])
