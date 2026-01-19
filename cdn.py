"""
Defines the class and methods for Causal Decision Networks (CDN).
CDNs are an extension of Bayesian networks that incorporate actions and utilities.

This class has the logic for both performing action searches and generating 
conditional courses of action, as well as the helper methods required for each.
"""

import warnings
import itertools
import networkx as nx
import numpy as np
import random
from pgmpy.inference import CausalInference
from pgmpy.models import DiscreteBayesianNetwork

warnings.simplefilter(action='ignore', category=FutureWarning)
warnings.simplefilter(action='ignore', category=DeprecationWarning)


class CDN:
    """
    Causal Decision Network (CDN) class.
    This class is an extension of Bayesian networks that incorporates actions and utilities.
    It provides methods for performing action searches and generating conditional courses of action.
    """

    def __init__(self, nodes, edges, cpds, actions, util_func, util_nodes):
        # Uses a pgmpy Bayesian Network as the base model
        self.model = DiscreteBayesianNetwork()
        self.model.add_nodes_from(nodes)
        self.model.add_edges_from(edges)
        self.model.add_cpds(*cpds)
        self.model.check_model()

        self.inference = CausalInference(self.model)
        # the utility function takes a dictionary of states and returns a utility value
        self.util_func = util_func
        self.util_nodes = util_nodes

        self.actions = actions.copy()
        self.starting_hidden_states = {}
        """
        caching all functions where the key is a tuple of the (frozen) 
        arguments and the value is the returned result. 
        This drastically speeds up the search process.
        
        WARNING: make sure to clear the caches when the model changes.
        """
        self.cached_pcc_queries = {}
        self.cached_cdn_queries = {}

        self.cached_max_nodes = {}
        self.cached_chance_nodes = {}

        self.cached_eus = {}
        self.cached_nodes = {}

        # split into 3 steps for typical counterfactual
        # 1. updating the evidence (action step)
        # 2. interventional step
        # 3. prediction (running the query on the new model)

    def _pcc_update_evidence(self, do_evidence, inv_evidence):
        # Updates the model and returns the updated model and the variables to update for a pcc query
        updated_model = self.model.copy()
        cf_antecendant = {key: val for key, val in do_evidence.items(
        ) if key in inv_evidence.keys() and do_evidence[key] != inv_evidence[key]}
        all_vars = set(updated_model.nodes)
        cf_antecendant_descendants = set()
        for key in cf_antecendant.keys():
            descendants = nx.descendants(self.model, key)
            cf_antecendant_descendants.update(descendants)
        causal_path_vars = {
            var for var in all_vars if var in cf_antecendant_descendants}
        vars_to_update = ((all_vars - do_evidence.keys()) -
                          causal_path_vars) - inv_evidence.keys()
        return updated_model, vars_to_update

    def _pcc_intervene(self, vars_to_update, updated_model, inv_evidence):
        # intervenes on the updated model using the variables to update for pcc queries
        for var in vars_to_update:
            cpt = updated_model.get_cpds(node=var)
            parent_vars = cpt.get_evidence()
            parent_cardinalities = [
                self.model.get_cardinality(node) for node in parent_vars]
            dec_domains = [list(range(parent_cardinalities[ind]))
                           for ind, _ in enumerate(parent_cardinalities)]
            dec_items = [[(d, v) for v in dec_domains[ind]]
                         for ind, d in enumerate(parent_vars)]
            parent_combinations = [dict(combo)
                                   for combo in itertools.product(*dec_items)]
            for row in parent_combinations:
                parents_values = {
                    parent_vars[i]: row[parent_vars[i]] for i in range(len(parent_vars))}
                evidence = {**inv_evidence, **parents_values}
                query = self.inference.query(
                    variables=list(var), evidence=evidence)
                for idx, value in enumerate(query.values):
                    cpt_row = row | {var: idx}
                    cpt.set_value(value=value, **cpt_row)

        return updated_model

    def _pcc_query(self, query_vars, do_evidence, inv_evidence):
        """
        PCC queries are those where you measure the impact of an intervention (do) on a query variable that you have already observed (inv).
        """
        key = (frozenset(query_vars), frozenset(
            do_evidence.items()), frozenset(inv_evidence.items()))
        if key in self.cached_pcc_queries:
            return self.cached_pcc_queries[key]
        # 1. updating the evidence
        updated_model, vars_to_update = self._pcc_update_evidence(
            do_evidence, inv_evidence)
        # 2. interventional step
        updated_model = self._pcc_intervene(
            vars_to_update, updated_model, inv_evidence)
        # 3. prediction step
        updated_model = updated_model.do(nodes=do_evidence.keys())
        inference = CausalInference(updated_model)
        query = inference.query(variables=query_vars,
                                evidence=do_evidence, show_progress=False)

        self.cached_pcc_queries[key] = query
        return query

    def _cdn_pcc_query(self, query_vars, do_evidence, inv_evidence):
        # performs a pcc query from cdn query when applicable
        for key, val in do_evidence.items():
            if key in inv_evidence.keys() and val != inv_evidence[key]:
                result = self._pcc_query(
                    query_vars, do_evidence, inv_evidence)
                self.cached_cdn_queries[key] = result
                return result

    def _cdn_query(self, query_vars, do_evidence, inv_evidence, pcc, obs_only=False):
        """
        returns the likelihood of the query variables given the tier-1 (inv) and tier-2 (do) evidence
        """
        key = (frozenset(query_vars), frozenset(do_evidence.items()),
               frozenset(inv_evidence.items()), pcc, obs_only)
        if key in self.cached_cdn_queries:
            return self.cached_cdn_queries[key]

        if pcc:
            return self._pcc_query(query_vars, do_evidence, inv_evidence)

        shared_vars = [var for var in query_vars if var in do_evidence.keys()]
        if len(shared_vars) > 0:
            model_copy = self.model.copy()
            for var in shared_vars:
                cpt = model_copy.get_cpds(node=var)
                for idx, _ in enumerate(cpt.values):
                    cpt.values[idx] = 0 if idx != do_evidence[var] else 1
            model_copy.do(nodes=shared_vars)
            inference = CausalInference(model_copy)
            query = inference.query(
                variables=query_vars, evidence=inv_evidence, show_progress=False)

            self.cached_cdn_queries[key] = query
            return query

        inference = self.inference
        if not obs_only:
            updated_model = self.model.do(nodes=list(do_evidence.keys()))
            inference = CausalInference(updated_model)
        combined_evidence = {**inv_evidence, **do_evidence}
        query = inference.query(
            variables=query_vars, evidence=combined_evidence, show_progress=False)
        self.cached_cdn_queries[key] = query
        return query

    def EU(self, do_evidence, inv_evidence, pcc, obs_only=False):
        """
        Computes the expected utility given the do and inv evidence.
        """
        cache_key = (frozenset(do_evidence.items()), frozenset(
            inv_evidence.items()), pcc, obs_only)
        if cache_key in self.cached_eus:
            return self.cached_eus[cache_key]

        inv_copy = inv_evidence.copy()
        do_copy = do_evidence.copy()

        unknown_util_vars = (set(self.util_nodes) -
                             set(do_copy.keys())) - set(inv_copy.keys())
        total_utility = 0

        if len(unknown_util_vars) == 0:
            combined_evidence = {**do_copy, **inv_copy}
            combined_evidence = {
                key: val for key, val in combined_evidence.items() if key in self.util_nodes}
            score = self.util_func(combined_evidence)
            self.cached_eus[cache_key] = score
            return score

        query = self._cdn_query(unknown_util_vars, do_copy,
                                inv_copy, pcc, obs_only)
        for values_combination in itertools.product(*[range(self.model.get_cardinality(node)) for node in unknown_util_vars]):
            unknown_with_vals = list(
                zip(unknown_util_vars, values_combination))

            evidence = {**inv_copy, **do_copy, **dict(unknown_with_vals)}
            evidence = {key: val for key,
                        val in evidence.items() if key in self.util_nodes}
            utility = self.util_func(evidence)

            probability = query.get_value(**dict(unknown_with_vals))
            total_utility += utility * probability

        self.cached_eus[cache_key] = total_utility
        return total_utility

    def legal_actions(self, do_evidence, inv_evidence, do_none_evidence, inv_none_evidence, time):
        """
        Given the current evidence and time, returns a list of legal actions.
        Actions are legal if:
         - they do not exceed the time limit
         - for inv (tier-1) actions, the node is not already in inv_evidence
         - for do (tier-2) actions, the node is not already in do_evidence or do_none_evidence
           - it is allowed to intervene upon a node that is already in inv_evidence
         - for do_none actions, the node is not already in do_none_evidence or do_evidence
         - for inv_none actions, the node is not already in inv_none_evidence or inv_evidence

        """
        if time == 0:
            return []

        legal_actions = []
        for action in self.actions:
            node = action["node"]
            action_type = action["action_type"]
            time_cost = action["time_cost"]

            if time_cost > time:
                continue

            if action_type == "inv":
                if node not in inv_evidence and node not in do_evidence:
                    legal_actions.append(action)

            elif action_type == "do":
                if node not in do_evidence and node not in do_none_evidence:
                    # TODO Add obs_only parameter, where if true
                    # you can't intervene on a node that is already in inv_evidence
                    legal_actions.append(action)

            elif action_type == "do_none":
                if node not in do_none_evidence and node not in do_evidence:
                    legal_actions.append(action)

            elif action_type == "inv_none":
                if node not in inv_none_evidence and node not in inv_evidence:
                    legal_actions.append(action)

        return legal_actions

    def get_transitions(self, do_evidence, inv_evidence, do_none_evidence, inv_none_evidence, committed_action, pcc, obs_only):
        """
        Given the current evidence and a committed action, returns a list of possible transitions.
        Transitions are tuples of (future_state, transition_probability).
        Committed do (tier-2) actions return a single transition with the action applied.
        Committed inv (tier-1) actions return a list of transitions for each possible value of acted-upon node.
        """
        if committed_action["action_type"] == "do_none":
            return [(do_evidence, inv_evidence, do_none_evidence | {committed_action["node"]: None}, inv_none_evidence, 1)]
        elif committed_action["action_type"] == "inv_none":
            return [(do_evidence, inv_evidence, do_none_evidence, inv_none_evidence | {committed_action["node"]: None}, 1)]
        elif committed_action["action_type"] == "do":
            return [(do_evidence | {committed_action["node"]: committed_action["value"]}, inv_evidence, do_none_evidence, inv_none_evidence, 1)]
        elif committed_action["action_type"] == "inv":
            states_and_probs = []
            possible_values = range(
                self.model.get_cardinality(committed_action["node"]))

            probabilities = self._cdn_query(
                [committed_action["node"]], do_evidence, inv_evidence, pcc, obs_only)
            for value in possible_values:
                updated_inv_evidence = inv_evidence | {
                    committed_action["node"]: value}

                prob = probabilities.get_value(
                    **{committed_action["node"]: value})
                states_and_probs.append(
                    (do_evidence, updated_inv_evidence, do_none_evidence, inv_none_evidence, prob))

            return states_and_probs

    def expectimax_search(self, node_type, do_evidence, inv_evidence, do_none_evidence, inv_none_evidence, committed_action, time, pcc, obs_only, method):
        """
        Performs (causal) expectimax search on the CDN and returns a tuple of (best_action, expected_utility).
        The search is performed recursively, with the node type determining whether the current search tree node is a chance node or a max node.

        # Method refers to the type of search to perform
          - "ES" for expectimax search
            - treats all evidence as tier-1 (inv) evidence
          - "CES" for causal expectimax search
            - allows for both tier-1 (inv) and tier-2 (do) evidence
        """

        if method != "ES" and committed_action and committed_action["action_type"] == "do":
            # This propagates the do action through the model, updating all evidence accordingly.
            # The built in pgmpy do method does not handle this correctly, so we do it manually.
            # It may be worth expirementing with the pgmpy do method in the future.
            # https://pgmpy.org/models/bayesiannetwork.html#pgmpy.models.DiscreteBayesianNetwork.DiscreteBayesianNetwork.do
            descendants = nx.descendants(self.model, committed_action["node"])
            do_evidence = {key: val for key,
                           val in do_evidence.items() if key not in descendants}
            inv_evidence = {key: val for key,
                            val in inv_evidence.items() if key not in descendants}
            do_none_evidence = {
                key: val for key, val in do_none_evidence.items() if key not in descendants}
            inv_none_evidence = {
                key: val for key, val in inv_none_evidence.items() if key not in descendants}

        if node_type == "chance":
            result = self.chance_node(do_evidence, inv_evidence, do_none_evidence,
                                      inv_none_evidence, committed_action, time, pcc, obs_only, method)
            return result
        elif node_type == "max":
            result = self.max_node(do_evidence, inv_evidence, do_none_evidence,
                                   inv_none_evidence, time, pcc, obs_only, method)
            return result

    def chance_node(self, do_evidence, inv_evidence, do_none_evidence, inv_none_evidence, committed_action, time, pcc, obs_only, method):
        """
        Performs the logic for the chance node in the expectimax search.
        Calculates the expected utility of the future states given the current evidence and committed action.
        Multiplies each future state's utility by its transition probability and sums them up to get the expected utility.
        """
        key = (frozenset(do_evidence.items()),
               frozenset(inv_evidence.items()),
               frozenset(committed_action.items()),
               time, pcc, obs_only, method)

        expected = 0

        self.cached_chance_nodes[key] = {}
        for future_state in self.get_transitions(do_evidence, inv_evidence, do_none_evidence, inv_none_evidence, committed_action, pcc, obs_only):
            if committed_action["action_type"] == "inv":
                new_evidence_key = {
                    k: v for k, v in future_state[1].items() if k not in inv_evidence}
                self.cached_chance_nodes[key][list(new_evidence_key.items())[0]] = (
                    frozenset(future_state[0].items()), frozenset(future_state[1].items()), time)

            _, val = self.expectimax_search(
                "max", future_state[0], future_state[1], future_state[2], future_state[3], None, time, pcc, obs_only, method)

            transition_prob = future_state[4]
            expected += val * transition_prob

        # TODO make this a dict
        return (None, expected)  # (best_action, expected_utility)

    def max_node(self, do_evidence, inv_evidence, do_none_evidence, inv_none_evidence, time, pcc, obs_only, method):
        """
        Performs the logic for the max node in the expectimax search.
        Searches for the best action to take given the current evidence and time.
        """
        key = (frozenset(do_evidence.items()), frozenset(
            inv_evidence.items()), time, pcc, obs_only, method)
        if key in self.cached_max_nodes:
            return self.cached_max_nodes[key]

        legal_actions = self.legal_actions(
            do_evidence, inv_evidence, do_none_evidence, inv_none_evidence, time)
        if len(legal_actions) == 0:
            EU = self.EU(do_evidence, inv_evidence, pcc, obs_only)
            self.cached_max_nodes[key] = (None, EU)
            return (None, EU)

        best_moves, best_val = [], -np.inf
        for action in legal_actions:
            _, val = self.expectimax_search("chance", do_evidence, inv_evidence, do_none_evidence,
                                 inv_none_evidence, action, time - action["time_cost"], pcc, obs_only, method)

            if val > best_val:
                best_moves = [action]
                best_val = val
            elif val == best_val and action["action_type"] == "inv":
                best_moves = [action]

        self.cached_max_nodes[key] = (best_moves[0], best_val)
        return (best_moves[0], best_val)

    """
    Below are the methods for generating and utilizing the conditional courses of action (COA).
    """

    def linear(self, coa, tree, parent_id, id_dict, edge_labels, node_names, sub_tree_id=None):
        """One of two (linear and branch) methods to convert a string COA into a tree structure."""
        if len(coa) == 0:
            return id_dict, edge_labels

        id_dict['node_count'] += 1
        sub_tree_root = coa[0]
        tree.add_node(id_dict['node_count'])
        node_names[id_dict['node_count']] = sub_tree_root
        if parent_id is not None:
            tree.add_edge(parent_id, id_dict['node_count'])
        parent_id = id_dict['node_count']

        if sub_tree_id is None:
            sub_tree_id = id_dict['node_count']
        if len(coa) > 1:
            if isinstance(coa[1], str):
                self.linear(coa[1:], tree, parent_id, id_dict,
                            edge_labels, node_names, sub_tree_id)
            if isinstance(coa[1], dict):
                self.branch(coa[1:], tree, parent_id, id_dict,
                            edge_labels, node_names, sub_tree_id)
        return sub_tree_id

    def branch(self, coa, tree, parent_id, id_dict, edge_labels, node_names, sub_tree_id):
        """One of two (linear and branch) methods to convert a string COA into a tree structure."""
        [coa] = coa
        for edge, branch in coa.items():
            if len(branch) == 0:
                continue

            sub_tree_id = self.linear(
                branch, tree, parent_id, id_dict, edge_labels, node_names, sub_tree_id=None)
            edge_labels[(parent_id, sub_tree_id)] = edge

    def coa_to_tree(self, coa):
        """Converts a string conditional course of action (COA) into a tree structure with recursive helpers."""
        tree = nx.DiGraph()
        id_dict = {'node_count': 0}
        edge_labels = {}
        node_names = {}
        self.linear(coa, tree, None, id_dict, edge_labels, node_names)

        return tree, node_names, edge_labels

    def all_trees_same(self, trees, node_names):
        """Checks if all trees in a list are the same. Returns True if they are, False otherwise."""
        for i in range(len(trees) - 1):
            if not nx.is_isomorphic(trees[i], trees[i+1]):
                return False
        for i in range(len(trees) - 1):
            if not all([node_names[n1] == node_names[n2] for n1, n2 in zip(trees[i].nodes, trees[i+1].nodes)]):
                return False
        return True

    def simplify_tree(self, tree, node_names, edge_labels):
        """
        Simplifies the tree by removing nodes that have the same subtree structure and merging their edges.
        """
        # emulating a do while loop in Python
        changes_made = True
        while changes_made:
            changes_made = False
            queue = [n for n, d in tree.in_degree() if d == 0]
            while len(queue) > 0:
                current = queue.pop(0)
                # continue if current is no longer in the tree
                if current not in tree.nodes:
                    continue
                children = list(tree.successors(current))

                child_trees = [nx.dfs_tree(tree, child) for child in children]

                if len(children) > 1 and self.all_trees_same(child_trees, node_names):
                    parent = [n for n in tree.predecessors(current)][0] if len(
                        list(tree.predecessors(current))) > 0 else None
                    tree.remove_node(current)
                    if parent is not None:
                        edge_labels[(parent, children[0])] = (parent, current)
                        tree.add_edge(parent, children[0])
                    # remove the other subtrees and their nodes and edges from the node_names and edge_labels dictionaries
                    for child in child_trees[1:]:
                        for node in child.nodes:
                            del node_names[node]
                            tree.remove_node(node)
                        for edge in child.edges:
                            if edge in edge_labels:
                                del edge_labels[edge]

                    if current in node_names:
                        del node_names[current]
                    if (parent, current) in edge_labels:
                        del edge_labels[(parent, current)]

                    changes_made = True
                tree, node_names, edge_labels = self.renumber_nodes(
                    tree, node_names, edge_labels)

                if len(children) > 0:
                    queue.extend(children)

        return tree, node_names, edge_labels

    def renumber_nodes(self, tree, node_names, edge_labels):
        """
        Renumbers the nodes in the tree to ensure they are consecutive starting from 1.
        """
        # if the node names are consecutive, return the tree as is
        if all([node == i+1 for i, node in enumerate(sorted(tree.nodes))]):
            return tree, node_names, edge_labels
        # if the node_names are not consecutive, renumber them
        nodes = list(tree.nodes())
        node_map = {old_node: new_node for new_node, old_node in enumerate(
            sorted(nodes), 1)}  # {old node number : new node number}
        # {new node number : old node number}
        new_to_old = {new_node: old_node for old_node,
                      new_node in node_map.items()}

        tree = nx.relabel_nodes(tree, node_map)
        node_names = {node_map[old_node]: name for old_node,
                      name in node_names.items() if old_node in node_map}

        new_edge_labels = {}
        # put all edges with the same parent in a nested list
        edges_sorted_by_parent = [[edge for edge in tree.edges if edge[0] == parent]
                                  for parent in tree.nodes if len([edge for edge in tree.edges if edge[0] == parent]) > 0]
        for edges in edges_sorted_by_parent:
            if node_names[edges[0][0]].startswith("do"):
                new_edge_labels[edges[0]] = ""
            elif node_names[edges[0][0]].startswith("do_none"):
                new_edge_labels[edges[0]] = ""
            elif node_names[edges[0][0]].startswith("inv_none"):
                new_edge_labels[edges[0]] = ""
            else:
                for num, edge in enumerate(edges):
                    old_u, old_v = new_to_old[edge[0]], new_to_old[edge[1]]
                    action_name = edge_labels[(old_u, old_v)][0]
                    new_edge_labels[edge] = str(action_name) + ": " + str(num)

        return tree, node_names, new_edge_labels

    def tree_to_coa(self, tree, node_names, edge_labels):
        """
        Converts a tree structure back into a list of strings conditional course of action (COA) format.
        """
        coa = []
        root = [n for n, d in tree.in_degree() if d == 0][0]
        coa.append(node_names[root])

        coa.append(self.recursive_tree_to_coa(
            tree, node_names, edge_labels, root))
        return coa

    def recursive_tree_to_coa(self, tree, node_names, edge_labels, current_node):
        """
        converts networkx tree to a string list COA format recursively.
        """
        # keys are the edges, values are the results of recursively calling on the children
        edges = []
        for child in tree.successors(current_node):
            if (current_node, child) in edge_labels:
                edges.append(edge_labels[(current_node, child)])
            else:
                edges.append("")
        sub_coas = []
        for child in tree.successors(current_node):
            sub_tree = nx.dfs_tree(tree, child)
            sub_coas.append(self.tree_to_coa(
                sub_tree, node_names, edge_labels))

        sub_coas = {edge: sub_coa for edge, sub_coa in zip(edges, sub_coas)}
        return sub_coas

    def prettify_COA(self, data):
        """
        removes excess [ ], and converts actions to a more readable format
        """
        if isinstance(data, list):
            return [self.prettify_COA(item) for item in data]
        elif isinstance(data, dict):
            if 'node' in data:
                action_type = data['action_type']
                node_name = data['node']
                if action_type == 'do':
                    return f"do({node_name}={data['value']})"
                else:
                    return f"{action_type}({node_name})"
            else:
                return {key: self.prettify_COA(value) for key, value in data.items()}

        return data

    def generate_COA(self, do_evidence, inv_evidence, do_none_evidence, inv_none_evidence, time, pcc, obs_only, method, simplified=True):
        """
        recursively generates a conditional course of action (COA) using max_COA and chance_COA methods.
        then cleans up the COA and simplifies the COA
        """
        result = self.max_COA(do_evidence, inv_evidence, do_none_evidence,
                              inv_none_evidence, time, pcc, obs_only, method)
        pretty = self.prettify_COA(result)
        if not simplified:
            return pretty

        coa_tree, node_names, edge_labels = self.coa_to_tree(pretty)
        simplified_tree, node_names, edge_labels = self.simplify_tree(
            coa_tree, node_names, edge_labels)
        simplified_coa = self.tree_to_coa(
            simplified_tree, node_names, edge_labels)
        return simplified_coa

    def max_COA(self, do_evidence, inv_evidence, do_none_evidence, inv_none_evidence, time, pcc, obs_only, method):
        """
        One of two recursive methods to generate a conditional course of action (COA).
        """
        key = (frozenset(do_evidence.items()), frozenset(
            inv_evidence.items()), time, pcc, obs_only, method)

        best_action = None

        if key in self.cached_max_nodes:
            if self.cached_max_nodes[key][0] is not None and len(self.cached_max_nodes[key][0]) > 0:
                best_action = self.cached_max_nodes[key][0]
        else:
            raise ValueError(
                "key not in cached_max_nodes: FIX THIS IN max_COA")

        if best_action is None or len(self.legal_actions(do_evidence, inv_evidence, do_none_evidence, inv_none_evidence, time)) == 0:
            return []

        if best_action["action_type"] == "do":
            transition = self.get_transitions(
                do_evidence, inv_evidence, do_none_evidence, inv_none_evidence, best_action, pcc, obs_only)[0]
            state = (transition[0], transition[1], do_none_evidence,
                     inv_none_evidence, time - best_action["time_cost"])

            return [best_action] + self.max_COA(*state, pcc, obs_only, method)
        return [best_action, self.chance_COA(do_evidence, inv_evidence, do_none_evidence, inv_none_evidence, best_action, time - best_action["time_cost"], pcc, obs_only, method)]

    def chance_COA(self, do_evidence, inv_evidence, do_none_evidence, inv_none_evidence, committed_action, time, pcc, obs_only, method):
        """
        One of two recursive methods to generate a conditional course of action (COA).
        """
        key = (frozenset(do_evidence.items()),
               frozenset(inv_evidence.items()),
               frozenset(committed_action.items()),
               time, pcc, obs_only, method)
        transitions = self.cached_chance_nodes[key]

        result = {}
        for transition_key, transition in transitions.items():
            state = (dict(transition[0]), dict(
                transition[1]), do_none_evidence, inv_none_evidence, transition[2])
            result[transition_key] = self.max_COA(
                *state, pcc, obs_only, method)

        return result

    def policy_iteration(self, do_evidence, inv_evidence, do_none_evidence, inv_none_evidence, time, pcc=False, obs_only=False, max_iterations=1000, gamma=0.95):
        """
        Performs policy iteration to generate an optimal policy for the CDN.
        Returns a tuple of (policy, values) where policy maps states to actions.
        """
        # Get a list of all possible states
        possible_states = self.populate_states(
            (do_evidence, inv_evidence, do_none_evidence, inv_none_evidence, time))

        # Initialize with a random policy
        policy = {}
        for state_key in possible_states:
            state_dict = self.state_from_key(state_key, pcc)
            legal_acts = self.legal_actions(
                state_dict['do_evidence'], state_dict['inv_evidence'],
                state_dict['do_none_evidence'], state_dict['inv_none_evidence'],
                state_dict['time']
            )
            if legal_acts:
                policy[state_key] = random.choice(legal_acts)
            else:
                policy[state_key] = None
        
        for iteration in range(max_iterations):
            # Policy Evaluation
            values = self.policy_evaluation(policy, possible_states, pcc, obs_only, gamma)
            
            # Policy Improvement
            new_policy = self.policy_improvement(values, possible_states, pcc, obs_only, gamma)
            
            # Check for convergence
            if new_policy == policy:
                break
            
            policy = new_policy
        
        return policy, values

    def populate_states(self, initial_state):
        """
        Enumerates all possible reachable states from the initial state by exploring the state space.
        Returns a list of state tuples that can be hashed.
        """
        initial_do, initial_inv, initial_do_none, initial_inv_none, initial_time = initial_state
        states = []
        visited = set()
        queue = [(initial_do, initial_inv, initial_do_none, initial_inv_none, initial_time)]
        
        while queue:
            do_ev, inv_ev, do_none_ev, inv_none_ev, time_left = queue.pop(0)
            
            # Create a hashable state key
            state_key = (
                frozenset(do_ev.items()),
                frozenset(inv_ev.items()),
                frozenset(do_none_ev.items()),
                frozenset(inv_none_ev.items()),
                time_left
            )
            
            if state_key in visited:
                continue
            visited.add(state_key)
            states.append(state_key)
            
            # Explore transitions from all legal actions
            legal_acts = self.legal_actions(do_ev, inv_ev, do_none_ev, inv_none_ev, time_left)
            for action in legal_acts:
                transitions = self.get_transitions(do_ev, inv_ev, do_none_ev, inv_none_ev, action, False, False)
                for next_do, next_inv, next_do_none, next_inv_none, _ in transitions:
                    new_time = time_left - action["time_cost"]
                    if new_time >= 0:
                        queue.append((next_do, next_inv, next_do_none, next_inv_none, new_time))
        
        return states

    def state_from_key(self, state_key, pcc=False):
        """Convert a hashable state key back to a dictionary for use in methods."""
        do_ev, inv_ev, do_none_ev, inv_none_ev, time_left = state_key
        return {
            'do_evidence': dict(do_ev),
            'inv_evidence': dict(inv_ev),
            'do_none_evidence': dict(do_none_ev),
            'inv_none_evidence': dict(inv_none_ev),
            'time': time_left,
            'pcc': pcc,
            'obs_only': False
        }

    def policy_evaluation(self, policy, states, pcc=False, obs_only=False, gamma=0.95, max_iterations=1000):
        """
        Evaluate a given policy by computing state values.
        policy: dict mapping state keys to actions
        states: list of all possible state keys
        pcc: whether to use pseudo-counterfactual inference
        obs_only: whether to only observe (not intervene)
        gamma: discount factor
        """
        values = {state_key: 0.0 for state_key in states}
        
        for _ in range(max_iterations):
            delta = 0.0
            for state_key in states:
                old_value = values[state_key]
                state_dict = self.state_from_key(state_key, pcc)
                action = policy.get(state_key)
                
                if action is None:
                    # No legal actions, use terminal utility
                    values[state_key] = self.EU(
                        state_dict['do_evidence'], state_dict['inv_evidence'],
                        pcc, obs_only
                    )
                    continue
                
                # Get possible transitions from this action
                transitions = self.get_transitions(
                    state_dict['do_evidence'], state_dict['inv_evidence'],
                    state_dict['do_none_evidence'], state_dict['inv_none_evidence'],
                    action, pcc, obs_only
                )
                
                # V(s) = gamma * sum(P(s'|s,a) * V(s'))
                # No immediate reward - only terminal states have utility
                expected_future = 0.0
                for next_do, next_inv, next_do_none, next_inv_none, prob in transitions:
                    new_time = state_dict['time'] - action["time_cost"]
                    next_state_key = (
                        frozenset(next_do.items()),
                        frozenset(next_inv.items()),
                        frozenset(next_do_none.items()),
                        frozenset(next_inv_none.items()),
                        new_time
                    )
                    expected_future += prob * values.get(next_state_key, 0.0)
                
                values[state_key] = gamma * expected_future
                delta = max(delta, abs(old_value - values[state_key]))
            
            if delta < 1e-6:
                break
        
        return values

    def policy_improvement(self, values, states, pcc=False, obs_only=False, gamma=0.95):
        """
        Improve the policy by finding the best action for each state.
        """
        new_policy = {}
        
        for state_key in states:
            state_dict = self.state_from_key(state_key, pcc)
            best_action = None
            best_value = -np.inf
            
            legal_actions = self.legal_actions(
                state_dict['do_evidence'], state_dict['inv_evidence'],
                state_dict['do_none_evidence'], state_dict['inv_none_evidence'],
                state_dict['time']
            )
            
            if not legal_actions:
                # No legal actions available
                new_policy[state_key] = None
                continue
            
            for action in legal_actions:
                transitions = self.get_transitions(
                    state_dict['do_evidence'], state_dict['inv_evidence'],
                    state_dict['do_none_evidence'], state_dict['inv_none_evidence'],
                    action, pcc, obs_only
                )
                
                expected_future = 0.0
                for next_do, next_inv, next_do_none, next_inv_none, prob in transitions:
                    new_time = state_dict['time'] - action["time_cost"]
                    next_state_key = (
                        frozenset(next_do.items()),
                        frozenset(next_inv.items()),
                        frozenset(next_do_none.items()),
                        frozenset(next_inv_none.items()),
                        new_time
                    )
                    expected_future += prob * values.get(next_state_key, 0.0)
                
                action_value = gamma * expected_future
                
                if action_value > best_value:
                    best_value = action_value
                    best_action = action
            
            new_policy[state_key] = best_action
        
        return new_policy
    