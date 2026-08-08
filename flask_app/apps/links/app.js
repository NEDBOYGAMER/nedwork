/* ==============================================================
   LINK MANAGER — backed by the Flask /list /save /delete API
   ============================================================== */

// ---- API base ----
// window.APP_NAME is injected by links.html so this file can call
// the right blueprint without any templating of its own.
const API_BASE = `/apps/${window.APP_NAME || 'links'}`;

// ---- State ----
/*
Structure
[
  { id: "a1b2c3", title: "name", url: "https://nedwork.ch", desc: "description",
    tags: ["tag1", "tag2", ...], createdAt: 1690000000000 },
  ...
]
*/

let links = [];
let editingId = null;
let searchQuery = '';
let activeTag = '__all__';
let loading = true;

// ---- DOM refs ----
const linkListEl = document.getElementById('linkList');
const searchInput = document.getElementById('searchInput');
const tagFilterBar = document.getElementById('tagFilterBar');
const totalCountEl = document.getElementById('totalCount');
const filteredCountEl = document.getElementById('filteredCount');
const linkCountDisplay = document.getElementById('linkCountDisplay');
const tagCountDisplay = document.getElementById('tagCountDisplay');

const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const modalSub = document.getElementById('modalSub');
const linkTitle = document.getElementById('linkTitle');
const linkUrl = document.getElementById('linkUrl');
const linkDesc = document.getElementById('linkDesc');
const linkTags = document.getElementById('linkTags');
const modalSaveBtn = document.getElementById('modalSaveBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const addLinkBtn = document.getElementById('addLinkBtn');

const toastContainer = document.getElementById('toastContainer');

// ---- Theme / accent ----
const themeSwitch = document.getElementById('themeSwitch');
const themeLabel = document.getElementById('themeLabel');
themeSwitch.addEventListener('change', () => {
  const t = themeSwitch.checked ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  themeLabel.textContent = t === 'dark' ? 'Dark' : 'Light';
});
document.querySelectorAll('.accent-dot').forEach(dot => {
  dot.addEventListener('click', () => {
    document.documentElement.setAttribute('data-accent', dot.dataset.accent);
    document.querySelectorAll('.accent-dot').forEach(d => d.classList.remove('active'));
    dot.classList.add('active');
  });
});

// ---- Helpers ----
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return new Date(ts).toLocaleDateString();
}

function getFaviconFallback(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace('www.', '');
    // Icon Horse: returns HTTP 200 + placeholder for ANY domain,
    // so missing favicons never trigger a 404 in the console.
    return `https://icon.horse/icon/${host}`;
  } catch { return ''; }
}

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
}

// ---- API ----
async function apiRequest(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  // The backend redirects to the login page when the session is invalid.
  if (res.redirected) {
    window.location.href = res.url;
    return null;
  }

  let body = null;
  try { body = await res.json(); } catch { /* no body */ }

  if (!res.ok) {
    const message = (body && body.error) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

async function loadLinks() {
  loading = true;
  renderLinks();
  try {
    const data = await apiRequest('/list');
    if (data) links = data.links || [];
  } catch (err) {
    showToast(err.message || 'Could not load your links', 'danger');
  } finally {
    loading = false;
    renderAll();
  }
}

// ---- Filter logic ----
function getFilteredLinks() {
  let filtered = links;
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    filtered = filtered.filter(l =>
      l.title.toLowerCase().includes(q) ||
      l.url.toLowerCase().includes(q) ||
      (l.desc || '').toLowerCase().includes(q) ||
      l.tags.some(t => t.toLowerCase().includes(q))
    );
  }
  if (activeTag !== '__all__') {
    filtered = filtered.filter(l => l.tags.includes(activeTag));
  }
  return filtered.slice().sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  );
}

function getAllTags() {
  const set = new Set();
  links.forEach(l => l.tags.forEach(t => set.add(t)));
  return Array.from(set).sort();
}

function updateStats() {
  totalCountEl.textContent = links.length;
  const filtered = getFilteredLinks();
  filteredCountEl.textContent = filtered.length;
  linkCountDisplay.textContent = `${links.length} saved`;

  const allTags = getAllTags();
  if (allTags.length > 0) {
    tagCountDisplay.textContent = `🏷 ${allTags.length} tag${allTags.length > 1 ? 's' : ''}`;
  } else {
    tagCountDisplay.textContent = '';
  }
}

function renderTagFilters() {
  const allTags = getAllTags();
  let html = `<div class="tag-filter ${activeTag === '__all__' ? 'active' : ''}" data-tag="__all__">All</div>`;
  allTags.forEach(t => {
    const count = links.filter(l => l.tags.includes(t)).length;
    html += `<div class="tag-filter ${activeTag === t ? 'active' : ''}" data-tag="${t}">${t} (${count})</div>`;
  });
  tagFilterBar.innerHTML = html;

  tagFilterBar.querySelectorAll('.tag-filter').forEach(el => {
    el.addEventListener('click', () => {
      const tag = el.dataset.tag;
      activeTag = tag;
      renderTagFilters();
      renderLinks();
    });
  });
}

// ---- Render ----
function renderLinks() {
  if (loading) {
    linkListEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⏳</div>
        <h3>Loading your links…</h3>
      </div>
    `;
    return;
  }

  const filtered = getFilteredLinks();
  if (filtered.length === 0) {
    linkListEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔗</div>
        <h3>${links.length === 0 ? 'No links yet' : 'No matching links'}</h3>
        <p>${links.length === 0 ? 'Click "+ New link" to add your first bookmark.' : 'Try a different search or tag filter.'}</p>
        ${links.length === 0 ? `<button class="btn btn-primary" onclick="document.getElementById('addLinkBtn').click()">+ New link</button>` : ''}
      </div>
    `;
    updateStats();
    return;
  }

  let html = '';
  filtered.forEach(l => {
    const domain = getDomain(l.url);
    const favicon = getFaviconFallback(l.url);
    const tagsHtml = l.tags.map(t =>
      `<span class="tag-pill" data-tag="${t}">${t}</span>`
    ).join('');
    const titleAttr = l.desc ? ` title="${escHtml(l.desc)}"` : '';

    html += `
      <div class="link-card" data-id="${l.id}" data-url="${escHtml(l.url)}" tabindex="0" role="link"${titleAttr}>
        <div class="link-icon">
          ${favicon ? `<img src="${favicon}" alt="" style="width:14px;height:14px;border-radius:3px;" onerror="this.parentElement.textContent='🔗'">` : '🔗'}
        </div>
        <div class="link-main">
          <span class="link-title">${escHtml(l.title)}</span>
          <a href="${escHtml(l.url)}" target="_blank" rel="noopener" class="link-url" onclick="event.stopPropagation()">${escHtml(domain)}</a>
        </div>
        <div class="link-meta">${tagsHtml}</div>
        <span class="link-date">${timeAgo(l.createdAt)}</span>
        <div class="link-actions">
          <button class="btn btn-ghost btn-sm edit-btn" data-id="${l.id}" title="Edit">✎</button>
          <button class="btn btn-danger btn-sm delete-btn" data-id="${l.id}" title="Delete">✕</button>
        </div>
      </div>
    `;
  });

  linkListEl.innerHTML = html;

  linkListEl.querySelectorAll('.link-card').forEach(el => {
    const open = () => window.open(el.dataset.url, '_blank', 'noopener');
    el.addEventListener('click', (e) => {
      if (e.target.closest('.link-actions') || e.target.closest('.tag-pill') || e.target.closest('.link-url')) return;
      open();
    });
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.link-actions, .tag-pill, .link-url')) {
        e.preventDefault();
        open();
      }
    });
  });

  linkListEl.querySelectorAll('.tag-pill').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('.tag-remove')) return;
      const tag = el.dataset.tag;
      activeTag = tag;
      renderTagFilters();
      renderLinks();
    });
  });

  linkListEl.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openEdit(btn.dataset.id); });
  });

  linkListEl.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteLink(btn.dataset.id); });
  });

  updateStats();
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---- CRUD (all persisted through the backend) ----
async function addLink(title, url, desc, tags) {
  try {
    const data = await apiRequest('/save', {
      method: 'POST',
      body: JSON.stringify({ title, url, desc, tags }),
    });
    if (!data) return;
    links.push(data.link);
    renderAll();
    showToast('Link saved', 'success');
  } catch (err) {
    showToast(err.message || 'Could not save link', 'danger');
  }
}

async function updateLink(id, title, url, desc, tags) {
  try {
    const data = await apiRequest('/save', {
      method: 'POST',
      body: JSON.stringify({ id, title, url, desc, tags }),
    });
    if (!data) return;
    const idx = links.findIndex(l => l.id === id);
    if (idx !== -1) links[idx] = data.link;
    renderAll();
    showToast('Link updated', 'success');
  } catch (err) {
    showToast(err.message || 'Could not update link', 'danger');
  }
}

async function deleteLink(id) {
  if (!confirm('Delete this link?')) return;
  try {
    const data = await apiRequest('/delete', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
    if (!data) return;
    links = links.filter(l => l.id !== id);
    if (activeTag !== '__all__' && !getAllTags().includes(activeTag)) {
      activeTag = '__all__';
    }
    renderAll();
    showToast('Link deleted', 'danger');
  } catch (err) {
    showToast(err.message || 'Could not delete link', 'danger');
  }
}

function renderAll() {
  renderTagFilters();
  renderLinks();
}

// ---- Modal ----
function openAdd() {
  editingId = null;
  modalTitle.textContent = 'New link';
  modalSub.textContent = 'Add a URL you want to keep handy.';
  linkTitle.value = '';
  linkUrl.value = '';
  linkDesc.value = '';
  linkTags.value = '';
  modalSaveBtn.textContent = 'Save link';
  modalBackdrop.classList.add('open');
  setTimeout(() => linkTitle.focus(), 100);
}

function openEdit(id) {
  const l = links.find(x => x.id === id);
  if (!l) return;
  editingId = id;
  modalTitle.textContent = 'Edit link';
  modalSub.textContent = 'Update your bookmark.';
  linkTitle.value = l.title;
  linkUrl.value = l.url;
  linkDesc.value = l.desc || '';
  linkTags.value = l.tags.join(', ');
  modalSaveBtn.textContent = 'Update link';
  modalBackdrop.classList.add('open');
  setTimeout(() => linkTitle.focus(), 100);
}

function closeModal() {
  modalBackdrop.classList.remove('open');
  editingId = null;
}

function saveFromModal() {
  const title = linkTitle.value.trim();
  const url = linkUrl.value.trim();
  const desc = linkDesc.value.trim();
  const rawTags = linkTags.value.trim();

  if (!title) { showToast('Title is required', 'danger'); linkTitle.focus(); return; }
  if (!url) { showToast('URL is required', 'danger'); linkUrl.focus(); return; }
  let finalUrl = url;
  if (!/^https?:\/\//i.test(url)) {
    finalUrl = 'https://' + url;
  }

  const tags = rawTags ? rawTags.split(',').map(t => t.trim()).filter(Boolean) : [];

  if (editingId) {
    updateLink(editingId, title, finalUrl, desc, tags);
  } else {
    addLink(title, finalUrl, desc, tags);
  }
  closeModal();
}

// ---- Toast ----
function showToast(msg, type) {
  const t = document.createElement('div');
  t.className = `toast ${type === 'success' ? 'toast-success' : type === 'danger' ? 'toast-danger' : ''}`;
  t.textContent = msg;
  toastContainer.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

// ---- Search ----
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  renderLinks();
});

// ---- Keyboard shortcuts ----
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
  }
  if (e.key === 'Escape') {
    if (modalBackdrop.classList.contains('open')) {
      closeModal();
    } else {
      searchInput.blur();
    }
  }
});

// ---- Event binding ----
addLinkBtn.addEventListener('click', openAdd);
modalCancelBtn.addEventListener('click', closeModal);
modalSaveBtn.addEventListener('click', saveFromModal);

modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) closeModal();
});

[linkTitle, linkUrl, linkDesc, linkTags].forEach(el => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveFromModal();
    }
  });
});

// ---- Init ----
loadLinks();

console.log('🔗 Link Manager loaded — persisted via the /list /save /delete API.');