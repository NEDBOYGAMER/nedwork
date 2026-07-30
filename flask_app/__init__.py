from flask import Flask
from flask_sqlalchemy import SQLAlchemy
import os

db = SQLAlchemy()

def create_app():
    app = Flask(__name__, instance_relative_config=True)
    os.makedirs(app.instance_path, exist_ok=True)
    app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(app.instance_path, 'app.db')}"
    
    db.init_app(app)

    # Import and call blueprint registration function
    from flask_app.blueprint_imports.main import register_all_blueprints
    register_all_blueprints(app)

    return app