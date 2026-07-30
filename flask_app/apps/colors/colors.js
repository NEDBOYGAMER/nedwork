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
let draggedId = null;

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
  panel.draggable = true;
  panel.dataset.id = color.id;

  const textColor = contrastTextColor(color.hex);
  panel.style.color = textColor;

  /* ---- sliding drag reorder ---- */
  panel.addEventListener('dragstart', (e)=>{
    draggedId = color.id;
    panel.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', color.id);
  });
  panel.addEventListener('dragend', ()=>{
    panel.classList.remove('dragging');
    draggedId = null;
  });
  panel.addEventListener('dragover', (e)=>{
    e.preventDefault();
    if(draggedId === null || draggedId === color.id) return;
    const fromIndex = palette.findIndex(c=>c.id===draggedId);
    const toIndex = palette.findIndex(c=>c.id===color.id);
    if(fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
    withSlide(()=>{
      const moved = palette.splice(fromIndex,1)[0];
      palette.splice(toIndex,0,moved);
    });
  });
  panel.addEventListener('drop', (e)=> e.preventDefault());

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
  });
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
      color.hex = candidate;
      updatePanelColor(panel, color);
      nameEl.textContent = nearestColorName(color.hex);
      hexInput.value = color.hex.replace('#','');
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
   SAVE / LOAD — hook up your own persistence here.
   ============================================================ */
document.getElementById('save-btn').addEventListener('click', ()=>{
  // TODO: implement saving the current `palette` array (e.g. to an
  // account, database, or export file). Browser localStorage/sessionStorage
  // cannot be used inside this sandbox, so wire this up to your own
  // backend or storage solution.
  console.log('Save clicked — palette to persist:', palette);
});
document.getElementById('load-btn').addEventListener('click', ()=>{
  // TODO: implement loading a previously saved palette and calling
  // `palette = loadedPalette; render();`
  console.log('Load clicked — implement retrieval of a saved palette here');
});

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

/* initial render */
render();