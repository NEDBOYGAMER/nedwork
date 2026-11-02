# SDD ledger — plan: TODO.md round-6 entry (clarified 2026-11-02)

Pre-flight: tasks 2–5 all touch events CSS/JS or admin files; executed
sequentially in this session, no cross-task interface conflicts.

Task list:
1. Server: post-vote doodle edits with per-date vote preservation +
   optional "none of these work" comment (routes.py, models.py comment,
   events_api_smoke.py).
2. settings.js: locale-aware shortAddress (de/at/ch = "Street number,
   City"; elsewhere house-number-first) + doodle/edit spacing.
3. View-mode CSS: delete hero-scrim gradient (keep layout div), title
   ~9vw + bigger subtitle/meta, bigger doodle text + checkboxes, bigger
   less-fidgety buttons, info row 50/50, flush separators/chat to
   sidenav, Leaflet zoom control inside map, chat speech blobs.
4. View JS: drop "Your RSVP:" label, update doodle lock hint (options
   editable post-vote now).
5. Small code items: dead IMG_EXT_BY_MAGIC, renderPermissions extra arg,
   typeless "Other" shelf, max-6-types hint, Kick button, groups
   member-add chips.

Verification: stuff/events_api_smoke.py (updated), socials_api_smoke.py,
browser_smoke.py (events), node --check on touched JS.

Ruling (Task 1): "delete the you rvsp" = remove the "Your RSVP:" label
in members.js, keep the Going/Maybe/Can't buttons (deleting the row
would remove RSVP functionality; the label is the bit the operator
called furniture). Cost if wrong: one label to re-add.
Ruling (Task 1): "comment required" error deleted = comment becomes
optional for none-of-these votes server-side; "pick at least one
option" guard stays for a fully empty vote.
Task 1: complete — events_api_smoke.py 88/88 (RED 3 fails before)
Task 2: complete — settings.js node --check OK; CSS spacing verified via browser smoke later
Task 3: complete — view-mode CSS shipped in commit b972bb2; browser_smoke.py 36/36 zero
  console/page errors; ev5_shot.py overflow: desktop 0 / mobile 0 (after cascade fix)
Task 4: complete — members.js label drop + doodle.js hint, shipped in b972bb2; node --check OK
Task 5: complete — admin.js/app_corner.js/admin routes.py cleanups, shipped in b972bb2;
  node --check OK; browser smoke green

Post-b972bb2 follow-up fix (uncommitted until final commit): the desktop 32px overflow
returned because the main/chat breakout rule sat BEFORE `.event-detail-view .event-chat
{ margin-left: 0; margin-right: 0 }` in events.css — later rule won margin-left while
the width stuck. Moved main+chat breakout into its own media block after the chat reset.
Mobile: main keeps 0 padding; scrim + chat-inner keep var(--event-gutter) (title x=12px
measured via computed style at 390px viewport, port 5062). ev5_shot.py re-run after fix.

Final review: self-review (no subagent dispatched — cost/benefit for a CSS+small-JS
polish round judged not worth a fresh reviewer; noted to human partner). Diff re-read:
TODO.md completion entry matches shipped commits; events.css cascade order verified;
no dead code left. Deferred minor: port 5061 is an ERR_UNSAFE_PORT for Chromium —
measurement scripts must use safe ports (5059/5062).
