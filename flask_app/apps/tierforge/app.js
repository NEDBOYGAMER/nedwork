// ── State ──────────────────────────────────────────────────────────
const DEFAULT_TIERS = [
  { id: uid(), label: 'S', color: '#e63946' },
  { id: uid(), label: 'A', color: '#f4a261' },
  { id: uid(), label: 'B', color: '#e9c46a' },
  { id: uid(), label: 'C', color: '#57cc99' },
  { id: uid(), label: 'D', color: '#4ea8de' },
];

const PRESET_COLORS = [
  '#e63946','#f4a261','#e9c46a','#57cc99',
  '#4ea8de','#9b5de5','#ff6b9d','#ffffff',
  '#adb5bd','#6c757d',
];

let tiers   = DEFAULT_TIERS.map(t => ({ ...t, images: [] }));
let pool    = []; // { id, src, name }
let editing = null; // tier id being edited

let dragItem     = null; // { imgId, fromTierId (null = pool) }
let hoveredImgId = null; // image currently under the mouse cursor

let settings = {
  poolImgSize: 120,
  tierImgSize: 120,
  showNames: false,
  confirmDelete: false,
  confirmClear: true,
  fullscreenTable: false,
  theme: 'dark',
  accent: 'violet',
};

// ── Helpers ────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function getImage(id) {
  return pool.find(i => i.id === id)
    || tiers.flatMap(t => t.images).find(i => i.id === id);
}

function removeImageFromEverywhere(imgId) {
  pool = pool.filter(i => i.id !== imgId);
  tiers.forEach(t => {
    t.images = t.images.filter(i => i.id !== imgId);
  });
}

// Revoke every currently-held blob: object URL. Only call this when
// wholesale REPLACING the in-memory state (loading a file / autosave) —
// never during a move (drag/drop, number-key jump), since those images
// keep the same URL and just change location.
function revokeAllImageUrls() {
  [...pool, ...tiers.flatMap(t => t.images)].forEach(img => {
    if (img.src && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  });
}

// ── Image <-> Blob helpers ──────────────────────────────────────────
// Images are kept in memory as Blobs with a cheap URL.createObjectURL()
// string for display (fast, no base64 encoding needed). Base64 data URLs
// are only produced at the edges — when writing a portable .tierforge
// file — since that's the one place we need a self-contained string.
function dataURLtoBlob(dataURL) {
  const [header, base64] = dataURL.split(',');
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Thumbnails ───────────────────────────────────────────────────────
// The card views (pool + tier rows) only ever need a small preview — they
// never need the full-resolution original decoded and painted. A phone
// photo can be 3000x4000px / several MB; decoding 50 of those to draw
// them at 120px is the real cost with lots of images, independent of how
// the image data is referenced (base64 vs blob: URL makes no difference
// here — it's decode + paint cost, not encoding cost).
//
// So: decode each original once at upload time, downscale it onto a
// canvas, and re-encode as a small JPEG. That thumbnail — not the
// original — is what gets displayed and re-painted on every render/drag.
// The original blob is kept only for the right-click full preview and
// for Save/Export, and is decoded again only in those moments (one image
// at a time), not for every card on every render.
const THUMB_MAX_DIM = 480;
const THUMB_QUALITY  = 0.82;

async function makeThumbnailBlob(file, maxDim = THUMB_MAX_DIM, quality = THUMB_QUALITY) {
  let width, height, drawSource;

  if (typeof createImageBitmap === 'function') {
    // Preferred path: decode is handled by the browser's image pipeline
    // (often off the main thread), and we get pixel dimensions directly.
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    drawSource = bitmap;
  } else {
    // Fallback for older browsers without createImageBitmap support.
    drawSource = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to decode image')); };
      img.src = url;
    });
    width = drawSource.naturalWidth;
    height = drawSource.naturalHeight;
  }

  if (width > maxDim || height > maxDim) {
    if (width >= height) {
      height = Math.round(height * (maxDim / width));
      width = maxDim;
    } else {
      width = Math.round(width * (maxDim / height));
      height = maxDim;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(drawSource, 0, 0, width, height);
  if (drawSource.close) drawSource.close(); // release the ImageBitmap

  const thumbBlob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Thumbnail encode failed'))),
      'image/jpeg',
      quality
    );
  });
  return thumbBlob;
}

// ── Autosave (crash / reload recovery) ────────────────────────────
// Uses IndexedDB rather than localStorage: it's async (doesn't block the
// main thread), isn't capped at ~5-10MB, and can store Blobs directly —
// no base64 re-encoding of every image on every save.
const IDB_NAME  = 'tierforge_db';
const IDB_STORE = 'autosave';
const IDB_KEY   = 'state_v1';
const OLD_LOCALSTORAGE_KEY = 'tierforge_autosave_v1'; // pre-migration key

let autosaveTimer = null;
let autosaveWarned = false;

function openTierForgeDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openTierForgeDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openTierForgeDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosaveState, 300);
}

async function autosaveState() {
  try {
    const titleEl = document.getElementById('tierTitle');
    const data = {
      _version: 3,
      title: titleEl ? titleEl.value : '',
      savedAt: new Date().toISOString(),
      tiers: tiers.map(t => ({
        id: t.id,
        label: t.label,
        color: t.color,
        images: t.images.map(i => ({ id: i.id, blob: i.blob, thumbBlob: i.thumbBlob, name: i.name })),
      })),
      pool: pool.map(i => ({ id: i.id, blob: i.blob, thumbBlob: i.thumbBlob, name: i.name })),
      settings,
    };
    await idbPut(IDB_KEY, data);
  } catch (err) {
    // Most likely a transient IndexedDB error. Warn once so the user knows
    // the safety net has stopped working, without being noisy.
    if (!autosaveWarned) {
      autosaveWarned = true;
      console.warn('Autosave failed:', err);
    }
  }
}

// One-time migration: earlier versions stored a base64 snapshot (title/
// settings only, no images) in localStorage. Bring the title/settings
// forward into IndexedDB, then remove the old key.
async function migrateOldLocalStorageAutosave() {
  try {
    const raw = localStorage.getItem(OLD_LOCALSTORAGE_KEY);
    if (!raw) return;
    const old = JSON.parse(raw);
    if (old && old.title) {
      const titleEl = document.getElementById('tierTitle');
      if (titleEl) titleEl.value = old.title;
    }
    if (old && old.settings) {
      settings = { ...DEFAULT_SETTINGS, ...old.settings };
    }
    localStorage.removeItem(OLD_LOCALSTORAGE_KEY);
  } catch (err) {
    // Corrupt old data, nothing to salvage — ignore.
  }
}

async function loadAutosave() {
  try {
    const data = await idbGet(IDB_KEY);
    if (!data || !Array.isArray(data.tiers)) {
      await migrateOldLocalStorageAutosave();
      return false;
    }

    // Older autosave versions didn't store a separate thumbnail — fall
    // back to generating one so display stays fast either way.
    const toImage = async (i) => {
      const thumbBlob = i.thumbBlob || await makeThumbnailBlob(i.blob).catch(() => i.blob);
      return {
        id: i.id || uid(),
        blob: i.blob,
        thumbBlob,
        src: URL.createObjectURL(thumbBlob),
        name: i.name,
      };
    };

    const tierImagePromises = data.tiers.map(t => Promise.all((t.images || []).map(toImage)));
    const poolImagePromises = Promise.all((data.pool || []).map(toImage));
    const [tierImages, poolImages] = await Promise.all([Promise.all(tierImagePromises), poolImagePromises]);

    tiers = data.tiers.map((t, idx) => ({
      id: t.id || uid(),
      label: t.label,
      color: t.color,
      images: tierImages[idx],
    }));
    pool = poolImages;

    if (data.title) {
      const titleEl = document.getElementById('tierTitle');
      if (titleEl) titleEl.value = data.title;
    }
    if (data.settings) {
      settings = { ...DEFAULT_SETTINGS, ...data.settings };
    }
    return true;
  } catch (err) {
    console.warn('Failed to restore autosaved session:', err);
    return false;
  }
}

// ── Render ─────────────────────────────────────────────────────────
function render() {
  renderTiers();
  renderPool();
  scheduleAutosave();
}

function renderTiers() {
  const board = document.getElementById('tierBoard');
  board.innerHTML = '';
  tiers.forEach(tier => {
    board.appendChild(makeTierRow(tier));
  });
}

function makeTierRow(tier) {
  const row = document.createElement('div');
  row.className = 'tier-row';
  row.dataset.tierId = tier.id;

  // Label
  const labelWrap = document.createElement('div');
  labelWrap.className = 'tier-label-wrap';
  labelWrap.style.background = tier.color + '60';
  labelWrap.title = 'Click to edit this tier';

  const label = document.createElement('div');
  label.className = 'tier-label';
  label.textContent = tier.label;
  label.style.color = tier.color;
  label.title = tier.label; // full name on hover, in case it's still truncated visually
  if (tier.label.length > 14) {
    label.dataset.len = 'very-long';
  } else if (tier.label.length > 6) {
    label.dataset.len = 'long';
  }

  const hint = document.createElement('div');
  hint.className = 'edit-hint';
  hint.textContent = 'edit';

  labelWrap.appendChild(label);
  labelWrap.appendChild(hint);
  labelWrap.addEventListener('click', () => openModal(tier.id));

  // Images area
  const imgArea = document.createElement('div');
  imgArea.className = 'tier-images';
  imgArea.dataset.tierId = tier.id;

  tier.images.forEach(img => {
    imgArea.appendChild(makeCard(img, tier.id));
  });

  // Drop events on imgArea
  setupDropZone(imgArea, tier.id);

  // Controls
  const controls = document.createElement('div');
  controls.className = 'tier-controls';

  const upBtn = document.createElement('button');
  upBtn.className = 'tier-ctrl-btn';
  upBtn.title = 'Move tier up';
  upBtn.textContent = '▲';
  upBtn.addEventListener('click', () => moveTier(tier.id, -1));

  const downBtn = document.createElement('button');
  downBtn.className = 'tier-ctrl-btn';
  downBtn.title = 'Move tier down';
  downBtn.textContent = '▼';
  downBtn.addEventListener('click', () => moveTier(tier.id, 1));

  controls.appendChild(upBtn);
  controls.appendChild(downBtn);

  row.appendChild(labelWrap);
  row.appendChild(imgArea);
  row.appendChild(controls);
  return row;
}

function makeCard(img, tierId) {
  const card = document.createElement('div');
  card.className = 'img-card';
  card.draggable = true;
  card.dataset.imgId = img.id;

  const image = document.createElement('img');
  image.src = img.src;
  image.alt = img.name;
  image.draggable = false;

  const name = document.createElement('div');
  name.className = 'img-name';
  name.textContent = img.name;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'img-remove';
  removeBtn.title = 'Remove image';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (settings.confirmDelete && !confirm(`Remove "${img.name}"?`)) return;
    removeImageFromEverywhere(img.id);
    if (img.src && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    render();
  });

  card.appendChild(image);
  card.appendChild(name);
  card.appendChild(removeBtn);

  // Track hover so a number-key press knows which image to move
  card.addEventListener('mouseenter', () => { hoveredImgId = img.id; });
  card.addEventListener('mouseleave', () => {
    if (hoveredImgId === img.id) hoveredImgId = null;
  });

  // Right-click to preview big — uses the full-resolution original (img.blob),
  // not the small display thumbnail (img.src), so zooming in looks sharp.
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showImagePreview(img.blob, img.name);
  });

  // Double-click an unranked image to bring it to the front of the pool
  if (tierId === null) {
    card.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const idx = pool.findIndex(i => i.id === img.id);
      if (idx > 0) {
        const [item] = pool.splice(idx, 1);
        pool.unshift(item);
        render();
      }
    });
  }

  // Drag events
  card.addEventListener('dragstart', (e) => {
    hideImagePreview();
    dragItem = { imgId: img.id, fromTierId: tierId || null };
    card.classList.add('dragging');

    // Custom ghost
    const ghost = document.getElementById('dragGhost');
    ghost.innerHTML = '';
    const gi = document.createElement('img');
    gi.src = img.src;
    gi.style.cssText = 'width:72px;height:72px;object-fit:cover;border-radius:4px;';
    ghost.appendChild(gi);
    e.dataTransfer.setDragImage(ghost, 36, 36);
    e.dataTransfer.effectAllowed = 'move';
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    dragItem = null;
    cancelPendingDragOverUpdate();
    document.querySelectorAll('.drag-active').forEach(el => el.classList.remove('drag-active'));
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    hideDropIndicator();
  });

  return card;
}

// Figure out which existing card the dragged item should be inserted before,
// based on cursor position. Works with wrapping flex rows.
function getDragAfterElement(container, clientX, clientY) {
  const cards = [...container.querySelectorAll('.img-card:not(.dragging)')];
  if (cards.length === 0) return null;

  // 1) Prefer a card whose row (vertical span) contains the cursor.
  let best = null;
  let bestDist = Infinity;
  cards.forEach(card => {
    const box = card.getBoundingClientRect();
    if (clientY >= box.top && clientY <= box.bottom) {
      const centerX = box.left + box.width / 2;
      const dist = Math.abs(clientX - centerX);
      if (dist < bestDist) {
        bestDist = dist;
        best = { el: card, before: clientX < centerX };
      }
    }
  });
  if (best) return best.before ? best.el : best.el.nextElementSibling;

  // 2) Fallback: cursor isn't within any card's row (e.g. empty gap area).
  // Find the closest row by vertical distance, then the closest card in it.
  let nearestRowCard = null;
  let nearestRowDist = Infinity;
  cards.forEach(card => {
    const box = card.getBoundingClientRect();
    const centerY = box.top + box.height / 2;
    const dist = Math.abs(clientY - centerY);
    if (dist < nearestRowDist) {
      nearestRowDist = dist;
      nearestRowCard = card;
    }
  });
  if (!nearestRowCard) return null;

  const rowBox = nearestRowCard.getBoundingClientRect();
  const rowCards = cards.filter(card => {
    const box = card.getBoundingClientRect();
    return box.top < rowBox.bottom && box.bottom > rowBox.top;
  });

  let bestInRow = null;
  bestDist = Infinity;
  rowCards.forEach(card => {
    const box = card.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const dist = Math.abs(clientX - centerX);
    if (dist < bestDist) {
      bestDist = dist;
      bestInRow = { el: card, before: clientX < centerX };
    }
  });
  return bestInRow ? (bestInRow.before ? bestInRow.el : bestInRow.el.nextElementSibling) : null;
}

// Insert img into array at the position implied by afterElement (a DOM card,
// or null to mean "append at the end").
function insertImageAt(array, img, afterElement) {
  if (afterElement && afterElement.dataset && afterElement.dataset.imgId) {
    const idx = array.findIndex(i => i.id === afterElement.dataset.imgId);
    if (idx === -1) array.push(img);
    else array.splice(idx, 0, img);
  } else {
    array.push(img);
  }
}

// A single reusable "drop here" indicator line, moved between containers
// while a drag is in progress.
const dropIndicatorEl = document.createElement('div');
dropIndicatorEl.className = 'drop-indicator';

function showDropIndicator(container, afterElement) {
  if (afterElement) {
    container.insertBefore(dropIndicatorEl, afterElement);
  } else {
    container.appendChild(dropIndicatorEl);
  }
}

function hideDropIndicator() {
  if (dropIndicatorEl.parentNode) {
    dropIndicatorEl.parentNode.removeChild(dropIndicatorEl);
  }
}

// ── Drag-over throttling ─────────────────────────────────────────────
// `dragover` fires continuously while the mouse moves — often far more
// often than the screen can repaint. The naive version of this handler
// called getBoundingClientRect() on every card in the container AND
// wrote to the DOM (moving the drop indicator) on every single one of
// those events. Reading layout right after writing it forces the browser
// to do a synchronous reflow before it can answer the next read — with
// ~100 cards on screen that's "layout thrashing", and it's what actually
// made dragging feel slow (it scales with image *count*, not size).
//
// Fix: collapse all events within a frame into a single rAF callback, so
// there's at most one read-then-write pass per repaint instead of one
// per raw event.
let dragRafHandle = null;
let pendingDragOver = null; // { el, clientX, clientY }

function scheduleDragOverUpdate(el, clientX, clientY) {
  pendingDragOver = { el, clientX, clientY };
  if (dragRafHandle) return; // already scheduled for this frame
  dragRafHandle = requestAnimationFrame(() => {
    dragRafHandle = null;
    const pending = pendingDragOver;
    pendingDragOver = null;
    if (!pending || !dragItem) return;
    const afterElement = getDragAfterElement(pending.el, pending.clientX, pending.clientY);
    showDropIndicator(pending.el, afterElement);
  });
}

function cancelPendingDragOverUpdate() {
  if (dragRafHandle) {
    cancelAnimationFrame(dragRafHandle);
    dragRafHandle = null;
  }
  pendingDragOver = null;
}

function setupDropZone(el, tierId) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drag-active');
    el.closest('.tier-row')?.classList.add('drag-over');
    if (dragItem) {
      scheduleDragOverUpdate(el, e.clientX, e.clientY);
    }
  });

  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) {
      el.classList.remove('drag-active');
      el.closest('.tier-row')?.classList.remove('drag-over');
      if (dropIndicatorEl.parentNode === el) hideDropIndicator();
    }
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    cancelPendingDragOverUpdate();
    el.classList.remove('drag-active');
    el.closest('.tier-row')?.classList.remove('drag-over');
    hideDropIndicator();

    if (!dragItem) return;

    // Find and remove image from current location
    const img = getImage(dragItem.imgId);
    if (!img) return;

    // Determine insertion point before we mutate any arrays
    const afterElement = getDragAfterElement(el, e.clientX, e.clientY);

    removeImageFromEverywhere(img.id);

    // Add to target tier at the correct position
    const targetTier = tiers.find(t => t.id === tierId);
    if (targetTier) {
      insertImageAt(targetTier.images, img, afterElement);
    }

    render();
  });
}

function renderPool() {
  const poolEl    = document.getElementById('imagePool');
  const emptyEl   = document.getElementById('poolEmpty');
  const countEl   = document.getElementById('poolCount');

  poolEl.innerHTML = '';
  poolEl.appendChild(emptyEl);

  if (pool.length === 0) {
    emptyEl.style.display = 'flex';
    countEl.textContent = '0 images';
  } else {
    emptyEl.style.display = 'none';
    countEl.textContent = `${pool.length} image${pool.length !== 1 ? 's' : ''}`;
    pool.forEach(img => {
      poolEl.appendChild(makeCard(img, null));
    });
  }
}

// Pool drop-zone listeners: attached once since #imagePool is a persistent
// element (only its children are re-rendered), unlike tier rows which are
// rebuilt from scratch on every render.
function setupPoolDropZone() {
  const poolEl = document.getElementById('imagePool');

  poolEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    poolEl.classList.add('drag-active');
    if (dragItem) {
      scheduleDragOverUpdate(poolEl, e.clientX, e.clientY);
    }
  });
  poolEl.addEventListener('dragleave', (e) => {
    if (!poolEl.contains(e.relatedTarget)) {
      poolEl.classList.remove('drag-active');
      if (dropIndicatorEl.parentNode === poolEl) hideDropIndicator();
    }
  });
  poolEl.addEventListener('drop', (e) => {
    e.preventDefault();
    cancelPendingDragOverUpdate();
    poolEl.classList.remove('drag-active');
    hideDropIndicator();
    if (!dragItem) return;

    const img = getImage(dragItem.imgId);
    if (!img) return;

    const afterElement = getDragAfterElement(poolEl, e.clientX, e.clientY);

    removeImageFromEverywhere(img.id);
    insertImageAt(pool, img, afterElement);
    render();
  });
}

// ── Upload ─────────────────────────────────────────────────────────
// Object URLs are created synchronously (no async base64 encode/decode
// pass per file), and every file is pushed into the pool before a single
// render() call — a 50-image upload does 1 board rebuild instead of 50.
document.getElementById('imageUpload').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;

  const uploadLabel = document.querySelector('label[for="imageUpload"]');
  const countEl = document.getElementById('poolCount');
  const originalLabelHTML = uploadLabel ? uploadLabel.innerHTML : null;

  try {
    let done = 0;
    if (uploadLabel) uploadLabel.style.pointerEvents = 'none';

    const newImages = await Promise.all(files.map(async (file) => {
      let thumbBlob;
      try {
        thumbBlob = await makeThumbnailBlob(file);
      } catch (err) {
        // If thumbnailing fails for some reason (e.g. corrupt/odd file),
        // fall back to showing the original rather than dropping the image.
        console.warn('Thumbnail generation failed, using original:', err);
        thumbBlob = file;
      }
      done++;
      if (uploadLabel) uploadLabel.textContent = `Processing ${done}/${files.length}…`;
      return {
        id: uid(),
        blob: file,           // full-resolution original — kept for preview/export
        thumbBlob,             // small re-encoded copy — used for on-screen display
        src: URL.createObjectURL(thumbBlob),
        name: file.name.replace(/\.[^.]+$/, ''),
      };
    }));

    pool.push(...newImages);
    render();
  } finally {
    if (uploadLabel) {
      uploadLabel.style.pointerEvents = '';
      uploadLabel.innerHTML = originalLabelHTML;
    }
    e.target.value = '';
  }
});

document.getElementById('tierTitle').addEventListener('input', scheduleAutosave);

// ── Add Tier ───────────────────────────────────────────────────────
document.getElementById('addTierBtn').addEventListener('click', () => {
  const labels = ['F', 'E', 'G', 'H', 'Z', 'X', '?'];
  const usedLabels = tiers.map(t => t.label);
  const label = labels.find(l => !usedLabels.includes(l)) || '?';
  tiers.push({ id: uid(), label, color: '#6c757d', images: [] });
  render();
});

// ── Move Tier ──────────────────────────────────────────────────────
function moveTier(id, dir) {
  const idx = tiers.findIndex(t => t.id === id);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= tiers.length) return;
  [tiers[idx], tiers[newIdx]] = [tiers[newIdx], tiers[idx]];
  render();
}

// ── Clear All ──────────────────────────────────────────────────────
document.getElementById('clearAllBtn').addEventListener('click', () => {
  if (settings.confirmClear && !confirm('Return all images to the pool and clear tiers?')) return;
  const allImages = [
    ...pool,
    ...tiers.flatMap(t => t.images)
  ];
  pool = allImages;
  tiers.forEach(t => t.images = []);
  render();
  autosaveState();
});

// ── Modal ──────────────────────────────────────────────────────────
function openModal(tierId) {
  editing = tierId;
  const tier = tiers.find(t => t.id === tierId);
  if (!tier) return;

  document.getElementById('tierLabelInput').value = tier.label;
  document.getElementById('tierColorInput').value = tier.color;

  // Swatches
  const swatchWrap = document.getElementById('colorSwatches');
  swatchWrap.innerHTML = '';
  PRESET_COLORS.forEach(c => {
    const s = document.createElement('div');
    s.className = 'swatch' + (c === tier.color ? ' selected' : '');
    s.style.background = c;
    s.title = c;
    s.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach(sw => sw.classList.remove('selected'));
      s.classList.add('selected');
      document.getElementById('tierColorInput').value = c;
    });
    swatchWrap.appendChild(s);
  });

  document.getElementById('modalOverlay').hidden = false;
  document.getElementById('tierLabelInput').focus();
  document.getElementById('tierLabelInput').select();
}

function closeModal() {
  document.getElementById('modalOverlay').hidden = true;
  editing = null;
}

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
});

document.getElementById('saveTierBtn').addEventListener('click', () => {
  if (!editing) return;
  const tier = tiers.find(t => t.id === editing);
  if (!tier) return;
  tier.label = document.getElementById('tierLabelInput').value.toUpperCase().slice(0, 4) || tier.label;
  tier.color = document.getElementById('tierColorInput').value;
  closeModal();
  render();
});

document.getElementById('deleteTierBtn').addEventListener('click', () => {
  if (!editing) return;
  if (!confirm('Delete this tier? Images will return to the pool.')) return;
  const tier = tiers.find(t => t.id === editing);
  if (tier) {
    pool.push(...tier.images);
    tiers = tiers.filter(t => t.id !== editing);
  }
  closeModal();
  render();
});

// Allow pressing Enter in label input to save
document.getElementById('tierLabelInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('saveTierBtn').click();
  if (e.key === 'Escape') closeModal();
});

// ── File Menu (dropdown) ────────────────────────────────────────────
function openFileMenu() {
  document.getElementById('fileMenu').classList.add('open');
  document.getElementById('fileMenuDropdown').hidden = false;
}
function closeFileMenu() {
  document.getElementById('fileMenu').classList.remove('open');
  document.getElementById('fileMenuDropdown').hidden = true;
}
document.getElementById('fileMenuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = document.getElementById('fileMenu').classList.contains('open');
  if (isOpen) closeFileMenu(); else openFileMenu();
});
document.addEventListener('click', (e) => {
  const menu = document.getElementById('fileMenu');
  if (menu.classList.contains('open') && !menu.contains(e.target)) closeFileMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeFileMenu();
});

// ── Export PNG ─────────────────────────────────────────────────────
document.getElementById('exportPngBtn').addEventListener('click', async () => {
  closeFileMenu();
  const title = document.getElementById('tierTitle').value.trim() || 'tier-list';
  const board = document.getElementById('tierBoard');
  const titleEl = document.querySelector('.tier-title-wrap');

  // Follow whichever theme is currently active, not a hardcoded palette
  const rootStyle = getComputedStyle(document.documentElement);
  const bgColor = rootStyle.getPropertyValue('--bg').trim() || '#0A0C14';
  const textColor = rootStyle.getPropertyValue('--text').trim() || '#ECEEF5';

  // Temporarily show full board for capture
  const capture = document.createElement('div');
  capture.style.cssText = `
    position: fixed; top: -9999px; left: -9999px;
    background: ${bgColor}; padding: 28px; width: ${board.offsetWidth}px;
    font-family: 'Inter', system-ui, sans-serif;
  `;

  // Title
  if (titleEl) {
    const titleClone = titleEl.cloneNode(true);
    const inp = titleClone.querySelector('.tier-title-input');
    if (inp) {
      const span = document.createElement('div');
      span.style.cssText = `font-family: 'Space Grotesk', sans-serif; font-size: 1.6rem; font-weight: 600; color: ${textColor}; padding-bottom: 12px;`;
      span.textContent = inp.value || '';
      titleClone.replaceChild(span, inp);
    }
    capture.appendChild(titleClone);
  }
  capture.appendChild(board.cloneNode(true));
  document.body.appendChild(capture);

  try {
    const canvas = await html2canvas(capture, {
      backgroundColor: bgColor,
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
    });
    const link = document.createElement('a');
    link.download = `${title.replace(/\s+/g, '-').toLowerCase()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    alert('Export failed: ' + err.message);
  } finally {
    document.body.removeChild(capture);
  }
});

// ── Save / Load ────────────────────────────────────────────────────
document.getElementById('saveBtn').addEventListener('click', async () => {
  closeFileMenu();
  const title = document.getElementById('tierTitle').value.trim() || 'Untitled Tier List';
  const data = {
    _version: 1,
    title,
    savedAt: new Date().toISOString(),
    tiers: await Promise.all(tiers.map(async t => ({
      id: t.id,
      label: t.label,
      color: t.color,
      images: await Promise.all(t.images.map(async i => ({ id: i.id, src: await blobToDataURL(i.blob), name: i.name }))),
    }))),
    pool: await Promise.all(pool.map(async i => ({ id: i.id, src: await blobToDataURL(i.blob), name: i.name }))),
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const link = document.createElement('a');
  link.download = `${title.replace(/\s+/g, '-').toLowerCase()}.tierforge`;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
});

document.getElementById('loadBtn').addEventListener('click', closeFileMenu);
document.getElementById('loadFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data._version || !data.tiers) throw new Error('Invalid file format');

      revokeAllImageUrls(); // replacing state wholesale — release the old blob URLs

      const toImage = async (i) => {
        const blob = dataURLtoBlob(i.src);
        const thumbBlob = await makeThumbnailBlob(blob).catch(() => blob);
        return { id: i.id || uid(), blob, thumbBlob, src: URL.createObjectURL(thumbBlob), name: i.name };
      };
      const tierImages = await Promise.all(data.tiers.map(t => Promise.all((t.images || []).map(toImage))));
      const poolImages = await Promise.all((data.pool || []).map(toImage));

      tiers = data.tiers.map((t, idx) => ({
        id: t.id || uid(),
        label: t.label,
        color: t.color,
        images: tierImages[idx],
      }));
      pool = poolImages;
      if (data.title) {
        document.getElementById('tierTitle').value = data.title;
      }
      render();
    } catch (err) {
      alert('Could not load file: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── Auto-scroll while dragging near the top/bottom of the viewport ──
document.addEventListener('dragover', (e) => {
  if (!dragItem) return;
  const margin = 90;
  const maxSpeed = 24;
  const y = e.clientY;
  const vh = window.innerHeight;
  let dy = 0;
  if (y < margin) {
    dy = -maxSpeed * (1 - y / margin);
  } else if (y > vh - margin) {
    dy = maxSpeed * (1 - (vh - y) / margin);
  }
  if (dy !== 0) window.scrollBy(0, dy);
});

// ── Right-click Image Preview ─────────────────────────────────────
// Takes a Blob (the full-resolution original) rather than a ready-made
// URL, and creates the object URL only for the moment it's shown — this
// is the one place a full decode of the original happens, and it's just
// one image at a time, not all 50 at once.
let currentPreviewUrl = null;

function showImagePreview(blob, name) {
  const overlay = document.getElementById('imgPreviewOverlay');
  const img = document.getElementById('imgPreviewImage');
  if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
  currentPreviewUrl = URL.createObjectURL(blob);
  img.src = currentPreviewUrl;
  img.alt = name || '';
  overlay.hidden = false;
}

function hideImagePreview() {
  const overlay = document.getElementById('imgPreviewOverlay');
  if (!overlay.hidden) overlay.hidden = true;
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = null;
  }
}

document.getElementById('imgPreviewOverlay').addEventListener('click', hideImagePreview);
document.getElementById('imgPreviewOverlay').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  hideImagePreview();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideImagePreview();
});
// Safety net: any drag starting anywhere should dismiss the preview
document.addEventListener('dragstart', hideImagePreview, true);

// ── Blank Screen (Space) ────────────────────────────────────────────
// Hides every image (tiers + unranked pool) so only the empty table
// structure is visible, letting you quiz yourself before revealing.
function toggleBlankScreen() {
  document.body.classList.toggle('blank-mode');
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function isSettingsModalOpen() {
  const overlay = document.getElementById('settingsModalOverlay');
  return overlay && !overlay.hidden;
}

// ── Global keyboard shortcuts ───────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target)) return;

  // Number keys: jump the currently-hovered image straight into a tier
  if (/^[1-9]$/.test(e.key) && hoveredImgId) {
    const targetTier = tiers[parseInt(e.key, 10) - 1];
    if (targetTier) {
      const img = getImage(hoveredImgId);
      if (img) {
        removeImageFromEverywhere(img.id);
        targetTier.images.push(img);
        render();
      }
    }
    return;
  }

  // Space: blank the screen (press again to reveal)
  if (e.code === 'Space') {
    e.preventDefault();
    toggleBlankScreen();
    return;
  }

  // F: toggle the wide ("fullscreen-ish") table layout
  if (e.key.toLowerCase() === 'f') {
    settings.fullscreenTable = !settings.fullscreenTable;
    applySettings();
    if (isSettingsModalOpen()) syncSettingsForm();
    scheduleAutosave();
  }
});

// ── Settings ───────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  poolImgSize: 120,
  tierImgSize: 120,
  showNames: false,
  confirmDelete: false,
  confirmClear: true,
  fullscreenTable: false,
  theme: 'dark',
  accent: 'violet',
};

function applySettings() {
  document.documentElement.style.setProperty('--pool-img-size', settings.poolImgSize + 'px');
  document.documentElement.style.setProperty('--tier-img-size', settings.tierImgSize + 'px');
  document.body.classList.toggle('always-show-names', settings.showNames);
  document.body.classList.toggle('wide-table', settings.fullscreenTable);
  document.documentElement.setAttribute('data-theme', settings.theme);
  document.documentElement.setAttribute('data-accent', settings.accent);
}

function syncSettingsForm() {
  document.getElementById('poolSizeSelect').value = String(settings.poolImgSize);
  document.getElementById('tierSizeSelect').value = String(settings.tierImgSize);
  document.getElementById('showNamesToggle').checked = settings.showNames;
  document.getElementById('confirmDeleteToggle').checked = settings.confirmDelete;
  document.getElementById('confirmClearToggle').checked = settings.confirmClear;
  document.getElementById('fullscreenTableToggle').checked = settings.fullscreenTable;

  document.getElementById('themeLightBtn').classList.toggle('btn-primary', settings.theme === 'light');
  document.getElementById('themeLightBtn').classList.toggle('btn-secondary', settings.theme !== 'light');
  document.getElementById('themeDarkBtn').classList.toggle('btn-primary', settings.theme === 'dark');
  document.getElementById('themeDarkBtn').classList.toggle('btn-secondary', settings.theme !== 'dark');
  document.querySelectorAll('.accent-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.accent === settings.accent);
  });
}

function openSettingsModal() {
  syncSettingsForm();
  document.getElementById('settingsModalOverlay').hidden = false;
}

function closeSettingsModal() {
  document.getElementById('settingsModalOverlay').hidden = true;
}

document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
document.getElementById('settingsModalClose').addEventListener('click', closeSettingsModal);
document.getElementById('settingsDoneBtn').addEventListener('click', closeSettingsModal);
document.getElementById('settingsModalOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('settingsModalOverlay')) closeSettingsModal();
});

document.getElementById('poolSizeSelect').addEventListener('change', (e) => {
  settings.poolImgSize = parseInt(e.target.value, 10);
  applySettings();
  scheduleAutosave();
});
document.getElementById('tierSizeSelect').addEventListener('change', (e) => {
  settings.tierImgSize = parseInt(e.target.value, 10);
  applySettings();
  scheduleAutosave();
});
document.getElementById('showNamesToggle').addEventListener('change', (e) => {
  settings.showNames = e.target.checked;
  applySettings();
  scheduleAutosave();
});
document.getElementById('confirmDeleteToggle').addEventListener('change', (e) => {
  settings.confirmDelete = e.target.checked;
  scheduleAutosave();
});
document.getElementById('confirmClearToggle').addEventListener('change', (e) => {
  settings.confirmClear = e.target.checked;
  scheduleAutosave();
});
document.getElementById('fullscreenTableToggle').addEventListener('change', (e) => {
  settings.fullscreenTable = e.target.checked;
  applySettings();
  scheduleAutosave();
});
document.getElementById('resetSettingsBtn').addEventListener('click', () => {
  settings = { ...DEFAULT_SETTINGS };
  syncSettingsForm();
  applySettings();
  scheduleAutosave();
});

document.getElementById('themeLightBtn').addEventListener('click', () => {
  settings.theme = 'light';
  applySettings();
  syncSettingsForm();
  scheduleAutosave();
});
document.getElementById('themeDarkBtn').addEventListener('click', () => {
  settings.theme = 'dark';
  applySettings();
  syncSettingsForm();
  scheduleAutosave();
});
document.querySelectorAll('.accent-dot').forEach(dot => {
  dot.addEventListener('click', () => {
    settings.accent = dot.dataset.accent;
    applySettings();
    syncSettingsForm();
    scheduleAutosave();
  });
});

applySettings();

// ── Ghost element for drag image ───────────────────────────────────
const ghost = document.createElement('div');
ghost.id = 'dragGhost';
ghost.style.cssText = 'position:fixed;top:-200px;left:-200px;width:72px;height:72px;pointer-events:none;z-index:9999;border-radius:4px;overflow:hidden;';
document.body.appendChild(ghost);

// ── Init ───────────────────────────────────────────────────────────
// If a previous session exists (e.g. the browser crashed or the tab was
// closed/reloaded), silently restore it so nothing is lost. IndexedDB
// access is async, so the rest of setup waits on this IIFE.
(async () => {
  if (await loadAutosave()) {
    applySettings();
  }
  setupPoolDropZone();
  render();
})();

// Also catch the moment the page is about to unload, as a last-chance save.
// Note: this is best-effort — IndexedDB writes are async and the browser
// may terminate the page before the transaction finishes. The 300ms
// debounced autosave after every change is the primary safety net.
window.addEventListener('beforeunload', autosaveState);