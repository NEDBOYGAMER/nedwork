"""PDF & PNG exports for the timetable app.

render_pdf(snapshot, orientation)
    A4 PDF, ALWAYS white (print style — ignores the app theme).
    "landscape": week grid, days as columns (like the desktop board).
    "portrait":  day-lane timeline, one row per day, time left → right.

render_png(snapshot, orientation)
    Week grid ("landscape") or vertical day list ("portrait") as PNG,
    FOLLOWING the user's theme: dark image in dark mode, white in light.

Pure server-side rendering (no browser needed):
    pip install reportlab pillow
"""

import io
from datetime import datetime

try:
    from reportlab.lib.pagesizes import A4, landscape as rl_landscape
    from reportlab.lib.colors import Color
    from reportlab.pdfgen import canvas as rl_canvas
    _HAVE_PDF = True
except Exception:                # reportlab missing — the app must still boot
    _HAVE_PDF = False

try:
    from PIL import Image, ImageDraw, ImageFont
    _HAVE_PIL = True
except Exception:                # pillow missing
    _HAVE_PIL = False


DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


# ------------------------------------------------------------------
# color / time math (mirrors the frontend)
# ------------------------------------------------------------------

def _clamp(v, lo, hi, dflt):
    try:
        v = int(v)
    except (TypeError, ValueError):
        return dflt
    return max(lo, min(hi, v))


def _rgb(hexstr, fallback=(148, 163, 184)):
    h = str(hexstr or "").strip().lstrip("#")
    if len(h) != 6:
        return fallback
    try:
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return fallback


def _blend(fg, alpha, bg):
    return tuple(int(round(fg[i] * alpha + bg[i] * (1 - alpha))) for i in range(3))


def _lum(rgb):
    def f(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])


def _contrast(a, b):
    la, lb = _lum(a), _lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def _text_on(rgb):
    dark, light = (17, 24, 38), (242, 245, 251)
    return dark if _contrast(rgb, dark) >= _contrast(rgb, light) else light


def _fmt(m):
    m = int(m) % 1440
    return "%02d:%02d" % (m // 60, m % 60)


def _fmt_raw(m):
    """Like the app's fmt(): 1440 shows as 24:00 (no wrap)."""
    m = int(m)
    return "%02d:%02d" % (m // 60, m % 60)


def _hours(mins):
    v = round((mins or 0) / 6.0) / 10.0
    s = ("%.1f" % v).rstrip("0").rstrip(".")
    return s or "0"


def _end_min(e):
    """Blocks may run past midnight: end <= start means the next day."""
    return (e.end_min or 0) + 1440 if (e.end_min or 0) <= (e.start_min or 0) else e.end_min


def _event_days(e):
    out = []
    for part in str(e.days or "").split(","):
        part = part.strip()
        if part.isdigit():
            v = int(part)
            if 0 <= v <= 6 and v not in out:
                out.append(v)
    if not out:
        out = [e.day if e.day is not None else 0]
    return out


def _segments(e, t):
    """Per-type split rhythm — same rule as the frontend's splitSegments()."""
    start, end = e.start_min or 0, _end_min(e)
    if t is None or not t.split_on:
        return [(start, end)]
    P = _clamp(t.split_min, 20, 120, 45)
    B = _clamp(t.split_break_min, 0, 60, 15)
    if end - start <= P:
        return [(start, end)]
    out, s = [], start
    while s < end and len(out) < 24:
        e1 = min(end, s + P)
        out.append((s, e1))
        if e1 >= end:
            break
        s = e1 + B
    return out if len(out) > 1 else [(start, end)]


def _layout(evs):
    """Greedy overlap columns (like the frontend's layoutDay).
    Returns {event: (column_index, columns_in_group)}."""
    evs = sorted(evs, key=lambda e: (e.start_min, -_end_min(e), e.id or 0))
    col_end, col_idx = [], {}
    for e in evs:
        idx = None
        for i in range(len(col_end)):
            if col_end[i] <= e.start_min:
                idx = i
                break
        if idx is None:
            idx = len(col_end)
            col_end.append(_end_min(e))
        else:
            col_end[idx] = _end_min(e)
        col_idx[e] = idx
    groups, cur, cur_end = [], [], -1
    for e in evs:
        if cur and e.start_min >= cur_end:
            groups.append(cur)
            cur, cur_end = [], -1
        cur.append(e)
        cur_end = max(cur_end, _end_min(e))
    if cur:
        groups.append(cur)
    out = {}
    for g in groups:
        ncols = max(col_idx[e] for e in g) + 1
        for e in g:
            out[e] = (col_idx[e], ncols)
    return out


# ------------------------------------------------------------------
# snapshot → render model
# ------------------------------------------------------------------

def _prepare(snapshot):
    s = snapshot["settings"]
    days = [0, 1, 2, 3, 4]
    if s.get("showSat"):
        days.append(5)
    if s.get("showSun"):
        days.append(6)

    per_day = {d: [] for d in days}
    for e in snapshot.get("events") or []:
        for d in _event_days(e):
            if d in per_day:
                per_day[d].append(e)

    ranges = {r["day"]: r for r in (snapshot.get("dayRanges") or [])}
    day_info = {}
    for d in range(7):
        r = ranges.get(d) or {}
        wake = _clamp(r.get("wake"), 0, 1440, s["dayStart"])
        sleep = _clamp(r.get("sleep"), 0, 1440, s["dayEnd"])
        sleep_abs = sleep if sleep > wake else sleep + 1440
        day_info[d] = {
            "wake": wake, "sleep": sleep, "sleepAbs": sleep_abs,
            "total": sum(_end_min(e) - (e.start_min or 0) for e in per_day.get(d, [])),
        }

    periods = []
    for p in snapshot.get("periods") or []:
        raw = p.days if isinstance(p.days, dict) else {}
        pdays = {}
        for d in days:
            it = raw.get(str(d)) or raw.get(d) or {}
            on = bool(it.get("on", True))
            st = _clamp(it.get("start"), 0, 1440, p.start_min)
            en = _clamp(it.get("end"), 0, 1440, p.end_min)
            if en <= st:
                en = min(1440, st + 60)
            pdays[d] = {"on": on, "start": st, "end": en}
        periods.append({"p": p, "days": pdays})

    return {
        "name": snapshot.get("name") or "Timetable",
        "settings": s, "days": days, "per_day": per_day, "day_info": day_info,
        "periods": periods, "types": snapshot.get("types") or {},
        "types_list": snapshot.get("typesList") or [],
        "events": snapshot.get("events") or [],
    }


def _stats(data):
    total = sum(data["day_info"][d]["total"] for d in data["days"])
    sleep = 0.0
    for d in range(7):
        info = data["day_info"][d]
        sleep += (1440 - (info["sleepAbs"] - info["wake"])) / 60.0
    busiest = None
    if total > 0:
        busiest = max(data["days"], key=lambda d: data["day_info"][d]["total"])
    return {"total": total, "count": len(data["events"]),
            "sleep": sleep / 7.0, "busiest": busiest}


def _day_zones(data, d):
    """sleep bands + period bands for one day (clipped by the caller)."""
    info = data["day_info"][d]
    out = []
    if info["wake"] > 0:
        out.append(("sleep", 0, info["wake"]))
    if info["sleepAbs"] < 1440:
        out.append(("sleep", info["sleepAbs"], 1440))
    for per in data["periods"]:
        pd = per["days"].get(d)
        if pd and pd["on"]:
            out.append(("period", pd["start"], pd["end"], per["p"]))
    return out


def _event_style(e, t, bg):
    color = _rgb(e.color if e.color else (t.color if t else None))
    a = (_clamp(t.opacity, 10, 100, 100) / 100.0) if t else 1.0
    return color, a, _blend(color, a, bg), _text_on(_blend(color, a, bg))


# ==================================================================
# PDF (always white)
# ==================================================================

_PAPER = (255, 255, 255)
_INK = (15, 23, 42)
_DIM = (51, 65, 85)
_MUTED = (100, 116, 139)
_LINE = (148, 163, 184)
_LINE2 = (203, 213, 225)
_HALF = (226, 232, 240)
_HEAD = (241, 245, 249)
_WEEKEND = (248, 250, 252)


def _C(rgb, a=1.0):
    return Color(rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0,
                 alpha=max(0.0, min(1.0, a)))


def _pdf_hatch(c, x, y, w, h, rgb, alpha, spacing=6.0, lw=0.75):
    """-45° hatch clipped to a rectangle (like the app's zone shading)."""
    if w <= 0.5 or h <= 0.5 or alpha <= 0:
        return
    c.saveState()
    p = c.beginPath()
    p.rect(x, y, w, h)
    c.clipPath(p, stroke=0, fill=0)
    c.setStrokeColor(_C(rgb))
    try:
        c.setStrokeAlpha(alpha)
    except Exception:   # very old reportlab: pre-blend towards white
        c.setStrokeColor(_C(_blend(rgb, min(1.0, alpha), _PAPER)))
    c.setLineWidth(lw)
    xx = x - h
    while xx < x + w:
        c.line(xx, y, xx + h, y + h)
        xx += spacing
    c.restoreState()


def _rl_ellipsize(c, text, font, size, maxw):
    text = str(text or "")
    if c.stringWidth(text, font, size) <= maxw:
        return text
    while text and c.stringWidth(text + "…", font, size) > maxw:
        text = text[:-1]
    return text + "…" if text else "…"


def _pdf_header(c, data, page_w, page_h, M, HEAD_H):
    st = _stats(data)
    c.setFillColor(_C(_INK))
    c.setFont("Helvetica-Bold", 15)
    c.drawString(M, page_h - M - 12, data["name"])
    c.setFont("Helvetica", 7.5)
    c.setFillColor(_C(_MUTED))
    c.drawString(M, page_h - M - 23,
                 "Weekly timetable · grid %s–%s · generated %s" % (
                     _fmt(data["settings"]["dayStart"]), _fmt(data["settings"]["dayEnd"]),
                     datetime.now().strftime("%d %b %Y %H:%M")))
    right = "Scheduled %s h · %d blocks · Sleep avg %.1f h" % (
        _hours(st["total"]), st["count"], st["sleep"])
    if st["busiest"] is not None:
        right += " · Busiest %s" % DAYS[st["busiest"]]
    c.setFont("Helvetica-Bold", 7.5)
    c.setFillColor(_C(_DIM))
    c.drawRightString(page_w - M, page_h - M - 12, right)
    c.setStrokeColor(_C(_LINE2))
    c.setLineWidth(0.8)
    c.line(M, page_h - M - HEAD_H, page_w - M, page_h - M - HEAD_H)


def _pdf_legend(c, data, page_w, M, y):
    x = M
    for t in (data.get("types_list") or []):
        a = _clamp(t.opacity, 10, 100, 100) / 100.0
        c.setFillColor(_C(_blend(_rgb(t.color), a, _PAPER)))
        c.setStrokeColor(_C(_rgb(t.color), min(1.0, max(0.55, a))))
        c.setLineWidth(0.8)
        c.roundRect(x, y, 14, 9, 2, fill=1, stroke=1)
        c.setFillColor(_C(_DIM))
        c.setFont("Helvetica", 7)
        c.drawString(x + 18, y + 2.5, t.name)
        x += 18 + c.stringWidth(t.name, "Helvetica", 7) + 16
        if x > page_w - M - 240:
            break
    c.setFont("Helvetica-Oblique", 6.3)
    c.setFillColor(_C(_MUTED))
    c.drawRightString(page_w - M, y + 2.5, "hatched: sleep · colored hatch: periods")


def _pdf_event_col(c, e, t, x, w, gy, hh, dstart, dend, color, a, fill, txtc):
    """One event in a vertical (landscape) column. Text sizes adapt to the
    available height so short blocks (45-min split segments, commutes…)
    still show their name instead of an empty colored box."""
    segs = _segments(e, t)
    for si, (s0, s1) in enumerate(segs):
        cs, ce = max(s0, dstart), min(s1, dend)
        if ce <= cs:
            continue
        y = gy - (ce - dstart) / 60.0 * hh + 1
        h = (ce - cs) / 60.0 * hh - 2
        if h < 5:
            # pause sliver between split segments — like the app: no text
            c.setFillColor(_C(fill))
            c.rect(x, y, w, max(2.0, h), fill=1, stroke=0)
            continue
        c.setFillColor(_C(fill))
        c.setStrokeColor(_C(color, min(1.0, max(0.55, a))))
        c.setLineWidth(0.8)
        c.roundRect(x, y, w, h, min(3.0, h / 2.0), fill=1, stroke=1)
        c.setFillColor(_C(color))
        c.rect(x + 1.4, y + 1.4, 2.6, h - 2.8, fill=1, stroke=0)

        tx, maxw = x + 7.5, w - 11.5
        fs_t = 7.2 if h >= 16 else 6.2
        ty = y + h - fs_t - 1.2
        c.setFillColor(_C(txtc))
        c.setFont("Helvetica-Bold", fs_t)
        c.drawString(tx, ty, _rl_ellipsize(c, e.title or "Untitled",
                                           "Helvetica-Bold", fs_t, maxw))
        if h >= 16.5:
            fs_m = 6.2 if h >= 24 else 5.4
            my = ty - fs_m - 1.4
            c.setFillAlpha(0.85)
            c.setFont("Helvetica", fs_m)
            c.drawString(tx, my, _rl_ellipsize(
                c, "%s–%s" % (_fmt(s0), _fmt(s1)), "Helvetica", fs_m, maxw))
            c.setFillAlpha(1)
            if h >= 27.5 and si == 0:
                # room/teacher — or, if neither exists, the type name,
                # so every block shows what it belongs to
                meta = " · ".join(v for v in (e.room or "", e.teacher or "") if v)
                if not meta and t is not None:
                    meta = t.name
                c.setFillAlpha(0.7)
                c.setFont("Helvetica", 5.8)
                c.drawString(tx, my - 6.6, _rl_ellipsize(
                    c, meta, "Helvetica", 5.8, maxw))
                c.setFillAlpha(1)

def _pdf_grid(c, data, page_w, page_h, gut):
    """Week grid shared by both PDF orientations: days as columns
    (Mon → Sun, Sat/Sun only when enabled in the settings), hours run
    top → bottom. Gutter, column width and hour height all derive from
    the page size, so the same code renders landscape and portrait A4."""
    M, HEAD_H, LEG_H, DAYHEAD = 26.0, 52.0, 40.0, 18.0
    s = data["settings"]
    dstart, dend = s["dayStart"], s["dayEnd"]
    if dend <= dstart:
        dend = min(1440, dstart + 60)
    hours = (dend - dstart) / 60.0
    days = data["days"]

    grid_top = page_h - M - HEAD_H
    grid_bot = M + LEG_H
    gy = grid_top - DAYHEAD
    hh = (gy - grid_bot) / hours
    gx = M + gut
    col_w = (page_w - 2 * M - gut) / len(days)

    _pdf_header(c, data, page_w, page_h, M, HEAD_H)

    for i, d in enumerate(days):
        x = gx + i * col_w
        weekend = d >= 5
        info = data["day_info"][d]

        # day header band
        c.setFillColor(_C(_WEEKEND if weekend else _HEAD))
        c.rect(x, gy, col_w, DAYHEAD, fill=1, stroke=0)
        c.setFillColor(_C(_INK))
        c.setFont("Helvetica-Bold", 8)
        c.drawString(x + 6, gy + 5.5, DAYS[d])
        if info["total"]:
            c.setFillColor(_C(_MUTED))
            c.setFont("Helvetica", 6.5)
            c.drawRightString(x + col_w - 5, gy + 5.5, "%s h" % _hours(info["total"]))

        # hour + half-hour lines
        m = dstart
        while m <= dend:
            y = gy - (m - dstart) / 60.0 * hh
            c.setStrokeColor(_C(_LINE2 if m % 60 == 0 else _HALF))
            c.setLineWidth(0.7 if m % 60 == 0 else 0.4)
            c.line(x, y, x + col_w, y)
            m += 30

        # sleep hatch + colored period hatch
        for z in _day_zones(data, d):
            zs, ze = max(z[1], dstart), min(z[2], dend)
            if ze <= zs:
                continue
            y_top = gy - (zs - dstart) / 60.0 * hh
            y_bot = gy - (ze - dstart) / 60.0 * hh
            if z[0] == "sleep":
                _pdf_hatch(c, x, y_bot, col_w, y_top - y_bot, _MUTED, 0.16)
            else:
                p = z[3]
                op = _clamp(p.opacity, 0, 100, 30) / 100.0
                _pdf_hatch(c, x, y_bot, col_w, y_top - y_bot, _rgb(p.color),
                           min(0.45, max(0.10, op * 0.55)))
                c.setStrokeColor(_C(_rgb(p.color), min(1.0, op + 0.25)))
                c.setLineWidth(0.7)
                c.line(x, y_top, x + col_w, y_top)
                c.line(x, y_bot, x + col_w, y_bot)

        # blocks (overlap columns + split segments + adaptive text)
        frac = _layout(data["per_day"][d])
        for e in data["per_day"][d]:
            col, ncols = frac[e]
            t = data["types"].get(e.type_id)
            color, a, fill, txtc = _event_style(e, t, _PAPER)
            ev_x = x + 2 + col * (col_w / ncols)
            ev_w = col_w / ncols - 4
            if ev_w >= 16:
                _pdf_event_col(c, e, t, ev_x, ev_w, gy, hh, dstart, dend,
                               color, a, fill, txtc)

    # gutter time labels
    c.setFont("Helvetica", 6.5)
    c.setFillColor(_C(_MUTED))
    m = dstart
    while m < dend:
        c.drawRightString(gx - 6, gy - (m - dstart) / 60.0 * hh - 2.2, _fmt(m))
        m += 60

    # frame + separators
    c.setStrokeColor(_C(_LINE))
    c.setLineWidth(1)
    c.rect(M, grid_bot, page_w - 2 * M, grid_top - grid_bot, fill=0, stroke=1)
    c.line(gx, grid_bot, gx, grid_top)
    c.line(M, gy, page_w - M, gy)
    for i in range(1, len(days)):
        c.setStrokeColor(_C(_LINE2))
        c.setLineWidth(0.7)
        c.line(gx + i * col_w, grid_bot, gx + i * col_w, grid_top)

    _pdf_legend(c, data, page_w, M, M + 6)


def _pdf_landscape(c, data, page_w, page_h):
    _pdf_grid(c, data, page_w, page_h, gut=46.0)


def _pdf_portrait(c, data, page_w, page_h):
    _pdf_grid(c, data, page_w, page_h, gut=40.0)


    
def render_pdf(snapshot, orientation="landscape"):
    if not _HAVE_PDF:
        raise RuntimeError("PDF export needs the 'reportlab' package — pip install reportlab")

    data = _prepare(snapshot)
    page_w, page_h = rl_landscape(A4) if orientation == "landscape" else A4

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(page_w, page_h))
    c.setTitle("Timetable — %s" % data["name"])
    if orientation == "landscape":
        _pdf_landscape(c, data, page_w, page_h)
    else:
        _pdf_portrait(c, data, page_w, page_h)
    c.showPage()
    c.save()
    return buf.getvalue()


# ==================================================================
# PNG (follows the theme: dark in dark mode, white in light mode)
# ==================================================================

_FONT_PATHS = [
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", True),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", False),
    ("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", True),
    ("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", False),
    ("/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf", True),
    ("/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", False),
    ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", True),
    ("/System/Library/Fonts/Supplemental/Arial.ttf", False),
    ("C:/Windows/Fonts/arialbd.ttf", True),
    ("C:/Windows/Fonts/arial.ttf", False),
]


def _load_font(size_px, bold):
    for path, want_bold in _FONT_PATHS:
        if want_bold == bold:
            try:
                return ImageFont.truetype(path, size_px)
            except Exception:
                pass
    try:
        return ImageFont.load_default(size_px)   # Pillow >= 10.1
    except TypeError:
        return ImageFont.load_default()


def render_png(snapshot, orientation="landscape"):
    if not _HAVE_PIL:
        raise RuntimeError("PNG export needs the 'Pillow' package — pip install pillow")

    data = _prepare(snapshot)
    dark = data["settings"].get("theme") != "light"
    pal = {
        "bg":    (11, 18, 32) if dark else (255, 255, 255),
        "panel": (18, 27, 48) if dark else (255, 255, 255),
        "grid":  (15, 25, 48) if dark else (255, 255, 255),
        "grid_we": (13, 21, 40) if dark else (240, 244, 250),
        "head":  (15, 25, 48) if dark else (238, 243, 250),
        "line":  (42, 58, 97) if dark else (195, 206, 221),
        "line2": (27, 40, 72) if dark else (219, 227, 238),
        "text":  (229, 234, 243) if dark else (15, 23, 42),
        "text2": (199, 210, 228) if dark else (39, 52, 73),
        "muted": (138, 160, 192) if dark else (91, 107, 132),
    }

    s = data["settings"]
    dstart, dend = s["dayStart"], s["dayEnd"]
    if dend <= dstart:
        dend = min(1440, dstart + 60)
    hours = (dend - dstart) / 60.0
    days = data["days"]
    nd = len(days)
    st = _stats(data)

    S = 2
    MARG, HEADER_H = 14, 46

    if orientation == "portrait":
        # vertical day list (like the app's mobile view) — phone-wallpaper style
        W, STATS_H = 1000, 64

        def _card_h(e):
            t = data["types"].get(e.type_id)
            h = 56
            if e.room or e.teacher:
                h += 17
            if e.note:
                h += 17
            if len(_segments(e, t)) > 1:
                h += 18
            return h

        sections = []
        yy = MARG + HEADER_H + 8
        for d in days:
            evs = sorted(data["per_day"][d], key=lambda e: (e.start_min, -_end_min(e)))
            sec_h = 36 + sum(_card_h(e) + 8 for e in evs) + (24 if not evs else 0) + 14
            sections.append((d, evs, yy))
            yy += sec_h
        chip_y = yy + 4
        H = yy + STATS_H + MARG
    else:
        hour_px = 64 if hours <= 16 else (48 if hours <= 20 else 40)
        GUT, DAYHEAD, STATS_H = 62, 40, 60
        day_w = max(150, (1420 - GUT) // nd)
        W = GUT + nd * day_w
        grid_h = int(round(hours * hour_px))
        gy0 = MARG + HEADER_H + DAYHEAD
        chip_y = gy0 + grid_h + 10
        H = chip_y + STATS_H + MARG

    img = Image.new("RGB", (W * S, H * S), pal["bg"])
    dr = ImageDraw.Draw(img)

    fonts = {}

    def F(sz, bold=False):
        k = (sz, bold)
        if k not in fonts:
            fonts[k] = _load_font(int(sz * S), bold)
        return fonts[k]

    def tw(t, f):
        return dr.textlength(str(t), font=f)

    def ell(t, f, maxw):
        t = str(t or "")
        if tw(t, f) <= maxw:
            return t
        while t and tw(t + "…", f) > maxw:
            t = t[:-1]
        return t + "…" if t else "…"

    def P(x, y):
        return (x * S, y * S)

    def BOX(x1, y1, x2, y2):
        return [x1 * S, y1 * S, x2 * S, y2 * S]

    def rr(x1, y1, x2, y2, rad, fill=None, outline=None, width=1):
        dr.rounded_rectangle(BOX(x1, y1, x2, y2), radius=rad * S, fill=fill,
                             outline=outline, width=int(width * S) if outline else 0)

    def ln(x1, y1, x2, y2, color, w=1):
        dr.line([x1 * S, y1 * S, x2 * S, y2 * S], fill=color, width=max(1, int(w * S)))

    def hatch(x, y, w, h, color, spacing=10, wpx=1):
        """-45° hatch, rect-clipped (like the app's zones)."""
        if w <= 1 or h <= 1:
            return
        c0 = x + y
        c0 -= c0 % spacing
        end = x + w + y + h
        while c0 <= end:
            pa = min(max(c0 - (y + h), x), x + w)
            pb = min(max(c0 - y, x), x + w)
            if pb > pa:
                ln(pa, c0 - pa, pb, c0 - pb, color, wpx)
            c0 += spacing

    # ---------- header ----------
    dr.text(P(MARG + 2, MARG + 2), data["name"], font=F(19, True), fill=pal["text"])
    right = "Sleep avg %s h · %d blocks" % (_hours(st["sleep"] * 60), st["count"])
    dr.text(P(W - MARG - 2 - tw(right, F(11)), MARG + 9), right,
            font=F(11), fill=pal["muted"])

    if orientation == "portrait":
        # ---------------- day list ----------------
        for d, evs, y0 in sections:
            info = data["day_info"][d]
            dr.text(P(MARG + 2, y0), DAYS[d], font=F(13, True), fill=pal["text"])
            if info["total"]:
                ts = "%s h" % _hours(info["total"])
                dr.text(P(W - MARG - 2 - tw(ts, F(10)), y0 + 3), ts,
                        font=F(10), fill=pal["muted"])
            yy = y0 + 36
            if not evs:
                dr.text(P(MARG + 4, yy), "nothing planned", font=F(10), fill=pal["muted"])
                yy += 24
            for e in evs:
                t = data["types"].get(e.type_id)
                color = _rgb(e.color or (t.color if t else None))
                a = (_clamp(t.opacity, 10, 100, 100) / 100.0) if t else 1.0
                fill = _blend(color, a, pal["panel"])
                border = _blend(color, min(1.0, max(0.6, a)), pal["panel"])
                txtc = _text_on(fill)
                txt2 = _blend(txtc, 0.78, fill)
                h = _card_h(e)
                rr(MARG, yy, W - MARG, yy + h, 10, fill=fill, outline=border, width=1)
                dr.rectangle(BOX(MARG + 2, yy + 2, MARG + 7, yy + h - 2), fill=color)
                f_t, f_m = F(12, True), F(10)
                tstr = "%s–%s" % (_fmt_raw(e.start_min), _fmt_raw(e.end_min))
                dr.text(P(W - MARG - 12 - tw(tstr, f_t), yy + 9), tstr,
                        font=f_t, fill=txtc)
                maxw = W - 2 * MARG - 34
                dr.text(P(MARG + 15, yy + 8),
                        ell(e.title or "Untitled", f_t, maxw - tw(tstr, f_t)),
                        font=f_t, fill=txtc)
                cy2 = yy + 30
                sub = " · ".join(v for v in (e.room or "", e.teacher or "") if v)
                if sub:
                    dr.text(P(MARG + 15, cy2), ell(sub, f_m, maxw), font=f_m, fill=txt2)
                    cy2 += 17
                if e.note:
                    dr.text(P(MARG + 15, cy2), ell(e.note, f_m, maxw), font=f_m, fill=txt2)
                    cy2 += 17
                segs = _segments(e, t)
                if len(segs) > 1:
                    parts = []
                    for j, (sa, sb) in enumerate(segs):
                        if j:
                            parts.append("pause %d min" % (sa - segs[j - 1][1]))
                        parts.append("%s–%s" % (_fmt(sa), _fmt(sb)))
                    dr.text(P(MARG + 15, cy2), ell("  ·  ".join(parts), f_m, maxw),
                            font=f_m, fill=txt2)
                yy += h + 8
            ln(MARG, yy - 2, W - MARG, yy - 2, pal["line2"], 1)
    else:
        # ---------------- week grid ----------------
        dr.rectangle(BOX(0, MARG + HEADER_H, W, gy0 + grid_h), fill=pal["panel"])
        for i, d in enumerate(days):
            x = GUT + i * day_w
            body = pal["grid_we"] if d >= 5 else pal["grid"]
            info = data["day_info"][d]
            dr.rectangle(BOX(x, gy0, x + day_w, gy0 + grid_h), fill=body)

            m = dstart
            while m <= dend:
                y = gy0 + (m - dstart) / 60.0 * hour_px
                if m % 60 == 0:
                    dr.line([x * S, y * S, (x + day_w) * S, y * S], fill=pal["line"], width=S)
                else:
                    dr.line([x * S, y * S, (x + day_w) * S, y * S], fill=pal["line2"], width=1)
                m += 30

            for zs, ze in ((0, info["wake"]), (info["sleepAbs"], 1440)):
                zs, ze = max(zs, dstart), min(ze, dend)
                if ze > zs:
                    hatch(x, gy0 + (zs - dstart) / 60.0 * hour_px, day_w,
                          (ze - zs) / 60.0 * hour_px, _blend(pal["muted"], 0.30, body))
            for per in data["periods"]:
                pd = per["days"].get(d)
                if not (pd and pd["on"]):
                    continue
                zs, ze = max(pd["start"], dstart), min(pd["end"], dend)
                if ze <= zs:
                    continue
                op = _clamp(per["p"].opacity, 0, 100, 30) / 100.0
                pcol = _rgb(per["p"].color)
                hatch(x, gy0 + (zs - dstart) / 60.0 * hour_px, day_w,
                      (ze - zs) / 60.0 * hour_px,
                      _blend(pcol, min(0.45, max(0.10, op * 0.6)), body))
                zbd = _blend(pcol, min(1.0, op + 0.25), body)
                ln(x, gy0 + (zs - dstart) / 60.0 * hour_px, x + day_w,
                   gy0 + (zs - dstart) / 60.0 * hour_px, zbd, 1)
                ln(x, gy0 + (ze - dstart) / 60.0 * hour_px, x + day_w,
                   gy0 + (ze - dstart) / 60.0 * hour_px, zbd, 1)

            frac = _layout(data["per_day"][d])
            for e in data["per_day"][d]:
                col, ncols = frac[e]
                t = data["types"].get(e.type_id)
                color = _rgb(e.color or (t.color if t else None))
                a = (_clamp(t.opacity, 10, 100, 100) / 100.0) if t else 1.0
                fill = _blend(color, a, body)
                border = _blend(color, min(1.0, max(0.6, a)), body)
                txtc = _text_on(fill)
                txt2 = _blend(txtc, 0.78, fill)
                segs = _segments(e, t)
                if len(segs) > 1:  # spine behind the segments, like the app
                    ys = gy0 + (max(segs[0][0], dstart) - dstart) / 60.0 * hour_px + 3
                    ye2 = gy0 + (min(segs[-1][1], dend) - dstart) / 60.0 * hour_px - 3
                    if ye2 > ys:
                        rr(x + 5, ys, x + 15, ye2, 5, fill=fill)
                for si, (s0, s1) in enumerate(segs):
                    cs, ce = max(s0, dstart), min(s1, dend)
                    if ce <= cs:
                        continue
                    y1 = gy0 + (cs - dstart) / 60.0 * hour_px + 2
                    y2 = gy0 + (ce - dstart) / 60.0 * hour_px - 2
                    if y2 - y1 < 9:
                        dr.rectangle(BOX(x + 4, y1, x + day_w - 4, max(y1 + 2, y2)), fill=fill)
                        continue
                    rr(x + 4, y1, x + day_w - 4, y2, 8, fill=fill, outline=border, width=1)
                    dr.rectangle(BOX(x + 6, y1 + 2, x + 10, y2 - 2), fill=color)
                    bx, bw = x + 15, day_w - 27
                    if y2 - y1 >= 30:
                        if si == 0:
                            dr.text(P(bx, y1 + 4), ell(e.title or "Untitled", F(11, True), bw),
                                    font=F(11, True), fill=txtc)
                        meta = "%s–%s" % (_fmt(s0), _fmt(s1))
                        extra = " · ".join(v for v in (e.room or "", e.teacher or "") if v)
                        if extra and si == 0:
                            meta += " · " + extra
                        if y2 - y1 >= 48 or si == 0:
                            dr.text(P(bx, y1 + 20), ell(meta, F(9.5), bw),
                                    font=F(9.5), fill=txt2)

            # day header on top of the body
            dr.rectangle(BOX(x, MARG + HEADER_H, x + day_w, gy0), fill=pal["head"])
            dr.text(P(x + 10, MARG + HEADER_H + 11), DAYS[d],
                    font=F(12.5, True), fill=pal["text"])
            if info["total"]:
                ts = "%s h" % _hours(info["total"])
                dr.text(P(x + day_w - 10 - tw(ts, F(9.5)), MARG + HEADER_H + 14),
                        ts, font=F(9.5), fill=pal["muted"])

        # separators, frame, gutter labels
        for i in range(nd):
            ln(GUT + i * day_w, MARG + HEADER_H, GUT + i * day_w, gy0 + grid_h,
               pal["line"], 1)
        ln(W, MARG + HEADER_H, W, gy0 + grid_h, pal["line"], 1)
        ln(0, gy0, W, gy0, pal["line"], 1)
        dr.rectangle(BOX(0, MARG + HEADER_H, W, gy0 + grid_h), outline=pal["line"], width=S)
        m = dstart
        while m < dend:
            y = gy0 + (m - dstart) / 60.0 * hour_px
            lab = _fmt(m)
            dr.text(P(GUT - 8 - tw(lab, F(9.5)), y - 6), lab, font=F(9.5), fill=pal["muted"])
            m += 60

    # ---------- stat chips ----------
    f_c, f_cb = F(10.5), F(10.5, True)
    by_type = {}
    for e in data["events"]:
        ds = [d for d in _event_days(e) if d in data["day_info"]]
        if ds:
            by_type[e.type_id] = by_type.get(e.type_id, 0) + (_end_min(e) - e.start_min) * len(ds)
    chips = []
    for t in data["types_list"]:
        mins = by_type.get(t.id, 0)
        if mins > 0:
            chips.append((mins, t.name, "%s h" % _hours(mins), _rgb(t.color)))
    chips.sort(key=lambda it: -it[0])
    chips = [(n, v, c) for _m, n, v, c in chips]
    chips.append(("Scheduled", "%s h" % _hours(st["total"]), (100, 116, 139)))
    chips.append(("Blocks", str(st["count"]), (100, 116, 139)))
    chips.append(("Sleep avg", "%s h" % _hours(st["sleep"] * 60), (100, 116, 139)))
    if st["busiest"] is not None:
        chips.append(("Busiest", DAYS[st["busiest"]], (100, 116, 139)))

    cx, cy = MARG, chip_y
    for name, val, colr in chips:
        wch = 12 + tw(name, f_c) + 6 + tw(val, f_cb) + 12
        if cx + wch > W - MARG:
            cx, cy = MARG, cy + 26
        if cy > H - MARG - 22:
            break
        rr(cx, cy, cx + wch, cy + 22, 8,
           fill=_blend(colr, 0.14, pal["bg"]), outline=_blend(colr, 0.55, pal["bg"]), width=1)
        dr.rectangle(BOX(cx + 1, cy + 2, cx + 5, cy + 20), fill=colr)
        dr.text(P(cx + 11, cy + 6), name, font=f_c, fill=pal["text2"])
        dr.text(P(cx + 11 + tw(name, f_c) + 6, cy + 6), val, font=f_cb, fill=pal["text"])
        cx += wch + 8

    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()