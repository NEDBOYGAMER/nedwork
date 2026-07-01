from flask import Flask
from flask_sqlalchemy import SQLAlchemy
import os

db = SQLAlchemy()


def create_app():
    app = Flask(__name__, instance_relative_config=True)

    # Ensure instance folder exists
    os.makedirs(app.instance_path, exist_ok=True)

    app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(app.instance_path, 'app.db')}"
    db.init_app(app)

    # 1. Import blueprints from their CORRECT respective folders
    from flask_app.main.routes import main_bp
    from flask_app.auth.routes import auth_bp
    from flask_app.settings.routes import settings_bp
    from flask_app.dashboard.routes import dashboard_bp
    from flask_app.event_manager.routes import event_manager_bp

    # 2. Register them
    app.register_blueprint(main_bp)
    app.register_blueprint(auth_bp, url_prefix='/auth')
    app.register_blueprint(settings_bp, url_prefix='/settings')
    app.register_blueprint(dashboard_bp, url_prefix='/dashboard')
    app.register_blueprint(event_manager_bp, url_prefix='/event_manager')

    return app