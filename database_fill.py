# seed_db.py
from flask_app import create_app, db
from flask_app.models import User, Group, Dashboard, user_groups

def seed_database():
    app = create_app()
    
    with app.app_context():
        print("Starting database reset and seed...")
        
        # 1. Clear existing entries to prevent UniqueConstraint errors
        try:
            print("Deleting old records...")
            # Delete dashboards first because they hold foreign keys to users
            db.session.query(Dashboard).delete()
            # Clear the many-to-many relationship table
            db.session.execute(user_groups.delete())
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
            "Admin", "Tester", "Developer", "Project Manager", 
            "Data Analyst", "Support", "Marketing"
        ]
        groups = {}
        for name in group_names:
            group = Group(name=name)
            db.session.add(group)
            groups[name] = group
            
        print(f"Created {len(groups)} groups.")
        
        # 3. Define Users data
        users_data = [
            {"username": "alice_dev", "email": "alice@example.com", "password": "SecurePass123!", "groups": ["Admin", "Developer"]},
            {"username": "bob_tester", "email": "bob@example.com", "password": "Testing456!", "groups": ["Tester"]},
            {"username": "charlie_pm", "email": "charlie@example.com", "password": "ManageProj789!", "groups": ["Project Manager"]},
            {"username": "dana_data", "email": "dana@example.com", "password": "DataCrunch2026!", "groups": ["Data Analyst", "Developer"]},
            {"username": "evan_support", "email": "evan@example.com", "password": "HelpDeskPassword!", "groups": ["Support"]},
            {"username": "fiona_mkt", "email": "fiona@example.com", "password": "GrowthMetrics#1", "groups": ["Marketing", "Data Analyst"]},
            {"username": "grace_lead", "email": "grace@example.com", "password": "LeadDevPass99!", "groups": ["Admin", "Developer", "Project Manager"]}
        ]
        
        users = {}
        for u_data in users_data:
            user = User(username=u_data["username"], email=u_data["email"])
            user.set_password(u_data["password"])
            db.session.add(user)
            users[u_data["username"]] = user
            
            # Associate users with groups (Many-to-Many)
            for g_name in u_data["groups"]:
                if g_name in groups:
                    user.groups.append(groups[g_name])
                    
        print(f"Created {len(users)} users and mapped their group permissions.")
        
        # 4. Create Dashboards and assign to users (One-to-Many)
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
            user_obj = users.get(d_data["username"])
            if user_obj:
                dashboard = Dashboard(name=d_data["name"], user=user_obj)
                db.session.add(dashboard)
                
        print(f"Created {len(dashboards_data)} dashboards assigned to respective users.")
        
        # 5. Commit everything to the physical database
        try:
            db.session.commit()
            print("---")
            print("Database successfully wiped and seeded with expanded mock data!")
        except Exception as e:
            db.session.rollback()
            print("---")
            print(f"Error during seeding: {e}")

if __name__ == "__main__":
    seed_database()