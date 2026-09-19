from flask import Flask
from flask_sqlalchemy import SQLAlchemy
import os

db = SQLAlchemy()

_PWA_HEAD_TAGS = (
    '<meta name="viewport" content="width=device-width, initial-scale=1">'
    '<meta name="color-scheme" content="dark light">'
    '<meta name="theme-color" content="#16161A">'
    '<link rel="manifest" href="/manifest.json">'
    '<link rel="icon" href="/favicon.ico" sizes="any">'
    '<link rel="apple-touch-icon" href="/static/icons/apple-touch-icon.png">'
)

def create_app():
    app = Flask(__name__, instance_relative_config=True)
    os.makedirs(app.instance_path, exist_ok=True)
    app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(app.instance_path, 'app.db')}"

    db.init_app(app)

    from flask_app.blueprint_imports.main import register_all_blueprints
    from flask_app.blueprint_imports.apps import register_all_blueprints as register_app_blueprints

    register_all_blueprints(app)
    register_app_blueprints(app)

    @app.after_request
    def inject_pwa_head(response):
        if (
            response.status_code == 200
            and response.headers.get("Content-Type", "").startswith("text/html")
            and not response.direct_passthrough
        ):
            html = response.get_data(as_text=True)
            if "</head>" in html and 'rel="manifest"' not in html:
                html = html.replace("</head>", _PWA_HEAD_TAGS + "</head>", 1)
                response.set_data(html)
        return response

    return app