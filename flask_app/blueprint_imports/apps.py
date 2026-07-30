# add   from flask_app.app_corner.routes import app_corner_bp


# Store blueprints in a list of tuples: (blueprint_object, url_prefix)
# add      (app_corner_bp, '/app_corner'),
ALL_BLUEPRINTS = [
]

def register_all_blueprints(app):
    for bp, prefix in ALL_BLUEPRINTS:
        if prefix:
            app.register_blueprint(bp, url_prefix=prefix)
        else:
            app.register_blueprint(bp)