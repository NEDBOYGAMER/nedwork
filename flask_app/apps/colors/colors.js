/* ============================================================
   COLOR NAME DATABASE — standard CSS/X11 colour keyword list,
   used for approximate nearest-name matching.
   ============================================================ */
import { NAMED_COLORS } from "./named_colors.js";

function hexToRgb(hex){
  hex = hex.replace('#','');
  return {
    r: parseInt(hex.substring(0,2),16),
    g: parseInt(hex.substring(2,4),16),
    b: parseInt(hex.substring(4,6),16)
  };
}
function rgbToHex(r,g,b){
  return '#' + [r,g,b].map(v=>{
    return Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');
  }).join('').toUpperCase();
}
function isValidHex(str){
  return /^#?[0-9A-Fa-f]{6}$/.test(str);
}
function normalizeHex(str){
  str = str.trim();
  if(!str.startsWith('#')) str = '#' + str;
  return str.toUpperCase();
}
function nearestColorName(hex){
  const {r,g,b} = hexToRgb(hex);
  let best = null, bestDist = Infinity;
  for(const [name, chex] of NAMED_COLORS){
    const c = hexToRgb(chex);
    const dist = (r-c.r)**2 + (g-c.g)**2 + (b-c.b)**2;
    if(dist < bestDist){ bestDist = dist; best = name; }
  }
  return best;
}

/* ============================================================
   HSL <-> RGB helpers for palette generation
   ============================================================ */
function hslToHex(h,s,l){
  s/=100; l/=100;
  const c = (1-Math.abs(2*l-1))*s;
  const x = c*(1-Math.abs((h/60)%2-1));
  const m = l-c/2;
  let r=0,g=0,b=0;
  if(h<60){r=c;g=x;b=0;} else if(h<120){r=x;g=c;b=0;}
  else if(h<180){r=0;g=c;b=x;} else if(h<240){r=0;g=x;b=c;}
  else if(h<300){r=x;g=0;b=c;} else {r=c;g=0;b=x;}
  return rgbToHex((r+m)*255,(g+m)*255,(b+m)*255);
}
function relativeLuminance(hex){
  const {r,g,b} = hexToRgb(hex);
  return (0.299*r + 0.587*g + 0.114*b) / 255;
}
function contrastTextColor(hex){
  return relativeLuminance(hex) > 0.6 ? '#14161a' : '#ffffff';
}

/* ============================================================
   PALETTE GENERATION — schemed HSL palettes that read as
   intentional rather than fully random.
   ============================================================ */
let idCounter = 1;
function nextId(){ return 'c' + (idCounter++); }

function generatePalette(count){
  const schemes = ['analogous','complementary','triadic','monochrome','split'];
  const scheme = schemes[Math.floor(Math.random()*schemes.length)];
  const baseHue = Math.floor(Math.random()*360);
  let hues = [];

  if(scheme==='analogous'){
    const spread = 22 + Math.random()*14;
    for(let i=0;i<count;i++) hues.push((baseHue + (i-count/2)*spread + 360)%360);
  } else if(scheme==='complementary'){
    for(let i=0;i<count;i++) hues.push(i % 2 === 0 ? baseHue : (baseHue+180)%360);
  } else if(scheme==='triadic'){
    const triad = [baseHue, (baseHue+120)%360, (baseHue+240)%360];
    for(let i=0;i<count;i++) hues.push(triad[i%3]);
  } else if(scheme==='monochrome'){
    for(let i=0;i<count;i++) hues.push(baseHue);
  } else { // split complementary
    const opts = [baseHue, (baseHue+150)%360, (baseHue+210)%360];
    for(let i=0;i<count;i++) hues.push(opts[i%3]);
  }

  const lightBase = [16, 32, 50, 68, 86, 94];
  const lights = [];
  for(let i=0;i<count;i++){
    const idx = Math.floor(i * (lightBase.length-1) / Math.max(1,count-1));
    lights.push(Math.max(8, Math.min(96, lightBase[idx] + (Math.random()*10-5))));
  }

  return hues.map((h,i)=>{
    const sat = scheme==='monochrome' ? (30+Math.random()*30) : (55+Math.random()*30);
    return { id: nextId(), hex: hslToHex(h, sat, lights[i]), locked:false };
  });
}

/* ============================================================
   STATE
   ============================================================ */
let palette = generatePalette(5);

// name of the palette currently loaded in the editor, e.g. "Brand/Website/Primary",
// or null if it hasn't been saved anywhere yet.
let currentPaletteName = null;

// flat dict mirroring the server: { "Library/Project/Palette": [{hex, locked}, ...] }
let flatPalettes = {};

// which folder keys ("Library" or "Library/Project") are collapsed in the tree
const collapsedKeys = new Set();

/* ------------------------------------------------------------
   VIRTUAL FOLDERS
   Libraries/projects are otherwise only inferred from the keys of
   saved palettes ("Library/Project/Palette") — there's no separate
   record of a folder that has no palette in it. That means an empty
   folder would just vanish from the tree the moment it has nothing
   under it (e.g. right after creating it, or after deleting the
   last project/palette inside it). To keep folders around even when
   they're empty, we track a small set of "known" folders client-side,
   persisted in localStorage so it survives reloads.
   ------------------------------------------------------------ */
const VIRTUAL_FOLDERS_KEY = 'colors_app_virtual_folders_v1';

function loadVirtualFolders(){
  try{
    const raw = localStorage.getItem(VIRTUAL_FOLDERS_KEY);
    if(raw === null) return null; // never persisted before — first-ever load
    const parsed = JSON.parse(raw);
    return {
      libraries: Array.isArray(parsed.libraries) ? parsed.libraries : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : []
    };
  } catch(err){
    return null;
  }
}

function saveVirtualFolders(){
  try{
    localStorage.setItem(VIRTUAL_FOLDERS_KEY, JSON.stringify({
      libraries: [...virtualLibraries],
      projects: [...virtualProjects]
    }));
  } catch(err){ /* ignore — worst case folders just don't persist across reloads */ }
}

const storedVirtualFolders = loadVirtualFolders();
// first-ever load: seed "main/main" as the default landing folder, without
// saving anything real to the server for it (see fetchPalettes() below)
const virtualLibraries = new Set(storedVirtualFolders ? storedVirtualFolders.libraries : ['main']);
const virtualProjects = new Set(storedVirtualFolders ? storedVirtualFolders.projects : ['main/main']);
if(!storedVirtualFolders) saveVirtualFolders();

// current "directory" location in the library tree: [] | [lib] | [lib,proj] | [lib,proj,pal].
// Drives what the header "+" button creates, and is kept in sync with whatever
// is selected/open in the sidebar. Defaults into "main/main" if that folder
// still exists, so there's somewhere sensible for Save to land by default.
let selectedPath = virtualProjects.has('main/main') ? ['main', 'main'] : [];

const container = document.getElementById('palette-container');

/* ---- FLIP animation helper for sliding reorders/inserts ---- */
function withSlide(mutationFn){
  const panels = [...container.querySelectorAll('.color-panel')];
  const firstRects = new Map();
  panels.forEach(p => firstRects.set(p.dataset.id, p.getBoundingClientRect()));

  mutationFn();
  render();

  const newPanels = [...container.querySelectorAll('.color-panel')];
  newPanels.forEach(p=>{
    const id = p.dataset.id;
    const first = firstRects.get(id);
    if(!first){
      // brand new panel: fade + scale in
      p.classList.add('entering');
      requestAnimationFrame(()=>{
        requestAnimationFrame(()=> p.classList.remove('entering'));
      });
      return;
    }
    const last = p.getBoundingClientRect();
    const dx = first.left - last.left;
    if(Math.abs(dx) > 0.5){
      p.style.transition = 'none';
      p.style.transform = `translateX(${dx}px)`;
      requestAnimationFrame(()=>{
        p.style.transition = 'transform 280ms cubic-bezier(.4,0,.2,1)';
        p.style.transform = '';
      });
    }
  });
}

/* ---- custom drag-to-reorder ----
   Deliberately not using native HTML5 drag/drop: that API renders its own
   translucent "ghost" image that follows the cursor separately from the
   actual element, which is exactly the effect we don't want. Instead we
   track the pointer directly and transform the real panel, so the color
   itself is what visibly slides. Neighboring panels shift by exactly one
   panel-width in the opposite direction, and only once the cursor crosses
   a neighbor's midpoint (Math.round of the distance dragged, in panel
   widths) — so it settles into place instead of flickering back and forth. */
let dragState = null;

function beginDrag(e, panel, originalIndex){
  e.preventDefault();

  const panels = [...container.querySelectorAll('.color-panel')];
  const panelWidth = panel.getBoundingClientRect().width;

  dragState = {
    panel,
    panels,
    originalIndex,
    currentIndex: originalIndex,
    panelWidth,
    startX: e.clientX,
    pointerId: e.pointerId
  };

  panel.classList.add('dragging');
  panel.style.transition = 'none';
  panels.forEach(p=>{
    if(p !== panel) p.style.transition = 'transform 180ms cubic-bezier(.4,0,.2,1)';
  });

  panel.setPointerCapture(e.pointerId);
  panel.addEventListener('pointermove', onDragMove);
  panel.addEventListener('pointerup', onDragEnd);
  panel.addEventListener('pointercancel', onDragEnd);
}

function onDragMove(e){
  if(!dragState || e.pointerId !== dragState.pointerId) return;
  const { panel, panels, originalIndex, panelWidth, startX } = dragState;

  const deltaX = e.clientX - startX;
  panel.style.transform = `translateX(${deltaX}px)`;

  let targetIndex = originalIndex + Math.round(deltaX / panelWidth);
  targetIndex = Math.max(0, Math.min(panels.length - 1, targetIndex));

  if(targetIndex !== dragState.currentIndex){
    dragState.currentIndex = targetIndex;
    panels.forEach((p, i)=>{
      if(p === panel) return;
      let shift = 0;
      if(originalIndex < targetIndex && i > originalIndex && i <= targetIndex) shift = -1;
      else if(originalIndex > targetIndex && i >= targetIndex && i < originalIndex) shift = 1;
      p.style.transform = shift ? `translateX(${shift * panelWidth}px)` : '';
    });
  }
}

function onDragEnd(e){
  if(!dragState || e.pointerId !== dragState.pointerId) return;
  const { panel, panels, originalIndex, currentIndex } = dragState;

  panel.releasePointerCapture(e.pointerId);
  panel.removeEventListener('pointermove', onDragMove);
  panel.removeEventListener('pointerup', onDragEnd);
  panel.removeEventListener('pointercancel', onDragEnd);

  panel.classList.remove('dragging');
  panels.forEach(p=>{ p.style.transition = ''; p.style.transform = ''; });

  dragState = null;

  if(currentIndex !== originalIndex){
    const moved = palette.splice(originalIndex, 1)[0];
    palette.splice(currentIndex, 0, moved);
    render();
  }
}

function render(){
  container.innerHTML = '';
  palette.forEach((color, i)=>{
    if(i>0){
      const divider = document.createElement('div');
      divider.className = 'divider';
      const hit = document.createElement('div');
      hit.className = 'divider-hit';
      const addBtn = document.createElement('button');
      addBtn.className = 'add-btn';
      addBtn.title = 'Insert color here';
      addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>`;
      addBtn.addEventListener('click', ()=> insertColorAt(i));
      hit.appendChild(addBtn);
      divider.appendChild(hit);
      container.appendChild(divider);
    }
    container.appendChild(buildPanel(color, i));
  });
}

function buildPanel(color, index){
  const panel = document.createElement('div');
  panel.className = 'color-panel';
  panel.style.backgroundColor = color.hex;
  panel.dataset.id = color.id;

  const textColor = contrastTextColor(color.hex);
  panel.style.color = textColor;

  /* ---- sliding drag reorder ---- */
  panel.addEventListener('pointerdown', (e)=>{
    if(e.button !== 0) return;
    if(e.target.closest('button, input, .panel-actions, .top-row')) return;
    beginDrag(e, panel, palette.findIndex(c=>c.id===color.id));
  });

  /* ---- top area: lock + paint(edit color) + name ---- */
  const top = document.createElement('div');
  top.className = 'panel-top';

  const topRow = document.createElement('div');
  topRow.className = 'top-row';

  const lockBtn = document.createElement('button');
  lockBtn.className = 'lock-btn';
  lockBtn.style.color = textColor;
  lockBtn.title = color.locked ? 'Unlock color' : 'Lock color';
  lockBtn.innerHTML = color.locked
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
  lockBtn.addEventListener('click', ()=>{
    color.locked = !color.locked;
    render();
  });

  const paintBtn = document.createElement('button');
  paintBtn.className = 'paint-btn';
  paintBtn.style.color = textColor;
  paintBtn.title = 'Edit color';
  paintBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.5 21.5 4 15l11.5-11.5a2.1 2.1 0 0 1 3 3L7 18l-4.5 3.5Z"/><path d="M13 5.5 18.5 11"/></svg>`;

  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'hidden-color-input';
  colorInput.value = color.hex;
  colorInput.addEventListener('input', ()=>{
    color.hex = colorInput.value.toUpperCase();
    updatePanelColor(panel, color);
    hexInput.value = color.hex.replace('#','');
    nameEl.textContent = nearestColorName(color.hex);
  });
  colorInput.addEventListener('change', ()=> autosaveIfSaved());
  paintBtn.addEventListener('click', ()=> colorInput.click());

  topRow.appendChild(lockBtn);
  topRow.appendChild(paintBtn);
  topRow.appendChild(colorInput);

  const nameEl = document.createElement('div');
  nameEl.className = 'color-name';
  nameEl.style.color = textColor;
  nameEl.textContent = nearestColorName(color.hex);

  top.appendChild(topRow);
  top.appendChild(nameEl);

  /* ---- editable hex field ---- */
  const hexInput = document.createElement('input');
  hexInput.className = 'color-hex-input';
  hexInput.style.color = textColor;
  hexInput.value = color.hex.replace('#','');
  hexInput.spellcheck = false;
  hexInput.maxLength = 7;
  hexInput.title = 'Click to edit';

  hexInput.addEventListener('focus', ()=> hexInput.select());
  hexInput.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter') hexInput.blur();
  });
  hexInput.addEventListener('blur', ()=> commitHexEdit());
  function commitHexEdit(){
    const candidate = normalizeHex(hexInput.value);
    if(isValidHex(candidate)){
      const changed = candidate !== color.hex;
      color.hex = candidate;
      updatePanelColor(panel, color);
      nameEl.textContent = nearestColorName(color.hex);
      hexInput.value = color.hex.replace('#','');
      if(changed) autosaveIfSaved();
    } else {
      hexInput.value = color.hex.replace('#',''); // revert
    }
  }

  /* ---- actions ---- */
  const actions = document.createElement('div');
  actions.className = 'panel-actions';

  const copyHexBtn = document.createElement('button');
  copyHexBtn.className = 'icon-btn';
  copyHexBtn.style.color = textColor;
  copyHexBtn.title = 'Copy HEX';
  copyHexBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  copyHexBtn.addEventListener('click', ()=> copyText(color.hex.replace('#',''), panel, 'HEX copied'));

  const copyRgbBtn = document.createElement('button');
  copyRgbBtn.className = 'icon-btn';
  copyRgbBtn.style.color = textColor;
  copyRgbBtn.title = 'Copy RGB';
  copyRgbBtn.textContent = 'RGB';
  copyRgbBtn.style.fontSize = '10px';
  copyRgbBtn.style.fontWeight = '700';
  copyRgbBtn.addEventListener('click', ()=>{
    const {r,g,b} = hexToRgb(color.hex);
    copyText(`rgb(${r}, ${g}, ${b})`, panel, 'RGB copied');
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn';
  deleteBtn.style.color = textColor;
  deleteBtn.title = 'Remove color';
  deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/></svg>`;
  deleteBtn.addEventListener('click', ()=>{
    if(palette.length <= 2) return;
    withSlide(()=>{
      const idx = palette.findIndex(c=>c.id===color.id);
      palette.splice(idx,1);
    });
  });

  actions.appendChild(copyHexBtn);
  actions.appendChild(copyRgbBtn);
  if(palette.length > 2) actions.appendChild(deleteBtn);

  const toast = document.createElement('div');
  toast.className = 'toast';

  const dragHandle = document.createElement('div');
  dragHandle.className = 'drag-handle';
  dragHandle.style.color = textColor;
  dragHandle.textContent = '⋮⋮ drag';

  panel.appendChild(top);
  panel.appendChild(hexInput);
  panel.appendChild(actions);
  panel.appendChild(toast);
  panel.appendChild(dragHandle);

  panel._toast = toast;
  return panel;
}

function updatePanelColor(panel, color){
  const textColor = contrastTextColor(color.hex);
  panel.style.backgroundColor = color.hex;
  panel.style.color = textColor;
}

function copyText(text, panel, message){
  navigator.clipboard.writeText(text).then(()=>{
    showToast(panel, message);
  }).catch(()=>{
    showToast(panel, 'Copy failed');
  });
}
function showToast(panel, message){
  const toast = panel._toast;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(panel._toastTimer);
  panel._toastTimer = setTimeout(()=> toast.classList.remove('show'), 1100);
}

function insertColorAt(index){
  const before = hexToRgb(palette[index-1].hex);
  const after = hexToRgb(palette[index].hex);
  const blended = rgbToHex(
    (before.r+after.r)/2,
    (before.g+after.g)/2,
    (before.b+after.b)/2
  );
  withSlide(()=>{
    palette.splice(index, 0, { id: nextId(), hex: blended, locked:false });
  });
}

function regenerate(){
  const fresh = generatePalette(palette.length);
  palette = palette.map((c,i)=> c.locked ? c : { ...fresh[i], id: c.id });
  render();
}

/* ============================================================
   HEADER TOAST (small "Saved" confirmation)
   ============================================================ */
const headerToast = document.getElementById('header-toast');
let headerToastTimer = null;
function flashHeaderToast(message){
  headerToast.textContent = message;
  headerToast.classList.add('show');
  clearTimeout(headerToastTimer);
  headerToastTimer = setTimeout(()=> headerToast.classList.remove('show'), 1600);
}

/* Editing a color (hex field or the native picker) auto-saves on exit —
   but only if this palette has already been saved somewhere. An unsaved
   palette stays unsaved; editing it doesn't implicitly create a save. */
async function autosaveIfSaved(){
  if(!currentPaletteName) return;
  try{
    await savePaletteToServer(currentPaletteName, palette);
    flashHeaderToast('Saved');
  } catch(err){
    // savePaletteToServer already surfaces an alert on failure
  }
}

function updateActivePaletteLabel(){
  const label = document.getElementById('active-palette-label');
  if(currentPaletteName){
    label.textContent = currentPaletteName.split('/').join(' / ');
  } else if(selectedPath.length){
    label.textContent = selectedPath.join(' / ') + ' — no palette open';
  } else {
    label.textContent = 'Unsaved palette';
  }
  label.title = label.textContent;
}

/* updates the header "+" button's tooltip/behavior to reflect what it will
   create given the current selection: nothing selected -> new library,
   a library selected -> new project, a project or palette selected -> new palette */
function updateNewButtonTitle(){
  const btn = document.getElementById('new-top-btn');
  if(!btn) return;
  const depth = Math.min(2, selectedPath.length);
  const kind = ['New library', 'New project', 'New palette'][depth];
  btn.title = selectedPath.length ? `${kind} in "${selectedPath.slice(0, depth).join(' / ')}"` : kind;
}

function pathEquals(a, b){
  return a.length === b.length && a.every((v,i)=> v === b[i]);
}

/* sets the current selection (used for tree highlighting and as the
   context for the header "+" button), then re-renders what depends on it */
function selectPath(path){
  selectedPath = path;
  updateNewButtonTitle();
  updateActivePaletteLabel();
  renderTree();
}

/* the header "+" button: creates a project if a library is selected, a
   palette if a project (or a palette within it) is selected, or falls
   back to creating a brand-new library if nothing is selected */
function contextualAdd(){
  createNewPalette(selectedPath.slice(0, Math.min(2, selectedPath.length)));
}

/* ============================================================
   GENERIC MODAL — used for "save as" and "new palette" prompts
   ============================================================ */
const modalOverlay = document.getElementById('modal-overlay');
const modalTitleEl = document.getElementById('modal-title');
const modalFieldsEl = document.getElementById('modal-fields');
const modalConfirmBtn = document.getElementById('modal-confirm');
const modalCancelBtn = document.getElementById('modal-cancel');

function openModal(title, fieldLabels, confirmLabel){
  return new Promise((resolve)=>{
    modalTitleEl.textContent = title;
    modalConfirmBtn.textContent = confirmLabel || 'Create';
    modalFieldsEl.innerHTML = '';

    const inputs = fieldLabels.map((label)=>{
      const wrap = document.createElement('label');
      wrap.className = 'modal-field';
      const span = document.createElement('span');
      span.textContent = label;
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 60;
      wrap.appendChild(span);
      wrap.appendChild(input);
      modalFieldsEl.appendChild(wrap);
      return input;
    });

    modalOverlay.classList.add('open');
    if(inputs[0]) setTimeout(()=> inputs[0].focus(), 30);

    function cleanup(result){
      modalOverlay.classList.remove('open');
      modalConfirmBtn.removeEventListener('click', onConfirm);
      modalCancelBtn.removeEventListener('click', onCancel);
      modalOverlay.removeEventListener('mousedown', onOverlayClick);
      document.removeEventListener('keydown', onKeydown);
      resolve(result);
    }
    function onConfirm(){
      cleanup(inputs.map(i=>i.value.trim()));
    }
    function onCancel(){ cleanup(null); }
    function onOverlayClick(e){ if(e.target === modalOverlay) cleanup(null); }
    function onKeydown(e){
      if(e.key === 'Escape'){ cleanup(null); }
      if(e.key === 'Enter'){ e.preventDefault(); onConfirm(); }
    }

    modalConfirmBtn.addEventListener('click', onConfirm);
    modalCancelBtn.addEventListener('click', onCancel);
    modalOverlay.addEventListener('mousedown', onOverlayClick);
    document.addEventListener('keydown', onKeydown);
  });
}

/* ============================================================
   BACKEND — list / save / delete
   Uses the absolute app base path set in colors.html (window.APP_BASE,
   e.g. "/apps/colors/") rather than a relative '' base — a relative base
   resolves against the *current page URL*, which silently breaks
   depending on whether that URL has a trailing slash.
   ============================================================ */
const API_BASE = window.APP_BASE || './';

async function fetchPalettes(){
  try{
    const res = await fetch(API_BASE + 'list', { credentials: 'same-origin' });
    if(res.redirected){ window.location.href = res.url; return; }
    if(!res.ok) throw new Error('Failed to load palettes');
    const data = await res.json();
    flatPalettes = data.palettes || {};
  } catch(err){
    console.error(err);
    flatPalettes = {};
  }

  // The palette generated on page load is just a starting point in the
  // editor — it's intentionally NOT saved to the server automatically.
  // The "main/main" folder is still shown (and used as the Save default)
  // via the virtual-folder tracking above, even though nothing real has
  // been saved into it yet.

  collapseAllFolders();
  renderTree();
}

/* folds up every library and project node so the tree starts collapsed
   when the app is first opened */
function collapseAllFolders(){
  const tree = buildTree(flatPalettes);
  Object.keys(tree).forEach(lib=>{
    collapsedKeys.add(lib);
    Object.keys(tree[lib]).forEach(proj=> collapsedKeys.add(`${lib}/${proj}`));
  });
}

async function savePaletteToServer(name, colorsArr){
  const cleanColors = colorsArr.map(c=>({ hex: c.hex, locked: !!c.locked }));
  const res = await fetch(API_BASE + 'save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ name, palette: cleanColors })
  });
  if(!res.ok){
    const err = await res.json().catch(()=>({}));
    alert('Save failed: ' + (err.error || res.statusText));
    throw new Error('save failed');
  }
  flatPalettes[name] = cleanColors;
  return res.json();
}

async function deletePathOnServer(name){
  const res = await fetch(API_BASE + 'delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ name })
  });
  if(!res.ok){
    const err = await res.json().catch(()=>({}));
    alert('Delete failed: ' + (err.error || res.statusText));
    throw new Error('delete failed');
  }
  return res.json();
}

/* ============================================================
   SIDEBAR TREE
   ============================================================ */
function buildTree(flat){
  const tree = {};
  Object.keys(flat).forEach(fullName=>{
    const parts = fullName.split('/');
    if(parts.length !== 3) return;
    const [lib, proj, pal] = parts;
    tree[lib] = tree[lib] || {};
    tree[lib][proj] = tree[lib][proj] || {};
    tree[lib][proj][pal] = flat[fullName];
  });

  // fold in folders that exist but have nothing saved under them yet
  virtualLibraries.forEach(lib=>{
    tree[lib] = tree[lib] || {};
  });
  virtualProjects.forEach(key=>{
    const [lib, proj] = key.split('/');
    tree[lib] = tree[lib] || {};
    tree[lib][proj] = tree[lib][proj] || {};
  });

  return tree;
}

function caretSvg(){ return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>`; }
function folderSvg(){ return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>`; }
function plusSvg(){ return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>`; }
function trashSvg(){ return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/></svg>`; }

function toggleCollapse(key){
  if(collapsedKeys.has(key)) collapsedKeys.delete(key);
  else collapsedKeys.add(key);
  renderTree();
}

function smallActionBtn(svg, title, onClick){
  const btn = document.createElement('button');
  btn.className = 'tree-action-btn';
  btn.type = 'button';
  btn.title = title;
  btn.innerHTML = svg;
  btn.addEventListener('click', onClick);
  return btn;
}

function treeRow(opts){
  const row = document.createElement('div');
  row.className = 'tree-row' + (opts.active ? ' active' : '');
  row.style.paddingLeft = (10 + opts.depth*16) + 'px';

  if(!opts.leaf){
    const caret = document.createElement('span');
    caret.className = 'tree-caret' + (opts.collapsedState ? ' collapsed' : '');
    caret.innerHTML = caretSvg();
    row.appendChild(caret);
  }

  const icon = document.createElement('span');
  if(opts.leaf){
    icon.className = 'palette-dot';
    icon.style.background = opts.swatchColor;
  } else {
    icon.className = 'tree-icon';
    icon.innerHTML = folderSvg();
  }
  row.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = opts.label;
  label.title = opts.label;
  row.appendChild(label);

  const actions = document.createElement('span');
  actions.className = 'tree-actions';
  if(opts.onDelete){
    actions.appendChild(smallActionBtn(trashSvg(), opts.deleteTitle, (e)=>{ e.stopPropagation(); opts.onDelete(); }));
  }
  row.appendChild(actions);

  row.addEventListener('click', ()=>{
    if(opts.onToggle) opts.onToggle();
    if(opts.onSelect) opts.onSelect();
  });

  return row;
}

function emptyRow(text, small){
  const el = document.createElement('div');
  el.className = 'tree-empty' + (small ? ' small' : '');
  el.textContent = text;
  return el;
}

/* a persistent (not hover-only) row at the bottom of a list that creates a
   new sibling at that exact level, regardless of what's currently selected */
function addRow(depth, label, onClick){
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'tree-row tree-add-row';
  row.style.paddingLeft = (10 + depth*16) + 'px';
  const icon = document.createElement('span');
  icon.className = 'tree-icon add-icon';
  icon.innerHTML = plusSvg();
  const text = document.createElement('span');
  text.className = 'tree-label';
  text.textContent = label;
  row.appendChild(icon);
  row.appendChild(text);
  row.addEventListener('click', onClick);
  return row;
}

function renderTree(){
  const root = document.getElementById('sidebar-tree');
  root.innerHTML = '';
  const tree = buildTree(flatPalettes);
  const libNames = Object.keys(tree).sort((a,b)=>a.localeCompare(b));

  if(libNames.length === 0){
    root.appendChild(emptyRow('No libraries yet'));
  } else {
    libNames.forEach(lib=> root.appendChild(buildLibraryNode(lib, tree[lib])));
  }
  root.appendChild(addRow(0, 'New library', ()=> createNewPalette([])));
}

function buildLibraryNode(lib, projects){
  const key = lib;
  const collapsed = collapsedKeys.has(key);

  const wrap = document.createElement('div');
  wrap.className = 'tree-node';

  const row = treeRow({
    depth: 0,
    collapsedState: collapsed,
    active: pathEquals(selectedPath, [lib]),
    label: lib,
    onToggle: ()=> toggleCollapse(key),
    onSelect: ()=> selectPath([lib]),
    onDelete: ()=> handleDelete(lib, `library "${lib}" and everything inside it`),
    deleteTitle: 'Delete library'
  });
  wrap.appendChild(row);

  const children = document.createElement('div');
  children.className = 'tree-children' + (collapsed ? ' hidden' : '');
  const projNames = Object.keys(projects).sort((a,b)=>a.localeCompare(b));
  projNames.forEach(proj=> children.appendChild(buildProjectNode(lib, proj, projects[proj])));
  children.appendChild(addRow(1, 'New project', ()=> createNewPalette([lib])));
  wrap.appendChild(children);

  return wrap;
}

function buildProjectNode(lib, proj, palettes){
  const key = `${lib}/${proj}`;
  const collapsed = collapsedKeys.has(key);

  const wrap = document.createElement('div');
  wrap.className = 'tree-node';

  const row = treeRow({
    depth: 1,
    collapsedState: collapsed,
    active: pathEquals(selectedPath, [lib, proj]),
    label: proj,
    onToggle: ()=> toggleCollapse(key),
    onSelect: ()=> selectPath([lib, proj]),
    onDelete: ()=> handleDelete(key, `project "${proj}" and everything inside it`),
    deleteTitle: 'Delete project'
  });
  wrap.appendChild(row);

  const children = document.createElement('div');
  children.className = 'tree-children' + (collapsed ? ' hidden' : '');
  const palNames = Object.keys(palettes).sort((a,b)=>a.localeCompare(b));
  palNames.forEach(pal=> children.appendChild(buildPaletteLeaf(lib, proj, pal, palettes[pal])));
  children.appendChild(addRow(2, 'New palette', ()=> createNewPalette([lib, proj])));
  wrap.appendChild(children);

  return wrap;
}

function buildPaletteLeaf(lib, proj, pal, colorsArr){
  const fullName = `${lib}/${proj}/${pal}`;
  return treeRow({
    depth: 2,
    leaf: true,
    active: fullName === currentPaletteName,
    swatchColor: (colorsArr && colorsArr[0]) ? colorsArr[0].hex : '#888',
    label: pal,
    onSelect: ()=> loadPaletteIntoEditor(fullName, colorsArr),
    onDelete: ()=> handleDelete(fullName, `palette "${pal}"`),
    deleteTitle: 'Delete palette'
  });
}

function loadPaletteIntoEditor(fullName, colorsArr){
  if(!Array.isArray(colorsArr) || colorsArr.length === 0) return;
  palette = colorsArr.map(c=> ({ id: nextId(), hex: c.hex, locked: !!c.locked }));
  currentPaletteName = fullName;
  selectedPath = fullName.split('/');
  updateNewButtonTitle();
  render();
  renderTree();
  updateActivePaletteLabel();
}

async function handleDelete(pathKey, label){
  if(!confirm(`Delete ${label}? This cannot be undone.`)) return;
  try{
    await deletePathOnServer(pathKey);
  } catch(err){
    return;
  }
  const prefix = pathKey + '/';
  Object.keys(flatPalettes).forEach(k=>{
    if(k === pathKey || k.startsWith(prefix)){
      delete flatPalettes[k];
      if(k === currentPaletteName) currentPaletteName = null;
    }
  });

  const parts = pathKey.split('/');
  if(parts.length === 1){
    // deleting a whole library: it and its projects go away — nothing above it to preserve
    virtualLibraries.delete(pathKey);
    [...virtualProjects].forEach(p=>{
      if(p === pathKey || p.startsWith(prefix)) virtualProjects.delete(p);
    });
  } else if(parts.length === 2){
    // deleting a project: only the project itself disappears — its library
    // must NOT backpropagate away just because it's now empty
    virtualProjects.delete(pathKey);
    virtualLibraries.add(parts[0]);
  } else {
    // deleting a single palette: its project and library must survive
    // even if this was the last palette in them
    virtualLibraries.add(parts[0]);
    virtualProjects.add(`${parts[0]}/${parts[1]}`);
  }
  saveVirtualFolders();

  const selKey = selectedPath.join('/');
  if(selectedPath.length && (selKey === pathKey || selKey.startsWith(prefix))){
    selectedPath = [];
  }
  updateNewButtonTitle();
  updateActivePaletteLabel();
  renderTree();
}

/* Creates a new library / project / palette depending on how many parts
   are already known from prefixParts (0 = creating a library, 1 = a
   project, 2 = a palette). Only ever prompts for ONE name — the thing
   actually being created — never for the "where". If the new item needs
   levels deeper than what was asked (e.g. a brand-new library also needs
   a project and a starter palette to exist in this data model), those
   are auto-named ("main" for a project, "new_palette" for a palette)
   rather than prompted for. */
const LEVEL_LABELS = ['Library name', 'Project name', 'Palette name'];
const LEVEL_WORDS = ['library', 'project', 'palette'];

async function createNewPalette(prefixParts){
  const levelIndex = prefixParts.length;
  const title = levelIndex === 0
    ? 'New library'
    : `New ${LEVEL_WORDS[levelIndex]} in "${prefixParts.join(' / ')}"`;

  const values = await openModal(title, [LEVEL_LABELS[levelIndex]], 'Create');
  if(!values) return;

  const name = values[0];
  if(!name || name.includes('/')){
    alert('Name must be non-empty and cannot contain "/"');
    return;
  }

  const existingTree = buildTree(flatPalettes);

  // creating a bare library — just the folder, nothing forced beneath it
  if(levelIndex === 0){
    if(virtualLibraries.has(name) || existingTree[name]){
      alert('A library with that name already exists.');
      return;
    }
    virtualLibraries.add(name);
    saveVirtualFolders();
    collapsedKeys.delete(name);
    selectPath([name]);
    flashHeaderToast('Library created');
    return;
  }

  // creating a bare project inside an existing library — same idea
  if(levelIndex === 1){
    const [lib] = prefixParts;
    const projKey = `${lib}/${name}`;
    if(virtualProjects.has(projKey) || (existingTree[lib] && existingTree[lib][name])){
      alert('A project with that name already exists.');
      return;
    }
    virtualLibraries.add(lib);
    virtualProjects.add(projKey);
    saveVirtualFolders();
    collapsedKeys.delete(lib);
    collapsedKeys.delete(projKey);
    selectPath([lib, name]);
    flashHeaderToast('Project created');
    return;
  }

  // levelIndex === 2: an actual palette, which is the only level that's
  // ever really saved to the server
  const allParts = [...prefixParts, name];
  const fullName = allParts.join('/');
  if(flatPalettes[fullName]){
    alert('A palette with that exact name already exists.');
    return;
  }

  const newColors = generatePalette(5);
  try{
    await savePaletteToServer(fullName, newColors);
  } catch(err){
    return;
  }
  virtualLibraries.add(allParts[0]);
  virtualProjects.add(allParts.slice(0,2).join('/'));
  saveVirtualFolders();
  collapsedKeys.delete(allParts[0]);
  collapsedKeys.delete(allParts.slice(0,2).join('/'));
  loadPaletteIntoEditor(fullName, flatPalettes[fullName]);
  flashHeaderToast('Palette created');
}

/* Saving an unsaved palette: only asks for whatever part of the
   Library/Project/Palette path isn't already implied by where you
   currently are in the tree (selectedPath). Standing in a project and
   hitting Save only asks for the palette's name; standing nowhere asks
   for all three, same as before. */
async function saveCurrentAs(){
  const prefixParts = selectedPath.slice(0, Math.min(2, selectedPath.length));
  const neededLabels = LEVEL_LABELS.slice(prefixParts.length);

  const title = prefixParts.length === 0
    ? 'Save palette as'
    : `Save palette in "${prefixParts.join(' / ')}"`;

  const values = await openModal(title, neededLabels, 'Save');
  if(!values) return;

  if(values.some(p=>!p || p.includes('/'))){
    alert('Each name must be non-empty and cannot contain "/"');
    return;
  }

  const allParts = [...prefixParts, ...values];
  const fullName = allParts.join('/');
  if(flatPalettes[fullName] && !confirm(`"${fullName.split('/').join(' / ')}" already exists. Overwrite it?`)){
    return;
  }

  try{
    await savePaletteToServer(fullName, palette);
  } catch(err){
    return;
  }
  collapsedKeys.delete(allParts[0]);
  collapsedKeys.delete(allParts.slice(0,2).join('/'));
  currentPaletteName = fullName;
  selectedPath = allParts;
  updateNewButtonTitle();
  updateActivePaletteLabel();
  renderTree();
  flashHeaderToast('Saved');
}

/* ============================================================
   SAVE button, SIDEBAR toggle, top-level "new" button
   ============================================================ */
document.getElementById('save-btn').addEventListener('click', async ()=>{
  if(currentPaletteName){
    try{
      await savePaletteToServer(currentPaletteName, palette);
    } catch(err){
      return;
    }
    renderTree();
    flashHeaderToast('Saved');
  } else {
    saveCurrentAs();
  }
});

document.getElementById('new-top-btn').addEventListener('click', contextualAdd);

const sidebar = document.getElementById('sidebar');
const sidebarOpenBtn = document.getElementById('sidebar-open-btn');

function setSidebarCollapsed(collapsed){
  sidebar.classList.toggle('collapsed', collapsed);
  sidebarOpenBtn.classList.toggle('visible', collapsed);
}

document.getElementById('sidebar-toggle-btn').addEventListener('click', ()=> setSidebarCollapsed(true));
sidebarOpenBtn.addEventListener('click', ()=> setSidebarCollapsed(false));

/* ============================================================
   EXPORT
   ============================================================ */
const exportWrap = document.getElementById('export-wrap');
document.getElementById('export-btn').addEventListener('click', (e)=>{
  e.stopPropagation();
  exportWrap.classList.toggle('open');
});
document.addEventListener('click', ()=> exportWrap.classList.remove('open'));

document.querySelectorAll('.dropdown-item').forEach(item=>{
  item.addEventListener('click', (e)=>{
    e.stopPropagation();
    exportPalette(item.dataset.export);
    exportWrap.classList.remove('open');
  });
});

function exportPalette(mode){
  const canvas = document.getElementById('export-canvas');
  const ctx = canvas.getContext('2d');
  const width = 1400;
  const height = 500;
  canvas.width = width;
  canvas.height = height;

  if(mode === 'full'){
    const segW = width / palette.length;
    palette.forEach((c,i)=>{
      ctx.fillStyle = c.hex;
      ctx.fillRect(i*segW, 0, segW, height);
      ctx.fillStyle = contrastTextColor(c.hex);
      ctx.font = '600 20px Space Grotesk, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(c.hex.replace('#',''), i*segW + segW/2, height - 30);
      ctx.font = '600 13px Inter, sans-serif';
      ctx.globalAlpha = 0.8;
      ctx.fillText(nearestColorName(c.hex), i*segW + segW/2, height - 55);
      ctx.globalAlpha = 1;
    });
  } else { // 'palette' — spaced, rounded
    ctx.fillStyle = '#f4f4f2';
    ctx.fillRect(0,0,width,height);
    const gap = 18;
    const segW = (width - gap*(palette.length+1)) / palette.length;
    const top = 40, boxH = height - 80;
    palette.forEach((c,i)=>{
      const x = gap + i*(segW+gap);
      roundRect(ctx, x, top, segW, boxH, 22);
      ctx.fillStyle = c.hex;
      ctx.fill();
      ctx.fillStyle = contrastTextColor(c.hex);
      ctx.font = '600 18px Space Grotesk, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(c.hex.replace('#',''), x + segW/2, top + boxH - 26);
      ctx.font = '600 12px Inter, sans-serif';
      ctx.globalAlpha = 0.8;
      ctx.fillText(nearestColorName(c.hex), x + segW/2, top + boxH - 48);
      ctx.globalAlpha = 1;
    });
  }

  const link = document.createElement('a');
  link.download = `palette-${mode}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

/* ============================================================
   GENERATE — button only (no spacebar shortcut)
   ============================================================ */
document.getElementById('generate-btn').addEventListener('click', regenerate);

/* ============================================================
   EXTRACT PALETTE FROM IMAGE (upload + paste + drag & drop + AI)
   ============================================================ */
const imageModalOverlay = document.getElementById('image-modal-overlay');
const imageFileInput = document.getElementById('image-file-input');
const fileDrop = document.getElementById('file-drop');
const colorCountSlider = document.getElementById('color-count-slider');
const colorCountLabel = document.getElementById('color-count-label');
const imageModalCancel = document.getElementById('image-modal-cancel');
const imageModalGenerate = document.getElementById('image-modal-generate');

let selectedImageFile = null;   // current File, or null
let previewObjectURL = null;    // object URL we own (revoked on replace/reset)

/* Shows the image as the background of the drop zone itself — no separate
   preview element, no filename text. Works for file picker, paste and drop,
   since all three go through this function. */
function setSelectedImage(file){
  if(previewObjectURL){
    URL.revokeObjectURL(previewObjectURL);
    previewObjectURL = null;
  }

  selectedImageFile = file;

  if(file){
    previewObjectURL = URL.createObjectURL(file);
    fileDrop.style.backgroundImage = `url("${previewObjectURL}")`;
    fileDrop.classList.add('has-image');
  } else {
    fileDrop.style.backgroundImage = '';
    fileDrop.classList.remove('has-image');
  }
}

document.getElementById('upload-btn').addEventListener('click', openImageModal);

function openImageModal(){
  // default = current palette length, clamped to the 1–12 slider range
  colorCountSlider.value = Math.max(1, Math.min(12, palette.length));
  colorCountLabel.textContent = `Number of colors: ${colorCountSlider.value}`;

  setSelectedImage(null);
  imageFileInput.value = '';
  imageModalOverlay.classList.add('open');
}

imageFileInput.addEventListener('change', ()=>{
  setSelectedImage(imageFileInput.files[0] || null);
});

/* Ctrl/Cmd+V paste support — only active while the image modal is open */
document.addEventListener('paste', (e)=>{
  if(!imageModalOverlay.classList.contains('open')) return;

  const items = (e.clipboardData && e.clipboardData.items) || [];
  for(const item of items){
    if(item.type && item.type.startsWith('image/')){
      const file = item.getAsFile();
      if(file){
        e.preventDefault();
        setSelectedImage(file);
        return;
      }
    }
  }

  // fallback for browsers that expose the image via clipboardData.files
  const files = e.clipboardData && e.clipboardData.files;
  if(files && files.length && files[0].type.startsWith('image/')){
    e.preventDefault();
    setSelectedImage(files[0]);
  }
});

/* Drag & drop onto the same drop zone you click — no extra area.
   The zone is still the <label>, so clicking it keeps opening the file
   picker even after an image is already showing. */
['dragenter','dragover'].forEach(evt=>{
  fileDrop.addEventListener(evt, e=>{ e.preventDefault(); fileDrop.style.borderColor = 'var(--accent)'; });
});
['dragleave','drop'].forEach(evt=>{
  fileDrop.addEventListener(evt, e=>{ e.preventDefault(); fileDrop.style.borderColor = ''; });
});
fileDrop.addEventListener('drop', e=>{
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if(file && file.type.startsWith('image/')){
    setSelectedImage(file);
  }
});

colorCountSlider.addEventListener('input', ()=>{
  colorCountLabel.textContent = `Number of colors: ${colorCountSlider.value}`;
});

imageModalCancel.addEventListener('click', ()=> imageModalOverlay.classList.remove('open'));
imageModalOverlay.addEventListener('mousedown', (e)=>{
  if(e.target === imageModalOverlay) imageModalOverlay.classList.remove('open');
});
document.addEventListener('keydown', (e)=>{
  if(!imageModalOverlay.classList.contains('open')) return;
  if(e.key === 'Escape'){
    imageModalOverlay.classList.remove('open');
  } else if(e.key === 'Enter'){
    imageModalGenerate.click();
  }
});

imageModalGenerate.addEventListener('click', async ()=>{
  if(!selectedImageFile){
    alert('Please choose an image first.');
    return;
  }

  const number = parseInt(colorCountSlider.value, 10);
  const form = new FormData();
  form.append('image', selectedImageFile);
  form.append('number', number);

  imageModalGenerate.disabled = true;
  imageModalGenerate.textContent = 'Extracting…';

  try{
    const res = await fetch(API_BASE + 'palette-from-image', {
      method: 'POST',
      body: form,
      credentials: 'same-origin'
    });
    if(res.redirected){ window.location.href = res.url; return; }

    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Failed to extract palette');

    let colors = data.palette || [];

    // the model may occasionally return fewer than requested — top it up
    // locally so the slider's count is always respected
    if(colors.length < number){
      const extra = generatePalette(number - colors.length).map(c=> c.hex);
      colors = colors.concat(extra);
    }

    // full replacement — the palette now *is* the image's palette
    palette = colors.slice(0, number).map(hex=> ({ id: nextId(), hex, locked:false }));

    imageModalOverlay.classList.remove('open');
    render();
    flashHeaderToast('Palette extracted from image');
  } catch(err){
    alert(err.message || String(err));
  } finally {
    imageModalGenerate.disabled = false;
    imageModalGenerate.textContent = 'Extract';
  }
});

/* initial render */
render();
updateActivePaletteLabel();
updateNewButtonTitle();
fetchPalettes();