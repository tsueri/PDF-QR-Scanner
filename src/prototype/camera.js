// PROTOTYPE (ticket #30) — mobile camera scanning UX, branch prototype/camera-ux.
// Throwaway code, not for merge into main. Without ?camera=a|b|c this module does
// nothing and the app is untouched.
//
// Question under test: what should scanning with the camera feel like on a phone?
// Three structurally different variants, entered from a "Scan with camera" button
// injected into the intake controls, switchable via ?camera=a|b|c and the floating
// bottom bar:
//
//   A · Full-screen takeover — the camera takes the whole viewport; codes collect in
//       a bottom sheet drawer that peeks up; torch/zoom/mode live in a bottom control
//       bar; X exits back to the page.
//   B · Inline session card — the camera stays on the page as a card; codes stream
//       into a list under the preview; the card collapses on Finish.
//   C · Freeze-frame review — one-shot first: detection freezes the frame and a big
//       review card offers Copy / Open / Scan another; a Continuous toggle flips it
//       into live streaming with a corner code stack.
//
// All variants share (from research/camera-capture.md):
//   - permission framing: a pre-permission screen explains what the camera is for;
//     a "waiting" state while the browser prompt is open (no timeout error)
//   - torch/zoom only where track.getCapabilities() reports them (never
//     getSupportedConstraints); zoom is requested up front (`zoom: true`) so Chrome's
//     PTZ permission prompt is asked with the camera, with a plain retry if denied
//   - one-shot vs continuous toggle; repeated frames of the same code dedupe into one
//     row with an ×N count
//   - audio beep on detection (created after the user gesture); haptics only where
//     navigator.vibrate exists (not Safari)
//   - lifecycle: tracks stop on tab hide / pagehide → a "Resume camera" state; the
//     page never navigates while the camera is live (no hash routing)
//   - on Done/Finish the session lands as a camera source card in the results area,
//     in the style of the results decision (#29), with a per-session CSV download.
//
// Real decoding: a latest-frame-wins worker (src/prototype/camera.worker.js) reusing
// the PDF pipeline's {imageDataBuffer, width, height} message shape; camera preset
// (QR only, fast flags per research/camera-capture.md). Frames are drawn + read on
// the main thread, capped at 1280 px long side, transferred, one decode in flight,
// frames dropped while busy.
//
// Runs over plain http://localhost; a real phone needs a secure context — serve with
// `node scripts/dev-https.mjs` (self-signed HTTPS on your LAN) or a tunnel.
//
// Debug (for screenshots / reviewing found-code states without a camera):
//   __cxFound(payload?)  fake a detection    __cxDone()  finish + land the session card
//   __cxState()          current state       __cxMode(m) switch one-shot / continuous

(function () {
    'use strict';

    var params = new URLSearchParams(window.location.search);
    var VARIANTS = { a: 'Full-screen takeover', b: 'Inline card', c: 'Freeze-frame review' };
    var DEFAULT_MODE = { a: 'continuous', b: 'continuous', c: 'oneshot' };
    var variant = (params.get('camera') || '').toLowerCase();
    if (!VARIANTS[variant]) return;

    // ---------------------------------------------------------------- state

    var session = { engine: null, cleanup: [], sessionNo: 0 };
    var landingRoot = null;

    function addCleanup(fn) { session.cleanup.push(fn); }
    function teardown() {
        session.cleanup.forEach(function (fn) { try { fn(); } catch (e) { /* noop */ } });
        session.cleanup = [];
        session.engine = null;
    }

    // ---------------------------------------------------------------- helpers

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    var ICONS = {
        camera: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.2 3c.4 0 .8.2 1 .5l1 1.5h2.6l1-1.5c.2-.3.6-.5 1-.5H19a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h4.2zM12 8.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" fill-rule="evenodd"/></svg>',
        close: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        torch: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.2 2 4.8 13.4h5.3L9.4 22l8.7-11.4h-5.4L13.2 2z"/></svg>',
        copy: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
        check: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 12.5 9.5 18 20 7"/></svg>',
    };

    function svgIcon(name) {
        var span = el('span', 'cx-ic');
        span.innerHTML = ICONS[name] || '';
        return span;
    }

    // ---------------------------------------------------------------- feedback

    var audioCtx = null;
    function beep() {
        try {
            var Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            if (!audioCtx) audioCtx = new Ctx();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            var t = audioCtx.currentTime;
            var osc = audioCtx.createOscillator();
            var gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, t);
            osc.frequency.setValueAtTime(1320, t + 0.09);
            gain.gain.setValueAtTime(0.12, t);
            gain.gain.setValueAtTime(0.0001, t + 0.2);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(t);
            osc.stop(t + 0.22);
        } catch (e) { /* no audio — silent feedback is fine */ }
    }

    function vibrate() {
        // feature-detected: Safari has no navigator.vibrate; Firefox desktop removed it in 130
        try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* noop */ }
    }

    // ---------------------------------------------------------------- engine

    function createEngine(mode) {
        var engine = {
            state: 'permission',          // permission | prompting | live | paused | done
            errorKind: null,
            mode: mode,                   // 'continuous' | 'oneshot'
            caps: { torch: false, zoom: null },
            settings: { torch: false, zoom: null },
            codes: new Map(),             // payload → {payload, count, firstAt, lastAt, position}
            order: [],
            video: null,
            stream: null,
            track: null,
            scanning: false,
            frozen: false,
            busy: false,
            pending: false,
            captureScale: 1,
            worker: null,
            listeners: {},
            _frameHandle: 0,
            _wakeLock: null,
            _lifecycleWired: false,
        };

        engine.on = function (ev, fn) {
            (engine.listeners[ev] = engine.listeners[ev] || []).push(fn);
            return engine;
        };
        function emit(ev, data) {
            (engine.listeners[ev] || []).forEach(function (fn) {
                try { fn(data); } catch (e) { /* noop */ }
            });
        }

        // ---- decode worker (latest-frame-wins; created on first start)

        function ensureWorker() {
            if (engine.worker) return engine.worker;
            engine.worker = new Worker(new URL('./camera.worker.js', import.meta.url), { type: 'module' });
            engine.worker.onmessage = function (e) {
                engine.busy = false;
                var data = e.data || {};
                if (Array.isArray(data.codes)) handleCodes(data.codes);
                else if (data.error) console.warn('[cx-prototype] decode error:', data.error);
                if (engine.pending) { engine.pending = false; capture(); }
            };
            engine.worker.onerror = function (err) {
                console.warn('[cx-prototype] worker error:', err.message);
                engine.busy = false;
            };
            return engine.worker;
        }

        function handleCodes(results) {
            if (engine.state !== 'live') return;
            var changed = false;
            results.forEach(function (r) {
                if (!r || typeof r.data !== 'string' || !r.data) return;
                var existing = engine.codes.get(r.data);
                if (existing) {
                    existing.count += 1;
                    existing.lastAt = Date.now();
                    if (r.position) existing.position = r.position;
                } else {
                    var entry = { payload: r.data, count: 1, firstAt: Date.now(), lastAt: Date.now(), position: r.position || null };
                    engine.codes.set(r.data, entry);
                    engine.order.push(r.data);
                    changed = true;
                    emit('found', { code: entry, position: entry.position });
                }
            });
            if (changed) emit('codes');
        }

        // ---- frame capture (draw + read on main thread, capped at 1280 long side)

        var CAPTURE_MAX = 1280;
        var captureCanvas = null, captureCtx = null;

        function capture() {
            var video = engine.video;
            if (!video || video.readyState < 2) return;
            var vw = video.videoWidth, vh = video.videoHeight;
            if (!vw || !vh) return;
            if (!captureCanvas) {
                captureCanvas = document.createElement('canvas');
                captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
            }
            var scale = Math.min(1, CAPTURE_MAX / Math.max(vw, vh));
            var w = Math.round(vw * scale), h = Math.round(vh * scale);
            if (captureCanvas.width !== w || captureCanvas.height !== h) {
                captureCanvas.width = w;
                captureCanvas.height = h;
            }
            try { captureCtx.drawImage(video, 0, 0, w, h); } catch (e) { return; }
            var imageData = captureCtx.getImageData(0, 0, w, h);
            engine.captureScale = captureCanvas.width / vw;
            engine.busy = true;
            engine.worker.postMessage(
                { imageDataBuffer: imageData.data.buffer, width: w, height: h },
                [imageData.data.buffer]
            );
        }

        // ---- frame loop: requestVideoFrameCallback, rAF fallback

        function scheduleFrame() {
            if (engine.state !== 'live' || !engine.scanning || engine.frozen) return;
            if (engine.video.requestVideoFrameCallback) {
                engine._frameHandle = engine.video.requestVideoFrameCallback(onFrame);
            } else {
                engine._frameHandle = window.requestAnimationFrame(onFrame);
            }
        }

        function cancelFrame() {
            if (engine._frameHandle && engine.video && engine.video.requestVideoFrameCallback) {
                try { engine.video.cancelVideoFrameCallback(engine._frameHandle); } catch (e) { /* noop */ }
            } else if (engine._frameHandle) {
                window.cancelAnimationFrame(engine._frameHandle);
            }
            engine._frameHandle = 0;
        }

        function onFrame() {
            if (engine.state !== 'live' || !engine.scanning || engine.frozen) return;
            if (engine.busy) { engine.pending = true; return; }
            capture();
            scheduleFrame();
        }

        // ---- stream lifecycle

        function kindFromError(err) {
            switch (err && err.name) {
                case 'NotAllowedError': return 'denied';
                case 'NotFoundError': return 'nocamera';
                case 'NotReadableError': return 'busy';
                case 'OverconstrainedError': return 'failed';
                case 'SecurityError': return 'insecure';
                default: return 'failed';
            }
        }

        async function startStream(withZoom) {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                engine.errorKind = 'insecure';
                engine.state = 'error';
                emit('state', engine.state);
                return false;
            }
            var video = {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 },
            };
            if (withZoom) video.zoom = true; // asks Chrome's PTZ permission up front; see research
            try {
                engine.stream = await navigator.mediaDevices.getUserMedia({ video: video, audio: false });
            } catch (err) {
                if (withZoom && (err.name === 'NotAllowedError' || err.name === 'OverconstrainedError')) {
                    return startStream(false); // PTZ declined — retry plain
                }
                engine.errorKind = kindFromError(err);
                engine.state = 'error';
                emit('state', engine.state);
                return false;
            }
            engine.track = engine.stream.getVideoTracks()[0];
            if (!engine.track) {
                engine.errorKind = 'failed';
                engine.state = 'error';
                emit('state', engine.state);
                return false;
            }
            engine.video.srcObject = engine.stream;
            engine.video.setAttribute('playsinline', '');
            engine.video.muted = true;
            try { await engine.video.play(); } catch (e) { /* the start tap should cover autoplay */ }
            readCaps();
            wireLifecycle();
            wireTrackEvents();
            engine.state = 'live';
            emit('state', engine.state);
            acquireWakeLock();
            return true;
        }

        function readCaps() {
            var caps = { torch: false, zoom: null };
            try {
                var c = engine.track.getCapabilities ? engine.track.getCapabilities() : null;
                if (c && c.torch) caps.torch = true;
                if (c && c.zoom && typeof c.zoom.min === 'number' && typeof c.zoom.max === 'number') {
                    caps.zoom = { min: c.zoom.min, max: c.zoom.max, step: c.zoom.step || 0.1 };
                }
            } catch (e) { /* capabilities unknown — controls stay hidden */ }
            engine.caps = caps;
            emit('capabilities');
            try {
                var s = engine.track.getSettings ? engine.track.getSettings() : null;
                engine.settings.zoom = s && typeof s.zoom === 'number' ? s.zoom : null;
            } catch (e) { /* noop */ }
            emit('settings');
        }

        async function acquireWakeLock() {
            try {
                if (navigator.wakeLock && navigator.wakeLock.request) {
                    engine._wakeLock = await navigator.wakeLock.request('screen');
                }
            } catch (e) { engine._wakeLock = null; }
        }
        function releaseWakeLock() {
            try { if (engine._wakeLock) engine._wakeLock.release(); } catch (e) { /* noop */ }
            engine._wakeLock = null;
        }

        function wireLifecycle() {
            if (engine._lifecycleWired) return;
            engine._lifecycleWired = true;
            document.addEventListener('visibilitychange', function () {
                if (document.hidden && engine.state === 'live') {
                    stopStream();
                    engine.state = 'paused';
                    emit('state', engine.state);
                }
            });
            window.addEventListener('pagehide', function () {
                if (engine.state === 'live') { stopStream(); engine.state = 'paused'; emit('state', engine.state); }
            });
            window.addEventListener('beforeunload', function () {
                if (engine.stream) stopStream();
            });
        }

        function wireTrackEvents() {
            if (!engine.track) return;
            // WebKit can mute the track on its own (iOS tab hide); surface it as paused.
            engine.track.addEventListener('mute', function () {
                if (engine.state === 'live') { engine.state = 'paused'; emit('state', engine.state); }
            });
            engine.track.addEventListener('unmute', function () {
                if (engine.state === 'paused') {
                    engine.state = 'live';
                    emit('state', engine.state);
                    engine.scanning = true;
                    scheduleFrame();
                }
            });
            engine.track.addEventListener('ended', function () {
                if (engine.state === 'live') { engine.state = 'paused'; emit('state', engine.state); }
            });
        }

        function stopStream() {
            engine.scanning = false;
            engine.pending = false;
            engine.frozen = false;
            cancelFrame();
            if (engine.stream) engine.stream.getTracks().forEach(function (t) { t.stop(); });
            engine.stream = null;
            engine.track = null;
            releaseWakeLock();
            if (engine.video) { engine.video.pause(); engine.video.srcObject = null; }
            engine.settings = { torch: false, zoom: null };
        }

        // ---- controls

        engine.toggleTorch = async function () {
            if (!engine.caps.torch || !engine.track) return;
            var next = !engine.settings.torch;
            try {
                await engine.track.applyConstraints({ advanced: [{ torch: next }] });
                engine.settings.torch = next;
                emit('settings');
            } catch (err) { console.warn('[cx-prototype] torch failed:', err); }
        };

        engine.setZoom = async function (value) {
            if (!engine.caps.zoom || !engine.track) return;
            var c = engine.caps.zoom;
            var v = Math.min(c.max, Math.max(c.min, value));
            try {
                await engine.track.applyConstraints({ advanced: [{ zoom: v }] });
                engine.settings.zoom = v;
                emit('settings');
            } catch (err) { console.warn('[cx-prototype] zoom failed:', err); }
        };
        engine.zoomStep = function (dir) {
            if (!engine.caps.zoom || engine.settings.zoom == null) return;
            engine.setZoom(engine.settings.zoom + dir * engine.caps.zoom.step);
        };
        engine.zoomMultiplier = function () {
            if (!engine.caps.zoom || engine.settings.zoom == null) return 1;
            return engine.settings.zoom / engine.caps.zoom.min;
        };

        engine.setMode = function (m) { engine.mode = m; emit('mode'); };
        engine.pauseScanning = function () { engine.scanning = false; cancelFrame(); };
        engine.resumeScanning = function () { engine.scanning = true; engine.frozen = false; scheduleFrame(); };
        engine.freeze = function () {
            engine.frozen = true;
            cancelFrame();
            try { engine.video.pause(); } catch (e) { /* noop */ }
        };
        engine.unfreeze = function () {
            engine.frozen = false;
            try { engine.video.play(); } catch (e) { /* noop */ }
        };

        engine.finish = function () {
            stopStream();
            engine.state = 'done';
            emit('state', engine.state);
        };

        engine.start = async function (video) {
            engine.video = video;
            ensureWorker();
            var ok = await startStream(true);
            if (ok) { engine.scanning = true; engine.frozen = false; scheduleFrame(); }
            return ok;
        };

        engine.resume = async function () {
            var ok = await startStream(true);
            if (ok) { engine.scanning = true; engine.frozen = false; scheduleFrame(); }
            return ok;
        };

        // ---- debug hooks (screenshots + reviewing found-code states without a camera)

        engine.debugFound = function (payload) {
            if (engine.state !== 'live' || engine.frozen) return;
            var code = payload || 'https://example.com/prototype#' + Date.now();
            if (engine.codes.has(code)) {
                var ex = engine.codes.get(code);
                ex.count += 1;
                ex.lastAt = Date.now();
                emit('codes');
                return;
            }
            var entry = { payload: code, count: 1, firstAt: Date.now(), lastAt: Date.now(), position: null };
            engine.codes.set(code, entry);
            engine.order.push(code);
            emit('found', { code: entry, position: null });
            emit('codes');
        };
        engine.debugDone = function () { engine.finish(); };
        engine.debugState = function () { return engine.state; };
        engine.debugMode = function (m) { engine.setMode(m); };

        return engine;
    }

    // ---------------------------------------------------------------- landing card

    function csvEscape(v) {
        var s = String(v);
        if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    function cameraCSV(engine) {
        var rows = ['source,locator,symbology,data'];
        engine.order.forEach(function (p) {
            rows.push(['Camera session', 'live', 'QRCode', csvEscape(p)].join(','));
        });
        return rows.join('\r\n') + '\r\n';
    }

    function download(name, text, mime) {
        var blob = new Blob([text], { type: mime || 'text/csv' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            toast('Copied');
        } catch (e) {
            try {
                var ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                toast('Copied');
            } catch (e2) { toast('Copy failed'); }
        }
    }

    var toastTimer = null;
    function toast(msg) {
        var t = document.querySelector('.cx-toast');
        if (!t) {
            t = el('div', 'cx-toast');
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add('is-on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 1600);
    }

    function ensureLandingRoot() {
        if (landingRoot) return landingRoot;
        landingRoot = el('div', 'cx-root');
        var card = document.querySelector('.scan-card');
        if (card) card.appendChild(landingRoot);
        else document.body.appendChild(landingRoot);
        return landingRoot;
    }

    function landSession(engine) {
        var root = ensureLandingRoot();
        session.sessionNo += 1;
        var codes = engine.order.map(function (p) { return engine.codes.get(p); });
        var label = 'Camera session' + (session.sessionNo > 1 ? ' #' + session.sessionNo : '');

        var card = el('div', 'cx-land');
        var head = el('div', 'cx-land__head');
        head.appendChild(el('span', 'cx-pill cx-pill--camera', 'Camera'));
        head.appendChild(el('span', 'cx-land__name', label));
        head.appendChild(el('span', 'cx-land__meta',
            codes.length === 0 ? 'no codes' : codes.length + (codes.length === 1 ? ' code' : ' codes')));
        var acts = el('div', 'cx-land__acts');
        var copyBtn = el('button', 'btn btn-outline-secondary btn-sm', 'Copy');
        copyBtn.type = 'button';
        copyBtn.addEventListener('click', function () {
            copyText(codes.map(function (c) { return c.payload; }).join('\n'));
        });
        var csvBtn = el('button', 'btn btn-outline-secondary btn-sm', 'CSV');
        csvBtn.type = 'button';
        csvBtn.addEventListener('click', function () { download('camera.csv', cameraCSV(engine)); });
        acts.appendChild(copyBtn);
        acts.appendChild(csvBtn);
        head.appendChild(acts);
        card.appendChild(head);

        var body = el('div', 'cx-land__body');
        if (codes.length === 0) {
            body.appendChild(el('p', 'cx-land__empty', 'No QR codes were found during this session.'));
        } else {
            codes.forEach(function (c) {
                var row = el('div', 'cx-land__row');
                if (c.count > 1) row.appendChild(el('span', 'cx-land__count', '×' + c.count));
                row.appendChild(el('span', 'cx-land__payload', c.payload));
                body.appendChild(row);
            });
        }
        card.appendChild(body);
        root.appendChild(card);
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return card;
    }

    // ---------------------------------------------------------------- shared screens

    function permissionCard() {
        var wrap = el('div', 'cx-card cx-perm');
        var icon = el('div', 'cx-card__icon');
        icon.appendChild(svgIcon('camera'));
        var title = el('h3', 'cx-card__title', 'Ready to scan with your camera');
        var body = el('p', 'cx-card__body',
            'The camera feed is read on this device — nothing is uploaded or recorded. Your browser will ask for permission to use the camera.');
        var types = el('p', 'cx-card__types', 'Reads QR codes on-device.');
        var start = el('button', 'btn btn-primary cx-perm__start', 'Start camera');
        start.type = 'button';
        var cancel = el('button', 'btn btn-link cx-perm__cancel', 'Cancel');
        cancel.type = 'button';
        wrap.append(icon, title, body, types, start, cancel);
        return { node: wrap, start: start, cancel: cancel };
    }

    function setWaiting(card, btn) {
        btn.textContent = 'Waiting for permission…';
        btn.disabled = true;
        card.node.appendChild(el('p', 'cx-card__hint',
            'Check the camera prompt in your browser — if you don\u2019t see one, look for the camera icon in the address bar.'));
    }

    var ERRORS = {
        denied: { title: 'Camera access denied', body: 'To scan with the camera, allow camera access for this site in your browser settings, then tap Retry.' },
        nocamera: { title: 'No camera found', body: 'This device has no usable camera. You can still scan by uploading or pasting an image.' },
        busy: { title: 'Camera is busy', body: 'Another app or browser tab may be using the camera. Close it and tap Retry.' },
        insecure: { title: 'Needs a secure connection', body: 'The camera only works on HTTPS pages (or localhost). Reopen this page over HTTPS and try again.' },
        failed: { title: 'Could not start the camera', body: 'The camera failed to start. Close other apps using it and tap Retry.' },
    };

    function errorCard(kind, onRetry, onCancel) {
        var E = ERRORS[kind] || ERRORS.failed;
        var wrap = el('div', 'cx-card cx-err');
        var title = el('h3', 'cx-card__title', E.title);
        var body = el('p', 'cx-card__body', E.body);
        var retry = el('button', 'btn btn-primary cx-err__retry', 'Retry');
        retry.type = 'button';
        retry.addEventListener('click', onRetry);
        var cancel = el('button', 'btn btn-link cx-perm__cancel', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', onCancel);
        wrap.append(title, body, retry, cancel);
        return wrap;
    }

    function buildReticle(cls) {
        var reticle = el('div', 'cx-reticle' + (cls ? ' ' + cls : ''));
        var square = el('div', 'cx-reticle__square');
        ['tl', 'tr', 'bl', 'br'].forEach(function (corner) {
            square.appendChild(el('span', 'cx-bracket cx-bracket--' + corner));
        });
        reticle.appendChild(square);
        return reticle;
    }

    function buildVideo() {
        var video = el('video', 'cx-video');
        video.setAttribute('playsinline', '');
        video.muted = true;
        return video;
    }

    function buildPoly() {
        var wrap = el('div', 'cx-polywrap');
        wrap.innerHTML = '<svg class="cx-poly" aria-hidden="true"><polygon fill="rgba(34,197,94,0.28)" stroke="#22c55e" stroke-width="3"></polygon></svg>';
        return wrap;
    }

    // Maps a point in capture-canvas coordinates to element coordinates (object-fit: cover).
    function coverMapper(container, videoW, videoH, capScale) {
        var rect = container.getBoundingClientRect();
        var scale = Math.max(rect.width / videoW, rect.height / videoH);
        var offX = (rect.width - videoW * scale) / 2;
        var offY = (rect.height - videoH * scale) / 2;
        return function (pt) {
            return {
                x: ((pt.x || 0) / capScale) * scale + offX,
                y: ((pt.y || 0) / capScale) * scale + offY,
            };
        };
    }

    function drawPoly(wrap, position, mapper) {
        var svg = wrap.querySelector('svg');
        var w = wrap.clientWidth, h = wrap.clientHeight;
        svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
        var pts;
        if (position && position.topLeft) {
            var corners = [position.topLeft, position.topRight, position.bottomRight, position.bottomLeft];
            pts = corners.map(function (pt) {
                var m = mapper(pt);
                return m.x.toFixed(1) + ',' + m.y.toFixed(1);
            }).join(' ');
        } else {
            // no real position (debug founds): centered square in the reticle
            var cx = w / 2, cy = h / 2, s = Math.min(w, h) * 0.15;
            pts = (cx - s) + ',' + (cy - s) + ' ' + (cx + s) + ',' + (cy - s) + ' ' + (cx + s) + ',' + (cy + s) + ' ' + (cx - s) + ',' + (cy + s);
        }
        svg.querySelector('polygon').setAttribute('points', pts);
        svg.style.display = 'block';
        clearTimeout(svg._hideTimer);
        svg._hideTimer = setTimeout(function () { svg.style.display = 'none'; }, 2600);
    }

    // ---------------------------------------------------------------- shared controls

    function modeToggle(engine) {
        var seg = el('div', 'cx-seg');
        var one = el('button', 'cx-seg__btn', 'One shot');
        one.type = 'button';
        var cont = el('button', 'cx-seg__btn', 'Continuous');
        cont.type = 'button';
        function paint() {
            one.classList.toggle('is-on', engine.mode === 'oneshot');
            cont.classList.toggle('is-on', engine.mode === 'continuous');
        }
        one.addEventListener('click', function () { engine.setMode('oneshot'); });
        cont.addEventListener('click', function () { engine.setMode('continuous'); });
        engine.on('mode', paint);
        paint();
        seg.append(one, cont);
        return seg;
    }

    function torchButton(engine) {
        if (!engine.caps.torch) return null;
        var b = el('button', 'cx-iconbtn cx-iconbtn--torch');
        b.type = 'button';
        b.setAttribute('aria-label', 'Toggle torch');
        b.innerHTML = ICONS.torch;
        b.addEventListener('click', function () { engine.toggleTorch(); });
        engine.on('settings', function () { b.classList.toggle('is-active', engine.settings.torch); });
        return b;
    }

    function zoomControl(engine) {
        if (!engine.caps.zoom) return null;
        var wrap = el('div', 'cx-zoom');
        var minus = el('button', 'cx-zoom__btn', '−');
        minus.type = 'button';
        minus.setAttribute('aria-label', 'Zoom out');
        var label = el('span', 'cx-zoom__label');
        var plus = el('button', 'cx-zoom__btn', '+');
        plus.type = 'button';
        plus.setAttribute('aria-label', 'Zoom in');
        function paint() {
            label.textContent = engine.zoomMultiplier().toFixed(1) + '×';
        }
        minus.addEventListener('click', function () { engine.zoomStep(-1); });
        plus.addEventListener('click', function () { engine.zoomStep(1); });
        engine.on('settings', paint);
        paint();
        wrap.append(minus, label, plus);
        return wrap;
    }

    // ---------------------------------------------------------------- variant A · full-screen takeover

    function runVariantA(engine) {
        var overlay = el('div', 'cx-overlay cx-overlay--A');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Camera scanner');
        var video = buildVideo();
        var poly = buildPoly();
        var reticle = buildReticle();

        var top = el('div', 'cx-top');
        var close = el('button', 'cx-iconbtn cx-top__close');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close camera');
        close.innerHTML = ICONS.close;
        top.appendChild(el('span', 'cx-top__title', 'Camera'));
        top.appendChild(close);

        var hint = el('div', 'cx-hint', 'Point at a QR code');
        var controls = el('div', 'cx-controls');
        var confirmBar = el('div', 'cx-confirm');
        var sheet = el('div', 'cx-sheet cx-sheet--collapsed');
        var sheetHead = el('div', 'cx-sheet__head');
        var sheetList = el('div', 'cx-sheet__list');
        sheet.append(sheetHead, sheetList);

        // paused state card
        var resumeCard = el('div', 'cx-card cx-resume');
        var resumeBtn = el('button', 'btn btn-primary', 'Resume camera');
        resumeBtn.type = 'button';
        resumeBtn.addEventListener('click', function () { engine.resume(); });
        var resumeDone = el('button', 'btn btn-link cx-perm__cancel', 'Done');
        resumeDone.type = 'button';
        resumeDone.addEventListener('click', function () { engine.finish(); });
        resumeCard.append(
            el('h3', 'cx-card__title', 'Camera paused'),
            el('p', 'cx-card__body', 'The camera stops when the tab is hidden or the device sleeps. Tap to resume scanning.'),
            resumeBtn, resumeDone);

        // one-shot confirmation bar
        var confirmKeep = el('button', 'btn btn-light btn-sm', 'Keep scanning');
        confirmKeep.type = 'button';
        confirmKeep.addEventListener('click', function () {
            confirmBar.classList.remove('is-on');
            engine.resumeScanning();
        });
        var confirmDone = el('button', 'btn btn-success btn-sm', 'Done');
        confirmDone.type = 'button';
        confirmDone.addEventListener('click', function () { engine.finish(); });

        overlay.append(video, poly, reticle, top, hint, controls, confirmBar, sheet, resumeCard);
        document.body.appendChild(overlay);

        // ---- state rendering

        function show(stateName) {
            overlay.classList.toggle('is-live', stateName === 'live');
            overlay.classList.toggle('is-perm', stateName === 'permission' || stateName === 'prompting');
            overlay.classList.toggle('is-error', stateName === 'error');
            overlay.classList.toggle('is-paused', stateName === 'paused');
        }

        var permCard = null;
        function renderPerm() {
            permCard = permissionCard();
            overlay.appendChild(permCard.node);
            permCard.start.addEventListener('click', function () { engine.start(video); });
            permCard.cancel.addEventListener('click', function () { engine.finish(); });
            engine.on('state', function (s) { if (s === 'prompting') setWaiting(permCard, permCard.start); });
        }

        function renderError() {
            overlay.appendChild(errorCard(engine.errorKind,
                function () { engine.resume(); },
                function () { engine.finish(); }));
        }

        // ---- sheet

        var expanded = false;
        function sheetRows() {
            sheetList.innerHTML = '';
            engine.order.forEach(function (p) {
                var c = engine.codes.get(p);
                var row = el('div', 'cx-sheet__row');
                row.appendChild(el('span', 'cx-sheet__dot'));
                if (c.count > 1) row.appendChild(el('span', 'cx-sheet__count', '×' + c.count));
                row.appendChild(el('span', 'cx-sheet__payload', c.payload));
                var copy = el('button', 'cx-sheet__copy');
                copy.type = 'button';
                copy.setAttribute('aria-label', 'Copy code');
                copy.innerHTML = ICONS.copy;
                copy.addEventListener('click', function () { copyText(c.payload); });
                row.appendChild(copy);
                sheetList.appendChild(row);
            });
        }

        function paintSheet() {
            var n = engine.order.length;
            if (n === 0) {
                sheetHead.textContent = 'No codes yet';
            } else {
                var last = engine.codes.get(engine.order[engine.order.length - 1]);
                var preview = last.payload.length > 34 ? last.payload.slice(0, 34) + '…' : last.payload;
                sheetHead.textContent = n + (n === 1 ? ' code · ' : ' codes · ') + preview;
            }
            sheet.classList.toggle('cx-sheet--collapsed', !expanded);
            if (expanded) sheetRows();
        }

        sheetHead.addEventListener('click', function () {
            if (engine.order.length === 0) return;
            expanded = !expanded;
            paintSheet();
        });

        function paintControls() {
            controls.innerHTML = '';
            var torch = torchButton(engine);
            if (torch) controls.appendChild(torch);
            var zoom = zoomControl(engine);
            if (zoom) controls.appendChild(zoom);
            controls.appendChild(modeToggle(engine));
        }

        // ---- events

        engine.on('state', function (s) {
            if (s === 'permission') { show('permission'); renderPerm(); }
            else if (s === 'error') { show('error'); renderError(); }
            else if (s === 'live') { show('live'); paintControls(); paintSheet(); }
            else if (s === 'paused') { show('paused'); }
            else if (s === 'done') cleanup();
        });

        engine.on('found', function (ev) {
            if (engine.state !== 'live') return;
            beep();
            vibrate();
            var v = engine.video;
            if (v && v.videoWidth) {
                drawPoly(poly, ev.position, coverMapper(overlay, v.videoWidth, v.videoHeight, engine.captureScale));
            } else {
                drawPoly(poly, null, function () { return { x: 0, y: 0 }; });
            }
            reticle.classList.add('is-hit');
            setTimeout(function () { reticle.classList.remove('is-hit'); }, 900);
            hint.hidden = true;
            paintSheet();
            if (engine.mode === 'oneshot') {
                engine.pauseScanning();
                confirmBar.innerHTML = '';
                confirmBar.append(svgIcon('check'), el('span', 'cx-confirm__label', 'Code found'), confirmKeep, confirmDone);
                confirmBar.classList.add('is-on');
            }
        });

        engine.on('codes', function () { if (engine.state === 'live') paintSheet(); });

        close.addEventListener('click', function () { engine.finish(); });

        function keyHandler(e) { if (e.key === 'Escape') engine.finish(); }
        document.addEventListener('keydown', keyHandler);

        function cleanup() {
            landSession(engine);
            overlay.remove();
            document.removeEventListener('keydown', keyHandler);
        }

        show('permission');
        renderPerm();
    }

    // ---------------------------------------------------------------- variant B · inline session card

    function runVariantB(engine) {
        var card = el('div', 'cx-inline');
        var head = el('div', 'cx-inline__head');
        head.appendChild(el('span', 'cx-pill cx-pill--camera', 'Camera'));
        head.appendChild(el('span', 'cx-inline__title', 'Live camera'));
        var stop = el('button', 'btn btn-outline-secondary btn-sm cx-inline__stop', 'Stop');
        stop.type = 'button';
        stop.addEventListener('click', function () { engine.finish(); });
        head.appendChild(stop);

        var preview = el('div', 'cx-inline__preview');
        var video = buildVideo();
        video.classList.add('cx-video--inline');
        var poly = buildPoly();
        var reticle = buildReticle('cx-reticle--inline');
        preview.append(video, poly, reticle);

        var controls = el('div', 'cx-inline__controls');
        var list = el('div', 'cx-inline__list');
        var confirmBar = el('div', 'cx-confirm cx-confirm--inline');
        var confirmKeep = el('button', 'btn btn-outline-primary btn-sm', 'Keep scanning');
        confirmKeep.type = 'button';
        confirmKeep.addEventListener('click', function () {
            confirmBar.classList.remove('is-on');
            engine.resumeScanning();
        });
        var foot = el('div', 'cx-inline__foot');
        foot.appendChild(el('span', 'cx-inline__hint', 'Codes are added to your results as they are found.'));
        var finish = el('button', 'btn btn-primary btn-sm', 'Finish');
        finish.type = 'button';
        finish.addEventListener('click', function () { engine.finish(); });
        foot.appendChild(finish);

        var permCard = permissionCard();
        permCard.node.classList.add('cx-perm--inline');
        permCard.start.addEventListener('click', function () { engine.start(video); });
        permCard.cancel.addEventListener('click', function () { engine.finish(); });

        var liveWrap = el('div', 'cx-inline__live');
        liveWrap.append(preview, controls, list, confirmBar, foot);
        liveWrap.hidden = true;

        card.append(head, permCard.node, liveWrap);

        var host = document.querySelector('.scan-card');
        if (host) host.insertBefore(card, host.querySelector('.privacy-note'));
        else document.body.appendChild(card);

        function listRows() {
            list.innerHTML = '';
            if (engine.order.length === 0) {
                list.appendChild(el('p', 'cx-inline__empty', 'Aim the camera at a QR code — codes appear here as they are found.'));
                return;
            }
            engine.order.forEach(function (p) {
                var c = engine.codes.get(p);
                var row = el('div', 'cx-inline__row');
                row.appendChild(el('span', 'cx-sheet__dot'));
                if (c.count > 1) row.appendChild(el('span', 'cx-sheet__count', '×' + c.count));
                row.appendChild(el('span', 'cx-inline__payload', c.payload));
                var copy = el('button', 'cx-sheet__copy cx-sheet__copy--light');
                copy.type = 'button';
                copy.setAttribute('aria-label', 'Copy code');
                copy.innerHTML = ICONS.copy;
                copy.addEventListener('click', function () { copyText(c.payload); });
                row.appendChild(copy);
                list.appendChild(row);
            });
        }

        function paintControls() {
            controls.innerHTML = '';
            var torch = torchButton(engine);
            if (torch) controls.appendChild(torch);
            var zoom = zoomControl(engine);
            if (zoom) controls.appendChild(zoom);
            controls.appendChild(modeToggle(engine));
        }

        var pausedCard = null;
        engine.on('state', function (s) {
            if (s === 'prompting') setWaiting(permCard, permCard.start);
            else if (s === 'error') {
                permCard.node.replaceWith(errorCard(engine.errorKind,
                    function () { engine.resume(); },
                    function () { engine.finish(); }));
            }
            else if (s === 'live') {
                if (pausedCard) { pausedCard.remove(); pausedCard = null; }
                permCard.node.hidden = true;
                liveWrap.hidden = false;
                paintControls();
                listRows();
            }
            else if (s === 'paused') {
                liveWrap.hidden = true;
                pausedCard = el('div', 'cx-card cx-perm--inline');
                var resumeBtn = el('button', 'btn btn-primary btn-sm', 'Resume camera');
                resumeBtn.type = 'button';
                resumeBtn.addEventListener('click', function () { engine.resume(); });
                pausedCard.append(
                    el('h3', 'cx-card__title', 'Camera paused'),
                    el('p', 'cx-card__body', 'The camera stops when the tab is hidden. Tap to resume.'),
                    resumeBtn);
                card.appendChild(pausedCard);
            }
            else if (s === 'done') cleanup();
        });

        engine.on('found', function (ev) {
            if (engine.state !== 'live') return;
            beep();
            vibrate();
            var v = engine.video;
            if (v && v.videoWidth) {
                drawPoly(poly, ev.position, coverMapper(preview, v.videoWidth, v.videoHeight, engine.captureScale));
            } else {
                drawPoly(poly, null, function () { return { x: 0, y: 0 }; });
            }
            reticle.classList.add('is-hit');
            setTimeout(function () { reticle.classList.remove('is-hit'); }, 900);
            listRows();
            if (engine.mode === 'oneshot') {
                engine.pauseScanning();
                confirmBar.innerHTML = '';
                confirmBar.append(svgIcon('check'), el('span', 'cx-confirm__label', 'Code found'), confirmKeep);
                confirmBar.classList.add('is-on');
            }
        });

        engine.on('codes', function () { if (engine.state === 'live') listRows(); });

        function cleanup() {
            landSession(engine);
            card.remove();
        }
    }

    // ---------------------------------------------------------------- variant C · freeze-frame review

    function runVariantC(engine) {
        var overlay = el('div', 'cx-overlay cx-overlay--C');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Camera scanner');
        var video = buildVideo();
        var poly = buildPoly();
        var reticle = buildReticle();

        var top = el('div', 'cx-top');
        var close = el('button', 'cx-iconbtn cx-top__close');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close camera');
        close.innerHTML = ICONS.close;
        var modeWrap = el('div', 'cx-top__mode');
        modeWrap.appendChild(el('span', 'cx-top__modelabel', 'Continuous'));
        var modeSwitch = el('button', 'cx-switch');
        modeSwitch.type = 'button';
        modeSwitch.setAttribute('role', 'switch');
        modeSwitch.setAttribute('aria-label', 'Continuous mode');
        var switchKnob = el('span', 'cx-switch__knob');
        modeSwitch.appendChild(switchKnob);
        modeWrap.appendChild(modeSwitch);
        top.append(el('span', 'cx-top__title', 'Camera'), modeWrap, close);

        var hint = el('div', 'cx-hint', 'Point at a QR code — it is captured automatically');
        var stack = el('div', 'cx-stack');
        var shutter = el('div', 'cx-shutter');
        var shutterBtn = el('button', 'cx-shutter__btn', 'Done');
        shutterBtn.type = 'button';
        shutterBtn.addEventListener('click', function () { engine.finish(); });
        shutter.appendChild(shutterBtn);

        var review = el('div', 'cx-review');
        var reviewPayload = el('div', 'cx-review__payload');
        var reviewActs = el('div', 'cx-review__acts');
        var reviewAgain = el('button', 'btn btn-outline-light', 'Scan another');
        reviewAgain.type = 'button';
        reviewAgain.addEventListener('click', function () {
            review.classList.remove('is-on');
            engine.unfreeze();
            engine.resumeScanning();
        });
        var reviewDone = el('button', 'btn btn-light', 'Done');
        reviewDone.type = 'button';
        reviewDone.addEventListener('click', function () { engine.finish(); });

        // paused state card
        var resumeCard = el('div', 'cx-card cx-resume');
        var resumeBtn = el('button', 'btn btn-primary', 'Resume camera');
        resumeBtn.type = 'button';
        resumeBtn.addEventListener('click', function () { engine.resume(); });
        var resumeDone = el('button', 'btn btn-link cx-perm__cancel', 'Done');
        resumeDone.type = 'button';
        resumeDone.addEventListener('click', function () { engine.finish(); });
        resumeCard.append(
            el('h3', 'cx-card__title', 'Camera paused'),
            el('p', 'cx-card__body', 'The camera stops when the tab is hidden or the device sleeps. Tap to resume scanning.'),
            resumeBtn, resumeDone);

        overlay.append(video, poly, reticle, top, hint, stack, shutter, review, resumeCard);
        document.body.appendChild(overlay);

        function show(stateName) {
            overlay.classList.toggle('is-live', stateName === 'live');
            overlay.classList.toggle('is-perm', stateName === 'permission' || stateName === 'prompting');
            overlay.classList.toggle('is-error', stateName === 'error');
            overlay.classList.toggle('is-paused', stateName === 'paused');
        }

        var permCard = null;
        function renderPerm() {
            permCard = permissionCard();
            overlay.appendChild(permCard.node);
            permCard.start.addEventListener('click', function () { engine.start(video); });
            permCard.cancel.addEventListener('click', function () { engine.finish(); });
            engine.on('state', function (s) { if (s === 'prompting') setWaiting(permCard, permCard.start); });
        }

        function renderError() {
            overlay.appendChild(errorCard(engine.errorKind,
                function () { engine.resume(); },
                function () { engine.finish(); }));
        }

        function paintMode() {
            modeSwitch.classList.toggle('is-on', engine.mode === 'continuous');
            overlay.classList.toggle('is-oneshot', engine.mode === 'oneshot');
            if (engine.mode === 'continuous') {
                review.classList.remove('is-on');
                shutter.hidden = true;
            } else {
                shutter.hidden = false;
            }
        }
        engine.on('mode', paintMode);

        modeSwitch.addEventListener('click', function () {
            engine.setMode(engine.mode === 'continuous' ? 'oneshot' : 'continuous');
        });

        function paintStack() {
            stack.innerHTML = '';
            var n = engine.order.length;
            if (n === 0 || engine.mode !== 'continuous') return;
            stack.classList.add('is-on');
            engine.order.slice(-3).reverse().forEach(function (p) {
                var c = engine.codes.get(p);
                var chip = el('div', 'cx-stack__chip');
                chip.appendChild(svgIcon('check'));
                chip.appendChild(el('span', 'cx-stack__text',
                    c.payload.length > 26 ? c.payload.slice(0, 26) + '…' : c.payload));
                stack.appendChild(chip);
            });
            if (n > 3) stack.appendChild(el('div', 'cx-stack__more', '+' + (n - 3) + ' more'));
        }

        engine.on('state', function (s) {
            if (s === 'permission') { show('permission'); renderPerm(); }
            else if (s === 'error') { show('error'); renderError(); }
            else if (s === 'live') { show('live'); paintMode(); }
            else if (s === 'paused') { show('paused'); }
            else if (s === 'done') cleanup();
        });

        engine.on('found', function (ev) {
            if (engine.state !== 'live') return;
            beep();
            vibrate();
            var v = engine.video;
            if (v && v.videoWidth) {
                drawPoly(poly, ev.position, coverMapper(overlay, v.videoWidth, v.videoHeight, engine.captureScale));
            } else {
                drawPoly(poly, null, function () { return { x: 0, y: 0 }; });
            }
            reticle.classList.add('is-hit');
            setTimeout(function () { reticle.classList.remove('is-hit'); }, 900);
            hint.hidden = true;
            if (engine.mode === 'oneshot') {
                engine.freeze();
                reviewPayload.textContent = ev.code.payload;
                reviewActs.innerHTML = '';
                var copyBtn = el('button', 'btn btn-light', 'Copy');
                copyBtn.type = 'button';
                copyBtn.addEventListener('click', function () { copyText(ev.code.payload); });
                reviewActs.appendChild(copyBtn);
                if (/^https?:\/\//i.test(ev.code.payload)) {
                    var openBtn = el('button', 'btn btn-light', 'Open');
                    openBtn.type = 'button';
                    openBtn.addEventListener('click', function () {
                        window.open(ev.code.payload, '_blank', 'noopener');
                    });
                    reviewActs.appendChild(openBtn);
                }
                reviewActs.appendChild(reviewAgain);
                reviewActs.appendChild(reviewDone);
                review.classList.add('is-on');
            } else {
                paintStack();
            }
        });

        engine.on('codes', function () { if (engine.state === 'live') paintStack(); });

        close.addEventListener('click', function () { engine.finish(); });

        function keyHandler(e) { if (e.key === 'Escape') engine.finish(); }
        document.addEventListener('keydown', keyHandler);

        function cleanup() {
            landSession(engine);
            overlay.remove();
            document.removeEventListener('keydown', keyHandler);
        }

        show('permission');
        renderPerm();
    }

    // ---------------------------------------------------------------- entry + switcher

    function entryButton(onOpen) {
        var b = el('button', 'btn btn-outline-secondary cx-entry');
        b.type = 'button';
        b.appendChild(svgIcon('camera'));
        b.appendChild(document.createTextNode(' Scan with camera'));
        b.addEventListener('click', onOpen);
        return b;
    }

    function buildSwitcher(current, onSwitch) {
        var keys = Object.keys(VARIANTS);
        var bar = el('div', 'cx-bar');
        var prev = el('button', 'cx-bar__arrow', '‹');
        prev.type = 'button';
        prev.setAttribute('aria-label', 'Previous camera variant');
        var label = el('span', 'cx-bar__label', current.toUpperCase() + ' · ' + VARIANTS[current]);
        var next = el('button', 'cx-bar__arrow', '›');
        next.type = 'button';
        next.setAttribute('aria-label', 'Next camera variant');
        function cycle(dir) {
            var i = keys.indexOf(current);
            onSwitch(keys[(i + dir + keys.length) % keys.length]);
        }
        prev.addEventListener('click', function () { cycle(-1); });
        next.addEventListener('click', function () { cycle(1); });
        bar.append(prev, label, next);
        var keyHandler = function (e) {
            var a = document.activeElement;
            if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
            if (e.key === 'ArrowLeft') cycle(-1);
            if (e.key === 'ArrowRight') cycle(1);
        };
        document.addEventListener('keydown', keyHandler);
        if (document.querySelector('.rp-bar')) bar.classList.add('cx-bar--raised');
        document.body.appendChild(bar);
        return { remove: function () { bar.remove(); document.removeEventListener('keydown', keyHandler); } };
    }

    function setVariantParam(v) {
        var url = new URL(window.location.href);
        url.searchParams.set('camera', v);
        window.history.replaceState({}, '', url);
    }

    // ---------------------------------------------------------------- boot

    var RUNNERS = { a: runVariantA, b: runVariantB, c: runVariantC };
    var current = variant;
    var switcher = null;

    function openCamera() {
        if (session.engine) return; // already open
        var engine = createEngine(DEFAULT_MODE[current]);
        session.engine = engine;
        RUNNERS[current](engine);
    }

    function switchVariant(v) {
        teardown();
        current = v;
        setVariantParam(v);
        boot();
    }

    function boot() {
        var controls = document.querySelector('.batch-controls');
        var entry = entryButton(openCamera);
        if (controls) controls.appendChild(entry);
        addCleanup(function () { entry.remove(); });
        switcher = buildSwitcher(current, switchVariant);
        addCleanup(function () { if (switcher) switcher.remove(); });
    }

    // debug API for screenshots + reviewing found-code states without a camera
    window.__cxFound = function (payload) {
        if (session.engine) session.engine.debugFound(payload);
    };
    window.__cxDone = function () {
        if (session.engine) session.engine.finish();
    };
    window.__cxState = function () {
        return session.engine ? session.engine.debugState() : 'closed';
    };
    window.__cxMode = function (m) {
        if (session.engine) session.engine.debugMode(m);
    };

    boot();
})();
