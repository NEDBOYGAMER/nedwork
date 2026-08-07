from flask import request, Blueprint, jsonify, render_template, make_response, redirect, url_for, make_response
from ..models import *
from .. import db
from datetime import *

auth_bp = Blueprint("auth", __name__, static_folder='../static')


@auth_bp.route("/login", methods=["GET"])
def login_page():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return render_template('auth/login.html')

    return redirect(url_for('dashboard.dashboard'))


@auth_bp.route("/api/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or request.form
    username = data.get("username")
    password = data.get("password")
    email = data.get("email")

    if email == "" or not email:
        email = username + "@nedwork.ch"

    if not username or not password:
        return jsonify({"error": "username and password are required"}), 400

    user = User(username=username, email=email)
    user.set_password(password)
    user.generate_key()

    existing_user = User.query.filter_by(username=username).first()

    if existing_user:
        return jsonify({
            "success": False,
            "error": "Username already exists"
        })

    db.session.add(user)
    dashboard = Dashboard(
        name="Main",
        user=user,
        widgets=["Time"]
    )
    db.session.add(dashboard)
    db.session.commit()
    return jsonify({"success": True})


@auth_bp.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True)
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({"success": False, "error": "Missing username or password"}), 400

    user = User.query.filter_by(username=data["username"]).first()

    if  not user or not user.check_password(data["password"]):
        return jsonify({"success": False, "error": "User doesnt exist or password is wrong"}), 401

    session = Session(
        user_id = user.id,
        expires = datetime.now(timezone.utc) + timedelta(days=7)
    )
    session.create_session_id()

    db.session.add(session)
    db.session.commit()

    response = make_response({"success": True})

    response.set_cookie(
        "session_id",
        session.session_id,
        httponly=True,
        secure=True,
        max_age=60*60*24*7
    )
    return response



@auth_bp.route("/api/who", methods=["GET"])
def who():
    valid, user = Session.check(request.cookies.get("session_id"))

    return jsonify({"user": user.username})




@auth_bp.route("/api/logout", methods=["POST"])
def logout():
    response = make_response(redirect(url_for("auth.login_page")))
    response.set_cookie(
        "session_id",
        "",
        max_age=0,
        httponly=True,
        secure=True,
        path="/"
    )
    return response