import random
from flask_app import create_app, db
from flask_app.models import User, Group, Dashboard, UserGroup, Friendship, Permission, UserPermission


def seed_database():
    app = create_app()

    with app.app_context():
        print("🚀 Starting database reset and friendly seed...")

        # 1. Recreate tables to ensure the schema matches the models exactly
        try:
            print("🧹 Dropping and recreating all tables...")
            db.drop_all()
            db.create_all()
            print("✨ Database schema recreated successfully.")
        except Exception as e:
            db.session.rollback()
            print(f"❌ Error resetting database schema: {e}")
            return

        print("---")

        # 2. Create Simple Global Permissions
        print("🔐 Seeding application features...")
        permission_names = ["use_chat", "create_groups", "custom_themes", "access_beta"]
        permissions_dict = {}
        
        for name in permission_names:
            perm = Permission(name=name)
            db.session.add(perm)
            permissions_dict[name] = perm
        
        print(f"🔑 Created {len(permissions_dict)} permissions.")

        # 3. Create Casual Friend Groups
        group_names = [
            "The Boys", "Gaming Clan", "Study Group", "Close Friends", 
            "Family", "Movie Night", "Concert Squad", "Weekend Hikers"
        ]

        groups = {}
        for name in group_names:
            group = Group(name=name)
            db.session.add(group)
            groups[name] = group

        print(f"📦 Created {len(groups)} casual friend groups.")

        # 4. Programmatically generate simple Users
        roles_pool = ["member", "admin", "owner"]
        created_users = []

        print("👤 Creating your custom user...")
        # Add your custom user explicitly
        custom_user = User(username="r", email="r@nedwork.ch")
        custom_user.generate_key()
        custom_user.set_password("1")
        db.session.add(custom_user)
        created_users.append(custom_user)

        # Assign your user to a couple of casual starting groups
        for g_name in random.sample(group_names, 2):
            db.session.add(UserGroup(user=custom_user, group=groups[g_name], role="owner"))
        for p_name in random.sample(permission_names, 2):
            db.session.add(UserPermission(user=custom_user, permission=permissions_dict[p_name]))

        first_names = [
            "Alice", "Bob", "Charlie", "Dana", "Evan", "Fiona", "Grace", "Henry", 
            "Ivy", "Jack", "Liam", "Mia", "Noah", "Olivia", "Peter", "Quinn", 
            "Ruby", "Sam", "Tara", "Umar", "Victor", "Wendy", "Xavier", "Yara", 
            "Zane", "Arthur", "Elena", "Marcus", "Chloe", "Luke", "Sophia", "Ryan"
        ]
        
        # Simple passwords list to pick from sequentially or randomly
        simple_passwords = ["123", "12", "15", "abc"]
        total_users_to_create = min(25, len(first_names)) # Kept smaller for quick clean testing

        print(f"👥 Generating {total_users_to_create} simplified users...")
        
        for i in range(total_users_to_create):
            username = first_names[i]
            email = f"{username.lower()}@example.com"
            password = simple_passwords[i % len(simple_passwords)] # Rotates cleanly through 123, 12, 15, abc
            
            user = User(username=username, email=email)
            user.generate_key()
            user.set_password(password)
            db.session.add(user)
            created_users.append(user)
            
            # --- Assign user to 1 to 2 random groups ---
            num_groups = random.randint(1, 2)
            assigned_groups = random.sample(group_names, num_groups)
            
            for g_name in assigned_groups:
                role = random.choice(roles_pool)
                membership = UserGroup(
                    user=user,
                    group=groups[g_name],
                    role=role
                )
                db.session.add(membership)
                
            # --- Assign a random permission ---
            p_name = random.choice(permission_names)
            user_perm = UserPermission(user=user, permission=permissions_dict[p_name])
            db.session.add(user_perm)

        # 5. Generate Dashboards with changing widget mock layouts to test widget logic
        print("📊 Creating custom dashboards with varied widget loads...")
        
        # Variations of logic states for widgets to test your front-end logic parsing
        
        dashboard_counter = 1
        for user in created_users:
            # Everyone gets 1 or 2 test boards
            num_dashboards = random.randint(1, 2)
            
            for index in range(num_dashboards):
                # Ensure name fits under 20 chars safely
                db_name = "main"
                if index > 0:
                    db_name += str(index+1)
                
                dashboard = Dashboard(
                    name=db_name,
                    user=user,
                    widgets=[]
                )
                db.session.add(dashboard)
                dashboard_counter += 1
                
        print(f"📈 Provisioned {dashboard_counter - 1} dashboards with mixed JSON widget payloads.")

        # 6. Build Friendships
        print("🤝 Linking casual friend graph...")
        friendship_statuses = ["accepted", "accepted", "pending"] 
        existing_friendships = set()
        friendship_count = 0
        
        for i, sender in enumerate(created_users):
            num_friends = random.randint(2, 5)
            eligible_receivers = [u for j, u in enumerate(created_users) if i != j]
            receivers = random.sample(eligible_receivers, min(num_friends, len(eligible_receivers)))
            
            for receiver in receivers:
                pair = (sender.username, receiver.username)
                reverse_pair = (receiver.username, sender.username)
                
                if pair not in existing_friendships and reverse_pair not in existing_friendships:
                    status = random.choice(friendship_statuses)
                    friendship = Friendship(
                        sender=sender,
                        receiver=receiver,
                        status=status
                    )
                    db.session.add(friendship)
                    existing_friendships.add(pair)
                    friendship_count += 1

        print(f"🔗 Connected {friendship_count} friendships.")

        # 7. Save out changes
        try:
            print("💾 Committing seed data to database...")
            db.session.commit()
            print("---")
            print("🎉 Success! Simplified playground dataset successfully populated.")
        except Exception as e:
            db.session.rollback()
            print("---")
            print(f"⚡ Crucial Error during seeding execution: {e}")


if __name__ == "__main__":
    seed_database()