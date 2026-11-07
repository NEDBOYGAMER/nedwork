/* Site-wide dialogs (confirm / prompt / alert). Injected into every HTML
   page (create_app) like csrf.js / toast.js, so plain scripts, ES modules
   and standalone app pages all share one styled implementation instead of
   the native browser boxes.
     window.confirmDialog(text, opts?) -> Promise<boolean>
     window.promptDialog (text, opts?) -> Promise<string|null>
     window.alertDialog  (text, opts?) -> Promise<undefined>
   opts: { title, okText, cancelText, danger, default, validate }
   Cancel = backdrop click, Cancel button or Escape -> null (prompt/confirm)
   or resolve (alert). Enter confirms; the input auto-focuses. */
(function () {
    "use strict";

    let backdrop = null;

    function ensure() {
        if (backdrop) return;
        backdrop = document.createElement("div");
        backdrop.className = "dialog-backdrop";
        backdrop.innerHTML =
            '<div class="dialog-box" role="dialog" aria-modal="true">' +
                '<h3 class="dialog-title"></h3>' +
                '<p class="dialog-msg"></p>' +
                '<input type="text" class="dialog-input" />' +
                '<div class="dialog-actions">' +
                    '<button type="button" class="dialog-btn dialog-btn-cancel" data-action="cancel">Cancel</button>' +
                    '<button type="button" class="dialog-btn dialog-btn-ok" data-action="ok">Confirm</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(backdrop);
    }

    function run(type, message, opts) {
        ensure();
        opts = opts || {};

        const titleEl = backdrop.querySelector(".dialog-title");
        const msgEl = backdrop.querySelector(".dialog-msg");
        const inputEl = backdrop.querySelector(".dialog-input");
        const cancelBtn = backdrop.querySelector("[data-action='cancel']");
        const okBtn = backdrop.querySelector("[data-action='ok']");

        titleEl.textContent = opts.title || "";
        titleEl.style.display = opts.title ? "" : "none";
        msgEl.textContent = message;

        if (type === "prompt") {
            inputEl.style.display = "";
            inputEl.value = opts.default || "";
        } else {
            inputEl.style.display = "none";
            inputEl.value = "";
        }

        okBtn.textContent = opts.okText ||
            (type === "alert" ? "OK" : "Confirm");
        okBtn.className = "dialog-btn dialog-btn-ok " +
            (opts.danger ? "dialog-btn-danger" : "dialog-btn-primary");
        cancelBtn.textContent = opts.cancelText || "Cancel";
        cancelBtn.style.display = type === "alert" ? "none" : "";

        return new Promise((resolve) => {
            const cancel = () => {
                cleanup(type === "alert" ? undefined : null);
            };
            const cleanup = (value) => {
                backdrop.classList.remove("open");
                document.removeEventListener("keydown", onKey);
                backdrop.removeEventListener("mousedown", onMouseDown);
                okBtn.onclick = null;
                cancelBtn.onclick = null;
                resolve(value);
            };
            const onKey = (e) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    cancel();
                } else if (e.key === "Enter" && type === "prompt") {
                    e.preventDefault();
                    const v = read();
                    if (v !== false) cleanup(v);
                }
            };
            const onMouseDown = (e) => {
                if (e.target === backdrop) cancel();
            };
            const read = () => {
                if (type !== "prompt") return true;
                const v = inputEl.value;
                if (opts.validate) {
                    const r = opts.validate(v);
                    if (r === false) {
                        inputEl.focus();
                        return false;
                    }
                    if (typeof r === "string") {
                        msgEl.textContent = r;
                        inputEl.focus();
                        return false;
                    }
                }
                return v;
            };

            okBtn.onclick = () => {
                const v = read();
                if (v !== false) cleanup(v);
            };
            cancelBtn.onclick = cancel;
            backdrop.addEventListener("mousedown", onMouseDown);
            document.addEventListener("keydown", onKey);
            backdrop.classList.add("open");
            if (type === "prompt") {
                inputEl.focus();
                inputEl.select();
            } else {
                okBtn.focus();
            }
        });
    }

    window.confirmDialog = (message, opts) =>
        run("confirm", message, opts);
    window.promptDialog = (message, opts) =>
        run("prompt", message, opts);
    window.alertDialog = (message, opts) =>
        run("alert", message, opts);
})();