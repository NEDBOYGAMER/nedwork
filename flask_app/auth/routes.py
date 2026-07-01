from flask import request, Blueprint, jsonify, render_template
from ..models import User
from .. import db

auth_bp = Blueprint("auth", __name__, static_folder='../static')


@auth_bp.route("/login", methods=["GET"])
def login_page():
    return render_template('auth/login.html')

@auth_bp.route("/register", methods=["GET"])
def register_page():
    return render_template('auth/register.html')



@auth_bp.route("/api/register", methods=["POST"])
def register():
    data = request.get_json() or request.form
    username = data.get("username")
    password = data.get("password")
    email = data.get("email")

    if not username or not password:
        return jsonify({"error": "username and password are required"}), 400

    user = User(username=username, email=email)
    user.set_password(password)

    existing_user = User.query.filter_by(username=username).first()

    if existing_user:
        return jsonify({
            "success": False,
            "error": "Username already exists"
        })

    db.session.add(user)
    db.session.commit()

    return jsonify({"success": True})


@auth_bp.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True)
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({"success": False, "error": "Missing username or password"}), 400

    user = User.query.filter_by(username=data["username"]).first()

    if user and user.check_password(data["password"]):
        return jsonify({"success": True})

    return jsonify({"success": False})