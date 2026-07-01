# seed_db.py
from flask_app import create_app, db
from flask_app.models import User, Group, Dashboard, UserGroup


def seed_database():
    app = create_app()

    with app.app_context():
        print("Starting database reset and seed...")

        # 1. Clear existing entries to prevent UniqueConstraint errors
        try:
            print("Deleting old records...")

            # Delete dashboards first because they reference users
            db.session.query(Dashboard).delete()

            # Delete memberships
            db.session.query(UserGroup).delete()

            # Delete users and groups
            db.session.query(User).delete()
            db.session.query(Group).delete()

            db.session.commit()
            print("Database cleared successfully.")

        except Exception as e:
            db.session.rollback()
            print(f"Error clearing database: {e}")
            return

        print("---")

        # 2. Create Groups
        group_names = [
            "Admin",
            "Tester",
            "Developer",
            "Project Manager",
            "Data Analyst",
            "Support",
            "Marketing"
        ]

        groups = {}

        for name in group_names:
            group = Group(name=name)
            db.session.add(group)
            groups[name] = group

        print(f"Created {len(groups)} groups.")

        # 3. Create Users
        users_data = [
            {
                "username": "alice_dev",
                "email": "alice@example.com",
                "password": "SecurePass123!",
                "groups": [
                    ("Admin", "admin"),
                    ("Developer", "member")
                ]
            },
            {
                "username": "bob_tester",
                "email": "bob@example.com",
                "password": "Testing456!",
                "groups": [
                    ("Tester", "member")
                ]
            },
            {
                "username": "charlie_pm",
                "email": "charlie@example.com",
                "password": "ManageProj789!",
                "groups": [
                    ("Project Manager", "organizer")
                ]
            },
            {
                "username": "dana_data",
                "email": "dana@example.com",
                "password": "DataCrunch2026!",
                "groups": [
                    ("Data Analyst", "member"),
                    ("Developer", "member")
                ]
            },
            {
                "username": "evan_support",
                "email": "evan@example.com",
                "password": "HelpDeskPassword!",
                "groups": [
                    ("Support", "member")
                ]
            },
            {
                "username": "fiona_mkt",
                "email": "fiona@example.com",
                "password": "GrowthMetrics#1",
                "groups": [
                    ("Marketing", "admin"),
                    ("Data Analyst", "member")
                ]
            },
            {
                "username": "grace_lead",
                "email": "grace@example.com",
                "password": "LeadDevPass99!",
                "groups": [
                    ("Admin", "admin"),
                    ("Developer", "admin"),
                    ("Project Manager", "organizer")
                ]
            }
        ]

        users = {}

        for u_data in users_data:
            user = User(
                username=u_data["username"],
                email=u_data["email"]
            )
            user.set_password(u_data["password"])

            db.session.add(user)
            users[u_data["username"]] = user

            for group_name, role in u_data["groups"]:
                membership = UserGroup(
                    user=user,
                    group=groups[group_name],
                    role=role
                )
                db.session.add(membership)

        print(f"Created {len(users)} users and assigned group roles.")

        # 4. Create Dashboards
        dashboards_data = [
            {"name": "Main Analytics", "username": "alice_dev"},
            {"name": "Database Health", "username": "alice_dev"},
            {"name": "QA Overview", "username": "bob_tester"},
            {"name": "Automation Metrics", "username": "bob_tester"},
            {"name": "Sprint Velocity", "username": "charlie_pm"},
            {"name": "Roadmap Timeline", "username": "charlie_pm"},
            {"name": "BI Insights", "username": "dana_data"},
            {"name": "ETL Pipeline Monitor", "username": "dana_data"},
            {"name": "Ticket Volume", "username": "evan_support"},
            {"name": "SLA Compliance", "username": "evan_support"},
            {"name": "Campaign ROI", "username": "fiona_mkt"},
            {"name": "Social Engagement", "username": "fiona_mkt"},
            {"name": "System Architecture", "username": "grace_lead"},
            {"name": "Global Error Logs", "username": "grace_lead"}
        ]

        for d_data in dashboards_data:
            dashboard = Dashboard(
                name=d_data["name"],
                user=users[d_data["username"]]
            )
            db.session.add(dashboard)

        print(f"Created {len(dashboards_data)} dashboards.")

        # 5. Commit everything
        try:
            db.session.commit()
            print("---")
            print("Database successfully wiped and seeded!")

        except Exception as e:
            db.session.rollback()
            print("---")
            print(f"Error during seeding: {e}")


if __name__ == "__main__":
    seed_database()

