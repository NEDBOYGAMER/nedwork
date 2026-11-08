/* Doodle module — two modes (Rallly-inspired, §4):
     date mode: host picked candidate DAYS in edit mode; attendees tick
                the days that work.
     time mode: the event date is fixed (Title module); attendees pick
                the time span that works.
   Host finalizes manually (never auto-picked); finalize sets the
   canonical event_date. Options stay editable after votes — votes on
   removed/changed options are wiped with them (per-date rule). */
import { el, icon, toast, fmtDate, fmtTime, isGoing } from "../ui.js";
import { voteUrl, api } from "../api.js";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function renderDoodle(root, ctx) {
    const { module, event, state, isHost, refresh } = ctx;
    const config = module.config || {};
    const options = state.options || [];
    const votes = state.votes || [];
    const amHost = isHost;
    const going = isGoing(ctx);
    const myUserId = window.EVENT_USER_ID;
    const timeMode = config.mode === "time";

    const myVotes = new Set(
        votes.filter((v) => v.user.id === myUserId && v.option_id)
            .map((v) => v.option_id));
    const myComment = votes.find(
        (v) => v.user.id === myUserId && !v.option_id)?.comment || "";
    const anyoneVoted = votes.some((v) => v.option_id);

    if (!options.length) {
        // empty doodle → the section (title included) is dropped by the
        // view-mode section builder; nothing renders here at all
        return;
    }

    // voting grid — one row per option; shift-click selects the range from
    // the last-toggled row to this one, inclusive (attendees only)
    const table = el("div", "doodle-table");
    let lastToggledId = null;
    for (const option of options) {
        const optionVotes = votes.filter((v) => v.option_id === option.id);
        const row = el("div", "doodle-row");

        const left = el("div", "doodle-when");
        if (!amHost && going) {
            const check = el("input");
            check.type = "checkbox";
            check.checked = myVotes.has(option.id);
            check.onchange = () => {
                if (check.checked) myVotes.add(option.id);
                else myVotes.delete(option.id);
                castVote(ctx, myVotes);
            };
            check.onclick = (e) => {
                if (e.shiftKey && lastToggledId !== null) {
                    e.preventDefault();   // no native toggle — we cast the range
                    const ids = options.map((o) => o.id);
                    const a = ids.indexOf(lastToggledId);
                    const b = ids.indexOf(option.id);
                    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
                        myVotes.add(ids[i]);
                    }
                    castVote(ctx, myVotes);
                }
                lastToggledId = option.id;
            };
            left.appendChild(check);
        } else {
            left.appendChild(icon(myVotes.has(option.id) ? "check" : "minus"));
        }
        left.appendChild(el("span", "doodle-date",
            timeMode ? `${fmtDate(option.starts_at)} ${fmtTime(option.starts_at)}–${fmtTime(option.ends_at)}`
                     : fmtDate(option.starts_at)));
        row.appendChild(left);

        // votes: counts or names (anonymous toggle)
        const right = el("div", "doodle-votes");
        if (config.anonymous) {
            right.appendChild(el("span", "badge badge-neutral mono",
                `${optionVotes.length} vote${optionVotes.length === 1 ? "" : "s"}`));
        } else {
            for (const v of optionVotes) {
                const chip = el("span", "badge badge-neutral", v.user.username);
                if (v.user.id === null) chip.classList.add("badge-warning");
                right.appendChild(chip);
            }
        }
        row.appendChild(right);
        table.appendChild(row);
    }
    root.appendChild(table);

    // non-Going members see the results but can't vote
    if (!amHost && !going) {
        root.appendChild(el("p", "hint",
            "Only members marked Going can vote."));
    }

    // host hint: options stay editable after votes now — editing in Edit
    // mode keeps votes on unchanged dates (per-date rule)
    if (amHost && anyoneVoted) {
        const lockRow = el("div", "host-content-row");
        lockRow.appendChild(el("p", "hint",
            "Participants have already voted — editing the options in "
            + "Edit keeps the votes on unchanged dates."));
        root.appendChild(lockRow);
    }

    // "none of these work" comment vote
    if (!amHost && going) {
        const noneRow = el("div", "doodle-none");
        const noneInput = el("input", "field-input");
        noneInput.type = "text";
        noneInput.placeholder = "None of these work — comment (optional)";
        noneInput.value = myComment;
        const noneBtn = el("button", "btn btn-secondary btn-sm", "Send");
        noneBtn.type = "button";
        noneBtn.onclick = async () => {
            try {
                await api(voteUrl(module.id), {
                    method: "POST",
                    body: JSON.stringify({
                        option_ids: [...myVotes],
                        none_of_these: true,
                        comment: noneInput.value,
                    }),
                });
                await refresh();
            } catch (e) { toast(e.message, "error"); }
        };
        noneRow.append(noneInput, noneBtn);
        root.appendChild(noneRow);
    }
}

async function castVote(ctx, myVotes) {
    const { module, refresh } = ctx;
    try {
        await api(voteUrl(module.id), {
            method: "POST",
            body: JSON.stringify({ option_ids: [...myVotes] }),
        });
        await refresh();
    } catch (e) {
        toast(e.message, "error");
        refresh();
    }
}
