// PROTOTYPE — batch UI study for #2. Throwaway. Scanning is SIMULATED.
// Three structurally different variants of the batch upload + per-file progress UI,
// switchable via ?variant=A|B|C with a floating bottom bar.

const VARIANTS = {
  A: { name: 'List queue', render: renderA },
  B: { name: 'Card grid', render: renderB },
  C: { name: 'Focus + rail', render: renderC },
};
const ORDER = ['A', 'B', 'C'];

// --- tiny DOM helper --------------------------------------------------------
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) e.dataset[dk] = dv;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return e;
}

// --- shared state ------------------------------------------------------------
let _id = 0;
const seed = [
  { name: 'invoice-2024.pdf', pages: 4,  outcome: 'done',  codes: 2 },
  { name: 'tickets.pdf',      pages: 1,  outcome: 'done',  codes: 1 },
  { name: 'blank-form.pdf',   pages: 2,  outcome: 'empty' },
  { name: 'user-manual.pdf',  pages: 12, outcome: 'done',  codes: 5 },
  { name: 'scan-corrupt.pdf', pages: 3,  outcome: 'error' },
].map((f) => ({ id: ++_id, state: 'queued', page: 0, codes: 0, ...f }));

const state = { files: seed.slice(), scanning: false, cursor: null, finished: false };
let timer = null;

// --- shared helpers ----------------------------------------------------------
function statusText(f) {
  switch (f.state) {
    case 'queued': return 'Queued';
    case 'scanning': return f.page === 0 ? 'Starting…' : `Scanning p.${f.page}/${f.pages}`;
    case 'done': return `${f.codes} code${f.codes === 1 ? '' : 's'} found`;
    case 'empty': return 'No QR codes';
    case 'error': return 'Scan failed';
  }
}
function badge(f) {
  return h('span', { class: `fstate fstate--${f.state}` }, statusText(f));
}
function finishedCount() { return state.files.filter((f) => f.state !== 'queued' && f.state !== 'scanning').length; }
function isBusy() { return state.scanning; }

function fakePages(file) {
  if (file.size) return Math.min(40, Math.max(1, Math.round(file.size / 90000)));
  return 1 + Math.floor(Math.random() * 12);
}
function guessOutcome() { return Math.random() < 0.18 ? 'empty' : 'done'; }

function addFiles(fileList) {
  if (isBusy()) return;
  const names = new Set(state.files.map((f) => f.name));
  for (const file of fileList) {
    if (names.has(file.name)) continue;
    names.add(file.name);
    state.files.push({
      id: ++_id, name: file.name, pages: fakePages(file),
      state: 'queued', page: 0, codes: 0,
      outcome: guessOutcome(),
      codesPlanned: 1 + Math.floor(Math.random() * 3),
    });
  }
  state.finished = false;
  rerender();
}

function removeFile(id) {
  if (isBusy()) return;
  state.files = state.files.filter((f) => f.id !== id);
  rerender();
}
function clearAll() {
  if (isBusy()) return;
  stopScan();
  state.files = [];
  state.finished = false;
  rerender();
}

function scanAll() {
  if (isBusy() || state.files.length === 0) return;
  stopScan();
  for (const f of state.files) { f.state = 'queued'; f.page = 0; f.codes = 0; }
  state.finished = false;
  state.scanning = true;
  state.cursor = 0;
  state.files[0].state = 'scanning';
  rerender();
  scheduleTick();
}
function stopScan() {
  if (timer) { clearTimeout(timer); timer = null; }
  state.scanning = false;
  state.cursor = null;
}

function scheduleTick() {
  const f = state.files[state.cursor];
  const stepMs = f.pages > 8 ? 70 : 110;
  timer = setTimeout(tick, stepMs);
}
function tick() {
  if (!state.scanning) return;
  const f = state.files[state.cursor];
  f.page = Math.min(f.pages, f.page + 1);
  if (f.page >= f.pages) {
    // finalize this file
    if (f.outcome === 'done') { f.state = 'done'; f.codes = f.codesPlanned ?? 1; }
    else if (f.outcome === 'empty') { f.state = 'empty'; f.codes = 0; }
    else { f.state = 'error'; f.codes = 0; }
    state.cursor++;
    if (state.cursor >= state.files.length) {
      state.scanning = false;
      state.cursor = null;
      state.finished = true;
      rerender();
    } else {
      state.files[state.cursor].state = 'scanning';
      rerender();
      scheduleTick();
    }
  } else {
    liveUpdate && liveUpdate(f);
    scheduleTick();
  }
}

// --- shared UI bits ----------------------------------------------------------
function makeDropZone(onFiles, { cardStyle = false } = {}) {
  const input = h('input', { type: 'file', accept: 'application/pdf', multiple: true, class: 'drop-zone__input' });
  input.addEventListener('change', () => { if (input.files.length) onFiles(input.files); input.value = ''; });
  let zone;
  if (cardStyle) {
    zone = h('label', { class: 'add-card' },
      h('svg', { xmlns: 'http://www.w3.org/2000/svg', width: 28, height: 28, fill: 'currentColor', viewBox: '0 0 16 16', html: '<path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2Z"/>' }),
      h('span', { class: 'add-card__hint' }, 'Add PDFs'),
      input,
    );
  } else {
    zone = h('label', { class: 'drop-zone' },
      h('span', { class: 'drop-zone__hint', html: 'Drag PDFs here, or <span class="drop-zone__browse">browse</span>' }),
      input,
    );
  }
  const onDragOver = (e) => { e.preventDefault(); zone.classList.add('is-dragover'); };
  const onDragLeave = () => zone.classList.remove('is-dragover');
  const onDrop = (e) => {
    e.preventDefault(); zone.classList.remove('is-dragover');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) onFiles(files);
  };
  zone.addEventListener('dragenter', onDragOver);
  zone.addEventListener('dragover', onDragOver);
  zone.addEventListener('dragleave', onDragLeave);
  zone.addEventListener('drop', onDrop);
  return zone;
}

function aggregateBar() {
  const done = finishedCount();
  const total = state.files.length;
  const pct = total ? (done / total) * 100 : 0;
  return h('div', { class: 'batch-bar' },
    h('p', { class: 'batch-bar__label', html: `<span class="batch-bar__counter">${done}</span> of ${total} files done` }),
    h('div', { class: 'scan-progress__track' },
      h('div', { class: 'scan-progress__fill', style: `width:${pct}%` }),
    ),
  );
}

function controlsBar({ dropZone = null, hint }) {
  const scanBtn = h('button', { class: 'btn btn-primary scan-card__button', type: 'button', onClick: scanAll, disabled: isBusy() || state.files.length === 0 }, 'Scan all');
  const clearBtn = h('button', { class: 'btn btn-outline-secondary', type: 'button', onClick: clearAll, disabled: isBusy() }, 'Clear');
  const kids = [scanBtn, clearBtn, h('span', { class: 'batch-controls__hint' }, hint)];
  if (dropZone) kids.unshift(dropZone);
  return h('div', { class: 'batch-controls' }, h('div', { class: 'batch-controls__spacer' }), ...kids);
}

function zipReadyBanner() {
  const done = state.files.filter((f) => f.state === 'done').length;
  const empty = state.files.filter((f) => f.state === 'empty').length;
  const err = state.files.filter((f) => f.state === 'error').length;
  const bits = [`${done} CSV${done === 1 ? '' : 's'}`];
  if (empty) bits.push(`${empty} empty skipped`);
  if (err) bits.push(`${err} failed`);
  const btn = h('button', { class: 'btn btn-success zip-ready__btn', type: 'button',
    onClick: () => { btn.textContent = 'Downloaded ✓'; btn.disabled = true; console.log('[prototype] ZIP would download:', state.files.filter(f=>f.state==='done').map(f=>f.name.replace(/\.pdf$/i,'.csv'))); } },
    'Download ZIP');
  return h('div', { class: 'zip-ready' },
    h('span', null, `ZIP ready — ${bits.join(' · ')}`),
    btn,
  );
}

// --- Variant A — list queue --------------------------------------------------
function renderA() {
  const dropZone = makeDropZone(addFiles);
  const list = h('ul', { class: 'file-list' });
  const refs = {};

  for (const f of state.files) {
    const bar = h('div', { class: 'scan-progress__track filebar' },
      h('div', { class: 'scan-progress__fill', dataset: { fileBar: f.id }, style: `width:${(f.page / f.pages) * 100}%` }));
    const row = h('li', { class: `file-row is-${f.state}`, dataset: { file: f.id } },
      h('div', { class: 'file-row__top' },
        h('span', { class: 'file-row__name' }, f.name),
        h('span', { class: 'file-row__meta' }, `${f.pages}p`),
      ),
      h('div', { class: 'file-row__bar' }, bar),
      h('div', { style: 'display:flex;align-items:center;gap:.5rem' },
        badgeWithSlot(f),
        f.state === 'queued' && !isBusy() ? h('button', { class: 'file-remove', 'aria-label': 'Remove', onClick: () => removeFile(f.id) }, '×') : null,
      ),
    );
    list.appendChild(row);
  }

  function badgeWithSlot(f) {
    const b = badge(f);
    b.dataset.fileStatus = f.id;
    return b;
  }

  const root = h('div', { class: 'v-a' },
    dropZone,
    state.files.length ? aggregateBar() : null,
    controlsBar({ hint: 'Files scan one at a time. ZIP builds on completion.' }),
    state.files.length ? list : h('p', { class: 'batch-empty' }, 'No files yet — drop or browse to add some.'),
    state.finished ? zipReadyBanner() : null,
  );

  function update(f) {
    const fill = root.querySelector(`[data-file-bar="${f.id}"]`);
    if (fill) fill.style.width = `${(f.page / f.pages) * 100}%`;
    const st = root.querySelector(`[data-file-status="${f.id}"]`);
    if (st) { st.className = `fstate fstate--${f.state}`; st.textContent = statusText(f); }
  }
  return { el: root, update };
}

// --- Variant B — card grid ---------------------------------------------------
const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;
function ringSvg(pct, f) {
  return h('svg', { class: 'file-card__ring', viewBox: '0 0 56 56', xmlns: 'http://www.w3.org/2000/svg' },
    h('circle', { class: 'track', cx: 28, cy: 28, r: RING_R }),
    h('circle', { class: 'fill', cx: 28, cy: 28, r: RING_R,
      'stroke-dasharray': RING_C, 'stroke-dashoffset': RING_C * (1 - pct),
      dataset: { fileRing: f.id } }),
  );
}
function renderB() {
  const grid = h('div', { class: 'file-grid' });
  const addCard = makeDropZone(addFiles, { cardStyle: true });
  grid.appendChild(addCard);
  for (const f of state.files) {
    const pct = (f.page / f.pages);
    const card = h('div', { class: `file-card is-${f.state}`, dataset: { file: f.id } },
      f.state === 'queued' && !isBusy() ? h('button', { class: 'file-remove', 'aria-label': 'Remove', onClick: () => removeFile(f.id) }, '×') : null,
      h('svg', { class: 'file-card__icon', xmlns: 'http://www.w3.org/2000/svg', width: 28, height: 28, fill: 'currentColor', viewBox: '0 0 16 16', html: '<path d="M14 4.5V14a2 2 0 0 1-2 2h-1v-1h1a1 1 0 0 0 1-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v9H2V2a2 2 0 0 1 2-2h5.5zM1.6 11.85H0v3.999h.791v-1.342h.803q.43 0 .732-.173.305-.175.463-.474a1.4 1.4 0 0 0 .161-.677q0-.375-.158-.677a1.2 1.2 0 0 0-.46-.477q-.3-.18-.732-.179m.545 1.333a.8.8 0 0 1-.085.38.57.57 0 0 1-.238.241.8.8 0 0 1-.375.082H.788V12.48h.66q.327 0 .512.181.185.183.185.522m1.217-1.333v3.999h1.46q.602 0 .998-.237a1.45 1.45 0 0 0 .595-.689q.196-.45.196-1.084 0-.63-.196-1.075a1.43 1.43 0 0 0-.589-.68q-.396-.234-1.005-.234zm.791.645h.563q.371 0 .609.152a.9.9 0 0 1 .354.454q.118.302.118.753a2.3 2.3 0 0 1-.068.592 1.1 1.1 0 0 1-.196.422.8.8 0 0 1-.334.252 1.3 1.3 0 0 1-.483.082h-.563zm3.743 1.763v1.591h-.79V11.85h2.548v.653H7.896v1.117h1.606v.638z"/>' }),
      h('span', { class: 'file-card__name' }, f.name),
      ringSvg(pct, f),
      h('span', { class: 'file-card__pct', dataset: { filePct: f.id } }, `${Math.round(pct * 100)}%`),
      badgeWith(f),
      h('span', { class: 'file-card__codes' }, f.state === 'done' ? `${f.codes} code${f.codes === 1 ? '' : 's'}` : `${f.pages} pages`),
    );
    grid.appendChild(card);
  }
  function badgeWith(f) {
    const b = badge(f);
    b.dataset.fileStatus = f.id;
    return b;
  }
  const root = h('div', { class: 'v-b' },
    controlsBar({ hint: 'Each card is one file. ZIP builds on completion.' }),
    state.files.length ? aggregateBar() : null,
    grid,
    state.finished ? zipReadyBanner() : null,
  );
  function update(f) {
    const pct = f.page / f.pages;
    const ring = root.querySelector(`[data-file-ring="${f.id}"]`);
    if (ring) ring.style.strokeDashoffset = RING_C * (1 - pct);
    const pctEl = root.querySelector(`[data-file-pct="${f.id}"]`);
    if (pctEl) pctEl.textContent = `${Math.round(pct * 100)}%`;
    const st = root.querySelector(`[data-file-status="${f.id}"]`);
    if (st) { st.className = `fstate fstate--${f.state}`; st.textContent = statusText(f); }
  }
  return { el: root, update };
}

// --- Variant C — focus + rail ------------------------------------------------
function renderC() {
  const dropZone = makeDropZone(addFiles);
  const cur = state.cursor != null ? state.files[state.cursor] : null;

  const panel = h('div', { class: 'focus-panel' });
  if (cur) {
    const pct = (cur.page / cur.pages) * 100;
    panel.appendChild(h('p', { class: 'focus-panel__pos', html: `File <strong>${state.cursor + 1}</strong> of ${state.files.length}` }));
    panel.appendChild(h('p', { class: 'focus-panel__name' }, cur.name));
    const bar = h('div', { class: 'focus-panel__bar scan-progress__track' },
      h('div', { class: 'scan-progress__fill', dataset: { fileBar: cur.id }, style: `width:${pct}%` }));
    panel.appendChild(bar);
    const st = badge(cur); st.dataset.fileStatus = cur.id;
    panel.appendChild(h('p', { class: 'focus-panel__codes' }, st));
  } else if (state.finished) {
    panel.appendChild(h('p', { class: 'focus-panel__pos', html: `Done — <strong>${state.files.length}</strong> files` }));
    panel.appendChild(state.finished ? zipReadyBanner() : null);
  } else {
    panel.appendChild(h('p', { class: 'focus-panel__idle' }, 'Add files and press Scan all to begin.'));
  }

  const rail = h('div', { class: 'rail' });
  for (const f of state.files) {
    const isCur = cur && f.id === cur.id;
    const pct = (f.page / f.pages) * 100;
    const st = badge(f); st.dataset.fileStatusRail = f.id;
    rail.appendChild(h('div', { class: `rail__item is-${f.state}${isCur ? ' is-active' : ''}`, dataset: { file: f.id } },
      h('span', { class: 'rail__dot' }),
      h('div', null,
        h('div', { class: 'rail__name' }, f.name),
        h('div', { class: 'rail__mini' }, h('span', { dataset: { fileMini: f.id }, style: `width:${pct}%` })),
      ),
      h('span', { class: 'rail__meta', dataset: { fileMeta: f.id } }, `${f.pages}p · ${statusText(f)}`),
    ));
  }

  const root = h('div', { class: 'v-c' },
    dropZone,
    controlsBar({ hint: 'One file in focus at a time; the rail tracks the rest.' }),
    state.files.length ? h('div', { class: 'focus-layout' }, panel, rail) : h('p', { class: 'batch-empty' }, 'No files yet — drop or browse to add some.'),
  );
  function update(f) {
    const fill = root.querySelector(`[data-file-bar="${f.id}"]`);
    if (fill) fill.style.width = `${(f.page / f.pages) * 100}%`;
    const st = root.querySelector(`[data-file-status="${f.id}"]`);
    if (st) { st.className = `fstate fstate--${f.state}`; st.textContent = statusText(f); }
    const meta = root.querySelector(`[data-file-meta="${f.id}"]`);
    if (meta) meta.textContent = `${f.pages}p · ${statusText(f)}`;
    const mini = root.querySelector(`[data-file-mini="${f.id}"]`);
    if (mini) mini.style.width = `${(f.page / f.pages) * 100}%`;
  }
  return { el: root, update };
}

// --- controller --------------------------------------------------------------
const mount = document.getElementById('mount');
const switcher = document.getElementById('switcher');
const label = document.getElementById('switcherLabel');
let current = null;
let liveUpdate = null;

function rerender() {
  mount.innerHTML = '';
  const { el, update } = VARIANTS[current].render();
  mount.appendChild(el);
  liveUpdate = update;
}

function setVariant(key) {
  current = key;
  const url = new URL(location.href);
  url.searchParams.set('variant', key);
  history.replaceState({}, '', url);
  label.innerHTML = `<strong>${key}</strong> — ${VARIANTS[key].name}`;
  rerender();
}

document.getElementById('switcherPrev').addEventListener('click', () => {
  const i = ORDER.indexOf(current);
  setVariant(ORDER[(i - 1 + ORDER.length) % ORDER.length]);
});
document.getElementById('switcherNext').addEventListener('click', () => {
  const i = ORDER.indexOf(current);
  setVariant(ORDER[(i + 1) % ORDER.length]);
});
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target.isContentEditable) return;
  if (e.key === 'ArrowLeft') document.getElementById('switcherPrev').click();
  if (e.key === 'ArrowRight') document.getElementById('switcherNext').click();
});

const initial = new URLSearchParams(location.search).get('variant');
setVariant(ORDER.includes(initial) ? initial : 'A');
switcher.hidden = false;
