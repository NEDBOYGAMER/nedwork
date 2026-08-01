# Universal Style Instructions

Use this as the ruleset for styling any page in this ecosystem. It applies regardless of what the page does — do not add anything specific to one app, and do not assume every page has the same layout (some are full tools, some are single-purpose utilities). Only what's listed here is required everywhere; everything else (navigation, page structure, icons, content layout) is up to the individual app.

---

## 1. Color

Implement as CSS variables so theme and accent can be swapped by changing an attribute, not by editing values throughout the code.

**Two themes must both be supported: dark (default) and light.**

Dark:
```
--bg: #0A0C14
--surface: #12141F
--surface-2: #1A1D2B
--line: #262A3B
--text: #ECEEF5
--text-muted: #8A8FA6
```

Light:
```
--bg: #F6F7FB
--surface: #FFFFFF
--surface-2: #F0F1F7
--line: #E3E5EE
--text: #14161F
--text-muted: #6B7086
```

**Accent — must be switchable between three options, identical hex in both themes:**
```
Violet (default): --accent:#6C5CE7   --accent-soft:rgba(108,92,231,.14)   --accent-ink:#FFFFFF
Green:            --accent:#22C58B   --accent-soft:rgba(34,197,139,.14)   --accent-ink:#06251A
Red:               --accent:#E5484D   --accent-soft:rgba(229,72,77,.14)    --accent-ink:#FFFFFF
```
Every colored interactive element (buttons, focus states, active states, links, selected items, progress fills) must reference `--accent` / `--accent-soft`, never a hardcoded color. Swapping the accent must visibly re-skin the whole page.

**Fixed system colors — do not theme or re-skin these, they mean the same thing everywhere:**
```
--success: #22C58B
--warning: #E8A23D
--danger:  #E5484D
--info:    #4EA1F3
```

**Hard rules:**
- Never use pure `#000000` or pure `#FFFFFF` as a background.
- Never hardcode a hex value directly on a component — always go through a variable.

---

## 2. Typography

Three font roles, used consistently everywhere:

| Role | Font | Used for |
|---|---|---|
| Display | Space Grotesk | Headings, section titles, large numbers/stats |
| Body | Inter | Paragraphs, labels, buttons, all general UI text |
| Mono | JetBrains Mono | Data: timestamps, codes, counters, numeric values, technical identifiers |

Rules:
- Sentence case everywhere. No uppercase headers, no letter-spaced tracking on titles or nav-style text — this look is explicitly retired.
- One weight of each face per screen in normal use: 400 for body, 500–600 for display/emphasis. Don't mix more than two weights on one page.
- Type scale to use: 12 / 14 / 16 / 20 / 24 / 32 / 40px. Line-height 1.5 for body text, 1.15 for display text.

---

## 3. Spacing, radius, elevation

Applies to every component on every page — this is what makes different apps feel like the same product.

- Spacing scale (margins, gaps, padding): 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px. Don't invent arbitrary values outside this scale.
- Radius:
  - `10px` — buttons, inputs, small controls
  - `14px` — cards, panels, modals, larger containers
  - `999px` (full pill) — badges, tags, toggles, avatars
- Borders: every card, panel, and input gets a `1px solid var(--line)` border.
- Elevation:
  - Dark theme: border only, no shadows (shadows don't read on dark backgrounds — border is the elevation cue).
  - Light theme: add `box-shadow: 0 1px 2px rgba(20,22,31,.04), 0 8px 24px rgba(20,22,31,.06)` to raised elements (cards, modals, dropdowns).

---

## 4. Background / ambient layer

**Default for any page that is primarily navigational, informational, or dashboard-like** (i.e. has surrounding chrome, cards, empty page space around content): apply an ambient background —
- A faint dot grid: `radial-gradient(var(--line) 1px, transparent 1px)`, 24px pitch, ~30–35% opacity.
- One soft-focus circular glow in `--accent`, ~500px, opacity ≤10%, positioned off to one side, optionally slow-drifting (15–25s ease-in-out loop). It must sit behind all content, fixed, and never be visually competing with foreground elements.

**Exception — skip the ambient background entirely when the page's content is the visual field itself**, i.e. any full-bleed, content-fills-the-viewport tool where the work surface *is* the background (e.g. a canvas, board, or edge-to-edge layout with no visible page margins). In that case use a flat `var(--bg)` with no dot grid and no glow — the ambient layer only makes sense where there's empty space around content for it to live in.

When in doubt: if the page has visible background around its content, use the ambient layer; if the content fills the screen, don't.

---

## 5. Buttons

Every page will have buttons — this set is mandatory.

- Shared base: Inter, 500 weight, 14px, `10px` radius, no uppercase, `1px` transparent border by default.
- Variants:
  - **Primary** — filled `--accent`, text `--accent-ink`. For the one main action.
  - **Secondary** — `--surface-2` fill, `1px solid var(--line)` border, `--text`. For standard actions.
  - **Ghost** — transparent, `--text-muted`, background appears on hover (`--surface-2`). For low-emphasis actions.
  - **Danger** — filled `--danger`, white text. For destructive actions only.
- Sizes: small (6px/12px padding), default (10px/18px), large (13px/24px).
- States: hover = slight brightness increase (filled) or border/background shift (outlined); focus-visible = `2px solid var(--accent)` outline with offset; disabled = 40% opacity, no pointer events.

---

## 6. Form elements

Mandatory baseline for any input, select, textarea, checkbox, radio, or toggle:

- Fields (`input`, `select`, `textarea`): `--surface-2` background, `1px solid var(--line)`, `10px` radius, 14px Inter text, 10–12px padding.
- Focus state: border becomes `--accent`, plus a soft `0 0 0 3px var(--accent-soft)` glow. This is the same focus treatment used for buttons — one consistent focus language across all controls.
- Labels: 13px, `--text-muted`, sentence case, positioned above the field, medium weight.
- Helper/hint text: 12px, `--text-muted`, below the field.
- Checkboxes/radios: native elements with `accent-color: var(--accent)`.
- Toggle switch: track in `--surface-2` (off) / `--accent-soft` with `--accent` border (on), knob in `--text-muted` (off) / `--accent` (on), pill radius, animated slide.

---

## 7. Cards / panels

The base container used for grouping content anywhere:
- `--surface` background, `1px solid var(--line)`, `14px` radius, `24px` internal padding.
- Optional small eyebrow label at the top: 12px, `--text-muted`, sentence case (not uppercase-tracked), used to name what the card contains.
- No other required internal structure — content layout inside a card is up to the page.

---

## 8. Badges, tags, pills

Any small status or category marker, anywhere:
- Pill radius, small padding (4px/10px), 12px text.
- Color variants map directly to the palette: accent (`--accent-soft` bg / `--accent` text), success/warning/danger (matching soft-tint background / solid text), neutral (`--surface-2` bg / `--text-muted` text).
- Use mono font when the badge contains a number or code; body font for words.

---

## 9. Feedback — alerts, toasts, modals, tooltips

These appear across apps whenever something needs confirming or explaining, so they must look identical everywhere:

- **Inline alert**: left-aligned icon + text, `1px solid` border in the relevant system color at low opacity, background = same color at ~8% opacity, `10px` radius.
- **Toast**: `--surface` background, `1px solid var(--line)`, `3px` left border in `--accent` (or a system color if it's a status message), fixed bottom-right, slide-in animation, auto-dismiss.
- **Modal**: centered, `--surface` background, `1px solid var(--line)`, `14px` radius, dimmed backdrop (`rgba(0,0,0,.5)`), click-outside-to-close.
- **Tooltip**: small dark/light-inverted pill (`--text` background, `--bg` text), appears on hover, no border.

---

## 10. Tables & progress

- **Table**: no vertical borders, `1px solid var(--line)` row dividers only, header row in `--text-muted` 12px sentence case (not uppercase-tracked), body text 14px.
- **Progress bar**: `8px` height, pill radius, `--surface-2` track, `--accent` fill.

---

## 11. General principles to apply when something isn't covered above

- Reuse an existing token before introducing a new one. If a new color, spacing value, or radius seems necessary, question it first — the scale in this document should cover the vast majority of cases.
- Any interactive element gets a visible `focus-visible` state (accent outline) — never remove focus outlines without replacing them.
- System colors (success/warning/danger/info) always mean the same thing and are never swapped for the theme accent.
- If a page's nature genuinely requires deviating from a rule here (as with the background exception in §4), state the exception and why, rather than silently ignoring the system.




## 12. Use of provided ressources

- in flask_app/static/css/global there is a colors.css and a ui-elements.css file
- if these files were not included in the commit, make a reamark about it
- only using them can you make the same look as the other pages
- in templates/ there is a base.html which serves as the ground base for all sites
- base.html allows for blocking and the background and side nav, only the "big apps" have side nav's, if you're unsure wheter the site is a "big" one ask
- the background can generally stay enabled except when you think it doesnt make sense
