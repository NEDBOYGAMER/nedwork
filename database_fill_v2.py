import random
import os
import re
import json
import copy
import string
from flask_app import create_app, db
from flask_app.models import User, Group, Dashboard, UserGroup, Friendship, Permission, UserPermission


# ==========================================
# JS parsing utility functions
# ==========================================

def js_to_json(js_str):
    """
    Converts a JS object literal string into a valid JSON string by:
    - Standardizing single quotes to double quotes.
    - Quoting unquoted object keys.
    - Stripping trailing commas.
    - Escaping inside strings.
    """
    # Clean up comments first
    js_str = re.sub(r'(?<!:)\/\/.*', '', js_str)  # Safe from stripping 'https://' URLs
    js_str = re.sub(r'/\*.*?\*/', '', js_str, flags=re.DOTALL)
    
    in_string = False
    quote_char = None
    escaped = False
    result = []
    
    i = 0
    n = len(js_str)
    while i < n:
        char = js_str[i]
        
        if escaped:
            result.append(char)
            escaped = False
            i += 1
            continue
            
        if char == '\\':
            result.append(char)
            escaped = True
            i += 1
            continue
            
        if char in ('"', "'"):
            if not in_string:
                in_string = True
                quote_char = char
                result.append('"')  # standardizing on double quotes
            elif char == quote_char:
                in_string = False
                result.append('"')
            else:
                result.append(char)
            i += 1
            continue
            
        if in_string:
            result.append(char)
            i += 1
            continue
            
        # Match Javascript object key format (unquoted key followed by colon)
        match = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*)\s*:', js_str[i:])
        if match:
            key = match.group(1)
            result.append(f'"{key}":')
            i += match.end()
            continue
            
        result.append(char)
        i += 1
        
    json_candidate = "".join(result)
    # Remove any trailing commas inside objects or arrays
    json_candidate = re.sub(r',\s*([\]}])', r'\1', json_candidate)
    return json_candidate


def load_widget_defaults():
    """
    Dynamically finds, reads, and parses WIDGET_DEFAULTS from the Javascript file.
    Includes a built-in fallback schema in case the target file is missing.
    """
    # Robust multi-path resolution depending on where the script is run from
    possible_paths = [
        "./flask_app/static/js/pages/dashboard/widget_default.js",
        "../flask_app/static/js/pages/dashboard/widget_default.js",
        "./static/js/pages/dashboard/widget_default.js",
    ]
    
    js_path = None
    for path in possible_paths:
        resolved_path = os.path.abspath(path)
        if os.path.exists(resolved_path):
            js_path = resolved_path
            break
            
    if not js_path:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        possible_paths_rel = [
            os.path.join(script_dir, "flask_app/static/js/pages/dashboard/widget_default.js"),
            os.path.join(script_dir, "static/js/pages/dashboard/widget_default.js")
        ]
        for path in possible_paths_rel:
            if os.path.exists(path):
                js_path = path
                break

    fallback_defaults = {
        "time": {
            "type": "time", "id": "-", 
            "settings": {"title": "Time", "show_time": True, "show_weekday": True, "show_date": True, "primary": "time", "format24": True, "show_seconds": True, "date_style": "dd.mm.yyyy", "timezone": "Europe/Zurich"},
            "style": "tech"
        },
        "weather": {
            "type": "weather", "id": "-",
            "settings": {"title": "Weather", "location": "Zurich, Switzerland", "unit": "celsius", "show_humidity": True, "show_wind": False},
            "style": "tech"
        },
        "notes": {
            "type": "notes", "id": "-", "text": "default",
            "settings": {"title": "Notes", "font": "Orbitron"},
            "style": "tech"
        },
        "timer": {
            "type": "timer", "id": "-",
            "settings": {"title": "Timer", "offline": True, "sound": True, "autorestart": False},
            "style": "tech", "duration": 300, "started": 0
        },
        "quote": {
            "type": "quote", "id": "-",
            "settings": {"title": "Quote", "category": "mixed", "font": "serif", "show_source": True},
            "style": "tech"
        }
    }

    if not js_path:
        print("⚠️ Warning: Could not locate widget_default.js. Falling back to built-in presets.")
        return fallback_defaults
        
    try:
        print(f"📖 Parsing widget defaults dynamically from: {js_path}")
        with open(js_path, "r", encoding="utf-8") as f:
            js_content = f.read()
            
        # Locate the WIDGET_DEFAULTS declaration
        match = re.search(r"WIDGET_DEFAULTS\s*=\s*\{", js_content)
        if not match:
            raise ValueError("WIDGET_DEFAULTS object declaration not found in JS file.")
            
        start_idx = match.end() - 1
        bracket_count = 0
        end_idx = -1
        for i in range(start_idx, len(js_content)):
            if js_content[i] == '{':
                bracket_count += 1
            elif js_content[i] == '}':
                bracket_count -= 1
                if bracket_count == 0:
                    end_idx = i + 1
                    break
                    
        if end_idx == -1:
            raise ValueError("Mismatched braces within WIDGET_DEFAULTS block.")
            
        js_object_str = js_content[start_idx:end_idx]
        json_str = js_to_json(js_object_str)
        return json.loads(json_str)
        
    except Exception as e:
        print(f"⚡ Error reading/parsing JS file: {e}")
        print("⚠️ Falling back to built-in presets.")
        return fallback_defaults


def generate_random_widgets(defaults):
    """
    Creates a customized list of 1 to 4 widgets from parsed template definitions.
    """
    available_types = list(defaults.keys())
    num_widgets = random.randint(1, 4)
    selected_types = random.choices(available_types, k=num_widgets)
    
    widgets = []
    for i, w_type in enumerate(selected_types):
        # Always deepcopy to prevent cross-mutations
        widget = copy.deepcopy(defaults[w_type])
        
        # Give each widget a unique 8-character ID
        widget["id"] = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
        settings = widget.get("settings", {})
        
        # Modify options randomly based on widget type
        if w_type == "time":
            settings["show_seconds"] = random.choice([True, False])
            settings["format24"] = random.choice([True, False])
            settings["show_date"] = random.choice([True, False])
            settings["title"] = f"Clock {i+1}"
        elif w_type == "weather":
            cities = ["Zurich, Switzerland", "London, UK", "New York, USA", "Tokyo, Japan", "Sydney, Australia"]
            settings["location"] = random.choice(cities)
            settings["unit"] = random.choice(["celsius", "fahrenheit"])
            settings["show_humidity"] = random.choice([True, False])
            settings["show_wind"] = random.choice([True, False])
            settings["title"] = f"Weather: {settings['location'].split(',')[0]}"
        elif w_type == "notes":
            settings["font"] = random.choice(["Orbitron", "sans-serif", "monospace"])
            note_options = [
                "Finish homework 📚",
                "Remember to hydrate! 💧",
                "Database successfully seeded! 🎉",
                "Keep up the great work! ✨",
                "Buy milk and eggs 🥛🥚"
            ]
            widget["text"] = random.choice(note_options)
        elif w_type == "timer":
            widget["duration"] = random.choice([60, 300, 600, 1800])
            settings["sound"] = random.choice([True, False])
            settings["autorestart"] = random.choice([True, False])
        elif w_type == "quote":
            settings["category"] = random.choice(["mixed", "motivation", "coding", "philosophy"])
            settings["show_source"] = random.choice([True, False])
            
        widgets.append(widget)
        
    return widgets


# ==========================================
# Main Seed Process
# ==========================================

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

        # 5. Generate Dashboards dynamically from widget JS configuration templates
        print("📊 Creating custom dashboards with varied widget loads...")
        
        # Extract default options from the source JS configuration
        widget_defaults = load_widget_defaults()
        
        dashboard_counter = 1
        for user in created_users:
            # Everyone gets 1 or 2 test boards
            num_dashboards = random.randint(1, 2)
            
            for index in range(num_dashboards):
                # Ensure name fits under 20 chars safely
                db_name = "main"
                if index > 0:
                    db_name += str(index+1)
                
                # Assign a dynamic randomized widget collection
                dashboard_widgets = generate_random_widgets(widget_defaults)
                
                dashboard = Dashboard(
                    name=db_name,
                    user=user,
                    widgets=dashboard_widgets
                )
                db.session.add(dashboard)
                dashboard_counter += 1
                
        print(f"📈 Provisioned {dashboard_counter - 1} dashboards with dynamically configured widget payloads.")

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