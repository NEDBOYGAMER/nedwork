/* Check that every events ES module links in a browser-like environment
   (resolves + all named imports exist in their targets). A link error
   anywhere in the graph leaves #container empty — exactly the "detail
   page looks like the list" symptom. Node needs window/document stubs
   because api.js touches window at module top level. */
import { pathToFileURL } from "node:url";
import path from "node:path";

// minimal browser globals BEFORE any import
globalThis.window = globalThis;
globalThis.document = {
  createElement: () => ({ style: { setProperty() {} } }),
  getElementById: () => null,
  addEventListener: () => {},
  body: { appendChild() {} },
};
globalThis.location = { pathname: "/", origin: "http://localhost" };
globalThis.STATIC_URL = "/static/";
globalThis.EVENTS_API = {
  events: "/events/api/events", friends: "/events/api/friends",
  event: "/events/0/", module: "/events/api/modules/0",
  item: "/events/api/items/0", ride: "/events/api/rides/0",
  chatMsg: "/events/api/chat/0", upcoming: "/events/api/upcoming",
  notifications: "/notifications/api/list",
  notificationsRead: "/notifications/api/read",
  baseUrl: "/events/",
};
globalThis.EVENT_ID = 1;
globalThis.EVENT_USER_ID = 1;
globalThis.LOGIN_URL = "/auth/login";
globalThis.SOCIALS_API = {
  friends: "/socials/api/friends", groups: "/socials/api/groups",
  joinByCode: "/socials/api/groups/join", baseUrl: "/socials/",
};
globalThis.SOCIAL_JOIN = { code: "TESTCODE", groupId: 1 };
globalThis.fetch = async () => ({ status: 200, json: async () => ({}) });

// app.js is the entry point — it renders immediately. In the stub there is
// no #container, so just verify its import graph resolves via editor.js
// (which pulls in the same modules) instead of executing app.js.
const base = "flask_app/static/js/pages/events";
const files = [
  `${base}/list_view.js`,
  `${base}/detail_view.js`,
  `${base}/editor.js`,
  `${base}/picker.js`,
  `${base}/ui.js`,
  `${base}/api.js`,
  `${base}/poller.js`,
  `${base}/modules/index.js`,
  `${base}/modules/description.js`,
  `${base}/modules/location.js`,
  `${base}/modules/members.js`,
  `${base}/modules/doodle.js`,
  `${base}/modules/bring.js`,
  `${base}/modules/rides.js`,
  `${base}/modules/chat.js`,
];

const socialsBase = "flask_app/static/js/pages";
const socialsFiles = [
  `${socialsBase}/socials.js`,
  `${socialsBase}/social_join.js`,
];

let failed = false;
for (const f of [...files, ...socialsFiles]) {
  const url = pathToFileURL(path.resolve(f)).href;
  try {
    await import(url);
    console.log("LINK-OK ", f);
  } catch (e) {
    failed = true;
    console.log("LINK-FAIL", f, "->", e.message.split("\n")[0]);
  }
}
process.exit(failed ? 1 : 0);
