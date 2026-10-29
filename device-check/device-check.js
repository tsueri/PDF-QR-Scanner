// device-check.js — throwaway harness for ticket #33 (wayfinder map #18).
//
// Serves itself from device-check/ over HTTPS (scripts/dev-https.mjs). Records
// browser facts into device-check/results/<label>.json via the dev server's
// POST endpoint. Nothing is uploaded unless the human taps "Send results".
//
// Results persist in localStorage as they are recorded, so a reload or a tab
// killed by the canvas probe does not lose earlier probes.

const $ = (sel, root = document) => root.querySelector(sel);
const STORE_KEY = 'device-check-v1';

// Canvas probe sizes: rectangles first (smaller backing stores), then squares
// ascending — the last two (12000², 16384²) are the ones that may kill the tab.
const PROBE_RECTS = [[4096, 8192], [8192, 4096]];
const PROBE_SQUARES = [2048, 4096, 6000, 8192, 10000, 12000, 16384];

const FIXTURES = {
    heic12: { file: 'photo-12mp.heic', type: 'image/heic', expected: '4032×3024' },
    jpeg12: { file: 'photo-12mp-qr-corner.jpg', type: 'image/jpeg', expected: '4000×3000' },
    jpeg48: { file: 'photo-48mp-qr-corner.jpg', type: 'image/jpeg', expected: '8000×6000' },
};

const state = {
    label: 'iphone-safari',
    device: {},
    tests: {
        bundled: {},                                   // heic12 / jpeg12 / jpeg48
        picker: { imageAccept: null, heicAccept: null },
        special: [],                                   // [{file, img, bitmap, kind}]
        capture: { files: [], cameraSetting: null },
        canvasProbe: { main: [], worker: [] },
        cameraNotes: {},
    },
};

// ── persistence ─────────────────────────────────────────────────────────────

function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
}

function load() {
    try {
        const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
        if (s && s.tests) {
            Object.assign(state, s);
            return true;
        }
    } catch (e) { /* corrupt store */ }
    return false;
}

// ── small helpers ───────────────────────────────────────────────────────────

function errText(err) { return String(err && (err.message || err)) || 'error'; }

function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function collectDevice() {
    return {
        userAgent: navigator.userAgent,
        platform: navigator.platform || null,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        deviceMemory: navigator.deviceMemory ?? null,      // Chromium only
        maxTouchPoints: navigator.maxTouchPoints ?? null,
        language: navigator.language,
        screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
}

// Read the first 16 bytes and identify the container. The Photos picker may
// silently convert HEIC → JPEG, so the sniff is the ground truth, not the name.
async function sniff(file) {
    const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (buf[0] === 0xFF && buf[1] === 0xD8) return 'JPEG';
    if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
        return 'HEIF brand ' + String.fromCharCode(...buf.slice(8, 12));
    }
    return 'unknown ' + Array.from(buf.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// ── decode paths ────────────────────────────────────────────────────────────

async function decodeViaImg(blob) {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try {
        await img.decode();
        return { ok: true, w: img.naturalWidth, h: img.naturalHeight };
    } catch (err) {
        return { ok: false, error: errText(err) };
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function decodeViaBitmap(blob, keep = false) {
    const t0 = performance.now();
    try {
        const bmp = await createImageBitmap(blob);
        const out = { ok: true, w: bmp.width, h: bmp.height, ms: Math.round(performance.now() - t0) };
        if (keep) out.bitmap = bmp; else bmp.close();
        return out;
    } catch (err) {
        return { ok: false, error: errText(err) };
    }
}

// The app pipeline decodes inside a worker, so the worker path is the one that
// matters. A fresh blob worker per test keeps the heap predictable.
const WORKER_SRC = `
self.onmessage = async (e) => {
    const msg = e.data;
    if (msg.type === 'bitmap') {
        const out = { type: 'bitmap', ok: false };
        try {
            const t0 = performance.now();
            const bmp = await createImageBitmap(msg.blob);
            out.ok = true; out.w = bmp.width; out.h = bmp.height;
            out.ms = Math.round(performance.now() - t0);
            bmp.close();
        } catch (err) { out.error = String(err && (err.message || err)); }
        self.postMessage(out);
    } else if (msg.type === 'probe') {
        const out = { type: 'probe', w: msg.w, h: msg.h, ok: false };
        try {
            const c = new OffscreenCanvas(msg.w, msg.h);
            const ctx = c.getContext('2d');
            if (!ctx) { out.error = 'getContext returned null'; self.postMessage(out); return; }
            ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, msg.w, msg.h);
            ctx.fillStyle = '#00ff00'; ctx.fillRect(msg.w / 2 - 32, msg.h / 2 - 32, 64, 64);
            const a = ctx.getImageData(0, 0, 32, 32);
            const b = ctx.getImageData(msg.w - 32, msg.h - 32, 32, 32);
            out.ok = true;
            out.blank = [a.data[0], a.data[1], a.data[2], b.data[0], b.data[1], b.data[2]]
                .every((v) => v === 0);
            out.sampleCorner = [a.data[0], a.data[1], a.data[2]];
            out.sampleCenter = [b.data[0], b.data[1], b.data[2]];
        } catch (err) { out.error = String(err && (err.message || err)); }
        self.postMessage(out);
    }
};
`;

function spawnWorker() {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    return new Worker(url);
}

function decodeViaBitmapWorker(blob) {
    return new Promise((resolve) => {
        const worker = spawnWorker();
        worker.onmessage = (e) => { worker.terminate(); resolve(e.data); };
        worker.onerror = (e) => { worker.terminate(); resolve({ ok: false, error: e.message || 'worker error' }); };
        worker.postMessage({ type: 'bitmap', blob });
    });
}

function probeCanvasWorker(worker, w, h) {
    return new Promise((resolve) => {
        worker.onmessage = (e) => resolve(e.data);
        worker.onerror = (e) => resolve({ w, h, ok: false, error: e.message || 'worker error' });
        worker.postMessage({ type: 'probe', w, h });
    });
}

async function fetchFixture(key) {
    const f = FIXTURES[key];
    const blob = await fetch('./fixtures/' + f.file).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching ' + f.file);
        return r.blob();
    });
    return new File([blob], f.file, { type: f.type });
}

// ── bundled decode tests ────────────────────────────────────────────────────

async function runDecodeTest(key, btn) {
    btn.disabled = true;
    btn.textContent = 'Running…';
    try {
        const file = await fetchFixture(key);
        const img = await decodeViaImg(file);
        const main = await decodeViaBitmap(file);
        const worker = await decodeViaBitmapWorker(file);
        let fullRead = null;
        if (key === 'jpeg48' && main.ok) {
            const kept = await decodeViaBitmap(file, true);
            const t0 = performance.now();
            try {
                const c = new OffscreenCanvas(kept.w, kept.h);
                const ctx = c.getContext('2d');
                ctx.drawImage(kept.bitmap, 0, 0);
                const id = ctx.getImageData(0, 0, kept.w, kept.h);
                fullRead = {
                    ok: true,
                    ms: Math.round(performance.now() - t0),
                    pixels: id.data.length / 4,
                    sample: [id.data[0], id.data[1], id.data[2]],
                };
            } catch (err) {
                fullRead = { ok: false, error: errText(err) };
            }
            kept.bitmap.close();
        }
        state.tests.bundled[key] = { expected: FIXTURES[key].expected, img, bitmapMain: main, bitmapWorker: worker, fullRead };
    } catch (err) {
        state.tests.bundled[key] = { expected: FIXTURES[key].expected, error: errText(err) };
    }
    save();
    render();
    btn.disabled = false;
    btn.textContent = FIXTURES[key].expected + ' — re-run tests';
}

// ── picker / capture tests ──────────────────────────────────────────────────

async function recordFile(f) {
    const out = {
        name: f.name,
        type: f.type || null,
        size: f.size,
        sniff: await sniff(f),
        img: await decodeViaImg(f),
        bitmap: await decodeViaBitmap(f),
    };
    save();
    return out;
}

function bindFileInput(id, handler) {
    $(id).addEventListener('change', async (e) => {
        if (!e.target.files.length) return;
        await handler(e.target.files);
        render();
    });
}

// ── canvas probes ───────────────────────────────────────────────────────────

async function probeCanvas(w, h) {
    const out = { w, h, bytes: w * h * 4, ok: false };
    try {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) { out.error = 'getContext returned null'; return out; }
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(w / 2 - 32, h / 2 - 32, 64, 64);
        const a = ctx.getImageData(0, 0, 32, 32);
        const b = ctx.getImageData(w - 32, h - 32, 32, 32);
        out.ok = true;
        out.blank = [a.data[0], a.data[1], a.data[2], b.data[0], b.data[1], b.data[2]]
            .every((v) => v === 0);
        out.sampleCorner = [a.data[0], a.data[1], a.data[2]];
        out.sampleCenter = [b.data[0], b.data[1], b.data[2]];
        c.width = 0;                        // release the backing store before the next probe
        c.height = 0;
    } catch (err) {
        out.error = errText(err);
    }
    return out;
}

async function runCanvasProbe(btn) {
    btn.disabled = true;
    btn.textContent = 'Running…';
    state.tests.canvasProbe = { main: [], worker: [] };
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const worker = spawnWorker();
    const workerSupportsOffscreen = worker && typeof OffscreenCanvas !== 'undefined';
    for (const [w, h] of PROBE_RECTS) {
        state.tests.canvasProbe.main.push(await probeCanvas(w, h));
        save(); render(); await nextFrame();
        if (workerSupportsOffscreen) {
            state.tests.canvasProbe.worker.push(await probeCanvasWorker(worker, w, h));
            save(); render(); await nextFrame();
        }
    }
    for (const s of PROBE_SQUARES) {
        state.tests.canvasProbe.main.push(await probeCanvas(s, s));
        save(); render(); await nextFrame();
        if (workerSupportsOffscreen) {
            state.tests.canvasProbe.worker.push(await probeCanvasWorker(worker, s, s));
            save(); render(); await nextFrame();
        }
    }
    worker.terminate();
    btn.disabled = false;
    btn.textContent = 'Re-run canvas probe';
}

// ── rendering ───────────────────────────────────────────────────────────────

function fmtRes(r) {
    if (!r) return '<span class="muted">—</span>';
    if (r.ok) return `<span class="ok">✓ ${r.w}×${r.h}${r.ms != null ? ` · ${r.ms} ms` : ''}</span>`;
    return `<span class="fail">✗ ${esc(r.error || 'failed')}</span>`;
}

function renderDevice() {
    const d = state.device;
    $('#device-out').innerHTML = [
        `User agent: <code>${esc(d.userAgent)}</code>`,
        `Platform: ${esc(d.platform || '—')} · touch points: ${d.maxTouchPoints ?? '—'} · cores: ${d.hardwareConcurrency ?? '—'}${d.deviceMemory != null ? ` · deviceMemory: ${d.deviceMemory} GB` : ''}`,
        `Screen: ${d.screen.w}×${d.screen.h} @ ${d.screen.dpr}x · tz: ${esc(d.timezone)}`,
    ].join('<br>');
}

function render() {
    renderDevice();
    renderBundled();
    renderPicker();
    renderSpecial();
    renderCapture();
    renderCanvas();
    renderCamera();
}

function renderBundled() {
    const rows = [
        ['heic12', '12 MP HEIC (4032×3024)'],
        ['jpeg12', '12 MP JPEG (4000×3000)'],
        ['jpeg48', '48 MP JPEG (8000×6000)'],
    ];
    let html = '';
    for (const [key, name] of rows) {
        const t = state.tests.bundled[key];
        if (!t) continue;
        html += `<tr><td>${name}</td><td>${fmtRes(t.img)}</td><td>${fmtRes(t.bitmapMain)}</td><td>${fmtRes(t.bitmapWorker)}</td></tr>`;
        if (t.fullRead) {
            html += `<tr><td>↳ full OffscreenCanvas read</td><td colspan="3">${fmtRes(t.fullRead)}</td></tr>`;
        }
    }
    $('#bundled-out').innerHTML = html
        ? `<table><tr><th>fixture</th><th>&lt;img&gt;</th><th>bitmap main</th><th>bitmap worker</th></tr>${html}</table>`
        : '<p class="muted">not run yet</p>';
}

function fileRow(label, rec) {
    if (!rec) return '';
    const img = rec.img && rec.img.ok ? `${rec.img.w}×${rec.img.h}` : '✗';
    const bmp = rec.bitmap && rec.bitmap.ok ? `${rec.bitmap.w}×${rec.bitmap.h}` : '✗';
    return `<tr><td>${esc(label)}</td><td><code>${esc(rec.name)}</code></td><td>${esc(rec.sniff)}</td><td>${rec.size}</td><td>${img}</td><td>${bmp}</td></tr>`;
}

function renderPicker() {
    let html = '';
    html += fileRow('accept="image/*"', state.tests.picker.imageAccept);
    html += fileRow('accept=".heic,image/heic"', state.tests.picker.heicAccept);
    $('#picker-out').innerHTML = html
        ? `<table><tr><th>input</th><th>file.name</th><th>sniff</th><th>bytes</th><th>&lt;img&gt;</th><th>bitmap</th></tr>${html}</table>`
        : '<p class="muted">not run yet</p>';
}

const KIND_OPTIONS = [
    ['normal', 'Normal single-image'],
    ['grid', 'Tiled / grid'],
    ['hdr', 'HDR / gain-map'],
    ['multi', 'Multi-image / Live Photo'],
    ['depth', 'Depth / other'],
    ['unsure', 'Not sure'],
];

function renderSpecial() {
    const recs = state.tests.special;
    if (!recs.length) {
        $('#special-out').innerHTML = '<p class="muted">no files picked yet</p>';
        return;
    }
    let html = recs.map((rec, i) => {
        const opts = KIND_OPTIONS.map(([v, l]) =>
            `<option value="${v}" ${rec.kind === v ? 'selected' : ''}>${l}</option>`).join('');
        const img = rec.img && rec.img.ok ? `${rec.img.w}×${rec.img.h}` : '<span class="fail">✗</span>';
        const bmp = rec.bitmap && rec.bitmap.ok ? `${rec.bitmap.w}×${rec.bitmap.h}` : '<span class="fail">✗</span>';
        return `<div class="row" style="margin:.4rem 0"><code>${esc(rec.name)}</code> · ${esc(rec.sniff)} · ${rec.size} B · img ${img} · bitmap ${bmp}</div>
            <div class="row"><label style="margin:0">kind</label><select data-special="${i}">${opts}</select></div>`;
    }).join('');
    $('#special-out').innerHTML = html;
    $('#special-out').querySelectorAll('select[data-special]').forEach((sel) => {
        sel.addEventListener('change', (e) => {
            state.tests.special[Number(e.target.dataset.special)].kind = e.target.value;
            save();
        });
    });
}

function renderCapture() {
    const cap = state.tests.capture;
    let html = '';
    cap.files.forEach((rec, i) => {
        const img = rec.img && rec.img.ok ? `${rec.img.w}×${rec.img.h}` : '✗';
        const bmp = rec.bitmap && rec.bitmap.ok ? `${rec.bitmap.w}×${rec.bitmap.h}` : '✗';
        html += `<tr><td>photo ${i + 1}</td><td><code>${esc(rec.name)}</code></td><td>${esc(rec.sniff)}</td><td>${rec.size}</td><td>${img}</td><td>${bmp}</td></tr>`;
    });
    const setting = cap.cameraSetting
        ? `camera setting: <b>${esc(cap.cameraSetting)}</b>`
        : '<span class="muted">camera setting not recorded</span>';
    $('#capture-out').innerHTML = (html
        ? `<table><tr><th>#</th><th>file.name</th><th>sniff</th><th>bytes</th><th>&lt;img&gt;</th><th>bitmap</th></tr>${html}</table>` : '')
        + `<p class="muted">${setting}</p>`;
}

function probeRow(p) {
    if (!p) return '';
    if (!p.ok) return `<tr><td>${p.w}×${p.h}</td><td><span class="fail">✗ ${esc(p.error || '')}</span></td><td>${(p.bytes / 1048576).toFixed(0)} MB</td></tr>`;
    return `<tr><td>${p.w}×${p.h}</td><td>${p.blank
        ? '<span class="fail">BLANK</span>'
        : `<span class="ok">✓ corner ${p.sampleCorner.join(',')} · centre ${p.sampleCenter.join(',')}</span>`}</td><td>${(p.bytes / 1048576).toFixed(0)} MB</td></tr>`;
}

function renderCanvas() {
    const cp = state.tests.canvasProbe;
    const main = cp.main.map(probeRow).join('');
    const worker = cp.worker.map(probeRow).join('');
    $('#canvas-out').innerHTML =
        (main ? `<p class="muted">main-thread canvas:</p><table><tr><th>size</th><th>read</th><th>backing</th></tr>${main}</table>` : '')
        + (worker ? `<p class="muted">OffscreenCanvas in worker:</p><table><tr><th>size</th><th>read</th><th>backing</th></tr>${worker}</table>`
            : '<p class="muted">worker probe: not run (or OffscreenCanvas unavailable)</p>');
}

function renderCamera() {
    const n = state.tests.cameraNotes;
    if (!n || !Object.keys(n).length) {
        $('#camera-out').innerHTML = '<p class="muted">notes not saved yet</p>';
        return;
    }
    const items = Object.entries(n).filter(([k, v]) => v !== '' && v != null)
        .map(([k, v]) => `<div>${esc(k)}: <b>${esc(v)}</b></div>`).join('');
    $('#camera-out').innerHTML = `<p class="muted">saved — remember to tap Send results:</p>${items}`;
}

// ── send ────────────────────────────────────────────────────────────────────

function payload() {
    return { sentAt: new Date().toISOString(), ...state };
}

async function sendResults(btn) {
    state.label = ($('#label').value.trim() || 'iphone-safari');
    save();
    const status = $('#send-status');
    btn.disabled = true;
    status.textContent = 'sending…';
    try {
        const res = await fetch('/device-check/results?label=' + encodeURIComponent(state.label), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload()),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        status.innerHTML = `<span class="ok">✓ sent → device-check/results/${esc(state.label)}.json</span>`;
    } catch (err) {
        status.innerHTML = `<span class="fail">✗ send failed (${esc(errText(err))}) — use "Copy results JSON" instead</span>`;
    }
    btn.disabled = false;
}

// ── wiring ──────────────────────────────────────────────────────────────────

function restoreUiFromState() {
    if (state.label) $('#label').value = state.label;
    if (state.tests.capture.cameraSetting) $('#cn-camera-setting').value = state.tests.capture.cameraSetting;
    const n = state.tests.cameraNotes;
    const map = { decodeFeel: '#cn-decode', thermal: '#cn-thermal', lens: '#cn-lens', torch: '#cn-torch', zoom: '#cn-zoom', homescreen: '#cn-homescreen' };
    if (n) {
        for (const [k, sel] of Object.entries(map)) {
            if (n[k]) $(sel).value = n[k];
        }
        if (n.text) $('#cn-text').value = n.text;
    }
}

function bind() {
    $('#btn-heic').addEventListener('click', (e) => runDecodeTest('heic12', e.target));
    $('#btn-jpeg12').addEventListener('click', (e) => runDecodeTest('jpeg12', e.target));
    $('#btn-jpeg48').addEventListener('click', (e) => runDecodeTest('jpeg48', e.target));
    $('#btn-canvas').addEventListener('click', (e) => runCanvasProbe(e.target));

    bindFileInput('#pick-image', async (files) => {
        state.tests.picker.imageAccept = await recordFile(files[0]);
    });
    bindFileInput('#pick-heic', async (files) => {
        state.tests.picker.heicAccept = await recordFile(files[0]);
    });
    bindFileInput('#pick-special', async (files) => {
        for (const f of files) {
            state.tests.special.push({ ...(await recordFile(f)), kind: null });
        }
    });
    bindFileInput('#pick-capture', async (files) => {
        for (const f of files) {
            state.tests.capture.files.push(await recordFile(f));
        }
    });

    $('#cn-camera-setting').addEventListener('change', (e) => {
        state.tests.capture.cameraSetting = e.target.value || null;
        save();
    });
    $('#btn-save-camera').addEventListener('click', () => {
        state.tests.cameraNotes = {
            decodeFeel: $('#cn-decode').value,
            thermal: $('#cn-thermal').value,
            lens: $('#cn-lens').value,
            torch: $('#cn-torch').value,
            zoom: $('#cn-zoom').value,
            homescreen: $('#cn-homescreen').value,
            text: $('#cn-text').value.trim(),
        };
        save();
        render();
    });

    $('#btn-send').addEventListener('click', (e) => sendResults(e.target));
    $('#btn-copy').addEventListener('click', async () => {
        const text = JSON.stringify(payload(), null, 2);
        try {
            await navigator.clipboard.writeText(text);
            $('#send-status').innerHTML = '<span class="ok">✓ copied to clipboard</span>';
        } catch (err) {
            $('#send-status').innerHTML = `<span class="fail">✗ clipboard failed (${esc(errText(err))})</span>`;
        }
    });
}

function init() {
    const restored = load();
    state.device = collectDevice();
    if (!restored) save();
    bind();
    restoreUiFromState();
    render();
    save();
}

init();
