from flask_app import create_app, db
from flask_migrate import Migrate
from flask_app.permissions import ensure_all

app = create_app()

with app.app_context():
    #db.drop_all()
    db.create_all()
    # seed permission rows + create the admin account on first boot
    try:
        ensure_all()
    except Exception as exc:
        # an older DB (no users.must_change_password) can't be bootstrapped;
        # tell the operator to migrate instead of bricking boot-up
        print(f"[bootstrap] skipped, DB needs migration first ({exc})")
        print("[bootstrap] run:  flask db upgrade  (or python -m flask db upgrade)")
        db.session.rollback()

migrate = Migrate(app, db)
    

if __name__ == '__main__':
    app.run(debug=True, use_reloader=True)
