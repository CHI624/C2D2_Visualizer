"""
This visualization was written for a specific presentation and is therefor not very general.
There are many instances where I had to hardcode values specific to our example and model.
However, it can be used as a starting point for a more general interactive platform.

To run the GUI, simply execute this script.

It utilizes tkinter for the GUI, and networkx for the graph representation.
I've found that used paned windows in tkinter is a great way to create a flexible layout.
Building flexibility in early on is a good idea, as it allows for easy adjustments later.

# TODO add edge probabilities to the edge labels in the COA tree
"""


from collections import deque
import re
from copy import deepcopy
import tkinter as tk
from tkinter import ttk
import networkx as nx
import numpy as np
from matplotlib.figure import Figure
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from pgmpy.sampling import BayesianModelSampling
from models import safety, success, mix

FONT_FAMILY = "Roman"
FONT_SIZE = 18
NODE_COLOR = "lightgrey"


class State():
    """
    This class holds the state information (evidence, caches, etc) and related methods for the visualization.
    """

    def __init__(self, sim_params):
        self.tree = nx.DiGraph()
        self.node_names = {}
        self.edge_labels = {}

        self.selected_actions = []
        self.node_highlight_color = 'yellow'

        self.do_ev = {}
        self.inv_ev = {}
        self.do_none_ev = {}
        self.inv_none_ev = {}
        self.time_remaining = sim_params["time"]

        self.inference = sim_params["inference"]
        self.hidden_state = sim_params["hidden_state"]

        self.text_logs = []

    def update_text_logs(self, action=None) -> None:
        """
        Convert the given action to log message format and append it to the text logs.
        If the action is an investigation, also append the result of the investigation.
        """
        self.text_logs.append(self.action_to_log(action))
        if action["action_type"] == "inv":
            self.text_logs.append(self.result_to_log(action))

    def result_to_log(self, action) -> str:
        """
        Convert the result of an investigation action to a log message.
        Currently hardcoded for our specific example so that message format 
        matches expected ARL combat message format.
        Could be generalized to a more flexible format if combat messages not needed.
        """
        val = self.hidden_state[action["node"]][0]
        if action["node"] == "Weather Status":
            if val == 0:
                return "Weather is clear."
            else:
                return "Weather is inclement."
        elif action["node"] == "Enemy Presence":
            if val == 0:
                return "No enemy presence detected."
            else:
                return "Enemy presence detected."
        elif action["node"] == "Enemy ATK/Artillery":
            if val == 0:
                return "No enemy artillery detected."
            else:
                return "Enemy artillery detected."
        else:
            raise ValueError(
                f"result_to_log: Investigation {action} not known.")

    def action_to_log(self, action) -> str:
        """
        Convert an action from dictionary format to a log message.
        Currently hardcoded for our specific example so that message format 
        matches expected ARL combat message format.
        Could be generalized to a more flexible format if combat messages not needed.
        """
        current_time = self.time_remaining
        message = f"[{current_time}] "
        if action["action_type"] == "do" and action["value"] == 0 and action["node"] == "Ribbon Bridge Status":
            return message + "Ribbon Bridge has been retracted. Units cannot cross."
        elif action["action_type"] == "do" and action["value"] == 1 and action["node"] == "Ribbon Bridge Status":
            return message + "Ribbon Bridge has been deployed. Units can cross."
        elif action["action_type"] == "inv" and action["node"] == "Weather Status":
            return message + "Investigating imminent weather conditions. Adjusting operational parameters."
        elif action["action_type"] == "do" and action["value"] == 0 and action["node"] == "Fire Across Gap":
            return message + "Ceasing suppression fire across gap."
        elif action["action_type"] == "do" and action["value"] == 1 and action["node"] == "Fire Across Gap":
            return message + "Initiating suppression fire across gap."
        elif action["action_type"] == "inv" and action["node"] == "Enemy Presence":
            return message + "Investigating enemy presence."
        elif action["action_type"] == "inv" and action["node"] == "Enemy ATK/Artillery":
            return message + "Investigating enemy artillery presence."
        elif action["action_type"] == "do" and action["value"] == 0 and action["node"] == "Enemy ATK/Artillery":
            return message + "Initiating suppression of enemy artillery."
        elif action["action_type"] == "do" and action["value"] == 1 and action["node"] == "Enemy ATK/Artillery":
            return message + "Ceasing to suppress enemy artillery."
        elif action["action_type"] == "do_none" or action["action_type"] == "inv_none":
            return message + f"No action taken for {action['node']}."
        else:
            raise ValueError("Unexpected action in action_to_log.")

    def _find_descendant_nodes(self, node):
        """
        Given a node name, returns a list of all descendant nodes in the model.
        Descendant nodes are all children, grandchildren, etc. of the given node.
        """
        graph = {}

        for edge in self.tree.edges():
            parent, child = edge
            if parent not in graph:
                graph[parent] = []
            graph[parent].append(child)

        children_nodes = set()
        visited = set()

        queue = deque([node])

        while queue:
            current_node = queue.popleft()
            if current_node not in visited:
                visited.add(current_node)
                if current_node in graph:
                    for child in graph[current_node]:
                        children_nodes.add(child)
                        queue.append(child)

        return list(children_nodes)

    def update_evidence(self, action) -> None:
        """
        Given an action, updates the evidence in the state.
        If the action is an investigation, it updates the evidence with the value from the hidden state.
        If the action is a "do" action, it updates the evidence with the value from the action and propagates throughout the state.
        """
        if action["action_type"] == "do":
            descendants = self._find_descendant_nodes(action["node"])
            self.do_ev = {key: val for key,
                          val in self.do_ev.items() if key not in descendants}
            self.inv_ev = {key: val for key,
                           val in self.inv_ev.items() if key not in descendants}
            self.do_none_ev = {
                key: val for key, val in self.do_none_ev.items() if key not in descendants}
            self.inv_none_ev = {
                key: val for key, val in self.inv_none_ev.items() if key not in descendants}

        if action["action_type"] == "do":
            self.do_ev[action["node"]] = action["value"]
        elif action["action_type"] == "inv":
            self.inv_ev[action["node"]] = self.hidden_state[action["node"]][0]
        elif action["action_type"] == ("do_none" or "inv_none"):
            self.do_none_ev[action["node"]] = None


class Visualizer():
    """
    This class is responsible for the visualization of the COA tree and the model.
    It initializes the GUI, handles user interactions, and updates the COA tree and 
    model visualization.
    """

    def __init__(self, sim_params):
        """ 
        Uses different models for different utilities. I tried just updating the utility in a 
        single model, but it didnt work (maybe because of caching?).
        """
        self.safety_model = safety.model
        self.success_model = success.model
        self.mix_model = mix.model

        hidden_state = BayesianModelSampling(
            self.safety_model.model).forward_sample(size=1, show_progress=False)
        # Set initial values for the hidden state that we know to be true in our scenario.
        hidden_state.loc[0, "Ribbon Bridge Status"] = 0
        hidden_state.loc[0, "Fire Across Gap"] = 0

        self.inference = BayesianModelSampling(self.safety_model.model)
        sim_params["hidden_state"] = hidden_state
        sim_params["inference"] = self.inference

        self.sim_params = sim_params
        self.state = State(sim_params)

        # Create the root window
        self.root = tk.Tk()
        self.root.title("Wet Gap Crossing")

        # Create a paned window
        self.paned_window_horizontal = ttk.PanedWindow(
            self.root, orient=tk.HORIZONTAL)
        self.paned_window_horizontal.pack(fill=tk.BOTH, expand=True)

        # Create the widgets
        self.frame1 = tk.Frame(self.paned_window_horizontal, bg="lightgray")
        self.paned_window_horizontal.add(self.frame1, weight=1)

        self.paned_window_vertical = ttk.PanedWindow(
            self.paned_window_horizontal, orient=tk.VERTICAL)
        self.paned_window_horizontal.add(self.paned_window_vertical, weight=1)

        self.frame2_top = tk.Frame(self.paned_window_vertical, bg="lightblue")
        self.paned_window_vertical.add(self.frame2_top, weight=1)

        self.frame2_middle = tk.Frame(
            self.paned_window_vertical, bg="lightyellow")
        self.paned_window_vertical.add(self.frame2_middle, weight=1)

        self.frame2_bottom = tk.Frame(
            self.paned_window_vertical, bg="lightgreen")
        self.paned_window_vertical.add(self.frame2_bottom, weight=1)

        # add content to the frames

        # left pane (COA Tree)
        self.label1 = tk.Label(self.frame1, text="COA Tree",
                               fg="black", bg="lightgrey", font=(FONT_FAMILY, FONT_SIZE))
        self.label1.pack(padx=10, pady=10)
        # canvas for the tree
        self.coa_canvas = tk.Canvas(self.frame1, bg="white")
        self.coa_canvas.pack(ipadx=5, ipady=5, padx=10,
                             pady=10, fill=tk.BOTH, expand=True)

        # right pane top (Time Remaining and Buttons)
        starting_time = sim_params["time"]
        self.time_remaining_label = tk.Label(
            self.frame2_top, text=f"Time Remaining {starting_time}.", fg="black", bg="lightblue", font=(FONT_FAMILY, FONT_SIZE))
        self.time_remaining_label.pack(padx=10, pady=10)
        self.time_remaining_label.config(font=(FONT_FAMILY, FONT_SIZE))

        self.button_frame = tk.Frame(self.frame2_top, bg="lightblue")
        self.button_frame.pack(padx=10, pady=10)

        self.success_button = tk.Button(self.button_frame, text="Success", command=lambda: self.update_coa_tree(
            "success"), font=(FONT_FAMILY, FONT_SIZE))
        self.success_button.pack(side=tk.LEFT, padx=5)

        self.safety_button = tk.Button(self.button_frame, text="Safety", command=lambda: self.update_coa_tree(
            "safety"), font=(FONT_FAMILY, FONT_SIZE))
        self.safety_button.pack(side=tk.LEFT, padx=5)

        self.mix_button = tk.Button(self.button_frame, text="Mixed", command=lambda: self.update_coa_tree(
            "mix"), font=(FONT_FAMILY, FONT_SIZE))
        self.mix_button.pack(side=tk.LEFT, padx=5)

        self.reset_button = tk.Button(
            self.button_frame, text="Reset", command=self.reset, font=(FONT_FAMILY, FONT_SIZE))
        self.reset_button.pack(side=tk.LEFT, padx=5)

        # right pane middle (Text Logs)
        self.label2_middle = tk.Label(self.frame2_middle, text="Text Logs",
                                      fg="black", bg="lightyellow", font=(FONT_FAMILY, FONT_SIZE))
        self.label2_middle.pack(padx=10, pady=10)

        self.text_box = tk.Text(self.frame2_middle, height=10,
                                width=25, wrap="word", font=(FONT_FAMILY, FONT_SIZE))
        self.text_box.pack(pady=5, fill=tk.BOTH, expand=True)

        # right pane bottom (Network Visualization)
        self.label2_bottom = tk.Label(self.frame2_bottom, text="Network Visualization",
                                      fg="black", bg="lightgreen", font=(FONT_FAMILY, FONT_SIZE))
        self.label2_bottom.pack(padx=10, pady=10)
        # canvas for the model
        self.model_canvas = tk.Canvas(self.frame2_bottom, bg="white")
        self.model_canvas.pack(ipadx=5, ipady=5, padx=10,
                               pady=10, fill=tk.BOTH, expand=True)
        self.draw_model()

        # Start the main event loop
        self.root.mainloop()

    def reset(self) -> None:
        """
        Resets the visualizer to it's initial state.
        """
        self.clear_caches()
        self.state = State(self.sim_params)
        self.draw_figure()
        self.time_remaining_label.config(
            text=f"Time remaining: {self.state.time_remaining}.")
        self.text_box.delete(1.0, tk.END)

    def clear_caches(self):
        """
        Clears all caches in the CDN. This is necessary before performing a search with a new utility.
        """
        self.cdn.cached_pcc_queries = {}
        self.cdn.cached_cdn_queries = {}

        self.cdn.cached_max_nodes = {}
        self.cdn.cached_chance_nodes = {}

        self.cdn.starting_hidden_states = {}
        self.cdn.cached_eus = {}
        self.cdn.cached_nodes = {}

    def _create_initial_tree(self, sub_tree, sub_edge_labels, sub_node_names) -> None:
        """
        Initializes the COA tree with the first action.
        Called in update_figure_and_draw if the tree is empty.
        """
        self.state.tree = sub_tree
        self.state.edge_labels = sub_edge_labels
        self.state.node_names = sub_node_names
        self.state.selected_actions.append(list(sub_tree.nodes)[0])

    def update_figure_and_draw(self, sub_tree, sub_edge_labels, sub_node_names) -> None:
        """
        Updates the COA tree with the new subtree and draws the figure.
        If the tree is empty, it initializes the tree with the first action.
        """
        if not self.state.tree.nodes:
            self._create_initial_tree(
                sub_tree, sub_edge_labels, sub_node_names)
        else:
            selected_action_names = {}
            for action in self.state.selected_actions:
                selected_action_names[action] = self.state.node_names[action]
            selected_action_edge_labels = {
                key: value for key, value in sub_edge_labels.items() if key in selected_action_names}

            self.state.tree = nx.DiGraph()
            self.state.node_names = selected_action_names
            self.state.edge_labels = selected_action_edge_labels

            self.state.tree.add_nodes_from(self.state.selected_actions)
            for i in range(len(self.state.selected_actions) - 1):
                self.state.tree.add_edge(
                    self.state.selected_actions[i], self.state.selected_actions[i + 1])

            sub_tree = nx.relabel_nodes(sub_tree, {
                                        node: node + len(self.state.selected_actions) for node in sub_tree.nodes})
            sub_node_names = {
                key + len(self.state.selected_actions): value for key, value in sub_node_names.items()}
            sub_edge_labels = {(key[0] + len(self.state.selected_actions), key[1] + len(
                self.state.selected_actions)): value for key, value in sub_edge_labels.items()}

            self.state.tree = nx.compose(self.state.tree, sub_tree)
            self.state.tree.add_edge(
                self.state.selected_actions[-1], list(sub_tree.nodes)[0])

            self.state.node_names.update(sub_node_names)
            self.state.edge_labels.update(sub_edge_labels)

            self.state.selected_actions.append(list(sub_tree.nodes)[0])

        self.draw_model()
        self.draw_figure()

    def _node_colors(self) -> list:
        """
        Returns a list of node colors based on the selected actions.
        The last selected action is highlighted in light green or yellow based on the action type.
        """
        node_colors = [NODE_COLOR] * len(self.state.tree.nodes)
        for i in range(len(self.state.selected_actions)):
            node_colors[i] = 'grey'
        if len(self.state.selected_actions) > 0:
            if action_name := self.state.node_names[self.state.selected_actions[-1]]:
                if action_name.startswith('do'):
                    node_colors[len(
                        self.state.selected_actions) - 1] = 'lightgreen'
                elif action_name.startswith('inv'):
                    node_colors[len(
                        self.state.selected_actions) - 1] = 'yellow'
        return node_colors

    def draw_figure(self) -> None:
        """
        Draws the COA tree using networkx and matplotlib.
        It updates the node colors based on the selected actions and draws the labels.
        """
        for key in self.state.edge_labels.keys():
            if label := self.state.edge_labels[key]:
                self.state.edge_labels[key] = label[-1]

        node_colors = self._node_colors()

        pos = nx.drawing.nx_pydot.pydot_layout(self.state.tree, prog="dot")

        fig = Figure(figsize=(7, 9), dpi=150)
        ax = fig.add_subplot(111)
        ax.set_frame_on(False)

        nx.draw(G=self.state.tree,
                pos=pos,
                arrows=True,
                node_color=node_colors,
                ax=ax,),

        # move the label's positions towards the center of the canvas on the x-axis
        label_pos = deepcopy(pos)
        label_pos_x = [x for x in label_pos.values()]
        center_x = np.mean(label_pos_x, axis=0)[0] if label_pos_x else 0
        for key in label_pos.keys():
            x, y = label_pos[key]
            if x < center_x:
                label_pos[key] = (x + 0.25 * (abs(x - center_x)), y)
            else:
                label_pos[key] = (x - 0.25 * (abs(x - center_x)), y)

        nx.draw_networkx_labels(G=self.state.tree,
                                pos=label_pos,
                                labels=self.state.node_names,
                                font_family='Times New Roman',
                                font_size=FONT_SIZE-6,
                                ax=ax,
                                )

        for k, v in self.state.edge_labels.items():
            if v:
                self.state.edge_labels[k] = v

        nx.draw_networkx_edge_labels(G=self.state.tree,
                                     pos=pos,
                                     edge_labels=self.state.edge_labels,
                                     ax=ax,
                                     font_family='Times New Roman',
                                     font_size=FONT_SIZE-6,
                                     )

        fig.tight_layout(pad=0)

        # Clear the previous canvas
        for widget in self.coa_canvas.winfo_children():
            widget.destroy()

        # Create a new canvas and draw the figure
        canvas = FigureCanvasTkAgg(fig, master=self.coa_canvas)
        canvas.draw()
        canvas.get_tk_widget().pack(ipadx=0, ipady=0, padx=50,
                                    pady=10, fill=tk.BOTH, expand=True)

    def draw_model(self):
        """
        Draws the CDN model using networkx and matplotlib.

        Currently hardcoded for the wet gap crossing example CDN.
        """
        model = self.safety_model

        state_nodes = model.model.nodes()
        utility_nodes = ['Safety', 'Success', 'Mix']
        utility_node_parents = {'Safety': ['Fire Across Gap', 'Enemy Fires'],
                                'Success': ['Ribbon Bridge Status', 'Ammo Supply'],
                                'Mix': ['Ribbon Bridge Status', 'Weather Status', 'Enemy Fires', 'Fire Across Gap']}

        edges = list(model.model.edges())

        # Add edges to utility node 'U'
        for node in utility_nodes:
            for parent in utility_node_parents[node]:
                edges.append((parent, node))

        fig = Figure(figsize=(8, 6))
        ax = fig.add_subplot(111)

        # Create a directed graph
        G = nx.DiGraph()

        node_colors = {node: 'lightgrey' for node in model.model.nodes()}
        if self.state.selected_actions and (action_name := self.state.node_names[self.state.selected_actions[-1]]):
            if action_name.startswith('do'):
                node_name = re.search(
                    r'\(([^=]+)=([^)]+)\)', action_name).group(1)
                node_colors[node_name] = 'lightgreen'
            elif action_name.startswith('inv'):
                node_name = re.search(r'\((.*?)\)', action_name).group(1)
                node_colors[node_name] = 'yellow'
        node_colors.update({node: 'orange' for node in utility_nodes})

        # Add state nodes
        for node in state_nodes:
            G.add_node(node, type='state_node', node_shape='o',
                       node_color=node_colors[node])

        # Add utility nodes
        for node in utility_nodes:
            G.add_node(node, type='util_node',
                       node_shape='D', node_color='white')

        G.add_edges_from(edges, color='black', arrows=True, arrowstyle='->')

        # Use layout to position nodes, adjust k to reduce overlap manually
        # pos = nx.spring_layout(G, k=0.5, iterations=50)  # Smaller k = less overlap, more iterations = better layout
        pos = {
            'Weather Status': (-0.85, 1),
            'Ammo Supply': (0, 1),
            'Enemy Presence': (0.85, 1),
            'Ribbon Bridge Status': (-0.8, 0),
            'Fire Across Gap': (0, 0),
            'Enemy Fires': (1, 0),
            'Enemy ATK/Artillery': (0.75, 0.5),
            'Success': (-1, -1),
            'Mix': (0, -1),
            'Safety': (1, -1),
        }

        node_colors = [node_colors[node] for node in G.nodes()]
        # Draw the graph
        nx.draw(G, pos, with_labels=True, labels={n: n for n in G.nodes()},
                node_size=300,  # Smaller node size
                node_color=node_colors,  # Node color
                node_shape='o',
                edge_color='black', arrows=True, ax=ax, font_size=FONT_SIZE-4)
        # make the utility nodes diamond shaped
        nx.draw_networkx_nodes(G, pos, nodelist=utility_nodes,
                               node_shape='D', node_color='orange', node_size=300, ax=ax)

        # Remove the axes
        ax.axis('off')  # This will turn off the x and y axes

        # Adjust the figure layout to ensure labels are not cut off
        fig.tight_layout(pad=0)

        # Put on the model canvas
        for widget in self.model_canvas.winfo_children():
            widget.destroy()

        canvas = FigureCanvasTkAgg(fig, master=self.model_canvas)
        canvas.draw()
        canvas.get_tk_widget().pack(ipadx=0, ipady=0, padx=0,
                                    pady=0, fill=tk.BOTH, expand=True)

    def name_to_action(self, node_name) -> dict:
        """
        Converts a node name to an action in the form of a dictionary to be used by the cdn class.
        Currently the action time costs are hardcoded for the wet gap crossing example.
        """
        if node_name.startswith("do("):
            match = re.match(r"do\(([^=]+)=([^)]+)\)", node_name)
            if match:
                return {"node": match.group(1), "action_type": "do", "value": int(match.group(2)), "time_cost": 2}
        elif node_name.startswith("inv("):
            match = re.match(r"inv\(([^)]+)\)", node_name)
            if match:
                return {"node": match.group(1), "action_type": "inv", "time_cost": 1}
        elif node_name.startswith("do_none("):
            match = re.match(r"do_none\(([^)]+)\)", node_name)
            if match:
                return {"node": match.group(1), "action_type": "do_none", "time_cost": 0}
        elif node_name.startswith("inv_none("):
            match = re.match(r"inv_none\(([^)]+)\)", node_name)
            if match:
                return {"node": match.group(1), "action_type": "inv_none", "time_cost": 0}

    def coa_to_tree(self, coa) -> nx.DiGraph:
        """
        Converts a COA (Course of Action) to a tree structure using the linear and branch recursive methods.
        """
        tree = nx.DiGraph()
        id_dict = {'node_count': 0}
        edge_labels = {}
        node_names = {}
        self.cdn.linear(coa, tree, None, id_dict, edge_labels, node_names)

        return {"tree": tree,
                "edge_labels": edge_labels,
                "node_names": node_names}

    def generate_sub_tree(self, selected_utility) -> nx.DiGraph:
        """
        Given a selected utility, generates a COA tree.

        Currently only supports three utilities: safety, success, and mix for the specific wet gap crossing example.
        """
        if selected_utility == "safety":
            self.cdn = safety.model
        elif selected_utility == "success":
            self.cdn = success.model
        elif selected_utility == "mix":
            self.cdn = mix.model
        self.clear_caches()
        self.cdn.expectimax_search(node_type="max",
                        do_evidence=self.state.do_ev,
                        inv_evidence=self.state.inv_ev,
                        do_none_evidence=self.state.do_none_ev,
                        inv_none_evidence=self.state.inv_none_ev,
                        committed_action=None,
                        time=self.state.time_remaining,
                        obs_only=self.sim_params["obs_only"],
                        method=self.sim_params["method"])

        coa = self.cdn.generate_COA(do_evidence=self.state.do_ev,
                                    inv_evidence=self.state.inv_ev,
                                    do_none_evidence=self.state.do_none_ev,
                                    inv_none_evidence=self.state.inv_none_ev,
                                    time=self.state.time_remaining,
                                    pcc=self.sim_params["pcc"],
                                    obs_only=self.sim_params["obs_only"],
                                    method=self.sim_params["method"],
                                    simplified=True)

        sub_tree = self.coa_to_tree(coa)

        return sub_tree

    def get_model_figure(self):
        """
        Generates a figure of the wet gap crossing model along with the utility nodes.
        """
        def safety_util(states):
            return 2 * states['Fire Across Gap'] - 1 * states['Enemy Fires']

        def success_util(states):
            return 3 * states['Ribbon Bridge Status'] - 1 * states['Weather Status']

        def mix_util(states):
            return 4 * states['Ribbon Bridge Status'] - 1 * states['Weather Status'] - 1 * states['Enemy Fires'] + 1 * states['Fire Across Gap']

        model = self.cdn
        utils = {"safety": set(["Fire Across Gap", "Enemy Fires"]),
                 "success": set(["Ribbon Bridge Status", "Weather Status"]),
                 "mix": set(["Ribbon Bridge Status", "Weather Status", "Enemy Fires", "Fire Across Gap"])}
        hidden_state = self.state.hidden_state.copy().to_dict(orient="records")[
            0]
        nodes = list(model.model.nodes())
        edges = model.model.edges()

        g = nx.DiGraph()

        for node in nodes:
            node_label = f"{node}\n{hidden_state[node]}"
            g.add_node(node, label=node_label, type="state_node")

        for util_node in utils.keys():
            util_node_score = None
            if util_node == "safety":
                util_node_score = safety_util(hidden_state)
            elif util_node == "success":
                util_node_score = success_util(hidden_state)
            elif util_node == "mix":
                util_node_score = mix_util(hidden_state)
            util_node_label = f"{util_node}\n{util_node_score}"
            g.add_node(util_node, label=util_node_label, type="util_node")
            for util_var in utils[util_node]:
                g.add_edge(util_var, util_node)

        g.add_edges_from(edges)

        pos = nx.drawing.nx_pydot.pydot_layout(g, prog="dot")
        fig = Figure(figsize=(8, 6))
        ax = fig.add_subplot(111)

        state_nodes = [node for node, data in g.nodes(
            data=True) if data["type"] == "state_node"]
        nx.draw_networkx_nodes(G=g,
                               pos=pos,
                               nodelist=state_nodes,
                               node_shape="o",
                               node_color="lightblue",
                               node_size=1500,
                               ax=ax)
        util_nodes = [node for node, data in g.nodes(
            data=True) if data["type"] == "util_node"]
        nx.draw_networkx_nodes(G=g,
                               pos=pos,
                               nodelist=util_nodes,
                               node_shape="D",
                               node_color="orange",
                               node_size=1500,
                               ax=ax)

        nx.draw_networkx_edges(G=g, pos=pos, ax=ax, arrows=True)
        labels = {node: data["label"] for node, data in g.nodes(data=True)}
        nx.draw_networkx_labels(
            G=g, pos=pos, labels=labels, font_size=10, ax=ax)
        fig.tight_layout()

    def _update_model_utility(self, selected_utility) -> None:
        """
        Updates the model utility based on the selected utility.
        This is a helper function to update the model figure with the new utility.
        """
        if selected_utility == "safety":
            self.cdn = safety.model
        elif selected_utility == "success":
            self.cdn = success.model
        elif selected_utility == "mix":
            self.cdn = mix.model
        else:
            raise ValueError(
                f"Unknown utility: {selected_utility}. Supported utilities are: safety, success, mix.")
        self.clear_caches()  # clear caches before performing a search with a new utility

    def update_coa_tree(self, selected_utility) -> None:
        """
        given a selected utility, updates the COA tree
        Currently only supports three utilities: safety, success, and mix.
        """
        self._update_model_utility(selected_utility)

        legal_actions = self.cdn.legal_actions(self.state.do_ev,
                                               self.state.inv_ev,
                                               self.state.do_none_ev,
                                               self.state.inv_none_ev,
                                               self.state.time_remaining,
                                               pcc=self.sim_params["pcc"],)
        if not legal_actions:
            hidden_state = self.state.hidden_state.copy().to_dict(orient="records")
            utility_nodes = {key: value for key, value in hidden_state[0].items(
            ) if key in self.cdn.util_nodes}
            final_utility = self.cdn.util_func(utility_nodes)
            self.time_remaining_label.config(
                text=f"Out of time. No actions remaining. Final Utility {final_utility}.")
        else:
            # Generate the coa subtree based on the selected utility
            returned = self.generate_sub_tree(selected_utility)
            sub_tree = returned["tree"]
            edge_labels = returned["edge_labels"]
            node_names = returned["node_names"]

            root_action = self.name_to_action(node_names[1])
            self.state.update_evidence(root_action)
            self.state.update_text_logs(action=root_action)
            self.text_box.delete(1.0, tk.END)
            self.text_box.insert(tk.END, "\n".join(self.state.text_logs))

            self.state.time_remaining -= root_action["time_cost"]
            self.time_remaining_label.config(
                text=f"Time remaining: {self.state.time_remaining}.")

            self.update_figure_and_draw(sub_tree, edge_labels, node_names)
            self.get_model_figure()


def main():
    """
    Main function to run the visualizer.
    """
    sim_params = {"time": 7,
                  "method": "CES",
                  "pcc": False,
                  "obs_only": False}
    Visualizer(sim_params)


if __name__ == '__main__':
    main()
