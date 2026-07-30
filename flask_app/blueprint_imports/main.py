from flask_app.main.routes import main_bp
from flask_app.auth.routes import auth_bp
from flask_app.settings.routes import settings_bp
from flask_app._00_tests.routes import tests_bp
from flask_app.dashboard.routes import dashboard_bp
from flask_app.app_corner.routes import app_corner_bp
from flask_app.event_manager.routes import event_manager_bp
from flask_app.apps.routes import apps_bp

# Store blueprints in a list of tuples: (blueprint_object, url_prefix)
ALL_BLUEPRINTS = [
    (main_bp, None),
    (auth_bp, '/auth'),
    (settings_bp, '/settings'),
    (tests_bp, '/tests'),
    (dashboard_bp, '/dashboard'),
    (app_corner_bp, '/app_corner'),
    (event_manager_bp, '/event_manager'),
    (apps_bp, '/apps'),
]

def register_all_blueprints(app):
    for bp, prefix in ALL_BLUEPRINTS:
        if prefix:
            app.register_blueprint(bp, url_prefix=prefix)
        else:
            app.register_blueprint(bp)