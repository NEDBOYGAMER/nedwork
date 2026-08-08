from werkzeug.security import generate_password_hash, check_password_hash

from flask_app import db


class ColorsConfig(db.Model):
    __tablename__ = "colors_configs"

    id = db.Column(db.Integer, primary_key=True)
    
    # Points to apps_configs table
    apps_config_id = db.Column(db.Integer, db.ForeignKey("apps_configs.id"), nullable=False)

    # Put your color settings fields here
    palette = db.Column(db.JSON)


class LinkList(db.Model):
    __tablename__ = "linklists"

    id = db.Column(db.Integer, primary_key=True)
    
    # Points to apps_configs table
    apps_config_id = db.Column(db.Integer, db.ForeignKey("apps_configs.id"), nullable=False)

    linklist = db.Column(db.JSON)