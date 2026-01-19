from flask import Flask, render_template, request, redirect, url_for, send_from_directory, current_app, jsonify, session
import sqlite3
from cdn import CDN
from flask_session import Session
from flask_sqlalchemy import SQLAlchemy
# No sqlalchemy imports needed here for basic setup
import os
import time
import subprocess
import json
import datetime
import sys
import uuid
import requests
from pathlib import Path
from werkzeug.utils import secure_filename
#from paths_config import Paths, ensure_directories
#from dmd_inference_ensemble import run_ensemble_inference
from pgmpy.factors.discrete import TabularCPD

# 1. Define 'Action' node (User decision: 0=Off, 1=On)
# It has no parents, so we give it a 50/50 starting probability
cpd_action = TabularCPD(
    variable='Action', 
    variable_card=2, 
    values=[[0.5], [0.5]]
)

# 2. Define 'Weather' node (0=Dry, 1=Humid)
cpd_weather = TabularCPD(
    variable='Weather', 
    variable_card=2, 
    values=[[0.7], [0.3]]
)

# 3. Define 'Fire_Intensity' (The node that has parents)
# values list matches the combinations of Action and Weather
# Cardinality: Action(2) * Weather(2) = 4 columns
cpd_fire = TabularCPD(
    variable='Fire_Intensity', 
    variable_card=2, # 0=Low, 1=High
    values=[
        # Action: Off(0), Off(0), On(1), On(1)
        # Weather: Dry(0), Humid(1), Dry(0), Humid(1)
        [0.9, 0.5, 0.2, 0.1], # Prob of Low
        [0.1, 0.5, 0.8, 0.9]  # Prob of High
    ],
    evidence=['Action', 'Weather'],
    evidence_card=[2, 2]
)

# Combine them into a list


app = Flask(
    __name__
)
nodes = ['Action', 'Weather', 'Fire_Intensity']
edges = [('Action', 'Fire_Intensity'), ('Weather', 'Fire_Intensity')]
cpds = [cpd_action, cpd_weather, cpd_fire]
actions = {'Station_Alpha': {'node': 'Action', 'values': [0, 1]}}  # 0: Inactive, 1: Active
def util_func(state):
    # Utility based on Fire_Intensity
    fire_intensity = state['Fire_Intensity']
    if fire_intensity == 0:  # Low
        return 100
    elif fire_intensity == 1:  # Medium
        return 50
    else:  # High
        return 0
# Global CDN instance
fire_cdn = CDN(nodes, edges, cpds, actions, util_func, util_nodes=['Fire_Intensity'])
# Ensure expected runtime directories exist before use
# 1. Supabase Connection String (Use the "Transaction" or "Session" pooler string)
# Use the pooler address and port 6543
app.config['SQLALCHEMY_DATABASE_URI'] = "postgresql://postgres.baxouthhcchusicxymqh:Dabonem123!@aws-0-us-west-2.pooler.supabase.com:6543/postgres"
# 2. Flask-Session Configuration
app.config['SESSION_TYPE'] = 'sqlalchemy'
app.config['SESSION_SQLALCHEMY_TABLE'] = 'flask_sessions' # Table name in Supabase
app.config['SESSION_PERMANENT'] = True
app.config['SESSION_USE_SIGNER'] = True # Adds extra security to the session cookie
# ... (your app and config code)

db = SQLAlchemy(app) # 1. Initialize DB first
class ActivityLog(db.Model):
    __tablename__ = 'activity_logs'
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Text)
    action_performed = db.Column(db.Text)
    node_id = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    
app.config['SESSION_SQLALCHEMY'] = db # 2. Assign DB to session config
Session(app) # 3. Initialize Session extension last

# 4. Create the table
with app.app_context():
    db.create_all()

@app.route('/set-session')
def set_session():
    session['user_id'] = 123
    session['role'] = 'commander'
    return "Session data stored in Supabase!"
@app.route("/")
def home():
    return render_template("index.html")
@app.route("/C2D2")
def C2D2():
    return render_template("C2D2.html")
@app.route("/About")
def About():
    return render_template("About.html")
@app.route('/debug-session')
def debug_session():
    # This grabs everything currently stored in the user's session
    session_data = dict(session)
    return jsonify({
        "status": "Active Session Found",
        "data": session_data,
        "session_id": request.cookies.get(app.config.get('SESSION_COOKIE_NAME', 'session'))
    })
@app.route("/Human_only")
def Human_only():
    return render_template("Human_only.html")
@app.route("/Human_onlyjs")
def Human_onlyjs():
    return render_template("Human_only.js")
@app.route("/CDNjs")
def CDNjs():
    return render_template("CDN.js")
@app.route("/Human_CDN")
def Human_CDN():
    return render_template("Human_CDN.html")
@app.route("/Human_CDNjs")
def Human_CDNjs():
    return render_template("Human_CDN.js")
@app.route("/LLM")
def LLM():
    return render_template("LLM.js")
@app.route("/Human_LLM")
def Human_LLM():
    return render_template("Human_LLM.js")
@app.route("/Human_Random")
def Human_Random():
    return render_template("Human_Random.js")
@app.route('/process_action', methods=['POST'])
def process_action():
    try:
        data = request.json
        val = data.get('value')
        ui_node_id = data.get('node_id')
        
        # 1. Strategic/Investigative bypass (Values 2 and 3)
        if val == 3:
            return jsonify({"status": "success", "spread_increment": 0.02, "prob_high": 0.05})
        if val == 2:
            return jsonify({"status": "success", "spread_increment": 0.08, "prob_high": 0.15})
# --- NEW: LOG TO SUPABASE ---
        action_names = {0: "Evacuation", 1: "Suppression", 2: "Scan", 3: "Control Line"}
        new_log = ActivityLog(
            session_id = session.get('user_id', 'anonymous'), # Ties it to the user session
            action_performed = action_names.get(val, "Unknown"),
            node_id = ui_node_id
        )
        db.session.add(new_log)
        db.session.commit() # This pushes it to Supabase immediately
        # ----------------------------

        # ... (rest of your existing logic for spread_multiplier and prob_high)
        # 2. Map UI Node Names to CDN Node Names
        # If the UI node isn't in this map, we default to 'Action'
        node_mapping = {
            'Ribbon Bridge Status': 'Action',
            'Fire Across Gap': 'Action',
            'Enemy ATK/Artillery': 'Action'
        }
        cdn_variable = node_mapping.get(ui_node_id, 'Action')

        # 3. Standard CDN Query (Using the correct variable 'fire_cdn')
        # We query 'Fire_Intensity' because that is what your model uses
        prediction = fire_cdn._cdn_query(['Fire_Intensity'], {cdn_variable: val}, {}, pcc=False)
        
        # get_value expects a dictionary of the state we are checking
        prob_high = float(prediction.get_value(**{'Fire_Intensity': 1}))
        
        # Determine spread based on the probability of High Intensity
        spread_multiplier = 0.4 if prob_high < 0.5 else 1.8

        return jsonify({
            "status": "success",
            "spread_increment": spread_multiplier,
            "prob_high": prob_high
        })

    except Exception as e:
        db.session.rollback() # Roll back if DB insert fails
        print(f"Error in process_action: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True, port = 8080)  # Debug mode for development