from pgmpy.factors.discrete import TabularCPD
from cdn import CDN


def safety_util(states):
    return 3 * states['Fire Across Gap'] - 2 * states['Enemy Fires']


model = CDN(nodes=['Ribbon Bridge Status', 'Weather Status', 'Ammo Supply', 'Fire Across Gap', 'Enemy Presence', 'Enemy Fires', 'Enemy ATK/Artillery'],
            edges=[('Weather Status', 'Ammo Supply'), ('Ammo Supply', 'Fire Across Gap'),
                   ('Fire Across Gap', 'Enemy Presence'), ('Enemy Presence', 'Enemy Fires'), ('Enemy ATK/Artillery', 'Enemy Fires')],
            cpds=[TabularCPD('Ribbon Bridge Status', 2, [[0.6], [0.4]]),
                  TabularCPD('Weather Status', 2, [[0.6], [0.4]]),
                  TabularCPD('Ammo Supply', 2, [[0.6, 0.4], [0.4, 0.6]], evidence=[
                             'Weather Status'], evidence_card=[2]),
                  TabularCPD('Fire Across Gap', 2, [[0.8, 0.3], [0.2, 0.7]], evidence=[
                             'Ammo Supply'], evidence_card=[2]),
                  TabularCPD('Enemy Presence', 2, [[0.7, 0.2], [0.3, 0.8]], evidence=[
                             'Fire Across Gap'], evidence_card=[2]),
                  TabularCPD('Enemy Fires', 2, [[0.4, 0.4, 0.6, 0.7], [0.6, 0.6, 0.4, 0.3]], evidence=[
                             'Enemy Presence', 'Enemy ATK/Artillery'], evidence_card=[2, 2]),
                  TabularCPD('Enemy ATK/Artillery', 2, [[0.6], [0.4]])],
            actions=[{"node": 'Ribbon Bridge Status', "action_type": 'do', "value": 1, "time_cost": 2},
                     {"node": 'Weather Status', "action_type": 'inv', "time_cost": 1},
                     {"node": 'Fire Across Gap', "action_type": 'do',
                         "value": 0, "time_cost": 2},
                     {"node": 'Fire Across Gap', "action_type": 'do',
                         "value": 1, "time_cost": 2},
                     {"node": "Enemy Presence", "action_type": "inv", "time_cost": 1},
                     {"node": 'Enemy ATK/Artillery',
                         "action_type": 'inv', "time_cost": 1},
                     {"node": 'Enemy ATK/Artillery', "action_type": 'do',
                         "value": 0, "time_cost": 2},
                     {"node": 'Ribbon Bridge Status',
                         "action_type": 'do_none', "time_cost": 0},
                     {"node": 'Weather Status',
                         "action_type": 'inv_none', "time_cost": 0},
                     {"node": 'Fire Across Gap',
                         "action_type": 'do_none', "time_cost": 0},
                     {"node": "Enemy Presence",
                         "action_type": "inv_none", "time_cost": 0},
                     {"node": "Enemy Presence",
                         "action_type": "do_none", "time_cost": 0},
                     {"node": 'Enemy ATK/Artillery',
                         "action_type": 'inv_none', "time_cost": 0},
                     {"node": 'Enemy ATK/Artillery', "action_type": 'do_none', "time_cost": 0},],
            util_func=safety_util,
            util_nodes=['Fire Across Gap', 'Enemy Fires'])
