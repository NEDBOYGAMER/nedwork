'use strict';

/* ================= constants & state ================= */
const API = String(window.APP_BASE || '/apps/timetable/').replace(/\/+$/, '');
const DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const PASTELS = ['#2563EB','#0D9488','#7C3AED','#DB2777','#F59E0B','#65A30D',
                 '#0EA5E9','#EA580C','#DC2626','#4F46E5','#059669','#A16207'];
const ZOOMS = [32, 40, 48, 60, 76];

let state = null;
let editingEventId = null;
let editDays = new Set();
let editColor = null;        // per-entry color override (null = type color)
let editingTypes = [];
let editingPeriods = [];
let editingGroups = [];
let confirmCb = null;
let promptSubmit = null;
let suppressClick = false;
let drag = null;
let ctx = null;

/* mobile */
const mqMobile = window.matchMedia('(max-width: 760px)');
const isMobile = () => mqMobile.matches;
let mobileDay = (new Date().getDay()+6)%7;
let mobileEdit = false;
let mobileHintShown = false;
let mnavPage = 'main';
let mnavTabId = null;

if (mqMobile.addEventListener)
  mqMobile.addEventListener('change', () => {
    mobileEdit = false;
    document.body.classList.remove('mobile-edit');
    renderAll();
  });

/* ================= tiny helpers ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = m => String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
const parseHM = s => { if(!s) return null; const p = s.split(':').map(Number);
  if (p.length < 2 || Number.isNaN(p[0]) || Number.isNaN(p[1])) return null;
  return p[0]*60 + p[1]; };
const hoursTxt = mins => (Math.round(mins/6)/10).toFixed(1).replace(/\.0$/,'');
const nowMinutes = () => { const d = new Date(); return d.getHours()*60 + d.getMinutes(); };
const hourPx = () => (state && state.settings.hourPx) || 48;
const todayIdx = () => (new Date().getDay()+6)%7;
const clampInt = (v, lo, hi, dflt) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};
/* sleep <= wake means the sleep time is on the NEXT day (after midnight) */
const sleepAbsOf = r => (r.sleep <= r.wake ? r.sleep + 1440 : r.sleep);
const sleepHours = r => (1440 - (sleepAbsOf(r) - r.wake)) / 60;
const fmtW = m => fmt(m % 1440);   // absolute minutes that may exceed 24:00

function nearestOffset(m, o){
  const h = Math.floor(m/60)*60;
  let best = h + o - 60;
  for (const c of [h + o, h + o + 60])
    if (c >= 0 && Math.abs(c - m) < Math.abs(best - m)) best = c;
  return Math.max(0, Math.min(1439, best));
}

const lastTypeId = () => {
  try { const v = parseInt(localStorage.getItem('tt_last_type') || '', 10);
    return Number.isFinite(v) && state.eventTypes.some(t => t.id === v) ? v : null;
  } catch(_){ return null; }
};
const setLastType = id => {
  try { if (id != null) localStorage.setItem('tt_last_type', String(id));
        else localStorage.removeItem('tt_last_type'); } catch(_){}
};

/* ================= color math ================= */
function hexToRgb(h){
  h = String(h || '').replace('#','');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [148,163,184];
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function relLum(rgb){
  const f = v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
  return 0.2126*f(rgb[0]) + 0.7152*f(rgb[1]) + 0.0722*f(rgb[2]);
}
function contrastL(a, b){
  const la = relLum(a), lb = relLum(b);
  return (Math.max(la,lb)+0.05) / (Math.min(la,lb)+0.05);
}
function themeBaseRGB(){
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return hexToRgb(v);
  } catch(_){}
  return document.documentElement.dataset.theme === 'light' ? [255,255,255] : [15,25,48];
}
function rgba(rgb, a){ return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`; }
function pickText(effRgb){
  return contrastL(effRgb, [17,24,38]) >= contrastL(effRgb, [242,245,251])
    ? '#111826' : '#f2f5fb';
}
function blockVars(t, colorOverride){
  const c = colorOverride || (t ? t.color : '#8aa0c0');
  const op = t ? clampInt(t.opacity, 10, 100, 100) : 30;
  const a = op / 100;
  const rgb = hexToRgb(c);
  const base = themeBaseRGB();
  const eff = [0,1,2].map(i => rgb[i]*a + base[i]*(1-a));
  const txt = pickText(eff);
  const bd = Math.min(1, Math.max(0.6, a));
  return `--tc:${c};--evbg:${rgba(rgb,a)};--evbd:${rgba(rgb,bd)};--evt:${txt}`;
}
/* time-period zone: colored hatch (like the sleep zone) */
function periodVars(p){
  const rgb = hexToRgb(p.color);
  const a = clampInt(p.opacity, 0, 100, 30) / 100;
  return `--zh:${rgba(rgb, Math.max(.10, a*.6))};` +
         `--zbd:${rgba(rgb, Math.min(1, a+.25))}`;
}

/* ================= state accessors ================= */
const activeId = () => {
  const a = state.settings.activeScheduleId;
  return state.schedules.some(s => s.id === a) ? a : (state.schedules[0] ? state.schedules[0].id : null);
};
const activeSchedule = () => state.schedules.find(s => s.id === activeId()) || null;
const typeById = id => (id != null ? state.eventTypes.find(t => t.id === id) : null) || null;
const activeEvents = () => { const s = activeSchedule();
  return s ? state.events.filter(e => e.scheduleId === s.id) : []; };
const gridEvents = () => activeEvents();
function shownDays(){ const s = state.settings; const d = [0,1,2,3,4];
  if (s.showSaturday) d.push(5); if (s.showSunday) d.push(6); return d; }
const defaultDay = () => shownDays().includes(todayIdx()) ? todayIdx() : 0;
function dayRange(d){
  const r = (state.settings.dayRanges || [])[d];
  return r ? {wake: r.wake, sleep: r.sleep}
           : {wake: state.settings.dayStart ?? 420, sleep: state.settings.dayEnd ?? 1320};
}
function statCfg(){ return state.settings.statConfig || {}; }

/* per-TYPE split: lesson/pause rhythm from the block's start */
function splitSegments(e){
  const t = typeById(e.typeId);
  if (!t || !t.splitOn) return null;
  const P = clampInt(t.splitMin, 20, 120, 45);
  const B = clampInt(t.splitBreak, 0, 60, 15);
  const dur = e.end - e.start;
  if (dur <= P) return null;
  const out = []; let s = e.start;
  while (s < e.end && out.length < 24){
    const e1 = Math.min(e.end, s + P);
    out.push({start: s, end: e1});
    if (e1 >= e.end) break;
    s = e1 + B;
  }
  return out.length > 1 ? out : null;
}

/* last block with the same name & type — the source for "copy color from same" */
function findSameColorSource(excludeId, typeId, title){
  const key = String(title || '').trim().toLowerCase();
  if (!key) return null;
  const cands = activeEvents().filter(x =>
    x.id !== excludeId &&
    (x.typeId ?? null) === (typeId ?? null) &&
    String(x.title || '').trim().toLowerCase() === key);
  return cands.length ? cands.reduce((a, b) => (b.id > a.id ? b : a)) : null;
}

function normState(st){
  st.events = (st.events || []).map(e => ({
    ...e,
    days: Array.isArray(e.days) && e.days.length
      ? [...new Set(e.days)].sort((a,b) => a-b)
      : [e.day != null ? e.day : 0],
  }));
  const s = st.settings = st.settings || {};
  s.dayStart = s.dayStart ?? 420;
  s.dayEnd = s.dayEnd ?? 1320;
  s.style = s.style || 'default';
  s.styles = (Array.isArray(s.styles) && s.styles.length) ? s.styles : ['default'];
  const map = {};
  (Array.isArray(s.dayRanges) ? s.dayRanges : []).forEach(r => {
    if (r && r.day != null && !(r.day in map)) map[r.day] = r;
  });
  s.dayRanges = [0,1,2,3,4,5,6].map(d => {
    const r = map[d] || {};
    let wake = clampInt(r.wake, 0, 1440, s.dayStart);
    let sleep = clampInt(r.sleep, 0, 1440, s.dayEnd);
    if (wake > 1439) wake = 0;    // 24:00 == 00:00 (same moment)
    if (sleep > 1439) sleep = 0;  // 24:00 == 00:00; sleep <= wake → next day
    return {day: d, wake, sleep};
  });
  const sc = s.statConfig = s.statConfig || {};
  ['showTypes','showTotal','showCount','showBusiest','showSleep','showPeriods']
    .forEach(k => { if (k in sc) sc[k] = !!sc[k]; });
  sc.groups = (Array.isArray(sc.groups) ? sc.groups : []).filter(g => g && g.name);
  (st.eventTypes || []).forEach(t => {
    t.splitOn = !!t.splitOn;
    t.splitMin = clampInt(t.splitMin, 20, 120, 45);
    t.splitBreak = clampInt(t.splitBreak, 0, 60, 15);
    t.opacity = t.opacity == null ? 100 : t.opacity;
  });
  st.periods = (st.periods || []).map(p => {
    const pd = {};
    (Array.isArray(p.days) ? p.days : []).forEach(d => { if (d && d.day != null) pd[d.day] = d; });
    return {...p, opacity: clampInt(p.opacity, 0, 100, 30), days:
      [0,1,2,3,4,5,6].map(d => {
        const it = pd[d] || {};
        let start = clampInt(it.start, 0, 1440, p.start ?? 480);
        let end = clampInt(it.end, 0, 1440, p.end ?? 1020);
        if (end <= start) end = Math.min(1440, start + 60);
        return {day: d, on: it.on !== false, start, end};
      })};
  });
  return st;
}

/* ================= server calls ================= */
async function call(path, body){
  let res;
  try {
    res = await fetch(API + '/' + path, {
      method: 'POST',
      headers: {'Content-Type':'application/json','Accept':'application/json'},
      body: JSON.stringify(body || {})
    });
  } catch (e) { throw new Error('Network error'); }
  if (res.redirected || (res.url && res.url.includes('login'))){
    window.location.href = res.url;
    throw new Error('Please log in again');
  }
  let data = {};
  try { data = await res.json(); } catch (e) { throw new Error('Unexpected server response'); }
  if (!res.ok || data.error) throw new Error(data.error || ('HTTP ' + res.status));
  if (data.state){ state = normState(data.state); renderAll(); }
  return data;
}

/* ================= theme & style ================= */
function applyTheme(){
  document.documentElement.dataset.theme = state.settings.theme === 'light' ? 'light' : 'dark';
}

/* Extra styles: styles/default.css is always loaded as the base (the HTML
   links it); any other *.css in the styles folder can be layered on top of
   it — a later stylesheet wins, so a style can override ANYTHING. */
let previewStyle = null;   // live preview while the settings modal is open

function applyStyle(){
  if (!state) return;
  const st = previewStyle ?? (state.settings.style || 'default');
  let link = document.getElementById('styleLink');
  if (!st || st === 'default' || !/^[A-Za-z0-9_-]+$/.test(st)){
    if (link) link.remove();
    return;
  }
  const href = API + '/styles/' + st + '.css';
  if (!link){
    link = document.createElement('link');
    link.id = 'styleLink';
    link.rel = 'stylesheet';
    document.head.appendChild(link);   // after default.css → wins the cascade
  }
  link.href = href;
}
function styleLabel(n){
  return n === 'default' ? 'Default'
    : n.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function renderStyleOptions(){
  const list = (state.settings.styles && state.settings.styles.length)
    ? state.settings.styles : ['default'];
  $('#sStyle').innerHTML = list.map(n =>
    `<option value="${esc(n)}">${esc(styleLabel(n))}</option>`).join('');
}
/* revert a live preview when the settings modal is closed without saving */
function closeSettingsPreview(){
  if (previewStyle == null) return;
  previewStyle = null;
  applyStyle();
}

/* ================= rendering ================= */
function renderAll(){
  if (!state) return;
  applyTheme();
  applyStyle();
  renderTabs();
  renderBoard();
  renderStats();
  renderHintbar();
}

function renderHintbar(){
  $('#hintbar').style.display = activeEvents().length ? 'none' : 'block';
}

function renderTabs(){
  $('#scheduleTabs').innerHTML = state.schedules.map(s =>
    `<button class="tab ${s.id===activeId()?'active':''}" data-sid="${s.id}"
       title="Right-click: rename · duplicate · copy from · delete">${esc(s.name)}</button>`
  ).join('');
}

function layoutDay(list){
  const evs = [...list].sort((a,b)=>a.start-b.start || b.end-a.end || a.id-b.id);
  const colEnd = []; const colOf = new Map();
  for (const e of evs){
    let c = colEnd.findIndex(end => end <= e.start);
    if (c === -1){ c = colEnd.length; colEnd.push(e.end); } else colEnd[c] = e.end;
    colOf.set(e, c);
  }
  const groups = []; let cur = [], curEnd = -1;
  for (const e of evs){
    if (cur.length && e.start >= curEnd){ groups.push(cur); cur = []; curEnd = -1; }
    cur.push(e); curEnd = Math.max(curEnd, e.end);
  }
  if (cur.length) groups.push(cur);
  for (const g of groups){
    const cols = Math.max(...g.map(e => colOf.get(e) + 1));
    for (const e of g){ e._left = colOf.get(e)/cols; e._width = 1/cols; }
  }
  return evs;
}

function renderBoard(){
  if (!state) return;
  if (isMobile()) renderBoardMobile(); else renderBoardDesktop();
  updateNow();
}

/* ---------- desktop grid ---------- */
function renderBoardDesktop(){
  const s = state.settings;
  const hp = hourPx();
  const start = s.dayStart ?? 420, end = s.dayEnd ?? 1320;
  const bodyH = Math.max(60, (end - start)/60*hp);
  const nowMin = nowMinutes();

  $('#board').style.setProperty('--hour', hp + 'px');

  let g = '<div class="g-head"></div>';
  for (let m = start; m < end; m += 60)
    g += `<div class="g-label" style="height:${hp}px">${fmt(m)}</div>`;
  $('#gutter').innerHTML = g;

  const evs = gridEvents();
  const periods = state.periods || [];
  let html = '';
  for (const d of shownDays()){
    const r = dayRange(d);
    const slAbs = sleepAbsOf(r);   // sleep time may sit after midnight
    const dayEvs = evs.filter(e => e.days.includes(d));
    const laid = layoutDay(dayEvs);
    const total = dayEvs.reduce((a,e)=>a+(e.end-e.start),0);

    /* zones under the blocks: sleep hatch + colored period hatch */
    let zones = '';
    if (r.wake > start)
      zones += `<div class="zone" style="top:0;height:${(Math.min(r.wake,end)-start)/60*hp}px"
        title="Asleep before ${fmt(r.wake)}"></div>`;
    if (slAbs < end)
      zones += `<div class="zone" style="top:${(Math.max(slAbs,start)-start)/60*hp}px;
        height:${(end-Math.max(slAbs,start))/60*hp}px" title="Asleep after ${fmt(slAbs)}"></div>`;
    for (const p of periods){
      const pd = (p.days || [])[d];
      if (!pd || !pd.on) continue;
      const zt = Math.max(pd.start, start), zb = Math.min(pd.end, end);
      if (zb <= zt) continue;
      const top = (zt-start)/60*hp, h = (zb-zt)/60*hp;
      zones += `<div class="pzone" style="${periodVars(p)};top:${top}px;height:${h}px"
        title="${esc(p.name)} ${fmt(pd.start)}–${fmt(pd.end)}"></div>`;
    }

    let evh = '';
    for (const e of laid){
      const t = typeById(e.typeId);
      const segs = splitSegments(e) || [{start: e.start, end: e.end}];
      const multi = e.days.length > 1;
      const out = e.start < r.wake || e.end > slAbs;
      const L = e._left*100, W = e._width*100;
      const vars = blockVars(t, e.color);
      /* periods this block sits in → icon badge on the block (any type) */
      const inPeriods = periods.filter(p => {
        const pd = (p.days || [])[d];
        return pd && pd.on && e.start < pd.end && e.end > pd.start;
      });
      const bHtml = inPeriods.map(p =>
        `<span class="pib" title="${esc(p.name)}">${p.icon ? esc(p.icon)
          : `<i class="pib-dot" style="background:${p.color}"></i>`}</span>`).join('');

      /* filler behind the segments: same look as the blocks, ~15% wide,
         so the unit is bound together on the left like one block */
      if (segs.length > 1){
        const top1 = (Math.max(segs[0].start, start)-start)/60*hp;
        const hAll = (Math.min(segs[segs.length-1].end, end) - Math.max(segs[0].start, start))/60*hp - 2;
        evh += `<div class="ev-spine" style="${vars};
          left:calc(${L.toFixed(3)}% + 3px);width:calc(${(W*0.15).toFixed(3)}% - 3px);
          top:${top1}px;height:${Math.max(10,hAll)}px"></div>`;
      }

      segs.forEach((sg, idx) => {
        const topM = Math.max(sg.start, start), botM = Math.min(sg.end, end);
        if (botM <= topM) return;
        const top = (topM-start)/60*hp;
        const h = Math.max(16, (botM-topM)/60*hp - 2);
        const xs = h < 34;
        const first = idx === 0, last = idx === segs.length - 1;
        evh += `<div class="ev" data-id="${e.id}"
          data-off="${sg.start - e.start}" data-s0="${sg.start}"
          style="${vars};top:${top}px;height:${h}px;
          left:calc(${(L*1).toFixed(3)}% + 3px);width:calc(${(W*1).toFixed(3)}% - 6px)"
          title="${esc(e.title)} · ${fmt(e.start)}–${fmt(e.end)}${e.room?' · '+e.room:''}${out?' · 🌙 outside wake hours':''}">
          ${first ? `<div class="ev-title">${t && t.icon ? esc(t.icon)+' ' : ''}${esc(e.title)}${bHtml}</div>` : ''}
          ${xs ? '' : `<div class="ev-meta">${fmt(sg.start)}–${fmt(sg.end)}${first&&multi?' · '+e.days.map(i=>DAY_SHORT[i]).join(' '):''}${first&&e.room?' · '+esc(e.room):''}${out?' · 🌙':''}</div>`}
          ${last ? '<div class="ev-resize" title="Drag to change the end time"></div>' : ''}
        </div>`;
      });
    }

    const nowLine = (d === todayIdx() && nowMin >= start && nowMin <= end)
      ? '<div class="now-line" id="nowLine"></div>' : '';
    const menuItems = shownDays().filter(x => x !== d).map(x =>
      `<button class="mi" data-copyfrom="${d}" data-copyto="${x}">${DAY_NAMES[x]}</button>`).join('');
    html += `<div class="day ${d===todayIdx()?'is-today':''} ${d>=5?'we':''}">
      <div class="day-head">
        <span class="d-name">${DAY_NAMES[d]}</span>
        <span class="d-total">${total ? hoursTxt(total)+'h' : ''}</span>
        <details class="day-menu"><summary title="Day actions">⋯</summary>
          <div class="menu">
            <div class="m-title">Copy this day to…</div>
            ${menuItems || '<div class="m-title">No other days shown</div>'}
            <button class="mi danger" data-clearday="${d}">Clear this day</button>
          </div>
        </details>
      </div>
      <div class="day-body" data-day="${d}" style="height:${bodyH}px">${evh}${zones}${nowLine}</div>
    </div>`;
  }
  $('#days').innerHTML = html;
  $('#emptyHint').style.display = evs.length ? 'none' : 'block';
}

/* ---------- mobile ---------- */
function renderBoardMobile(){
  const days = shownDays();
  if (!days.includes(mobileDay)) mobileDay = defaultDay();

  const evs = gridEvents();
  $('#mPills').innerHTML = days.map(d => {
    const n = evs.filter(e => e.days.includes(d)).length;
    return `<button class="mpill ${d===mobileDay?'on':''} ${d===todayIdx()?'today':''}"
      data-day="${d}">${DAY_SHORT[d]}${n?'<i class="dot"></i>':''}</button>`;
  }).join('');

  const r = dayRange(mobileDay);
  const slAbs = sleepAbsOf(r);
  const dayEvs = evs.filter(e => e.days.includes(mobileDay))
    .sort((a,b) => a.start - b.start || b.end - a.end || a.id - b.id);
  const total = dayEvs.reduce((a,e) => a + (e.end - e.start), 0);

  $('#mDayHead').innerHTML = `
    <button class="mnav-arrow" data-dir="-1" title="Previous day">‹</button>
    <div class="mday-title">
      <span>${DAY_NAMES[mobileDay]}${mobileDay===todayIdx()?'<span class="today-tag">Today</span>':''}</span>
      <span class="mday-sub">${dayEvs.length
        ? `${dayEvs.length} block${dayEvs.length===1?'':'s'} · ${hoursTxt(total)}h · ${fmt(r.wake)}–${fmtW(slAbs)}`
        : 'nothing planned'}</span>
    </div>
    <button class="mnav-arrow" data-dir="1" title="Next day">›</button>`;

  const nowMin = nowMinutes();
  const showNow = mobileDay === todayIdx();
  const nowDivider = () =>
    `<div class="m-now"><span class="m-now-dot"></span><span class="m-now-time">${fmt(nowMin)}</span>` +
    `<span class="m-now-line"></span></div>`;

  const cardHtml = e => {
    const t = typeById(e.typeId);
    const out = e.start < r.wake || e.end > slAbs;
    const segs = splitSegments(e);
    let segLine = '';
    if (segs && segs.length > 1){
      const bits = [];
      segs.forEach((s, i) => {
        if (i) bits.push(`<span class="mc-pause">⏸ ${s.start - segs[i-1].end}′</span>`);
        bits.push(`<span class="mc-seg">${fmt(s.start)}–${fmt(s.end)}</span>`);
      });
      segLine = `<div class="mc-segline">${bits.join('')}</div>`;
    }
    return `<div class="mcard" data-id="${e.id}" style="${blockVars(t, e.color)}">
      <div class="mc-main">
        <div class="mc-title">${t && t.icon ? esc(t.icon)+' ' : ''}${esc(e.title)}</div>
        ${(e.room || e.teacher) ? `<div class="mc-sub">${esc(e.room||'')}${e.room&&e.teacher?' · ':''}${esc(e.teacher||'')}</div>` : ''}
        ${e.note ? `<div class="mc-sub">${esc(e.note)}</div>` : ''}
        ${segLine}
      </div>
      <div class="mc-time" ${out?`title="Outside wake hours (${fmt(r.wake)}–${fmtW(slAbs)})"`:''}>${out?'🌙 ':''}${fmt(e.start)}–${fmt(e.end)}</div>
    </div>`;
  };

  if (!dayEvs.length){
    $('#mList').innerHTML = (showNow ? nowDivider() : '') +
      `<div class="mempty">${mobileDay===todayIdx()
        ? 'Nothing today 🎉' : 'Nothing on '+DAY_NAMES[mobileDay]+' 🎉'}</div>`;
    return;
  }
  /* red "you are here" line: before the first block that starts later than now */
  let html = '';
  let nowPlaced = !showNow;
  for (const e of dayEvs){
    if (!nowPlaced && e.start > nowMin){ html += nowDivider(); nowPlaced = true; }
    html += cardHtml(e);
  }
  if (!nowPlaced) html += nowDivider();
  $('#mList').innerHTML = html;
}

/* ---------- stats bar ---------- */
function renderStats(){
  if (isMobile()) return;
  const cfg = statCfg();
  const evs = gridEvents();
  if (!evs.length){
    $('#statsBar').innerHTML = '<span class="muted">No blocks in this view — click the grid or “＋ Add block” to start.</span>';
    return;
  }
  const perDay = [0,0,0,0,0,0,0];
  const byType = new Map();
  let total = 0;
  for (const e of evs){
    const d = e.end - e.start;
    byType.set(e.typeId ?? 0, (byType.get(e.typeId ?? 0)||0) + d*e.days.length);
    total += d*e.days.length;
    for (const dd of e.days) perDay[dd] += d;
  }
  const chip = (label, mins, color) =>
    `<span class="chip" style="--tc:${color||'#64748b'}">${label} <b>${hoursTxt(mins)}h</b></span>`;
  const parts = [];

  for (const g of (cfg.groups || [])){
    if (g.on === false) continue;
    const ts = state.eventTypes.filter(t => (g.types || []).includes(t.id));
    if (!ts.length) continue;
    const set = new Set(ts.map(t => t.id));
    const mins = evs.reduce((a,e) =>
      a + (e.typeId && set.has(e.typeId) ? (e.end-e.start)*e.days.length : 0), 0);
    const icons = ts.map(t => t.icon).filter(Boolean).join('');
    parts.push(chip(`${icons ? esc(icons)+' ' : ''}${esc(g.name)}`, mins, ts[0].color));
  }
  if (cfg.showTypes !== false){
    for (const [tid, mins] of [...byType.entries()].sort((a,b)=>b[1]-a[1])){
      const t = tid ? typeById(tid) : null;
      const label = t ? `${t.icon ? esc(t.icon)+' ' : ''}${esc(t.name)}` : 'Unsorted';
      parts.push(chip(label, mins, t ? t.color : '#8aa0c0'));
    }
  }
  if (cfg.showPeriods !== false){
    for (const p of (state.periods || [])){
      const mins = (p.days || []).reduce((a,d) => a + (d.on ? d.end - d.start : 0), 0);
      if (mins > 0) parts.push(chip(`${p.icon ? esc(p.icon)+' ' : ''}${esc(p.name)}`, mins, p.color));
    }
  }
  if (cfg.showSleep !== false){
    const avg = state.settings.dayRanges.reduce((a,r) => a + sleepHours(r), 0) / 7;
    parts.push(`<span class="chip" style="--tc:#64748b">😴 Sleep avg <b>${avg.toFixed(1).replace(/\.0$/,'')}h</b></span>`);
  }
  if (cfg.showTotal !== false)
    parts.push(`<span class="chip total">Scheduled <b>${hoursTxt(total)}h</b> / week</span>`);
  if (cfg.showCount !== false)
    parts.push(`<span class="chip total">${evs.length} block${evs.length===1?'':'s'}</span>`);
  if (cfg.showBusiest !== false){
    let busiest = -1, bm = 0;
    perDay.forEach((v,i) => { if (v > bm){ bm = v; busiest = i; } });
    if (busiest >= 0)
      parts.push(`<span class="chip total">Busiest day <b>${DAY_NAMES[busiest]}</b></span>`);
  }
  $('#statsBar').innerHTML = parts.join('') ||
    '<span class="muted">All stat chips are hidden — enable some in ⚙ Settings → Stats.</span>';
}

function updateNow(){
  if (!state) return;
  const nowMin = nowMinutes();
  const todays = activeEvents().filter(e => e.days.includes(todayIdx())).sort((a,b)=>a.start-b.start);
  let txt;
  const cur = todays.find(e => e.start <= nowMin && nowMin < e.end);
  if (cur) txt = `Now: ${cur.title} · until ${fmt(cur.end)}`;
  else {
    const nxt = todays.find(e => e.start > nowMin);
    if (nxt){ const dmin = nxt.start - nowMin;
      txt = `Next: ${nxt.title} in ${dmin >= 60 ? Math.floor(dmin/60)+'h ' : ''}${dmin%60}m`; }
    else txt = todays.length ? 'Done for today 🎉' : 'Nothing scheduled today 🎉';
  }
  $('#nowChip').textContent = txt;

  if (isMobile()){
    document.querySelectorAll('.mcard.current').forEach(el => el.classList.remove('current'));
    if (cur && mobileDay === todayIdx()){
      const el = document.querySelector(`.mcard[data-id="${cur.id}"]`);
      if (el) el.classList.add('current');
    }
    const mt = document.getElementById('mNowTime');
    if (mt) mt.textContent = fmt(nowMin);
    return;
  }
  const line = document.getElementById('nowLine');
  if (line){
    const s = state.settings;
    if (nowMin >= s.dayStart && nowMin <= s.dayEnd){
      line.style.display = 'block';
      line.style.top = ((nowMin - s.dayStart)/60*hourPx()) + 'px';
    } else line.style.display = 'none';
  }
  document.querySelectorAll('.ev.current').forEach(el => el.classList.remove('current'));
  if (cur){
    document.querySelectorAll(`.day.is-today .ev[data-id="${cur.id}"]`)
      .forEach(el => el.classList.add('current'));
  }
}

/* ================= modals / toasts ================= */
function openModal(sel){ $(sel).classList.add('open'); }
function closeModal(sel){ $(sel).classList.remove('open'); }
function toast(msg, kind){
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2600);
}
function confirmAction(msg, cb){
  $('#confirmMsg').textContent = msg;
  confirmCb = cb;
  openModal('#confirmModal');
}
function openPrompt(title, value, cb){
  $('#promptTitle').textContent = title;
  $('#promptInput').value = value || '';
  promptSubmit = cb;
  openModal('#promptModal');
  setTimeout(() => { $('#promptInput').focus(); $('#promptInput').select(); }, 60);
}

/* ================= event modal ================= */
function renderDayChips(){
  $('#fDays').innerHTML = DAY_SHORT.map((n,i) =>
    `<button type="button" class="dchip ${editDays.has(i)?'on':''}" data-day="${i}">${n}</button>`
  ).join('');
  updateWakeWarn();
}
$('#fDays').addEventListener('click', e => {
  const b = e.target.closest('.dchip'); if (!b) return;
  const d = +b.dataset.day;
  if (editDays.has(d)){
    if (editDays.size > 1) editDays.delete(d);
    else { toast('Keep at least one day', 'err'); return; }
  } else editDays.add(d);
  renderDayChips();
});
document.querySelectorAll('#eventModal [data-preset]').forEach(b =>
  b.addEventListener('click', () => {
    editDays = new Set(b.dataset.preset === 'week' ? [0,1,2,3,4] : [0,1,2,3,4,5,6]);
    renderDayChips();
  }));

function updateRoomLabel(){
  const opt = $('#fType').selectedOptions[0];
  const commute = opt && opt.textContent.toLowerCase().includes('commute');
  $('#fRoomLabelTxt').textContent = commute ? 'Route (from → to)' : 'Room / place';
  $('#fRoom').placeholder = commute ? 'e.g. Home → Campus (S8)' : 'e.g. HG F 5';
}
function applyTypeDefaults(){
  const t = typeById(+$('#fType').value || null);
  if (!t) return;
  let start = parseHM($('#fStart').value);
  if (start == null) return;
  if (t.startOffset > 0) start = nearestOffset(start, t.startOffset);
  $('#fStart').value = fmt(start);
  $('#fEnd').value = fmt(Math.min(1439, start + (t.duration || 60)));
  updateWakeWarn();
}
function updateWakeWarn(){
  const el = $('#fWakeWarn');
  const start = parseHM($('#fStart').value), end = parseHM($('#fEnd').value);
  if (start == null || end == null){ el.style.display = 'none'; return; }
  const bad = [...editDays].filter(d => {
    const r = dayRange(d);
    return start < r.wake || end > sleepAbsOf(r);
  });
  if (!bad.length){ el.style.display = 'none'; return; }
  const r = dayRange(bad[0]);
  const slTxt = fmt(r.sleep) + (r.sleep <= r.wake ? ' (+1d)' : '');
  el.textContent = `🌙 Outside wake hours on ${bad.map(d=>DAY_SHORT[d]).join(', ')} ` +
                   `(wake ${fmt(r.wake)} — sleep ${slTxt})`;
  el.style.display = 'flex';
}
function syncColorUI(){
  const t = typeById(+$('#fType').value || null);
  const shown = editColor || (t ? t.color : '#8aa0c0');
  const rgb = hexToRgb(shown);
  const a = clampInt(t ? t.opacity : 100, 10, 100, 100) / 100;
  $('#fCol').value = shown;
  $('#fColFill').style.background = rgba(rgb, a);
  $('#fColHint').textContent = editColor ? 'custom color' : 'using type color';
}
$('#fCol').addEventListener('input', () => { editColor = $('#fCol').value; syncColorUI(); });
$('#fColReset').addEventListener('click', () => { editColor = null; syncColorUI(); });
/* copy the color of the last block with the same name & type */
$('#fColFromSame').addEventListener('click', () => {
  const typeId = $('#fType').value ? +$('#fType').value : null;
  const src = findSameColorSource(editingEventId, typeId, $('#fTitle').value);
  if (!src){ toast('No other block with this name & type', 'err'); return; }
  editColor = src.color || null;
  syncColorUI();
  toast(src.color ? `Color copied from “${src.title}” ✓`
                  : `“${src.title}” has no own color — type color used`);
});

function openEventModal(ev, prefill){
  editingEventId = ev ? ev.id : null;
  $('#fType').innerHTML = '<option value="">— no type —</option>' + state.eventTypes.map(t =>
    `<option value="${t.id}">${t.icon ? esc(t.icon)+'  ' : ''}${esc(t.name)}</option>`).join('');

  editDays = new Set(ev ? ev.days
    : [(prefill && prefill.day != null) ? prefill.day : defaultDay()]);
  editColor = ev ? (ev.color || null) : null;
  renderDayChips();

  let start;
  if (ev) start = ev.start;
  else if (prefill && prefill.start != null) start = prefill.start;
  else {
    const t = typeById(lastTypeId());
    const raw = nowMinutes();
    start = (t && t.startOffset > 0) ? nearestOffset(raw, t.startOffset) : Math.round(raw/15)*15;
  }
  const selId = ev ? ev.typeId
    : (prefill && prefill.typeId != null ? prefill.typeId : lastTypeId());
  const t = typeById(selId);
  let end;
  if (ev){
    end = ev.end;   // raw value — may be < start (block past midnight)
  } else {
    end = start + (t ? (t.duration || 60) : 60);
    end = Math.max(start + 15, Math.min(1439, end));
  }

  $('#fTitle').value = ev ? ev.title : '';
  $('#fType').value = t ? String(t.id) : '';
  $('#fStart').value = fmt(Math.min(start, 1439));
  $('#fEnd').value = fmt(end % 1440);   // 24:00 displays as 00:00, wraps back on save
  $('#fRoom').value = ev ? (ev.room || '') : '';
  $('#fTeacher').value = ev ? (ev.teacher || '') : '';
  $('#fNote').value = ev ? (ev.note || '') : '';
  $('#evModalTitle').textContent = ev ? 'Edit block' : 'Add block';
  $('#btnEvDelete').hidden = !ev;
  $('#btnEvDuplicate').hidden = !ev;
  setLastType(t ? t.id : null);
  updateRoomLabel();
  updateWakeWarn();
  syncColorUI();
  openModal('#eventModal');
  setTimeout(() => $('#fTitle').focus(), 60);
}

function eventPayload(includeId){
  const p = {
    scheduleId: activeId(),
    typeId: $('#fType').value ? +$('#fType').value : null,
    title: $('#fTitle').value.trim() || 'Untitled',
    days: [...editDays].sort((a,b) => a-b),
    start: parseHM($('#fStart').value),
    end: parseHM($('#fEnd').value),
    color: editColor,
    room: $('#fRoom').value.trim(),
    teacher: $('#fTeacher').value.trim(),
    note: $('#fNote').value.trim(),
  };
  if (includeId && editingEventId) p.id = editingEventId;
  return p;
}
/* shared save path: end before start = past midnight (asks for a confirm) */
function saveEvent(duplicate){
  const p = eventPayload(!duplicate);
  if (p.start == null || p.end == null){ toast('Please set start and end time', 'err'); return; }
  if (p.end === p.start){ toast('End must be after start', 'err'); return; }
  const go = async () => {
    try {
      await call('events/save', p);
      closeModal('#eventModal');
      toast(duplicate ? 'Duplicated ✓' : (editingEventId ? 'Block updated ✓' : 'Block added ✓'));
    } catch (err){ toast(err.message, 'err'); }
  };
  if (p.end < p.start && p.end !== 0){
    confirmAction(`“${p.title}” runs past midnight (${fmt(p.start)} → ${fmt(p.end)} next day). Save it like this?`, go);
  } else go();
}
$('#evForm').addEventListener('submit', e => { e.preventDefault(); saveEvent(false); });
$('#btnEvDuplicate').addEventListener('click', () => saveEvent(true));
$('#btnEvDelete').addEventListener('click', () => {
  const ev = state.events.find(x => x.id === editingEventId);
  confirmAction(`Delete “${ev ? ev.title : 'this block'}”?`, async () => {
    try { await call('events/delete', {id: editingEventId}); closeModal('#eventModal'); toast('Deleted'); }
    catch (err){ toast(err.message, 'err'); }
  });
});
$('#fType').addEventListener('change', () => {
  setLastType($('#fType').value ? +$('#fType').value : null);
  updateRoomLabel();
  if (!editingEventId) applyTypeDefaults();
  updateWakeWarn();
  syncColorUI();
});
$('#fFit').addEventListener('click', applyTypeDefaults);
['fStart','fEnd'].forEach(id =>
  document.getElementById(id).addEventListener('input', updateWakeWarn));

document.querySelectorAll('.mini[data-time]').forEach(b => b.addEventListener('click', () => {
  const inp = b.dataset.time === 'start' ? $('#fStart') : $('#fEnd');
  let m = parseHM(inp.value);
  if (m == null) return;
  m = Math.max(0, Math.min(1439, m + (+b.dataset.d)));
  inp.value = fmt(m);
  if (b.dataset.time === 'start'){
    const end = parseHM($('#fEnd').value);
    if (end != null && end <= m) $('#fEnd').value = fmt(Math.min(1439, m + 15));
  } else {
    const st = parseHM($('#fStart').value);
    if (st != null && m <= st) $('#fStart').value = fmt(Math.max(0, m - 15));
  }
  updateWakeWarn();
}));

/* ================= settings modal ================= */
function openSettingsTab(name){
  document.querySelectorAll('.set-tab').forEach(b => b.classList.toggle('active', b.dataset.stab === name));
  ['general','types','periods','stats'].forEach(n =>
    $('#stab-' + n).classList.toggle('active', n === name));
}
function renderWakeRows(){
  $('#wakeRows').innerHTML = state.settings.dayRanges.map(r => {
    const wrapped = r.sleep <= r.wake;   // sleep time is on the next day
    return `
    <div class="wake-row" data-day="${r.day}">
      <span class="dname">${DAY_NAMES[r.day]}</span>
      <span class="wlab">Wake<input type="time" class="wk" value="${fmt(r.wake)}"></span>
      <span class="wlab">Sleep<input type="time" class="sl" value="${fmt(r.sleep)}"></span>
      <span class="wslp" title="Time asleep between these two times${wrapped?' — sleep is on the next day':''}">${sleepHours(r).toFixed(1).replace(/\.0$/,'')}h${wrapped?' (+1d)':''}</span>
    </div>`;
  }).join('');
}
$('#wakeRows').addEventListener('input', () => {
  document.querySelectorAll('#wakeRows .wake-row').forEach(row => {
    const wk = parseHM(row.querySelector('.wk').value);
    const sl = parseHM(row.querySelector('.sl').value);
    const el = row.querySelector('.wslp');
    if (wk != null && sl != null){
      const sh = (1440 - ((sl <= wk ? sl + 1440 : sl) - wk)) / 60;
      el.textContent = sh.toFixed(1).replace(/\.0$/,'') + 'h' + (sl <= wk ? ' (+1d)' : '');
    }
  });
});

/* ---- periods editor ---- */
function renderPeriodRows(){
  $('#periodRows').innerHTML = editingPeriods.map((p, i) => `
    <div class="p-row" data-idx="${i}">
      <div class="tr-color" title="Click to pick a color">
        <input type="color" class="p-cin" value="${esc(p.color)}">
        <span class="tr-cfill" style="background:${rgba(hexToRgb(p.color), clampInt(p.opacity,0,100,30)/100)}"></span>
      </div>
      <input class="p-icon" maxlength="8" value="${esc(p.icon)}" placeholder="🏫">
      <input class="p-name" maxlength="60" value="${esc(p.name)}" placeholder="e.g. At school">
      <div class="p-nums">
        <input type="time" class="p-start" value="${fmt(p.start)}" title="Start — sets every day, follows the earliest day start">
        <input type="time" class="p-end" value="${fmt(p.end)}" title="End — sets every day, follows the latest day end">
        <input type="range" class="p-op" min="0" max="100" step="5" value="${p.opacity}"
          title="Opacity of the hatch">
        <span class="tr-opv">${p.opacity}%</span>
      </div>
      <button type="button" class="icon-btn p-del" title="Remove period">✕</button>
    </div>`).join('') || '<p class="muted">No periods yet — add one below.</p>';
}
function renderPdMatrix(){
  const wrap = $('#pdMatrix');
  if (!editingPeriods.length){ wrap.innerHTML = '<p class="muted">Add a period first.</p>'; return; }
  wrap.style.setProperty('--np', editingPeriods.length);
  let h = `<div class="pd"><span></span>${editingPeriods.map(p =>
    `<span class="dname" style="color:${p.color}">${p.icon ? esc(p.icon)+' ' : ''}${esc(p.name)}</span>`).join('')}</div>`;
  for (const d of [0,1,2,3,4,5,6]){
    h += `<div class="pd" data-day="${d}"><span class="dname">${DAY_SHORT[d]}</span>` +
      editingPeriods.map((p, i) => {
        const pd = p.days[d];
        return `<span class="pd-cell" data-pi="${i}">
          <label class="pd-chk"><input type="checkbox" class="pd-on" ${pd.on?'checked':''}><span class="sw sw-sm"></span></label>
          <input type="time" class="pd-s" value="${fmt(pd.start)}">
          <input type="time" class="pd-e" value="${fmt(pd.end)}">
        </span>`;
      }).join('') + `</div>`;
  }
  wrap.innerHTML = h;
  syncPdDim();
}
function syncPdDim(){
  document.querySelectorAll('#pdMatrix .pd-cell').forEach(cell => {
    const off = !cell.querySelector('.pd-on').checked;
    cell.style.opacity = off ? '.55' : '1';
  });
}
/* keep a period row's general start/end in sync with its days:
   earliest start → latest end across the active days */
function syncPeriodGeneral(p, pi){
  const act = p.days.filter(d => d.on);
  if (act.length){
    p.start = Math.min(...act.map(d => d.start));
    p.end = Math.max(...act.map(d => d.end));
  }
  const prow = document.querySelector('.p-row[data-idx="' + pi + '"]');
  if (prow){
    const sInp = prow.querySelector('.p-start'), eInp = prow.querySelector('.p-end');
    if (sInp) sInp.value = fmt(p.start);
    if (eInp) eInp.value = fmt(p.end);
  }
}
$('#pdMatrix').addEventListener('input', e => {
  const cell = e.target.closest('.pd-cell'); if (!cell) return;
  const row = cell.closest('.pd');
  const p = editingPeriods[+cell.dataset.pi];
  const pd = p.days[+row.dataset.day];
  if (e.target.classList.contains('pd-on')) pd.on = e.target.checked;
  if (e.target.classList.contains('pd-s')) pd.start = parseHM(e.target.value) ?? pd.start;
  if (e.target.classList.contains('pd-e')) pd.end = parseHM(e.target.value) ?? pd.end;
  syncPeriodGeneral(p, cell.dataset.pi);
  syncPdDim();
});
$('#periodRows').addEventListener('input', e => {
  const row = e.target.closest('.p-row'); if (!row) return;
  const i = +row.dataset.idx;
  const p = editingPeriods[i];
  if (e.target.classList.contains('p-cin'))  p.color = e.target.value;
  if (e.target.classList.contains('p-icon')) p.icon = e.target.value;
  if (e.target.classList.contains('p-name')) p.name = e.target.value;
  if (e.target.classList.contains('p-start')){
    p.start = parseHM(e.target.value) ?? p.start;
    p.days.forEach(d => { d.start = p.start; });   // general start → every day
  }
  if (e.target.classList.contains('p-end')){
    p.end = parseHM(e.target.value) ?? p.end;
    p.days.forEach(d => { d.end = p.end; });       // general end → every day
  }
  if (e.target.classList.contains('p-op'))    p.opacity = clampInt(e.target.value, 0, 100, 30);
  const fill = row.querySelector('.tr-cfill');
  if (fill) fill.style.background = rgba(hexToRgb(p.color), clampInt(p.opacity,0,100,30)/100);
  const opv = row.querySelector('.tr-opv');
  if (opv) opv.textContent = clampInt(p.opacity,0,100,30) + '%';
  renderPdMatrix();
});
$('#periodRows').addEventListener('click', e => {
  const del = e.target.closest('.p-del'); if (!del) return;
  editingPeriods.splice(+del.closest('.p-row').dataset.idx, 1);
  renderPeriodRows(); renderPdMatrix();
});
$('#btnAddPeriod').addEventListener('click', () => {
  const start = state.settings.dayStart ?? 480;
  const end = Math.min(1440, start + 300);
  editingPeriods.push({
    id: null, name: '', color: PASTELS[editingPeriods.length % PASTELS.length],
    icon: '🏫', opacity: 30, start, end,
    days: [0,1,2,3,4,5,6].map(d => ({day: d, on: true, start, end})),
  });
  renderPeriodRows(); renderPdMatrix();
  const rows = document.querySelectorAll('.p-row');
  if (rows.length) rows[rows.length-1].querySelector('.p-name').focus();
});

/* ---- stats editor ---- */
function renderGroupRows(){
  $('#groupRows').innerHTML = editingGroups.map((g, i) => `
    <div class="g-row" data-idx="${i}">
      <label class="chk" style="margin:0"><input type="checkbox" class="g-on" ${g.on!==false?'checked':''}><span class="sw sw-sm"></span></label>
      <input class="g-name" maxlength="60" value="${esc(g.name)}" placeholder="Group name">
      <div class="g-chips">${state.eventTypes.map(t => `
        <button type="button" class="tchip ${(g.types||[]).includes(t.id)?'on':''}" data-tid="${t.id}">
          <span class="dot" style="background:${t.color}"></span>${t.icon ? esc(t.icon)+' ' : ''}${esc(t.name)}</button>`).join('') || '<span class="muted">no types</span>'}
      </div>
      <button type="button" class="icon-btn g-del" title="Remove group">✕</button>
    </div>`).join('') || '<p class="muted">No custom groups — add one below.</p>';
}
$('#groupRows').addEventListener('input', e => {
  const row = e.target.closest('.g-row'); if (!row) return;
  const g = editingGroups[+row.dataset.idx];
  if (e.target.classList.contains('g-on')) g.on = e.target.checked;
  if (e.target.classList.contains('g-name')) g.name = e.target.value;
});
$('#groupRows').addEventListener('click', e => {
  const row = e.target.closest('.g-row'); if (!row) return;
  const i = +row.dataset.idx;
  const chip = e.target.closest('.tchip');
  if (chip){
    const tid = +chip.dataset.tid;
    const arr = editingGroups[i].types = editingGroups[i].types || [];
    const at = arr.indexOf(tid);
    if (at >= 0) arr.splice(at, 1); else arr.push(tid);
    chip.classList.toggle('on');
    return;
  }
  if (e.target.closest('.g-del')){
    editingGroups.splice(i, 1);
    renderGroupRows();
  }
});
$('#btnAddGroup').addEventListener('click', () => {
  editingGroups.push({name: '', on: true, types: []});
  renderGroupRows();
  const rows = document.querySelectorAll('.g-row');
  if (rows.length) rows[rows.length-1].querySelector('.g-name').focus();
});

function openSettings(tab){
  const s = state.settings;
  $('#sStart').value = fmt(s.dayStart);
  $('#sEnd').value = fmt(s.dayEnd);
  $('#sSat').checked = !!s.showSaturday;
  $('#sSun').checked = !!s.showSunday;
  $('#sZoom').value = String(hourPx());
  const th = s.theme === 'light' ? 'light' : 'dark';
  document.querySelectorAll('#thSeg button').forEach(b => b.classList.toggle('on', b.dataset.th === th));
  previewStyle = null;
  renderStyleOptions();
  $('#sStyle').value = s.style || 'default';
  renderWakeRows();
  editingTypes = state.eventTypes.map(t => ({...t, opacity: t.opacity == null ? 100 : t.opacity,
    splitOn: !!t.splitOn, splitMin: t.splitMin || 45, splitBreak: t.splitBreak ?? 15}));
  renderTypeRows();
  editingPeriods = (state.periods || []).map(p => ({...p, days: p.days.map(d => ({...d}))}));
  renderPeriodRows(); renderPdMatrix();
  const cfg = statCfg();
  $('#stTypes').checked = cfg.showTypes !== false;
  $('#stTotal').checked = cfg.showTotal !== false;
  $('#stCount').checked = cfg.showCount !== false;
  $('#stBusiest').checked = cfg.showBusiest !== false;
  $('#stSleep').checked = cfg.showSleep !== false;
  $('#stPeriods').checked = cfg.showPeriods !== false;
  editingGroups = (cfg.groups || []).map(g => ({name: g.name, on: g.on !== false, types: [...(g.types||[])]}));
  renderGroupRows();
  openSettingsTab(tab || 'general');
  openModal('#settingsModal');
}
$('#btnSettings').addEventListener('click', () => openSettings('general'));
document.querySelectorAll('.set-tab').forEach(b =>
  b.addEventListener('click', () => openSettingsTab(b.dataset.stab)));
$('#thSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-th]'); if (!b) return;
  document.querySelectorAll('#thSeg button').forEach(x => x.classList.toggle('on', x === b));
});
/* live preview: switching the dropdown restyles the whole page immediately;
   closing the modal without saving reverts it */
$('#sStyle').addEventListener('change', () => {
  previewStyle = $('#sStyle').value || 'default';
  applyStyle();
});
$('#btnWakeAll').addEventListener('click', () => {
  const first = document.querySelector('#wakeRows .wake-row');
  if (!first) return;
  const wk = first.querySelector('.wk').value, sl = first.querySelector('.sl').value;
  document.querySelectorAll('#wakeRows .wake-row').forEach(row => {
    row.querySelector('.wk').value = wk;
    row.querySelector('.sl').value = sl;
  });
  $('#wakeRows').dispatchEvent(new Event('input'));
  toast('Copied Monday to all days — now press Save settings');
});
$('#btnSettingsSave').addEventListener('click', async () => {
  const ds = parseHM($('#sStart').value) ?? 420;
  const de = parseHM($('#sEnd').value) ?? 1320;
  if (de - ds < 60){ toast('The day must be at least 1 hour long', 'err'); return; }
  const dayRanges = [...document.querySelectorAll('#wakeRows .wake-row')].map(row => ({
    day: +row.dataset.day,
    wake: parseHM(row.querySelector('.wk').value),
    sleep: parseHM(row.querySelector('.sl').value),
  }));
  for (const r of dayRanges){
    if (r.wake == null || r.sleep == null){
      toast(`Set wake & sleep for ${DAY_NAMES[r.day]}`, 'err'); return;
    }
    // sleep before wake is fine — it counts as after midnight
  }
  const thBtn = document.querySelector('#thSeg button.on');
  const types = editingTypes.filter(t => t.name.trim()).map(t => ({
    id: t.id, name: t.name.trim(), color: t.color, icon: (t.icon||'').trim(),
    startOffset: clampInt(t.startOffset, 0, 59, 0),
    duration: clampInt(t.duration, 15, 720, 60),
    opacity: clampInt(t.opacity, 10, 100, 100),
    splitOn: !!t.splitOn,
    splitMin: clampInt(t.splitMin, 20, 120, 45),
    splitBreak: clampInt(t.splitBreak, 0, 60, 15),
  }));
  const periods = editingPeriods.filter(p => p.name.trim()).map(p => ({
    id: p.id, name: p.name.trim(), color: p.color, icon: (p.icon||'').trim(),
    opacity: clampInt(p.opacity, 0, 100, 30),
    start: p.start, end: p.end,
    days: p.days.map(d => ({day: d.day, on: !!d.on, start: d.start, end: d.end})),
  }));
  const statConfig = {
    showTypes: $('#stTypes').checked,
    showTotal: $('#stTotal').checked,
    showCount: $('#stCount').checked,
    showBusiest: $('#stBusiest').checked,
    showSleep: $('#stSleep').checked,
    showPeriods: $('#stPeriods').checked,
    groups: editingGroups.filter(g => g.name.trim())
      .map(g => ({name: g.name.trim(), on: g.on !== false, types: [...(g.types||[])]})),
  };
  try {
    await call('settings/save', {
      dayStart: ds, dayEnd: de, dayRanges,
      showSaturday: $('#sSat').checked, showSunday: $('#sSun').checked,
      theme: thBtn ? thBtn.dataset.th : 'dark',
      style: $('#sStyle').value || 'default',
      hourPx: parseInt($('#sZoom').value, 10) || 48,
      statConfig,
    });
    await call('types/save', {types});
    await call('periods/save', {periods, scheduleId: activeId()});
    previewStyle = null;
    closeModal('#settingsModal');
    toast('Settings saved ✓');
  } catch (err){ toast(err.message, 'err'); }
});

/* type rows editor */
function typeFillStyle(t){
  return rgba(hexToRgb(t.color), clampInt(t.opacity, 10, 100, 100) / 100);
}
function updateTypeRowVisual(row, t){
  const fill = row.querySelector('.tr-cfill');
  if (fill) fill.style.background = typeFillStyle(t);
  const opv = row.querySelector('.tr-opv');
  if (opv) opv.textContent = clampInt(t.opacity, 10, 100, 100) + '%';
  row.classList.toggle('sp-on', !!t.splitOn);
}
function renderTypeRows(){
  const counts = {};
  for (const e of state.events){ if (e.typeId != null) counts[e.typeId] = (counts[e.typeId]||0)+1; }
  $('#typeRows').innerHTML = editingTypes.map((t, i) => `
    <div class="type-row ${t.splitOn?'sp-on':''}" data-idx="${i}">
      <div class="tr-color" title="Click to pick a color">
        <input type="color" class="tr-cin" value="${esc(t.color)}">
        <span class="tr-cfill" style="background:${typeFillStyle(t)}"></span>
      </div>
      <input class="tr-icon" maxlength="8" value="${esc(t.icon)}" placeholder="🙂">
      <input class="tr-name" maxlength="60" value="${esc(t.name)}" placeholder="Type name">
      <div class="tr-nums">
        <div class="tr-line">
          <input type="number" class="tr-off" min="0" max="59" step="5" value="${t.startOffset||0}"
            title="Blocks of this type snap to :MM past the hour (15 → 8:15)">
          <input type="number" class="tr-dur" min="15" max="720" step="15" value="${t.duration||60}"
            title="Default length in minutes">
          <input type="range" class="tr-op" min="10" max="100" step="5" value="${t.opacity==null?100:t.opacity}"
            title="Opacity: how strongly the color fills the block">
          <span class="tr-opv">${t.opacity==null?100:t.opacity}%</span>
        </div>
        <div class="tr-line">
          <label class="chk" style="margin:0" title="Split long blocks into period/break segments">
            <input type="checkbox" class="tr-son" ${t.splitOn?'checked':''}><span class="sw sw-sm"></span>
          </label>
          <span class="tr-slab">split</span>
          <input type="number" class="tr-sp" min="20" max="120" step="5" value="${t.splitMin||45}"
            title="Lesson period length (min)">
          <input type="number" class="tr-sb" min="0" max="60" step="5" value="${t.splitBreak??15}"
            title="Break between periods (min)">
        </div>
      </div>
      <span class="tr-count">${counts[t.id] || 0}</span>
      <button type="button" class="icon-btn tr-del" title="Remove type">✕</button>
    </div>`).join('') || '<p class="muted">No types yet — add one below.</p>';
}
$('#typeRows').addEventListener('input', e => {
  const row = e.target.closest('.type-row'); if (!row) return;
  const i = +row.dataset.idx;
  if (e.target.classList.contains('tr-cin'))  editingTypes[i].color = e.target.value;
  if (e.target.classList.contains('tr-icon')) editingTypes[i].icon = e.target.value;
  if (e.target.classList.contains('tr-name')) editingTypes[i].name = e.target.value;
  if (e.target.classList.contains('tr-off'))  editingTypes[i].startOffset = clampInt(e.target.value, 0, 59, 0);
  if (e.target.classList.contains('tr-dur'))  editingTypes[i].duration = clampInt(e.target.value, 15, 720, 60);
  if (e.target.classList.contains('tr-op'))   editingTypes[i].opacity = clampInt(e.target.value, 10, 100, 100);
  if (e.target.classList.contains('tr-son'))  editingTypes[i].splitOn = e.target.checked;
  if (e.target.classList.contains('tr-sp'))   editingTypes[i].splitMin = clampInt(e.target.value, 20, 120, 45);
  if (e.target.classList.contains('tr-sb'))   editingTypes[i].splitBreak = clampInt(e.target.value, 0, 60, 15);
  updateTypeRowVisual(row, editingTypes[i]);
});
$('#typeRows').addEventListener('click', e => {
  const del = e.target.closest('.tr-del'); if (!del) return;
  editingTypes.splice(+del.closest('.type-row').dataset.idx, 1);
  renderTypeRows();
});
$('#btnAddType').addEventListener('click', () => {
  editingTypes.push({id:null, name:'', color:PASTELS[editingTypes.length % PASTELS.length],
                     icon:'', startOffset:0, duration:60, opacity:100,
                     splitOn:false, splitMin:45, splitBreak:15});
  renderTypeRows();
  const rows = document.querySelectorAll('.type-row');
  if (rows.length) rows[rows.length-1].querySelector('.tr-name').focus();
});

/* ================= schedule actions ================= */
$('#btnAddSchedule').addEventListener('click', () =>
  openPrompt('Name your new timetable', '', async v => {
    if (!v.trim()) return;
    try { await call('schedules/create', {name: v.trim()}); toast('Schedule created ✓'); }
    catch (err){ toast(err.message, 'err'); }
  }));
$('#scheduleTabs').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (tab && tab.dataset.sid) call('schedules/activate', {id: +tab.dataset.sid}).catch(err => toast(err.message,'err'));
});

/* ================= file menu ================= */
$('#btnFileMenu').addEventListener('click', () => $('#fileMenuWrap').classList.toggle('open'));
$('#fileMenu').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  document.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open'));
  const act = b.dataset.act;
  if (act === 'ics') window.location.assign(API + '/export/ics');
  else if (act === 'pdf-l') window.location.assign(API + '/export/pdf?o=landscape');
  else if (act === 'pdf-p') window.location.assign(API + '/export/pdf?o=portrait');
  else if (act === 'png-l') window.location.assign(API + '/export/png?o=landscape');
  else if (act === 'png-p') window.location.assign(API + '/export/png?o=portrait');
  else if (act === 'json') window.location.assign(API + '/export/json');
  else if (act === 'import') $('#importFile').click();
  else if (act === 'print'){ if (isMobile()) renderBoardDesktop(); window.print(); }
});
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const r = await call('schedules/import-json', data);
    toast(`Imported ${r.blocks} blocks ✓`);
  } catch (err){ toast('Import failed: ' + err.message, 'err'); }
});
window.addEventListener('beforeprint', () => { if (isMobile() && state) renderBoardDesktop(); });
window.addEventListener('afterprint', () => { if (state) renderAll(); });

/* ================= mobile: view/edit mode ================= */
function setMobileEdit(on){
  mobileEdit = on;
  document.body.classList.toggle('mobile-edit', on);
  const b = $('#fabEdit');
  b.textContent = on ? '✓' : '✏️';
  b.classList.toggle('done', on);
  b.title = on ? 'Done — back to view mode' : 'Edit schedule';
  if (on) toast('Edit mode — tap a block to edit, ＋ to add');
}
$('#fabEdit').addEventListener('click', () => setMobileEdit(!mobileEdit));
$('#fabAdd').addEventListener('click', () => openEventModal(null, null));

$('#mPills').addEventListener('click', e => {
  const b = e.target.closest('.mpill');
  if (b){ mobileDay = +b.dataset.day; renderBoard(); }
});
$('#mDayHead').addEventListener('click', e => {
  const b = e.target.closest('.mnav-arrow');
  if (b) stepMobileDay(+b.dataset.dir);
});
$('#mList').addEventListener('click', e => {
  const card = e.target.closest('.mcard');
  if (!card) return;
  if (!mobileEdit){
    if (!mobileHintShown){ toast('View mode — tap ✏️ to edit'); mobileHintShown = true; }
    return;
  }
  const ev = state.events.find(x => x.id == card.dataset.id);
  if (ev) openEventModal(ev);
});
function stepMobileDay(dir){
  const days = shownDays();
  const j = (days.indexOf(mobileDay) + dir + days.length) % days.length;
  mobileDay = days[j];
  renderBoard();
}
let tsx = 0, tsy = 0, tst = 0;
$('#mobileWrap').addEventListener('touchstart', e => {
  const t = e.touches[0]; tsx = t.clientX; tsy = t.clientY; tst = Date.now();
}, {passive:true});
$('#mobileWrap').addEventListener('touchend', e => {
  const t = e.changedTouches[0];
  const dx = t.clientX - tsx, dy = t.clientY - tsy;
  if (Date.now() - tst < 600 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5)
    stepMobileDay(dx < 0 ? 1 : -1);
}, {passive:true});

/* ================= mobile nav sheet ================= */
function renderMobileNav(){
  const el = $('#mobileNav');
  let h = '';
  if (mnavPage === 'tab'){
    const s = state.schedules.find(x => x.id === mnavTabId);
    if (!s){ mnavPage = 'main'; }
    else {
      h = `<button class="mrow" data-act="back">‹ Back</button>
        <div class="mn-title">${esc(s.name)}</div>
        <button class="mrow" data-act="tab-rename">✏️ Rename</button>
        <button class="mrow" data-act="tab-dup">⧉ Duplicate</button>
        <button class="mrow" data-act="tab-copyfrom">⬅ Copy blocks from…</button>
        <button class="mrow danger" data-act="tab-del">🗑 Delete timetable…</button>`;
    }
  }
  if (mnavPage === 'copyfrom'){
    const others = state.schedules.filter(x => x.id !== mnavTabId);
    h = `<button class="mrow" data-act="back">‹ Back</button>
      <div class="mn-title">Copy all blocks from…</div>` +
      (others.length ? others.map(o =>
        `<button class="mrow" data-act="tab-copyfrom-go" data-src="${o.id}">“${esc(o.name)}”</button>`).join('')
       : '<div class="mn-title">No other timetable yet</div>');
  } else if (mnavPage === 'main'){
    h = `<div class="mn-title">Timetables</div>` +
      state.schedules.map(s => `
        <div class="mrow-wrap">
          <button class="mrow mrow-main ${s.id===activeId()?'on':''}"
            data-act="tab-activate" data-id="${s.id}">
            ${s.id===activeId()?'✓ ':''}${esc(s.name)}</button>
          <button class="mrow-more" data-act="tab-menu" data-id="${s.id}" title="Actions">⋯</button>
        </div>`).join('') +
      `<button class="mrow" data-act="tab-new">＋ New timetable</button>
       <hr class="msep">
       <button class="mrow" data-act="add">＋ Add block</button>
       <hr class="msep">
       <button class="mrow" data-act="settings">⚙ Settings</button>
       <button class="mrow" data-act="ics">📅 Export .ics</button>
       <button class="mrow" data-act="pdf-l">📄 PDF — landscape</button>
       <button class="mrow" data-act="pdf-p">📄 PDF — portrait</button>
       <button class="mrow" data-act="png-l">🖼 PNG — landscape</button>
       <button class="mrow" data-act="png-p">🖼 PNG — portrait</button>
       <button class="mrow" data-act="json">💾 JSON backup</button>
       <button class="mrow" data-act="import">⭳ Import backup</button>
       <button class="mrow" data-act="print">🖨 Print</button>
       <hr class="msep">
       <button class="mrow" data-act="help">? Help</button>`;
  }
  el.innerHTML = h;
}
function openMnav(){ mnavPage = 'main'; renderMobileNav(); $('#mobileNav').classList.add('open'); }
function closeMnav(){ $('#mobileNav').classList.remove('open'); }
$('#btnMobileMenu').addEventListener('click', () =>
  $('#mobileNav').classList.contains('open') ? closeMnav() : openMnav());

$('#mobileNav').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'back'){ mnavPage = 'main'; renderMobileNav(); return; }
  if (act === 'tab-activate'){
    closeMnav();
    call('schedules/activate', {id: +b.dataset.id}).catch(err => toast(err.message,'err'));
  } else if (act === 'tab-menu'){
    mnavPage = 'tab'; mnavTabId = +b.dataset.id; renderMobileNav();
  } else if (act === 'tab-new'){
    closeMnav();
    openPrompt('Name your new timetable', '', async v => {
      if (!v.trim()) return;
      try { await call('schedules/create', {name: v.trim()}); toast('Schedule created ✓'); }
      catch (err){ toast(err.message, 'err'); }
    });
  } else if (act === 'add'){
    closeMnav(); openEventModal(null, null);
  } else if (act === 'settings'){
    closeMnav(); openSettings('general');
  } else if (act === 'ics'){ closeMnav(); window.location.assign(API + '/export/ics');
  } else if (act === 'pdf-l'){ closeMnav(); window.location.assign(API + '/export/pdf?o=landscape');
  } else if (act === 'pdf-p'){ closeMnav(); window.location.assign(API + '/export/pdf?o=portrait');
  } else if (act === 'png-l'){ closeMnav(); window.location.assign(API + '/export/png?o=landscape');
  } else if (act === 'png-p'){ closeMnav(); window.location.assign(API + '/export/png?o=portrait');
  } else if (act === 'json'){ closeMnav(); window.location.assign(API + '/export/json');
  } else if (act === 'import'){ closeMnav(); $('#importFile').click();
  } else if (act === 'print'){ closeMnav(); renderBoardDesktop(); window.print();
  } else if (act === 'help'){ closeMnav(); openModal('#helpModal');
  } else if (mnavPage === 'tab'){
    const s = state.schedules.find(x => x.id === mnavTabId);
    if (!s){ mnavPage = 'main'; renderMobileNav(); return; }
    if (act === 'tab-rename'){
      closeMnav();
      openPrompt('Rename timetable', s.name, async v => {
        if (!v.trim()) return;
        try { await call('schedules/rename', {id: s.id, name: v.trim()}); toast('Renamed ✓'); }
        catch (err){ toast(err.message, 'err'); }
      });
    } else if (act === 'tab-dup'){
      closeMnav();
      call('schedules/duplicate', {id: s.id})
        .then(() => toast('Duplicated ✓')).catch(err => toast(err.message, 'err'));
    } else if (act === 'tab-copyfrom'){
      mnavPage = 'copyfrom'; renderMobileNav();
    } else if (act === 'tab-copyfrom-go'){
      const src = +b.dataset.src;
      closeMnav();
      call('schedules/copy-from', {sourceId: src, targetId: s.id})
        .then(r => toast(`Copied ${r.copied} block${r.copied===1?'':'s'} ✓`))
        .catch(err => toast(err.message, 'err'));
    } else if (act === 'tab-del'){
      closeMnav();
      confirmAction(`Delete “${s.name}” and all of its blocks? This cannot be undone.`, async () => {
        try { await call('schedules/delete', {id: s.id}); toast('Schedule deleted'); }
        catch (err){ toast(err.message, 'err'); }
      });
    }
  }
});

/* ================= context menus (desktop) ================= */
function renderCtx(){
  const m = $('#ctxMenu');
  if (!ctx){ m.classList.remove('open'); return; }
  let h = '';
  if (ctx.kind === 'tab'){
    const s = state.schedules.find(x => x.id === ctx.tabId);
    if (!s){ closeCtx(); return; }
    if (ctx.page === 'copyfrom'){
      const others = state.schedules.filter(x => x.id !== ctx.tabId);
      h = `<button class="mi" data-act="back">‹ Back</button>
           <div class="ctx-head">Copy all blocks from…</div>` +
        (others.length ? others.map(o =>
          `<button class="mi" data-act="tab-copyfrom-go" data-src="${o.id}">“${esc(o.name)}”</button>`).join('')
         : '<div class="ctx-head">No other timetable yet</div>');
    } else {
      h = `<div class="ctx-head">${esc(s.name)}</div>
        <button class="mi" data-act="tab-rename">✏️ Rename…</button>
        <button class="mi" data-act="tab-dup">⧉ Duplicate</button>
        <button class="mi" data-act="tab-copyfrom">⬅ Copy from another timetable…</button>
        <button class="mi danger" data-act="tab-del">🗑 Delete…</button>`;
    }
  } else {
    const ev = state.events.find(x => x.id === ctx.eventId);
    if (!ev){ closeCtx(); return; }
    if (ctx.page === 'copyto'){
      h = `<button class="mi" data-act="back">‹ Back</button>
           <div class="ctx-head">Copy “${esc(ev.title)}” to…</div>` +
        shownDays().map(d =>
          `<button class="mi" data-act="ev-copyto-day" data-day="${d}">${DAY_NAMES[d]}</button>`).join('');
    } else {
      h = `<div class="ctx-head">${esc(ev.title)} · ${ev.days.map(i=>DAY_SHORT[i]).join(' ')}</div>
        <button class="mi" data-act="ev-edit">✏️ Edit</button>
        <button class="mi" data-act="ev-samecolor">🎨 Color from same</button>
        <button class="mi" data-act="ev-dup">⧉ Duplicate</button>
        <button class="mi" data-act="ev-copyto">📄 Copy to day…</button>
        <button class="mi danger" data-act="ev-del">🗑 Delete…</button>`;
    }
  }
  m.innerHTML = h;
}
function openCtx(kind, x, y, opts){
  ctx = {kind, page: 'root', ...opts};
  renderCtx();
  const m = $('#ctxMenu');
  m.classList.add('open');
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(6, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(6, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
}
function closeCtx(){ ctx = null; $('#ctxMenu').classList.remove('open'); }

document.addEventListener('contextmenu', e => {
  if (isMobile()) return;
  const tab = e.target.closest('#scheduleTabs .tab');
  if (tab){ e.preventDefault(); openCtx('tab', e.clientX, e.clientY, {tabId: +tab.dataset.sid}); return; }
  const evEl = e.target.closest('#board .ev');
  if (evEl){ e.preventDefault(); openCtx('event', e.clientX, e.clientY, {eventId: +evEl.dataset.id}); }
});
$('#ctxMenu').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'back'){ ctx.page = 'root'; renderCtx(); return; }
  if (ctx.kind === 'tab'){
    const s = state.schedules.find(x => x.id === ctx.tabId);
    if (!s){ closeCtx(); return; }
    if (act === 'tab-rename'){ closeCtx();
      openPrompt('Rename timetable', s.name, async v => {
        if (!v.trim()) return;
        try { await call('schedules/rename', {id: s.id, name: v.trim()}); toast('Renamed ✓'); }
        catch (err){ toast(err.message, 'err'); }
      });
    } else if (act === 'tab-dup'){ closeCtx();
      call('schedules/duplicate', {id: s.id})
        .then(() => toast('Duplicated ✓')).catch(err => toast(err.message, 'err'));
    } else if (act === 'tab-copyfrom'){ ctx.page = 'copyfrom'; renderCtx();
    } else if (act === 'tab-copyfrom-go'){ const src = +b.dataset.src; closeCtx();
      call('schedules/copy-from', {sourceId: src, targetId: s.id})
        .then(r => toast(`Copied ${r.copied} block${r.copied===1?'':'s'} ✓`))
        .catch(err => toast(err.message, 'err'));
    } else if (act === 'tab-del'){ closeCtx();
      confirmAction(`Delete “${s.name}” and all of its blocks? This cannot be undone.`, async () => {
        try { await call('schedules/delete', {id: s.id}); toast('Schedule deleted'); }
        catch (err){ toast(err.message, 'err'); }
      });
    }
  } else {
    const ev = state.events.find(x => x.id === ctx.eventId);
    if (!ev){ closeCtx(); return; }
    const copyPayload = days => ({scheduleId: ev.scheduleId, typeId: ev.typeId,
      title: ev.title, days, start: ev.start, end: ev.end,
      color: ev.color, room: ev.room, teacher: ev.teacher, note: ev.note});
    if (act === 'ev-edit'){ closeCtx(); openEventModal(ev);
    } else if (act === 'ev-samecolor'){ closeCtx();
      const src = findSameColorSource(ev.id, ev.typeId, ev.title);
      if (!src){ toast('No other block with this name & type yet', 'err'); return; }
      const p = copyPayload(ev.days); p.color = src.color || null;
      call('events/save', p)
        .then(() => toast(src.color ? 'Color copied ✓' : 'Color reset to type color ✓'))
        .catch(err => toast(err.message, 'err'));
    } else if (act === 'ev-dup'){ closeCtx();
      call('events/save', copyPayload(ev.days))
        .then(() => toast('Duplicated ✓')).catch(err => toast(err.message, 'err'));
    } else if (act === 'ev-copyto'){ ctx.page = 'copyto'; renderCtx();
    } else if (act === 'ev-copyto-day'){ const day = +b.dataset.day; closeCtx();
      call('events/save', copyPayload([day]))
        .then(() => toast(`Copied to ${DAY_NAMES[day]} ✓`))
        .catch(err => toast(err.message, 'err'));
    } else if (act === 'ev-del'){ closeCtx();
      confirmAction(`Delete “${ev.title}” (on ${ev.days.length} day${ev.days.length===1?'':'s'})?`, async () => {
        try { await call('events/delete', {id: ev.id}); toast('Deleted'); }
        catch (err){ toast(err.message, 'err'); }
      });
    }
  }
});

document.addEventListener('pointerdown', e => {
  if (!e.target.closest('#ctxMenu')) closeCtx();
  if (!e.target.closest('#mobileNav') && !e.target.closest('#btnMobileMenu')) closeMnav();
  const dd = e.target.closest('.dd');
  document.querySelectorAll('.dd.open').forEach(d => { if (d !== dd) d.classList.remove('open'); });
});
window.addEventListener('blur', () => { closeCtx(); closeMnav(); });

/* ================= desktop board interactions ================= */
$('#board').addEventListener('click', ev => {
  if (suppressClick){ suppressClick = false; return; }
  const evEl = ev.target.closest('.ev');
  if (evEl){
    const e = state.events.find(x => x.id == evEl.dataset.id);
    if (e) openEventModal(e);
    return;
  }
  const clearBtn = ev.target.closest('[data-clearday]');
  if (clearBtn){
    const d = +clearBtn.dataset.clearday;
    document.querySelectorAll('details[open]').forEach(x => x.removeAttribute('open'));
    confirmAction(`Remove ${DAY_NAMES[d]}? Single-day blocks are deleted, multi-day blocks keep their other days.`, async () => {
      try { await call('events/clear-day', {scheduleId: activeId(), day: d}); toast('Day cleared'); }
      catch (err){ toast(err.message, 'err'); }
    });
    return;
  }
  const copyBtn = ev.target.closest('[data-copyfrom]');
  if (copyBtn){
    document.querySelectorAll('details[open]').forEach(x => x.removeAttribute('open'));
    call('events/copy-day', {scheduleId: activeId(),
      fromDay: +copyBtn.dataset.copyfrom, toDay: +copyBtn.dataset.copyto})
      .then(() => toast('Day copied ✓')).catch(err => toast(err.message, 'err'));
    return;
  }
  const body = ev.target.closest('.day-body');
  if (body){
    const st = state.settings, hp = hourPx();
    const y = ev.clientY - body.getBoundingClientRect().top;
    const raw = st.dayStart + y/hp*60;
    const t = typeById(lastTypeId());
    let m, dur = 60;
    if (t){
      dur = t.duration || 60;
      m = t.startOffset > 0 ? nearestOffset(raw, t.startOffset) : Math.round(raw/15)*15;
    } else m = Math.round(raw/15)*15;
    m = Math.max(st.dayStart, Math.min(Math.max(st.dayStart, st.dayEnd - dur), m));
    openEventModal(null, {day: +body.dataset.day, start: m, typeId: t ? t.id : null});
  }
});
document.addEventListener('click', e => {
  document.querySelectorAll('details.day-menu[open]').forEach(d => {
    if (!d.contains(e.target)) d.removeAttribute('open');
  });
});

/* ================= drag & drop (desktop) ================= */
function clearDragUI(){
  document.body.classList.remove('dragging-active');
  document.querySelectorAll('.day-body.drop-hint').forEach(b => b.classList.remove('drop-hint'));
  document.querySelectorAll('.ev.dragging,.ev.resizing').forEach(x => x.classList.remove('dragging','resizing'));
  $('#dragTip').style.display = 'none';
}
function dragTip(text, e){
  const t = $('#dragTip');
  t.textContent = text;
  t.style.display = 'block';
  const w = t.offsetWidth || 120;
  t.style.left = Math.max(6, Math.min(window.innerWidth - w - 10, e.clientX + 14)) + 'px';
  t.style.top = (e.clientY - 34) + 'px';
}
$('#days').addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const handle = e.target.closest('.ev-resize');
  const evEl = handle ? handle.closest('.ev') : e.target.closest('.ev');
  if (!evEl) return;
  const ev = state.events.find(x => x.id == evEl.dataset.id);
  if (!ev) return;
  if (e.pointerType === 'mouse') e.preventDefault();
  const multi = ev.days.length > 1;
  drag = {mode: handle ? 'resize' : 'move', ev, el: evEl,
          sx: e.clientX, sy: e.clientY, moved: false, suppress: !!handle,
          dur: ev.end - ev.start, multi,
          off: parseInt(evEl.dataset.off || '0', 10) || 0,
          segStart: parseInt(evEl.dataset.s0 || '0', 10) || ev.start,
          newDay: null, newStart: null, newEnd: null};

  const onMove = pe => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(pe.clientX - drag.sx, pe.clientY - drag.sy) < 4) return;
    if (!drag.moved){
      drag.moved = true;
      document.body.classList.add('dragging-active');
      drag.el.classList.add(drag.mode === 'move' ? 'dragging' : 'resizing');
    }
    pe.preventDefault();
    const st = state.settings, hp = hourPx();
    if (drag.mode === 'move'){
      const hit = document.elementFromPoint(pe.clientX, pe.clientY);
      const body = hit ? hit.closest('.day-body') : null;
      if (!body) return;
      const r = body.getBoundingClientRect();
      let start = Math.round((st.dayStart + (pe.clientY - r.top)/hp*60 - drag.off) / 15) * 15;
      start = Math.max(st.dayStart, Math.min(Math.max(st.dayStart, st.dayEnd - drag.dur), start));
      drag.newDay = +body.dataset.day;
      drag.newStart = start;
      document.querySelectorAll('.day-body.drop-hint').forEach(b => b.classList.toggle('drop-hint', b === body));
      if (drag.el.parentElement !== body) body.appendChild(drag.el);
      drag.el.style.left = '3px';
      drag.el.style.width = 'calc(100% - 6px)';
      drag.el.style.top = ((start + drag.off - st.dayStart)/60*hp) + 'px';
      dragTip(`${fmt(start)}–${fmt(start + drag.dur)} · ${DAY_NAMES[drag.newDay]}` +
              (drag.multi ? ' · time only (multi-day)' : ''), pe);
    } else {
      const r = drag.el.parentElement.getBoundingClientRect();
      let end = Math.round((st.dayStart + (pe.clientY - r.top)/hp*60) / 15) * 15;
      end = Math.max(drag.segStart + 15, Math.min(1440, end));
      drag.newEnd = end;
      drag.el.style.height = Math.max(16, (end - drag.segStart)/60*hp - 2) + 'px';
      dragTip(`${fmt(drag.segStart)}–${fmt(end)}`, pe);
    }
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  };
  const onCancel = () => { cleanup(); clearDragUI(); drag = null; renderAll(); };
  const onUp = () => {
    cleanup();
    const d = drag; drag = null;
    clearDragUI();
    if (!d) return;
    suppressClick = d.moved || d.suppress;
    if (!d.moved) return;
    const e2 = d.ev;
    if (d.mode === 'move'){
      if (d.newStart == null){ renderAll(); return; }
      e2.start = d.newStart;
      e2.end = d.newStart + d.dur;
      if (!d.multi && d.newDay != null) e2.days = [d.newDay];
    } else {
      if (d.newEnd == null){ renderAll(); return; }
      e2.end = d.newEnd;
    }
    renderAll();
    call('events/save', {id: e2.id, scheduleId: e2.scheduleId, typeId: e2.typeId,
      title: e2.title, days: e2.days, start: e2.start, end: e2.end,
      color: e2.color, room: e2.room, teacher: e2.teacher, note: e2.note})
      .catch(err => toast(err.message, 'err'));
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
});

/* ================= topbar buttons ================= */
$('#btnAddBlock').addEventListener('click', () => openEventModal(null, null));
$('#btnHelp').addEventListener('click', () => openModal('#helpModal'));
$('#nowChip').addEventListener('click', () => {
  if (isMobile()){
    const el = document.querySelector('.mcard.current');
    if (el) el.scrollIntoView({block:'center', behavior:'smooth'});
    else toast('No current block right now');
    return;
  }
  const line = document.getElementById('nowLine');
  if (line) line.scrollIntoView({block:'center', behavior:'smooth'});
  else toast('Today is not visible on the board');
});

function zoomStep(dir){
  const cur = hourPx();
  let i = ZOOMS.indexOf(cur);
  if (i < 0) i = ZOOMS.findIndex(z => z >= cur);
  if (i < 0) i = ZOOMS.length - 1;
  const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + dir))];
  if (next === cur) return;
  call('settings/save', {hourPx: next}).catch(err => toast(err.message, 'err'));
}
$('#zoomOut').addEventListener('click', () => zoomStep(-1));
$('#zoomIn').addEventListener('click', () => zoomStep(1));

/* modal plumbing */
document.querySelectorAll('[data-close]').forEach(b =>
  b.addEventListener('click', () => {
    b.closest('.mb').classList.remove('open');
    if (b.closest('#settingsModal')) closeSettingsPreview();
  }));
document.querySelectorAll('.mb').forEach(m =>
  m.addEventListener('mousedown', e => {
    if (e.target === m){
      m.classList.remove('open');
      if (m.id === 'settingsModal') closeSettingsPreview();
    }
  }));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){
    document.querySelectorAll('.mb.open').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open'));
    closeCtx(); closeMnav(); closeSettingsPreview();
    return;
  }
  if (isMobile()) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
            || t.isContentEditable)) return;
  if (document.querySelector('.mb.open')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key.toLowerCase()){
    case 'n': openEventModal(null, null); break;
    case 't': openSettings('types'); break;
    case 's': openSettings('general'); break;
    case 'p': e.preventDefault(); window.print(); break;
    case '?': openModal('#helpModal'); break;
  }
});
$('#promptForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#promptInput').value;
  closeModal('#promptModal');
  if (promptSubmit) promptSubmit(v);
  promptSubmit = null;
});
$('#btnConfirmOk').addEventListener('click', () => {
  closeModal('#confirmModal');
  if (confirmCb) confirmCb();
  confirmCb = null;
});
$('#btnConfirmCancel').addEventListener('click', () => {
  closeModal('#confirmModal'); confirmCb = null;
});

/* ================= init ================= */
(async function init(){
  try {
    const res = await fetch(API + '/api/state', {headers: {'Accept':'application/json'}});
    if (res.redirected){ window.location.href = res.url; return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state = normState(await res.json());
    if (state.error) throw new Error(state.error);
    mobileDay = defaultDay();
    $('#loading').style.display = 'none';
    renderAll();
  } catch (e){
    $('#loading').textContent = 'Could not load your timetable: ' + e.message;
  }
})();
setInterval(() => { if (state && !(drag && drag.moved)) updateNow(); }, 30000);
setInterval(() => { if (state && !(drag && drag.moved)) renderBoard(); }, 60000);