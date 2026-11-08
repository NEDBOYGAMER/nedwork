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

// Every image object is now just a thin reference to server-held bytes:
// { id, src (thumbnail URL), fullUrl (full-res URL), name }. No Blobs are
// held in memory anymore — the server does the decode/resize work at
// upload time, and the browser only ever downloads what it's about to
// paint (a ~480px thumbnail per card, or the full copy on demand for a
// right-click preview). This is the single biggest lag fix in this file:
// the old version kept a full-resolution Blob *and* a thumbnail Blob for
// every image alive in tab memory the whole session, which is what made
// big batches (dozens of multi-MB phone photos) slow to upload, slow to
// autosave, and heavy on the tab.
let tiers   = DEFAULT_TIERS.map(t => ({ ...t, images: [] }));
let pool    = []; // { id, src, fullUrl, name }
let editing = null; // tier id being edited

let dragItem     = null; // { imgId, fromTierId (null = pool) }
let hoveredImgId = null; // image currently under the mouse cursor

// ── Multiplayer session state ──────────────────────────────────────
// While a session is active the personal IndexedDB autosave is parked
// (see autosaveState) and the shared board is synced through short
// polling. `applyingRemote` marks renders caused by a server update so
// they never bounce straight back as a push. `localChangeSeq` lets an
// in-flight push notice that new local edits landed while it was away.
const SESSION_POLL_MS = 1000;
const SESSION_PUSH_MS = 350;
const PRESENCE_SEND_MS = 100;
const ME = (window.TIERFORGE_USER && window.TIERFORGE_USER.id) || null;

let sessionToken   = null;
let sessionState   = null;  // last known server session payload
let sessionCatalog = [];    // shared image refs [{id, owner, name}]
let sessionPollTimer = null;
let sessionPushTimer = null;
let sessionDirty     = false;
let applyingRemote   = false;
let localChangeSeq   = 0;

// Ephemeral drag presence: what we're dragging (sent to the server) and the
// last snapshot of everyone else's drags (rendered as remote cursors).
let sessionPresence  = {};
let presenceRef      = null;
let presenceXY       = { x: 0, y: 0 };
let presenceTimer    = null;
let presencePending  = false;

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

// Pure array mutation only — this is used both for permanent removal
// (img-remove button) AND for ordinary moves (drag/drop, number-key
// jump), so it must never talk to the network. Server-side deletion is
// triggered explicitly by whichever call site actually means "gone for
// good" — see deleteImageFromServer().
function removeImageFromEverywhere(imgId) {
  pool = pool.filter(i => i.id !== imgId);
  tiers.forEach(t => {
    t.images = t.images.filter(i => i.id !== imgId);
  });
}

// ── Server image store ────────────────────────────────────────────
// The backend at /apps/tierforge/images does the actual thumbnailing
// (Pillow: EXIF-transpose, downscale, re-encode) and hands back URLs for
// a small thumbnail + a capped "full" copy. A whole file-picker selection
// is sent as ONE multipart POST rather than one request per file — for a
// 50-image upload that's 1 round trip instead of 50, and the resize work
// happens off the user's main thread entirely (on the server), so the UI
// never stalls while it's happening.
const API_BASE = '/apps/tierforge';

async function uploadImagesToServer(files) {
  const formData = new FormData();
  files.forEach(f => formData.append('images', f, f.name));

  const res = await fetch(`${API_BASE}/images`, { method: 'POST', body: formData });
  let body = null;
  try { body = await res.json(); } catch (_) { /* fall through to status-based error */ }

  if (!res.ok && (!body || !body.images || body.images.length === 0)) {
    const msg = (body && body.error) || `Upload failed (${res.status})`;
    throw new Error(msg);
  }
  return { images: (body && body.images) || [], errors: (body && body.errors) || [] };
}

// Fire-and-forget: an orphaned file left on the server isn't worth
// blocking or retrying the UI over. `keepalive` lets the request survive
// even if this happens right as the user navigates away.
function deleteImageFromServer(imageId) {
  fetch(`${API_BASE}/images/${imageId}`, { method: 'DELETE', keepalive: true }).catch(() => {});
}

// ── Image <-> data URL helpers ──────────────────────────────────────
// Only needed at the two edges that produce/consume a portable
// .tierforge file (Save embeds full images as base64; Load has to turn
// that base64 back into a file to re-upload). Nothing else in this file
// touches Blobs anymore.
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

// ── Autosave (crash / reload recovery) ────────────────────────────
// Uses IndexedDB rather than localStorage: it's async (doesn't block the
// main thread) and isn't capped at ~5-10MB. Now that images are just
// {id, src, fullUrl, name} references instead of Blobs, this write is
// tiny — a board of a few hundred images used to mean serializing
// hundreds of MB of image data into IndexedDB on every debounced
// autosave; now it's a few KB of JSON either way.
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
  if (sessionToken) return; // personal board is parked during a session
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosaveState, 300);
}

async function autosaveState() {
  if (sessionToken) return;
  try {
    const titleEl = document.getElementById('tierTitle');
    const data = {
      _version: 4,
      title: titleEl ? titleEl.value : '',
      savedAt: new Date().toISOString(),
      tiers: tiers.map(t => ({
        id: t.id,
        label: t.label,
        color: t.color,
        images: t.images.map(i => ({ id: i.id, src: i.src, fullUrl: i.fullUrl, name: i.name })),
      })),
      pool: pool.map(i => ({ id: i.id, src: i.src, fullUrl: i.fullUrl, name: i.name })),
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

// Pre-v4 autosave (_version 3 and earlier) stored raw Blobs client-side
// instead of server refs. Migrate it once by re-uploading each original
// to the server, so switching to server-side thumbnailing doesn't just
// wipe out anyone's in-progress session.
async function migrateBlobAutosaveToServer(data) {
  const toImage = async (i) => {
    const blob = i.blob || i.thumbBlob;
    if (!blob) return null;
    try {
      const { images } = await uploadImagesToServer([new File([blob], (i.name || 'image') + '.jpg')]);
      const uploaded = images[0];
      if (!uploaded) return null;
      return { id: uploaded.id, owner: ME, src: uploaded.thumbUrl, fullUrl: uploaded.fullUrl, name: i.name || uploaded.name };
    } catch (err) {
      console.warn('Failed to migrate an autosaved image:', err);
      return null;
    }
  };

  const tierImages = await Promise.all(data.tiers.map(t => Promise.all((t.images || []).map(toImage))));
  const poolImages = await Promise.all((data.pool || []).map(toImage));

  return {
    tiers: data.tiers.map((t, idx) => ({
      id: t.id || uid(),
      label: t.label,
      color: t.color,
      images: (tierImages[idx] || []).filter(Boolean),
    })),
    pool: (poolImages || []).filter(Boolean),
  };
}

async function loadAutosave() {
  try {
    const data = await idbGet(IDB_KEY);
    if (!data || !Array.isArray(data.tiers)) {
      await migrateOldLocalStorageAutosave();
      return false;
    }

    let restored;
    if (!data._version || data._version < 4) {
      restored = await migrateBlobAutosaveToServer(data);
    } else {
      restored = {
        tiers: data.tiers.map(t => ({
          id: t.id || uid(),
          label: t.label,
          color: t.color,
          images: (t.images || []).map(i => ({ id: i.id, src: i.src, fullUrl: i.fullUrl, name: i.name })),
        })),
        pool: (data.pool || []).map(i => ({ id: i.id, src: i.src, fullUrl: i.fullUrl, name: i.name })),
      };
    }

    tiers = restored.tiers;
    pool = restored.pool;

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
  schedulePersist();
}

// One persistence entry point: the personal board saves to IndexedDB, a
// live session pushes to the server.
function schedulePersist() {
  if (sessionToken) {
    scheduleSessionPush();
  } else {
    scheduleAutosave();
  }
}

function renderTiers() {
  const board = document.getElementById('tierBoard');
  // Build off-DOM and swap in one shot — one reflow for the whole board
  // instead of one per appendChild.
  const frag = document.createDocumentFragment();
  tiers.forEach(tier => frag.appendChild(makeTierRow(tier)));
  board.innerHTML = '';
  board.appendChild(frag);
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

  const imgFrag = document.createDocumentFragment();
  tier.images.forEach(img => imgFrag.appendChild(makeCard(img, tier.id)));
  imgArea.appendChild(imgFrag);

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
  // Thumbnails now come over the network rather than an instant blob:
  // URL, so let the browser defer decoding/loading of off-screen cards
  // instead of doing it all eagerly on every render.
  image.loading = 'lazy';
  image.decoding = 'async';

  const name = document.createElement('div');
  name.className = 'img-name';
  name.textContent = img.name;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'img-remove';
  const inSplit = sessionToken && sessionState && sessionState.mode === 'split';
  if (inSplit) {
    removeBtn.title = tierId === null
      ? 'Delete from the shared pool'
      : 'Return to my unranked pool';
  } else if (sessionToken) {
    removeBtn.title = 'Delete from the shared pool';
  } else {
    removeBtn.title = 'Remove image';
  }
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();

    if (inSplit) {
      if (tierId === null) {
        // Shared catalogue: only the host may delete an image for everyone.
        if (!isSessionHost()) return;
        if (settings.confirmDelete && !(await confirmDialog(
            `Delete "${img.name}" from the shared pool for everyone?`,
            { danger: true }))) return;
        await removeFromSession(img);
      } else {
        // Un-ranking only moves the image back to this member's pool.
        removeImageFromEverywhere(img.id);
        pool.push(img);
        render();
      }
      return;
    }

    if (sessionToken) {
      // Co-op: one shared board, so every member can delete. Bytes stay in
      // the owner's personal uploads; only the session board forgets them.
      if (settings.confirmDelete && !(await confirmDialog(
          `Delete "${img.name}" from the shared pool for everyone?`,
          { danger: true }))) return;
      await removeFromSession(img);
      return;
    }

    if (settings.confirmDelete && !(await confirmDialog(`Remove "${img.name}"?`, { danger: true }))) return;
    removeImageFromEverywhere(img.id);
    deleteImageFromServer(img.id);
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

  // Right-click to preview big — fetches the full-resolution copy from
  // the server on demand (img.fullUrl), rather than keeping every
  // original decoded in the tab the whole time.
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showImagePreview(img);
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

    if (sessionToken) {
      presenceRef = imageToRef(img);
      presenceXY = { x: e.clientX, y: e.clientY };
      sendPresence();
    }

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
    if (sessionToken) {
      presenceRef = null;
      sendPresence();
    }
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
    if (sessionToken) {
      presenceXY = { x: pending.clientX, y: pending.clientY };
      sendPresence();
    }
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

// ── Lightweight drop handling ────────────────────────────────────────
// A drop only ever moves ONE card. Calling render() rebuilt every card in
// every tier and the whole pool (~100 elements) from scratch just to
// reflect that one move — that full rebuild, not the drag itself, was
// the real cause of the pause you feel right when you release the mouse.
//
// Instead: relocate the existing card's actual DOM node. Because it's the
// same node (not a new one), its <img> keeps its already-decoded/painted
// state — nothing needs to redecode or reflow beyond the single move.
function moveImageCardDom(img, targetContainer, afterElement, isPoolTarget) {
  let card = document.querySelector(`.img-card[data-img-id="${img.id}"]`);

  if (!card) {
    // Shouldn't normally happen, but stay correct if it ever does.
    card = makeCard(img, isPoolTarget ? null : targetContainer.dataset.tierId);
  }
  card.classList.remove('dragging');

  if (afterElement) {
    targetContainer.insertBefore(card, afterElement);
  } else {
    targetContainer.appendChild(card);
  }

  updatePoolCountDisplay();
  schedulePersist();
}

function updatePoolCountDisplay() {
  const emptyEl = document.getElementById('poolEmpty');
  const countEl = document.getElementById('poolCount');
  if (!emptyEl || !countEl) return;
  if (pool.length === 0) {
    emptyEl.style.display = 'flex';
    countEl.textContent = '0 images';
  } else {
    emptyEl.style.display = 'none';
    countEl.textContent = `${pool.length} image${pool.length !== 1 ? 's' : ''}`;
  }
}

function setupDropZone(el, tierId) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.closest('.tier-row')?.classList.add('drag-over');
    if (dragItem) {
      scheduleDragOverUpdate(el, e.clientX, e.clientY);
    }
  });

  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) {
      el.closest('.tier-row')?.classList.remove('drag-over');
      if (dropIndicatorEl.parentNode === el) hideDropIndicator();
    }
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    cancelPendingDragOverUpdate();
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

    moveImageCardDom(img, el, afterElement, false);
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
    const frag = document.createDocumentFragment();
    pool.forEach(img => frag.appendChild(makeCard(img, null)));
    poolEl.appendChild(frag);
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
    moveImageCardDom(img, poolEl, afterElement, true);
  });
}

// ── Upload ─────────────────────────────────────────────────────────
// The whole file-picker selection is sent to the server as one multipart
// POST. The server normalizes + thumbnails every file and hands back
// {id, name, thumbUrl, fullUrl} for each — no canvas work, no per-file
// decode, happens on the user's device at all. One render() call adds
// the whole batch to the pool at once.
document.getElementById('imageUpload').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;

  const uploadLabel = document.querySelector('label[for="imageUpload"]');
  const originalLabelHTML = uploadLabel ? uploadLabel.innerHTML : null;

  try {
    if (uploadLabel) {
      uploadLabel.style.pointerEvents = 'none';
      const isArchive = files.some(f => /\.zip$/i.test(f.name));
      uploadLabel.textContent = isArchive
        ? 'Uploading archive…'
        : (files.length > 1 ? `Uploading ${files.length} images…` : 'Uploading…');
    }

    const { images, errors } = await uploadImagesToServer(files);

    if (images.length > 0) {
      pool.push(...images.map(img => ({
        id: img.id,
        owner: ME,
        src: img.thumbUrl,
        fullUrl: img.fullUrl,
        name: img.name,
      })));
      render();
    }

    if (errors.length > 0) {
      const shown = errors.slice(0, 8)
        .map(er => `${er.name}: ${er.error}`)
        .join('\n');
      const more = errors.length > 8 ? `\n…and ${errors.length - 8} more` : '';
      await alertDialog(
        `${errors.length} file(s) could not be uploaded:\n${shown}${more}`);
    }
  } catch (err) {
    await alertDialog('Upload failed: ' + err.message);
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
document.getElementById('clearAllBtn').addEventListener('click', async () => {
  closeClearMenu();
  if (settings.confirmClear && !(await confirmDialog('Return all images to the pool and clear tiers?', { danger: true }))) return;
  const allImages = [
    ...pool,
    ...tiers.flatMap(t => t.images)
  ];
  pool = allImages;
  tiers.forEach(t => t.images = []);
  render();
  autosaveState();
});

// "Clear completely" — drops every image from the board AND deletes the
// stored bytes on the server. The plain "Clear all" above only returns
// ranked images to the pool (nothing is deleted).
document.getElementById('clearCompletelyBtn').addEventListener('click', async () => {
  closeClearMenu();
  if (sessionToken) return; // never delete shared/personal bytes from a session
  if (settings.confirmClear && !(await confirmDialog(
      'Delete ALL images from the board and the server? This cannot be undone.',
      { danger: true }))) return;
  const oldIds = [...pool, ...tiers.flatMap(t => t.images)].map(i => i.id);
  pool = [];
  tiers.forEach(t => t.images = []);
  render();
  autosaveState();
  oldIds.forEach(deleteImageFromServer);
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

document.getElementById('deleteTierBtn').addEventListener('click', async () => {
  if (!editing) return;
  if (!(await confirmDialog('Delete this tier? Images will return to the pool.', { danger: true }))) return;
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

// ── Dropdown menus (File + Clear) ───────────────────────────────────
function setupDropdown(menuId, toggleId, dropdownId) {
  const menu = document.getElementById(menuId);
  const dropdown = document.getElementById(dropdownId);
  const setOpen = (open) => {
    menu.classList.toggle('open', open);
    dropdown.hidden = !open;
    const toggle = document.getElementById(toggleId);
    toggle.setAttribute('aria-expanded', String(open));
  };
  document.getElementById(toggleId).addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!menu.classList.contains('open'));
  });
  document.addEventListener('click', (e) => {
    if (menu.classList.contains('open') && !menu.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
  return { close: () => setOpen(false) };
}

const fileMenu = setupDropdown('fileMenu', 'fileMenuBtn', 'fileMenuDropdown');
const clearMenu = setupDropdown('clearMenu', 'clearMenuBtn', 'clearMenuDropdown');

function closeFileMenu() { fileMenu.close(); }
function closeClearMenu() { clearMenu.close(); }

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
    await alertDialog('Export failed: ' + err.message);
  } finally {
    document.body.removeChild(capture);
  }
});

// ── Save / Load ────────────────────────────────────────────────────
// The exported .tierforge file stays fully self-contained (base64 image
// data embedded directly), unchanged from before — that's what lets a
// downloaded file be reopened later even if the server-side copies it
// was built from are long gone. Saving now means fetching each image's
// full-resolution copy from the server once, at export time, instead of
// reading it out of an in-memory Blob.
document.getElementById('saveBtn').addEventListener('click', async () => {
  closeFileMenu();
  const title = document.getElementById('tierTitle').value.trim() || 'Untitled Tier List';

  const fetchAsDataURL = async (img) => {
    const res = await fetch(img.fullUrl);
    if (!res.ok) throw new Error(`Failed to fetch "${img.name}"`);
    const blob = await res.blob();
    return blobToDataURL(blob);
  };

  let data;
  try {
    data = {
      _version: 1,
      title,
      savedAt: new Date().toISOString(),
      tiers: await Promise.all(tiers.map(async t => ({
        id: t.id,
        label: t.label,
        color: t.color,
        images: await Promise.all(t.images.map(async i => ({ id: i.id, src: await fetchAsDataURL(i), name: i.name }))),
      }))),
      pool: await Promise.all(pool.map(async i => ({ id: i.id, src: await fetchAsDataURL(i), name: i.name }))),
    };
  } catch (err) {
    await alertDialog('Could not prepare file for saving: ' + err.message);
    return;
  }

  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const link = document.createElement('a');
  link.download = `${title.replace(/\s+/g, '-').toLowerCase()}.tierforge`;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
});

document.getElementById('loadFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data._version || !data.tiers) throw new Error('Invalid file format');

      // Remember what's currently on the board so it can be cleaned up on
      // the server once the new board has loaded successfully — otherwise
      // every previous session's uploads just leak on disk.
      const oldIds = [...pool, ...tiers.flatMap(t => t.images)].map(i => i.id);

      const toImage = async (i) => {
        const blob = dataURLtoBlob(i.src);
        const { images } = await uploadImagesToServer([new File([blob], (i.name || 'image') + '.jpg')]);
        const uploaded = images[0];
        if (!uploaded) throw new Error(`Failed to re-upload "${i.name}"`);
        return { id: uploaded.id, owner: ME, src: uploaded.thumbUrl, fullUrl: uploaded.fullUrl, name: i.name };
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
      if (sessionToken) {
        // A loaded file replaces a co-op board wholesale; in split mode the
        // shared catalogue stays (loaded images join it as new entries).
        if (sessionState && sessionState.mode === 'coop') {
          sessionCatalog = collectBoardRefs(tiers, pool);
        }
        render();
      } else {
        render();
        oldIds.forEach(deleteImageFromServer);
      }
    } catch (err) {
      await alertDialog('Could not load file: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── Import from a TierMaker link ───────────────────────────────────
// The server fetches the template page + item API, downloads every image
// through the same normalize/thumbnail pipeline as an upload, and returns
// {title, tiers, pool, errors} — so imported images behave exactly like
// uploaded ones afterwards (drag, preview, save/load, PNG export).
document.getElementById('importLinkBtn').addEventListener('click', async () => {
  closeFileMenu();

  const url = await promptDialog('Paste a TierMaker template link (tiermaker.com/create/…):', {
    title: 'Import from link',
    okText: 'Import',
  });
  if (!url) return;
  if (!(await confirmDialog('Replace the current board with the imported list?', { danger: true }))) return;

  const btn = document.getElementById('importLinkBtn');
  const originalLabel = btn.innerHTML;
  btn.textContent = 'Importing…';
  btn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data && data.error) || `Import failed (${res.status})`);

    // Same cleanup as Load: remember the current board so its images can be
    // removed from the server once the imported board is in place — otherwise
    // every import leaks the previous board's uploads on disk.
    const oldIds = [...pool, ...tiers.flatMap(t => t.images)].map(i => i.id);

    tiers = (data.tiers || []).map(t => ({
      id: uid(), label: t.label, color: t.color, images: [],
    }));
    pool = (data.pool || []).map(i => ({
      id: i.id, owner: ME, src: i.thumbUrl, fullUrl: i.fullUrl, name: i.name,
    }));
    if (data.title) {
      document.getElementById('tierTitle').value = data.title;
    }
    if (sessionToken) {
      if (sessionState && sessionState.mode === 'coop') {
        sessionCatalog = collectBoardRefs(tiers, pool);
      }
      render();
    } else {
      render();
      autosaveState();
      oldIds.forEach(deleteImageFromServer);
    }
    if (data.errors && data.errors.length > 0) {
      await alertDialog(`${data.errors.length} image(s) could not be imported: ` +
        data.errors.map(er => er.name).join(', '));
    }
  } catch (err) {
    await alertDialog('Import failed: ' + err.message);
  } finally {
    btn.innerHTML = originalLabel;
    btn.disabled = false;
  }
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
// Full-resolution bytes live on the server, not in tab memory, so this
// fetches them on demand. To keep it feeling instant, the overlay opens
// immediately showing the already-loaded thumbnail (blurred up to full
// size via CSS) and swaps to the sharp version the moment the fetch
// resolves — no blank/loading flash, and the common "just glancing"
// case never even needs the network round trip to feel done.
let currentPreviewUrl = null;
let previewRequestToken = 0;

async function showImagePreview(img) {
  const overlay = document.getElementById('imgPreviewOverlay');
  const imageEl = document.getElementById('imgPreviewImage');
  const myToken = ++previewRequestToken;

  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = null;
  }

  imageEl.src = img.src; // instant: the thumbnail, shown large as a placeholder
  imageEl.alt = img.name || '';
  overlay.classList.add('loading');
  overlay.hidden = false;

  try {
    const res = await fetch(img.fullUrl);
    if (!res.ok) throw new Error('Failed to load full-resolution image');
    const blob = await res.blob();
    if (myToken !== previewRequestToken) return; // superseded by a newer preview / already closed

    currentPreviewUrl = URL.createObjectURL(blob);
    imageEl.src = currentPreviewUrl;
  } catch (err) {
    console.warn('Preview failed, showing thumbnail only:', err);
  } finally {
    if (myToken === previewRequestToken) overlay.classList.remove('loading');
  }
}

function hideImagePreview() {
  previewRequestToken++; // invalidate any in-flight fetch for the old preview
  const overlay = document.getElementById('imgPreviewOverlay');
  if (!overlay.hidden) overlay.hidden = true;
  overlay.classList.remove('loading');
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

// ── Multiplayer sessions ───────────────────────────────────────────
function refKey(ref) {
  return `${ref.owner}:${ref.id}`;
}

function sessionImageUrl(owner, id, variant) {
  return `${API_BASE}/sessions/${sessionToken}/images/${owner}/${id}/${variant}`;
}

// Server refs {id, owner, name} -> local cards {id, owner, src, fullUrl, name}
function refToImage(ref) {
  return {
    id: ref.id,
    owner: ref.owner,
    name: ref.name || 'image',
    src: sessionImageUrl(ref.owner, ref.id, 'thumb'),
    fullUrl: sessionImageUrl(ref.owner, ref.id, 'full'),
  };
}

// Local cards -> server refs. Personal images (created before any session)
// default to the signed-in user as owner.
function imageToRef(img) {
  return {
    id: img.id,
    owner: Number.isInteger(img.owner) ? img.owner : ME,
    name: img.name || 'image',
  };
}

function tiersToWire() {
  return tiers.map(t => ({
    id: t.id,
    label: t.label,
    color: t.color,
    images: t.images.map(imageToRef),
  }));
}

function collectBoardRefs(tierList, poolList) {
  const seen = new Set();
  const out = [];
  const push = (img) => {
    const ref = imageToRef(img);
    if (!ref || !ref.id) return;
    const key = refKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };
  tierList.forEach(t => t.images.forEach(push));
  poolList.forEach(push);
  return out;
}

// Shared catalogue = known session refs plus anything currently placed.
function collectCatalogRefs() {
  const seen = new Set();
  const out = [];
  const push = (ref) => {
    if (!ref || !ref.id) return;
    const key = refKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: ref.id, owner: ref.owner, name: ref.name || 'image' });
  };
  sessionCatalog.forEach(push);
  tiers.forEach(t => t.images.forEach(img => push(imageToRef(img))));
  pool.forEach(img => push(imageToRef(img)));
  return out;
}

function sessionBoardPayload() {
  const catalog = collectCatalogRefs();
  if (sessionState.mode === 'coop') {
    return {
      base_version: sessionState.version,
      catalog,
      tiers: tiersToWire(),
      pool: pool.map(imageToRef),
    };
  }
  return {
    base_version: sessionState.version,
    catalog,
    my_tiers: tiersToWire(),
    my_pool_order: pool.map(imageToRef),
  };
}

function isSessionHost() {
  return !!(sessionState && ME && sessionState.hostId === ME);
}

// Server session payload -> local board. In split mode the member's pool is
// "catalog minus my ranked images", ordered by their saved pool_order.
function applySessionState(state) {
  sessionState = state;
  const board = state.board || {};
  sessionCatalog = Array.isArray(board.catalog)
    ? board.catalog.map(ref => ({ ...ref }))
    : [];

  const toLocalTiers = (wireTiers) => (wireTiers || []).map(t => ({
    id: t.id || uid(),
    label: t.label || '?',
    color: t.color || '#6c757d',
    images: (t.images || []).map(refToImage),
  }));

  if (state.mode === 'split') {
    const entry = (board.split || {})[String(ME)]
      || { tiers: [], pool_order: [] };
    tiers = toLocalTiers(entry.tiers);

    const ranked = new Set(tiers.flatMap(t => t.images.map(refKey)));
    const byKey = new Map(sessionCatalog.map(ref => [refKey(ref), ref]));
    const ordered = [];
    const seen = new Set();
    const pushRef = (ref) => {
      if (!ref || !ref.id) return;
      const key = refKey(ref);
      if (ranked.has(key) || seen.has(key)) return;
      const canonical = byKey.get(key);
      if (!canonical) return;
      seen.add(key);
      ordered.push(canonical);
    };
    (entry.pool_order || []).forEach(pushRef);
    sessionCatalog.forEach(pushRef);
    pool = ordered.map(refToImage);
  } else {
    const coop = board.coop || {};
    tiers = toLocalTiers(coop.tiers);
    pool = (coop.pool || []).map(refToImage);
  }

  sessionDirty = false;
  updateSessionBanner();
  updatePeerView();
}

function updateSessionBanner() {
  const banner = document.getElementById('sessionBanner');
  if (!sessionState) {
    banner.hidden = true;
    return;
  }
  const ended = sessionState.status === 'ended';
  banner.hidden = false;

  document.getElementById('sessionModeLabel').textContent =
    sessionState.mode === 'coop' ? 'Co-op session' : 'Split-screen session';
  document.getElementById('sessionTitleLabel').textContent =
    sessionState.title || '';

  const names = (sessionState.members || []).map(m => {
    let label = m.username;
    if (m.role === 'host') label += ' (host)';
    if (m.userId === ME) label += ' (you)';
    return label;
  });
  document.getElementById('sessionMembers').textContent =
    ended ? 'Session ended' : names.join(' · ');

  document.getElementById('copyInviteBtn').hidden = ended;
  document.getElementById('peerToggleBtn').hidden =
    sessionState.mode !== 'split' || ended;
  document.getElementById('endSessionBtn').hidden = ended || !isSessionHost();

  const leaveBtn = document.getElementById('leaveSessionBtn');
  leaveBtn.hidden = !ended && isSessionHost();
  leaveBtn.textContent = ended ? 'Exit session' : 'Leave session';

  if (sessionState.mode !== 'split' || ended) {
    document.getElementById('peerView').hidden = true;
    document.getElementById('peerToggleBtn').textContent = 'Peer rankings';
  }
}

// Read-only live view of every other member's split-screen board.
function updatePeerView() {
  const panel = document.getElementById('peerView');
  const columns = document.getElementById('peerColumns');
  if (!sessionState || sessionState.mode !== 'split') {
    panel.hidden = true;
    columns.innerHTML = '';
    return;
  }

  const board = sessionState.board || {};
  const split = board.split || {};
  const catalog = board.catalog || [];
  const peers = (sessionState.members || []).filter(m => m.userId !== ME);
  columns.innerHTML = '';

  if (peers.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'peer-empty';
    empty.textContent = 'Share the invite link — nobody else has joined yet.';
    columns.appendChild(empty);
    return;
  }

  peers.forEach(member => {
    const entry = split[String(member.userId)]
      || { tiers: [], pool_order: [] };
    const column = document.createElement('div');
    column.className = 'peer-column';

    const name = document.createElement('div');
    name.className = 'peer-name';
    name.textContent = member.username
      + (member.role === 'host' ? ' (host)' : '');
    column.appendChild(name);

    const ranked = new Set();
    (entry.tiers || []).forEach(tier =>
      (tier.images || []).forEach(ref => ranked.add(refKey(ref))));
    const poolCount = catalog.filter(ref => !ranked.has(refKey(ref))).length;

    const count = document.createElement('div');
    count.className = 'peer-count';
    count.textContent = `${poolCount} unranked`;
    column.appendChild(count);

    (entry.tiers || []).forEach(tier => {
      const row = document.createElement('div');
      row.className = 'peer-tier';

      const label = document.createElement('span');
      label.className = 'peer-tier-label';
      label.textContent = tier.label;
      label.style.color = tier.color || '';
      row.appendChild(label);

      const images = document.createElement('div');
      images.className = 'peer-tier-images';
      (tier.images || []).forEach(ref => {
        const local = refToImage(ref);
        const image = document.createElement('img');
        image.src = local.src;
        image.alt = ref.name || '';
        image.title = ref.name || '';
        image.loading = 'lazy';
        images.appendChild(image);
      });
      row.appendChild(images);
      column.appendChild(row);
    });

    columns.appendChild(column);
  });
}

function startSessionPolling() {
  stopSessionPolling();
  sessionPollTimer = setInterval(pollSession, SESSION_POLL_MS);
}

function stopSessionPolling() {
  if (sessionPollTimer) {
    clearInterval(sessionPollTimer);
    sessionPollTimer = null;
  }
}

function membersKey(members) {
  return (members || []).map(m => `${m.userId}:${m.role}`).sort().join('|');
}

function handleSessionUpdate(data) {
  if (!sessionToken || !data) return;
  const prev = sessionState;
  if (prev && data.version < prev.version) return; // out-of-order poll
  const statusChanged = !prev || prev.status !== data.status;
  const membersChanged = !prev
    || membersKey(prev.members) !== membersKey(data.members);
  const titleChanged = !prev || prev.title !== data.title;
  const presenceChanged = !!data.presence
    && presenceKey(data.presence) !== presenceKey(sessionPresence);
  const boardChanged = !prev || data.version !== prev.version
    || statusChanged || membersChanged || titleChanged;

  // Cursor movement is the common case at 1s polling: repaint just the
  // overlay instead of rebuilding every card on the board.
  if (!boardChanged) {
    if (presenceChanged) {
      sessionPresence = data.presence;
      renderRemoteCursors();
    }
    return;
  }

  if (prev && prev.status !== 'ended' && data.status === 'ended') {
    if (!sessionDirty && !dragItem) {
      applyingRemote = true;
      applySessionState(data);
      render();
      applyingRemote = false;
    } else {
      sessionState = data;
    }
    if (data.presence) sessionPresence = data.presence;
    onSessionEnded();
    return;
  }

  if (sessionDirty || dragItem) {
    // Keep the local board (the user is mid-edit); only adopt metadata and
    // the server version so the next push isn't permanently rejected.
    sessionState = { ...data, board: prev ? prev.board : data.board };
    if (data.presence) sessionPresence = data.presence;
    updateSessionBanner();
    if (sessionState.mode === 'split') updatePeerView();
    renderRemoteCursors();
    return;
  }

  applyingRemote = true;
  applySessionState(data);
  render();
  applyingRemote = false;
  if (data.presence) sessionPresence = data.presence;
  renderRemoteCursors();
}

async function pollSession() {
  if (!sessionToken || document.hidden) return;
  try {
    const res = await fetch(`${API_BASE}/sessions/${sessionToken}`);
    if (res.status === 404) {
      exitSession();
      await alertDialog('This session no longer exists.');
      return;
    }
    if (res.status === 403) {
      exitSession();
      await alertDialog('You are no longer a member of this session.');
      return;
    }
    if (!res.ok) return;
    handleSessionUpdate(await res.json());
  } catch (_) {
    // transient network failure — the next poll retries
  }
}

function scheduleSessionPush() {
  if (!sessionToken || applyingRemote) return;
  sessionDirty = true;
  localChangeSeq += 1;
  clearTimeout(sessionPushTimer);
  sessionPushTimer = setTimeout(() => pushSessionBoard(), SESSION_PUSH_MS);
}

async function pushSessionBoard(attempt = 0) {
  if (!sessionToken || !sessionState || applyingRemote) return;
  if (sessionState.status !== 'open') return;

  const seqAtSend = localChangeSeq;
  try {
    const res = await fetch(`${API_BASE}/sessions/${sessionToken}/board`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionBoardPayload()),
    });

    // The user may have left the session while this push was in flight.
    // Adopting the response now would resurrect the session UI and clobber
    // the personal board restored on exit.
    if (!sessionToken) return;

    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      if (!sessionToken) return;
      if (data.session) {
        // Re-pull gave us the fresh version; keep the local board (whole-
        // board last-write-wins) and retry once.
        sessionState = { ...data.session, board: sessionState.board };
        updateSessionBanner();
      }
      if (attempt < 1) return pushSessionBoard(attempt + 1);
      clearTimeout(sessionPushTimer);
      sessionPushTimer = setTimeout(() => pushSessionBoard(), 1000);
      return;
    }
    if (res.status === 410) {
      const data = await res.json().catch(() => ({}));
      if (!sessionToken) return;
      if (data.session) sessionState = data.session;
      onSessionEnded();
      return;
    }
    if (res.status === 401 || res.status === 403) {
      if (!sessionToken) return;
      stopSessionPolling();
      exitSession();
      await alertDialog('You no longer have access to this session.');
      return;
    }
    if (!res.ok) throw new Error(`Sync failed (${res.status})`);

    const data = await res.json();
    if (!sessionToken) return;
    sessionState = data;
    if (localChangeSeq === seqAtSend) {
      if (dragItem) {
        // Don't rebuild the board in the middle of a drag; the queued push
        // from the drop will reconcile everything once the drag is over.
        sessionDirty = false;
        if (data.board && data.board.catalog) {
          sessionCatalog = data.board.catalog;
        }
        updateSessionBanner();
        if (data.mode === 'split') updatePeerView();
      } else {
        // Adopt the server's merged view (e.g. images another member added
        // to a split session's catalogue while this push was in flight).
        applyingRemote = true;
        applySessionState(data);
        render();
        applyingRemote = false;
      }
    } else {
      if (data.board && data.board.catalog) {
        sessionCatalog = data.board.catalog;
      }
      scheduleSessionPush(); // edits landed while this push was in flight
      updateSessionBanner();
    }
  } catch (err) {
    console.warn('Session sync failed:', err);
    // Keep the pending state and retry instead of silently diverging.
    if (sessionToken && sessionState && sessionState.status === 'open') {
      clearTimeout(sessionPushTimer);
      sessionPushTimer = setTimeout(() => pushSessionBoard(), 3000);
    }
  }
}

// Delete an image from the shared session board for good. Permission is
// enforced server-side (host-only while split-screen, any member in co-op).
// The removal is tombstoned, so our own stale push cannot undo it either.
async function removeFromSession(img) {
  if (!sessionToken) return;
  const owner = Number.isInteger(img.owner) ? img.owner : ME;
  try {
    const res = await fetch(`${API_BASE}/sessions/${sessionToken}/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refs: [{ owner, id: img.id }] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!sessionToken) return;
    if (!res.ok) {
      await alertDialog(data.error
        || `Could not delete the image (${res.status})`);
      return;
    }
    if (sessionDirty) {
      // Keep pending local edits; the server tombstone keeps the removed
      // ref out of the next push.
      removeImageFromEverywhere(img.id);
      sessionCatalog = sessionCatalog.filter(ref => !(
        ref.id === img.id && Number(ref.owner) === owner));
      render();
    } else {
      applyingRemote = true;
      applySessionState(data);
      render();
      applyingRemote = false;
    }
  } catch (_) {
    // transient network failure — the next poll reconciles the board
  }
}

function presenceKey(presence) {
  if (!presence) return '';
  return Object.keys(presence).sort().map(uid => {
    const entry = presence[uid];
    return `${uid}:${entry.x}:${entry.y}:`
      + (entry.image ? refKey(entry.image) : '');
  }).join('|');
}

// Draw other members' drag cursors. The ghost is loaded through the same
// board-gated image route as the board, so it only shows refs we could
// already see.
function renderRemoteCursors() {
  if (!sessionCursorsEl) return;
  sessionCursorsEl.innerHTML = '';
  if (!sessionToken || !sessionState) return;
  Object.keys(sessionPresence).forEach(uid => {
    if (Number(uid) === ME) return;
    const entry = sessionPresence[uid];
    if (!entry || !entry.image) return;
    const cursor = document.createElement('div');
    cursor.className = 'remote-cursor';
    cursor.style.left = `${entry.x}px`;
    cursor.style.top = `${entry.y}px`;

    const image = document.createElement('img');
    image.className = 'remote-drag-ghost';
    image.src = sessionImageUrl(entry.image.owner, entry.image.id, 'thumb');
    image.alt = '';
    image.draggable = false;
    cursor.appendChild(image);

    const label = document.createElement('span');
    label.className = 'remote-cursor-label';
    label.textContent = entry.username || `user ${uid}`;
    cursor.appendChild(label);

    sessionCursorsEl.appendChild(cursor);
  });
}

// Coalesce drag movement into ~10 presence posts per second. Presence is
// best-effort: failures are ignored and stale entries expire server-side.
function sendPresence() {
  if (!sessionToken || !sessionState || sessionState.status !== 'open') return;
  presencePending = true;
  if (presenceTimer) return;
  presenceTimer = setTimeout(async () => {
    presenceTimer = null;
    if (!sessionToken || !sessionState
        || sessionState.status !== 'open') {
      presencePending = false;
      return;
    }
    const body = JSON.stringify({
      image: presenceRef,
      x: presenceXY.x,
      y: presenceXY.y,
    });
    presencePending = false;
    try {
      await fetch(`${API_BASE}/sessions/${sessionToken}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (_) {
      // ignore — presence is best-effort
    }
    if (presencePending) sendPresence();
  }, PRESENCE_SEND_MS);
}

function onSessionEnded() {
  stopSessionPolling();
  clearTimeout(sessionPushTimer);
  sessionPushTimer = null;
  clearTimeout(presenceTimer);
  presenceTimer = null;
  presencePending = false;
  presenceRef = null;
  sessionDirty = false;
  sessionPresence = {};
  renderRemoteCursors();
  document.body.classList.add('session-ended');
  updateSessionBanner();
  document.getElementById('peerView').hidden = true;
}

function enterSessionState(state) {
  sessionToken = state.token;
  sessionState = state;
  sessionPresence = {};
  presenceRef = null;
  document.body.classList.add('in-session');
  document.body.classList.toggle('session-split', state.mode === 'split');
  document.body.classList.toggle(
    'session-host', !!(ME && state.hostId === ME));
  document.body.classList.remove('session-ended');
  // The banner owns the session title; don't let edits to the personal
  // title box silently vanish when the personal board is restored on exit.
  const titleEl = document.getElementById('tierTitle');
  if (titleEl) {
    titleEl.value = state.title || '';
    titleEl.readOnly = true;
    titleEl.title = 'Session title — your own title returns after you leave.';
  }
  applyingRemote = true;
  applySessionState(state);
  render();
  applyingRemote = false;
  renderRemoteCursors();
  startSessionPolling();
}

async function enterSessionFromLink(token) {
  try {
    const res = await fetch(`${API_BASE}/sessions/${token}/join`, {
      method: 'POST',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Could not join the session (${res.status})`);
    }
    enterSessionState(data);
    return true;
  } catch (err) {
    await alertDialog('Could not join the session: ' + err.message);
    return false;
  }
}

function exitSession() {
  stopSessionPolling();
  clearTimeout(sessionPushTimer);
  sessionPushTimer = null;
  clearTimeout(presenceTimer);
  presenceTimer = null;
  presencePending = false;
  presenceRef = null;
  sessionPresence = {};
  renderRemoteCursors();
  sessionToken = null;
  sessionState = null;
  sessionCatalog = [];
  sessionDirty = false;
  applyingRemote = false;
  document.body.classList.remove(
    'in-session', 'session-split', 'session-ended', 'session-host');
  history.replaceState(null, '', location.pathname);
  document.getElementById('sessionBanner').hidden = true;
  document.getElementById('peerView').hidden = true;
  document.getElementById('peerToggleBtn').textContent = 'Peer rankings';

  // Restore the personal board parked in IndexedDB while in the session.
  // Settings changed during the session stay in effect (they're local
  // preferences, not part of the shared board).
  const currentSettings = { ...settings };
  tiers = DEFAULT_TIERS.map(t => ({ ...t, images: [] }));
  pool = [];
  const titleEl = document.getElementById('tierTitle');
  if (titleEl) {
    titleEl.value = '';
    titleEl.readOnly = false;
    titleEl.title = '';
  }
  loadAutosave().then(() => {
    settings = { ...settings, ...currentSettings };
    applySettings();
    render();
  });
}

async function leaveSession() {
  if (!sessionToken) return;
  if (sessionState && sessionState.status === 'open' && !isSessionHost()) {
    try {
      await fetch(`${API_BASE}/sessions/${sessionToken}/leave`, {
        method: 'POST',
      });
    } catch (_) {
      // best effort — leaving locally must never be blocked
    }
  }
  exitSession();
}

async function endSession() {
  if (!sessionToken || !isSessionHost()) return;
  if (!(await confirmDialog('End this session for everyone?',
                            { danger: true }))) return;
  try {
    const res = await fetch(`${API_BASE}/sessions/${sessionToken}/end`, {
      method: 'POST',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Could not end the session (${res.status})`);
    }
    sessionState = data;
    onSessionEnded();
  } catch (err) {
    await alertDialog('Could not end the session: ' + err.message);
  }
}

async function copyInviteLink() {
  if (!sessionToken) return;
  const url = `${location.origin}${location.pathname}?s=${sessionToken}`;
  try {
    await navigator.clipboard.writeText(url);
    const btn = document.getElementById('copyInviteBtn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch (_) {
    await promptDialog('Copy this invite link:', {
      title: 'Invite link', okText: 'Done', default: url,
    });
  }
}

function closeSessionModal() {
  document.getElementById('sessionModalOverlay').hidden = true;
}

document.getElementById('multiplayerBtn').addEventListener('click', () => {
  if (!ME) {
    alertDialog('Sign in to start a multiplayer session.');
    return;
  }
  const titleInput = document.getElementById('sessionTitleInput');
  titleInput.value = document.getElementById('tierTitle').value.trim();
  document.querySelector(
    'input[name="sessionMode"][value="coop"]').checked = true;
  document.getElementById('sessionModalOverlay').hidden = false;
  titleInput.focus();
  titleInput.select();
});

document.getElementById('sessionModalClose').addEventListener('click', closeSessionModal);
document.getElementById('sessionModalCancel').addEventListener('click', closeSessionModal);
document.getElementById('sessionModalOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('sessionModalOverlay')) closeSessionModal();
});

document.getElementById('createSessionBtn').addEventListener('click', async () => {
  const btn = document.getElementById('createSessionBtn');
  const modeEl = document.querySelector('input[name="sessionMode"]:checked');
  const payload = {
    mode: modeEl ? modeEl.value : 'coop',
    title: document.getElementById('sessionTitleInput').value.trim(),
    catalog: collectBoardRefs(tiers, pool),
    tiers: tiersToWire(),
    pool: pool.map(imageToRef),
  };

  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const res = await fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Could not create the session (${res.status})`);
    }
    closeSessionModal();
    history.replaceState(null, '', `${location.pathname}?s=${data.token}`);
    enterSessionState(data);
  } catch (err) {
    await alertDialog('Could not create the session: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

document.getElementById('copyInviteBtn').addEventListener('click', copyInviteLink);
document.getElementById('endSessionBtn').addEventListener('click', endSession);
document.getElementById('leaveSessionBtn').addEventListener('click', () => {
  if (sessionState && sessionState.status === 'ended') {
    exitSession();
  } else {
    leaveSession();
  }
});
document.getElementById('peerToggleBtn').addEventListener('click', () => {
  const panel = document.getElementById('peerView');
  const show = panel.hidden;
  if (show) updatePeerView();
  panel.hidden = !show;
  document.getElementById('peerToggleBtn').textContent =
    show ? 'Hide peer rankings' : 'Peer rankings';
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && sessionToken) pollSession();
});

// ── Ghost element for drag image ───────────────────────────────────
const ghost = document.createElement('div');
ghost.id = 'dragGhost';
ghost.style.cssText = 'position:fixed;top:-200px;left:-200px;width:72px;height:72px;pointer-events:none;z-index:9999;border-radius:4px;overflow:hidden;';
document.body.appendChild(ghost);

// ── Overlay for other members' drag cursors ────────────────────────
const sessionCursorsEl = document.createElement('div');
sessionCursorsEl.id = 'sessionCursors';
sessionCursorsEl.className = 'session-cursors';
document.body.appendChild(sessionCursorsEl);

// ── Init ───────────────────────────────────────────────────────────
// If a previous session exists (e.g. the browser crashed or the tab was
// closed/reloaded), silently restore it so nothing is lost. IndexedDB
// access is async, so the rest of setup waits on this IIFE.
(async () => {
  const token = new URLSearchParams(location.search).get('s');
  if (token && /^[0-9a-f]{32}$/.test(token) && ME) {
    if (await enterSessionFromLink(token)) {
      setupPoolDropZone();
      return;
    }
    history.replaceState(null, '', location.pathname);
  }

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