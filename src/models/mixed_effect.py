"""
mixed-effect example model
"""
from pgmpy.factors.discrete import TabularCPD
from cdn import CDN


def ex4_util(states):
    return 1 if ((states['A'] == 0 and states['C'] == 1) or (states['A'] == 1 and states['C'] == 0)) else 0


# mixed-effect
model = CDN(nodes=['A', 'B', 'C'],
            edges=[('A', 'B'), ('A', 'C')],
            cpds=[TabularCPD('A', 2, [[0.5], [0.5]]),
                  TabularCPD('B', 2, [[0.1, 0.9], [0.9, 0.1]], evidence=[
                      'A'], evidence_card=[2]),
                  TabularCPD('C', 2, [[0.3, 0.6], [0.7, 0.4]], evidence=['A'], evidence_card=[2])],
            actions=[{"node": 'A', "action_type": 'do', "value": 0, "time_cost": 2},
                     {"node": 'A', "action_type": 'do',
                      "value": 1, "time_cost": 2},
                     {"node": 'A', "action_type": 'inv', "time_cost": 1},
                     {"node": 'B', "action_type": 'do',
                      "value": 0, "time_cost": 2},
                     {"node": 'B', "action_type": 'do',
                      "value": 1, "time_cost": 2},
                     {"node": 'C', "action_type": 'inv', "time_cost": 1},
                     {"node": 'C', "action_type": 'inv_none', "time_cost": 0}],
            util_func=ex4_util,
            util_nodes=['A', 'C'])
