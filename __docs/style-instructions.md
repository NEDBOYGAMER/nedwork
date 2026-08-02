# Universal Style Instructions

Use this as the ruleset for styling any page in this ecosystem. It applies regardless of what the page does — do not add anything specific to one app, and do not assume every page has the same layout (some are full tools, some are single-purpose utilities). Only what's listed here is required everywhere; everything else (navigation, page structure, icons, content layout) is up to the individual app.

---

## 1. Color

Implement as CSS variables so theme and accent can be swapped by changing an attribute, not by editing values throughout the code.

**Two themes must both be supported: dark (default) and light.**

Dark:
```
--bg: #0B0B0D
--surface: #16161A
--surface-2: #1E1E24
--surface-strong: #16161A
--surface-hover: rgba(255,255,255,.06)
--line: #2A2A32
--line-alpha: rgba(42,42,50,.55)
--text: #EDEDF0
--text-muted: #8B8B96
--shadow: none
```

Light:
```
--bg: #F7F7F8
--surface: #FFFFFF
--surface-2: #F0F0F2
--surface-strong: #FFFFFF
--surface-hover: rgba(0,0,0,.05)
--line: #E4E4E8
--line-alpha: rgba(228,228,232,.9)
--text: #16161A
--text-muted: #6E6E78
--shadow: 0 1px 2px rgba(20,20,24,.04), 0 8px 24px rgba(20,20,24,.06)
```

This palette is intentionally neutral — the old values leaned navy (blue-tinted blacks and blue-gray text); these are true grays instead, which reads cleaner and lets the accent color do the only color work on the page.

`--line-alpha` is a translucent version of `--line`, used only for the ambient dot grid (§4) — `--line` itself stays a solid 1px border color and is never watered down for that purpose. `--surface-strong` exists for elevated/floating surfaces that sit above other content; in practice it's currently identical to `--surface` in both themes, kept as its own variable so it can diverge later without a find-and-replace. `--surface-hover` is for finer-grained hover effects (skeleton loaders, scrollbar thumbs) — shared interactive components (ghost buttons, nav items) hover to `--surface-2` directly instead, see §11.

`--shadow` is defined once per theme and used as-is (`box-shadow: var(--shadow)`) — it resolves to `none` in dark and to the real elevation shadow in light, so components never need theme-specific shadow logic of their own.

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
| Body | IBM Plex Sans | Paragraphs, labels, buttons, all general UI text |
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
  - Implement as a single `--shadow` token (see §1) and apply it uniformly: `box-shadow: var(--shadow)`.
  - Dark theme: `--shadow` is `none` — border is the elevation cue, shadows don't read on dark backgrounds.
  - Light theme: `--shadow` carries the real elevation shadow, applied to raised elements (cards, modals, dropdowns, toasts).
  - Never write a component-specific box-shadow value or branch on theme in a component's own CSS — the token already does that.

---

## 4. Background / ambient layer

**Default for any page that is primarily navigational, informational, or dashboard-like** (i.e. has surrounding chrome, cards, empty page space around content): apply an ambient background, built from two layers stacked behind all content:

- **Dot grid**: `radial-gradient(var(--line-alpha) 1px, transparent 1px)`, 24px pitch, ~35% opacity. Use `--line-alpha` (a translucent version of `--line`), not `--line` itself — the grid needs a softer dot than a solid border color gives. This is applied globally via `body::before` — pages don't add markup for it, it's on by default and opts out per-page with a `no-ambient` body class.
- **Background image**: a very low-opacity full-bleed image sitting behind content, same as the dot grid — `background-size: cover`, anchored to the bottom-left, ~6% opacity, referenced through a `--bg-image` variable set per page (e.g. via `url_for('static', filename='img/background_image.png')`). Include it with the `background.html` partial (see that file). Unlike the dot grid this one is opt-in per page, not automatic — include the partial where the ambient look calls for it, and skip it where it doesn't fit.

Both layers are `position: fixed`, `inset: 0`, `z-index: 0`, and `pointer-events: none`, so they never intercept clicks or compete with foreground content, which stays on `.surface-layer` at `z-index: 1`.

**Exception — skip the ambient background entirely when the page's content is the visual field itself**, i.e. any full-bleed, content-fills-the-viewport tool where the work surface *is* the background (e.g. a canvas, board, or edge-to-edge layout with no visible page margins). In that case use a flat `var(--bg)` with no dot grid and no background image — the ambient layer only makes sense where there's empty space around content for it to live in.

When in doubt: if the page has visible background around its content, use the ambient layer; if the content fills the screen, don't.

---

## 5. Buttons

Every page will have buttons — this set is mandatory.

- Shared base: IBM Plex Sans, 500 weight, 14px, `10px` radius, no uppercase, `1px` transparent border by default.
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

- Fields (`input`, `select`, `textarea`): `--surface-2` background, `1px solid var(--line)`, `10px` radius, 14px IBM Plex Sans text, 10–12px padding.
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
- Hover fill for shared interactive components (ghost buttons, nav items, and similar low-emphasis controls) is `--surface-2` directly, not a dedicated hover-only tint. `--surface-hover` still exists for finer effects (skeleton loaders, scrollbar thumbs) but isn't the default hover treatment.
- Any interactive element gets a visible `focus-visible` state (accent outline) — never remove focus outlines without replacing them.
- System colors (success/warning/danger/info) always mean the same thing and are never swapped for the theme accent.
- If a page's nature genuinely requires deviating from a rule here (as with the background exception in §4), state the exception and why, rather than silently ignoring the system.

---

## 12. Use of provided resources

- in flask_app/static/css/global there is a colors.css and a ui-elements.css file
- if these files were not included in the commit, make a remark about it
- only using them can you make the same look as the other pages
- in templates/ there is a base.html which serves as the ground base for all sites
- base.html allows for blocking and the background and side nav, only the "big apps" have side navs, if you're unsure whether the site is a "big" one ask
- the background (dot grid + background image, §4) can generally stay enabled except when you think it doesn't make sense


## 13. Icons

- when you need an icon ther is a folder in flask_app/static/img/icons where many different icons live
the names of the available icons are:
  tabler-alert-circle, tabler-arrow-down, tabler-arrow-left, tabler-arrow-right, tabler-arrow-up, tabler-bell, tabler-calendar, tabler-chart-bar, tabler-check, tabler-cloud, tabler-code, tabler-color-picker, tabler-copy, tabler-database, tabler-device-desktop, tabler-download, tabler-edit, tabler-external-link, tabler-file, tabler-filter, tabler-folder, tabler-globe, tabler-grid-dots, tabler-heart-filled, tabler-heart, tabler-home, tabler-info-circle, tabler-layout-dashboard, tabler-link, tabler-lock, tabler-mail, tabler-map-pin, tabler-menu, tabler-message, tabler-minus, tabler-moon, tabler-package, tabler-palette, tabler-plus, tabler-search, tabler-server, tabler-settings, tabler-shield, tabler-star-filled, tabler-star, tabler-sun, tabler-trash, tabler-upload, tabler-user, tabler-x
- all of course with the .svg ending
- if you created any other icons or use emojis explicitely state so, as it is not intended but, if there truly arent any icons for the purpose its permitted
