# add   from flask_app.app_corner.routes import app_corner_bp
from flask_app.apps.colors.routes import colors_bp
from flask_app.apps.links.routes import links_bp
from flask_app.apps.townclaim.routes import townclaim_bp
from flask_app.apps.tierforge.routes import tierforge_bp


# Store blueprints in a list of tuples: (blueprint_object, url_prefix)
# add      (app_corner_bp, '/app_corner'),
ALL_BLUEPRINTS = [
    (colors_bp, '/apps/colors'),
    (links_bp, '/apps/links'),
    (townclaim_bp, '/apps/townclaim'),
    (tierforge_bp, '/apps/tierforge'),
]

def register_all_blueprints(app):
    for bp, prefix in ALL_BLUEPRINTS:
        if prefix:
            app.register_blueprint(bp, url_prefix=prefix)
        else:
            app.register_blueprint(bp)