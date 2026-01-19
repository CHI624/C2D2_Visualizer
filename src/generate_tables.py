"""
I wrote this to generate a specific set of tables for a paper.
Therefore, it is not very general, though improvements on that front could easily be made.

This table compares the efficacy of different strategies including 
expectimax, causal expectimax, observation-only searches, and PCC enabled searches.

The first page of the output Excel file contains a summary table with average utilities and 
standard errors for each strategy across different models and time limits.

The following pages contain detailed course of action (COA) tables for each simulation

Column names:
EDT_ES: Evidential Decision Theory, Expectimax Search
CDT_ES: Causal Decision Theory, Expectimax Search
EDT_CES: Evidential Decision Theory, Causal Expectimax Search
CDT_CES: Causal Decistion Theory, Causal Expectimax Search
RDT_CES: Regret Decision Theory, Causal Expectimax Search
 
Row names:
are formatted as EX{model_index}_t{trials}
"""

from copy import deepcopy
import pandas as pd
import tqdm
from sim import sim_n_trials
from models import double_check_effect, mixed_effect, \
    possum_effect, pseudo_counterfactual_effect, standard_confounding


def generate_simulation_results_table(num_trials=1000, secondary_table_limit=150):
    """
    Generates a table of simulation results comparing different decision-making strategies
    across various models, simulation parameters, and time limits.
    """
    ex_models = [standard_confounding.model, possum_effect.model,
                 pseudo_counterfactual_effect.model, double_check_effect.model, mixed_effect.model]

    columns = ['EDT_ES', 'CDT_ES', 'EDT_CES', 'CDT_CES', 'RDT_CES']
    test_table = pd.DataFrame(columns=columns)

    coa_table_template = _create_coa_table(
        num_trials, secondary_table_limit, columns)
    sims = ['EX0_t2', 'EX0_t3', 'EX1_t2', 'EX2_t2',
            'EX2_t3', 'EX3_t3', 'EX3_t4', 'EX3_t5', 'EX4_t5']
    coa_tables = {sim: deepcopy(coa_table_template) for sim in sims}

    table_rows = [
        ('EX0_t2', ex_models[0], 2),
        ('EX0_t3', ex_models[0], 3),
        ('EX1_t2', ex_models[1], 2),
        ('EX2_t2', ex_models[2], 2),
        ('EX2_t3', ex_models[2], 3),
        ('EX3_t3', ex_models[3], 3),
        ('EX3_t4', ex_models[3], 4),
        ('EX3_t5', ex_models[3], 5),
        ('EX4_t5', ex_models[4], 5)
    ]
    table_columns = [
        ('EDT_ES', "ES", True, False),
        ('CDT_ES', "ES", False, False),
        ('EDT_CES', "CES", True, False),
        ('CDT_CES', "CES", False, False),
        ('RDT_CES', "CES", False, True)
    ]

    # use tqdm to show progress bar for columns AND rows
    for column in tqdm.tqdm(table_columns, desc="Columns"):
        for row in tqdm.tqdm(table_rows, desc="row"):
            sim_result, coa_result = _run_simulation(row, column, num_trials)
            test_table.at[row[0], column[0]] = sim_result
            _update_coa_table(coa_tables, row, column,
                              coa_result, secondary_table_limit)

    _write_to_excel(test_table, coa_tables, sims, secondary_table_limit)


def _run_simulation(row, column, num_trials):
    """
    Runs a simulation for a given model and strategy, returning the average utility, standard error,
    and course of action (COA) results.
    """
    model, trials = row[1], row[2]
    sim_result = sim_n_trials(cdn=model, time_limit=trials, num_trials=num_trials,
                              method=column[1], pcc=column[3], obs_only=column[2], randomize_models=False)
    avg_utility = sim_result["avg_utility"]
    standard_error = sim_result['standard_error']
    coa_result = model.generate_COA(
        {}, {}, {}, {}, trials, column[3], column[2], column[1])
    return (avg_utility, standard_error, coa_result), sim_result["actions_and_states"]


def _create_coa_table(num_trials, secondary_table_limit, columns):
    limit = min(num_trials, secondary_table_limit)
    return pd.DataFrame(columns=[f'trial {i}' for i in range(limit)], index=columns)


def _update_coa_table(coa_tables, row, column, coa_result, secondary_table_limit):
    for j, result in enumerate(coa_result):
        if j < secondary_table_limit:
            coa_tables[row[0]].at[column[0], f'trial {j}'] = result


def _write_to_excel(test_table, coa_tables, sims, secondary_table_limit):
    with pd.ExcelWriter('output.xlsx') as writer:
        test_table.to_excel(writer, sheet_name="test_table.xlsx")
        for i, sim in enumerate(sims):
            if i < secondary_table_limit:
                coa_tables[sim].to_excel(writer, sheet_name=f"{sim}.xlsx")


generate_simulation_results_table(num_trials=10, secondary_table_limit=150)
