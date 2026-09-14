-- ============================================================
-- seed_tasks.sql  -  recreate tasks table + 25 varied tasks for user 'r'
-- Run:  sqlite3 .\instance\app.db ".read seed_tasks.sql"
-- ============================================================
-- Matches the current Task SQLAlchemy model.
-- Dates shifted forward 11 days from the original seed data.
-- ============================================================

BEGIN TRANSACTION;

DROP TABLE IF EXISTS tasks;

CREATE TABLE tasks (
    id INTEGER NOT NULL PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    user_id INTEGER,
    text TEXT,
    subtasks JSON,
    tags JSON NOT NULL,
    deadline DATETIME,
    private BOOLEAN NOT NULL,
    done BOOLEAN NOT NULL,
    importance VARCHAR(20) NOT NULL,
    created_at DATETIME NOT NULL,
    last_updated_at DATETIME NOT NULL,
    completed_at DATETIME,
    FOREIGN KEY(user_id) REFERENCES users (id)
);

-- ---------------- WORK ----------------

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Prepare Q3 status report',
    (SELECT id FROM users WHERE username = 'r'),
    'Collect KPIs, summarize progress and open risks for the quarterly review.',
    '[{"name":"Collect KPIs","done":true},{"name":"Write summary","done":false},{"name":"Review with team lead","done":false}]',
    '["work","report"]',
    '2026-09-23 17:00:00', 0, 0, 'high',
    '2026-09-12 09:15:00', '2026-09-13 18:40:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Fix login redirect bug',
    (SELECT id FROM users WHERE username = 'r'),
    'After a password reset the app sends you to /login instead of /dashboard.',
    '[{"name":"Reproduce bug","done":true},{"name":"Find cause","done":false},{"name":"Patch + regression test","done":false}]',
    '["work","bug"]',
    '2026-09-15 12:00:00', 0, 0, 'high',
    '2026-09-11 10:00:00', '2026-09-13 14:20:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Review pull request 142',
    (SELECT id FROM users WHERE username = 'r'),
    'New caching layer for the dashboard API. Leave review comments.',
    NULL,
    '["work","code-review"]',
    '2026-09-13 18:00:00', 0, 0, 'medium',
    '2026-09-09 11:30:00', '2026-09-09 11:30:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Update API documentation',
    (SELECT id FROM users WHERE username = 'r'),
    'Document the /tasks and /groups endpoints including error codes.',
    '[]',
    '["work","docs"]',
    NULL, 0, 0, 'medium',
    '2026-09-07 09:00:00', '2026-09-07 09:00:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Send weekly team update',
    (SELECT id FROM users WHERE username = 'r'),
    'Recap of the week: releases, blockers, next steps.',
    NULL,
    '["work","communication"]',
    '2026-09-12 16:00:00', 0, 1, 'low',
    '2026-09-11 08:45:00', '2026-09-12 15:55:00', '2026-09-12 15:55:00'
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Onboard the new intern',
    (SELECT id FROM users WHERE username = 'r'),
    'First day is Monday - everything should be ready before that.',
    '[{"name":"Prepare laptop","done":false},{"name":"Create accounts","done":false},{"name":"Schedule intro meeting","done":false}]',
    '["work","hr"]',
    '2026-09-18 09:00:00', 0, 0, 'medium',
    '2026-09-12 10:30:00', '2026-09-12 10:30:00', NULL
);

-- ---------------- HOME / SHOPPING ----------------

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Buy groceries',
    (SELECT id FROM users WHERE username = 'r'),
    'Weekly shopping run.',
    '[{"name":"Oat milk","done":false},{"name":"Bread","done":false},{"name":"Tomatoes","done":false},{"name":"Coffee beans","done":false}]',
    '["shopping","errand"]',
    '2026-09-15 18:00:00', 0, 0, 'low',
    '2026-09-13 19:10:00', '2026-09-13 19:10:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Clean the apartment',
    (SELECT id FROM users WHERE username = 'r'),
    'Vacuum, bathroom and take out the recycling.',
    '[{"name":"Vacuum","done":false},{"name":"Bathroom","done":false},{"name":"Recycling","done":false}]',
    '["home","chores"]',
    '2026-09-17 12:00:00', 0, 0, 'medium',
    '2026-09-10 12:00:00', '2026-09-10 12:00:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Fix leaking kitchen faucet',
    (SELECT id FROM users WHERE username = 'r'),
    'The drip is getting worse, probably just a worn washer.',
    '[{"name":"Buy washer kit","done":false},{"name":"Replace washer","done":false}]',
    '["home","repair"]',
    '2026-09-10 18:00:00', 0, 0, 'high',
    '2026-09-04 08:00:00', '2026-09-06 19:45:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Water the plants',
    (SELECT id FROM users WHERE username = 'r'),
    'Balcony plants and the monstera.',
    NULL,
    '["home"]',
    '2026-09-15 09:00:00', 0, 1, 'low',
    '2026-09-08 07:30:00', '2026-09-13 08:10:00', '2026-09-13 08:10:00'
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Order a new desk lamp',
    (SELECT id FROM users WHERE username = 'r'),
    'Old one flickers - pick one with warm light.',
    '[]',
    '["shopping","home"]',
    '2026-09-19 20:00:00', 0, 0, 'low',
    '2026-09-12 21:00:00', '2026-09-12 21:00:00', NULL
);

-- ---------------- HEALTH / FITNESS ----------------

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Gym: leg day',
    (SELECT id FROM users WHERE username = 'r'),
    'Squats, lunges, leg press. 3 sets each.',
    NULL,
    '["fitness"]',
    '2026-09-14 19:00:00', 0, 0, 'medium',
    '2026-09-12 18:00:00', '2026-09-12 18:00:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Dentist appointment',
    (SELECT id FROM users WHERE username = 'r'),
    'Regular check-up and cleaning.',
    '[{"name":"Confirm appointment","done":false},{"name":"Bring insurance card","done":false}]',
    '["health"]',
    '2026-09-26 10:30:00', 0, 0, 'high',
    '2026-08-31 09:00:00', '2026-08-31 09:00:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Meal prep for the week',
    (SELECT id FROM users WHERE username = 'r'),
    'Cook lunch boxes for Monday to Friday.',
    '[{"name":"Plan menu","done":false},{"name":"Buy ingredients","done":false},{"name":"Cook and portion","done":false}]',
    '["health","cooking"]',
    '2026-09-17 11:00:00', 0, 0, 'medium',
    '2026-09-12 13:00:00', '2026-09-12 13:00:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Book annual health check-up',
    (SELECT id FROM users WHERE username = 'r'),
    'Call the clinic and pick a date in October.',
    '[]',
    '["health"]',
    NULL, 0, 0, 'medium',
    '2026-09-06 10:00:00', '2026-09-06 10:00:00', NULL
);

-- ---------------- LEARNING ----------------

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Finish Flask course chapter 7',
    (SELECT id FROM users WHERE username = 'r'),
    'Blueprints and application factories.',
    '[{"name":"Watch videos","done":false},{"name":"Do exercises","done":false}]',
    '["learning","coding"]',
    '2026-09-21 20:00:00', 0, 0, 'high',
    '2026-09-09 15:00:00', '2026-09-09 15:00:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Read 30 pages of Clean Code',
    (SELECT id FROM users WHERE username = 'r'),
    'Currently in chapter 4.',
    NULL,
    '["learning","reading"]',
    '2026-09-16 22:00:00', 0, 0, 'medium',
    '2026-09-08 22:00:00', '2026-09-08 22:00:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Practice Spanish 20 minutes',
    (SELECT id FROM users WHERE username = 'r'),
    'Vocabulary flashcards plus one lesson.',
    '[]',
    '["learning","daily"]',
    '2026-09-14 21:00:00', 0, 0, 'low',
    '2026-09-13 08:00:00', '2026-09-13 08:00:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Watch talk on SQL indexing',
    (SELECT id FROM users WHERE username = 'r'),
    'Recording is saved in the bookmarks.',
    NULL,
    '["learning","sql"]',
    NULL, 0, 1, 'low',
    '2026-09-10 19:00:00', '2026-09-11 21:30:00', '2026-09-11 21:30:00'
);

-- ---------------- FINANCE ----------------

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Pay electricity bill',
    (SELECT id FROM users WHERE username = 'r'),
    'Invoice 2026-0847, amount 84.50.',
    '[]',
    '["finance","bills"]',
    '2026-09-12 12:00:00', 0, 0, 'high',
    '2026-09-05 09:00:00', '2026-09-05 09:00:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Review monthly budget',
    (SELECT id FROM users WHERE username = 'r'),
    'Compare planned vs actual spending for August.',
    '[{"name":"Export statements","done":false},{"name":"Categorize expenses","done":false}]',
    '["finance"]',
    '2026-10-11 20:00:00', 0, 0, 'medium',
    '2026-09-12 20:00:00', '2026-09-12 20:00:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Cancel unused subscriptions',
    (SELECT id FROM users WHERE username = 'r'),
    'Check streaming and cloud services.',
    '[{"name":"List all subscriptions","done":false},{"name":"Cancel unused ones","done":false}]',
    '["finance"]',
    NULL, 0, 0, 'low',
    '2026-09-07 19:00:00', '2026-09-07 19:00:00', NULL
);

-- ---------------- SOCIAL / TRAVEL / ERRANDS ----------------

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Plan birthday gift for Mia',
    (SELECT id FROM users WHERE username = 'r'),
    'She hinted at wanting a good thermos flask.',
    '[{"name":"Research options","done":false},{"name":"Order in time","done":false}]',
    '["social","gifts"]',
    '2026-10-06 12:00:00', 0, 0, 'medium',
    '2026-09-13 20:15:00', '2026-09-13 20:15:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Book flights and hotel for Lisbon',
    (SELECT id FROM users WHERE username = 'r'),
    'Trip in October - aim for the 8th to the 13th.',
    '[{"name":"Compare flights","done":false},{"name":"Book hotel","done":false},{"name":"Check passport","done":false}]',
    '["travel"]',
    '2026-10-01 12:00:00', 0, 0, 'high',
    '2026-09-09 20:00:00', '2026-09-09 20:00:00', NULL
);

INSERT INTO tasks (name, user_id, text, subtasks, tags, deadline, private, done, importance, created_at, last_updated_at, completed_at)
VALUES (
    'Get car inspection',
    (SELECT id FROM users WHERE username = 'r'),
    'Inspection sticker expires end of September.',
    NULL,
    '["errands","car"]',
    '2026-09-29 09:00:00', 0, 0, 'medium',
    '2026-09-11 17:00:00', '2026-09-11 17:00:00', NULL
);

COMMIT;