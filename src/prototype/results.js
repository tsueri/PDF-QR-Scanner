// PROTOTYPE — throwaway UI for ticket #29 (results view + export actions), branch prototype/results-view.
// Not for merge into main. Without ?variant=a|b|c this module does nothing and the app is untouched;
// the only path to users is this branch, so the prototype chrome can't ship.
//
// Question under test: what does the on-screen results view look like after a scan, and how do
// export actions work? Three structurally different variants, mounted on the real page in the
// exact slot where today's "ZIP ready" banner sits (#zipReady), switchable via ?variant=a|b|c
// and the floating bottom bar:
//
//   A · One list        — one flowing list, slim per-source headers, export bar in the banner's slot
//   B · Source cards    — one collapsible card per source with its own Copy/CSV, run summary carries exports
//   C · Summary + table — dense flat table under a summary strip with symbology chips
//
// Runs to compare: mixed (10 sources, 13 codes, long/binary payloads, 1 empty source),
// big (202 codes over 4 sources), camera (a single camera session, 1 code → bare CSV export).
//
// Export behaviour follows the output-schema decision (#27): one CSV per source (`page,data` for
// PDFs, `source,locator,symbology,data` otherwise), bare CSV for exactly one source, `barcodes.zip`
// for 2+, one run-level `barcodes.json`. Copy copies payload text (HRI-escaped when binary).
// Terms follow CONTEXT.md: sources, origins, items, locators, sightings → results.

(function () {
    var params = new URLSearchParams(window.location.search);
    var VARIANTS = { a: 'One list', b: 'Source cards', c: 'Summary + table' };
    var variant = (params.get('variant') || '').toLowerCase();
    if (!VARIANTS[variant]) return; // normal app, untouched

    var RUNS = ['mixed', 'big', 'camera'];
    var RUN_LABELS = { mixed: 'Mixed run', big: '200 codes', camera: 'Camera single' };
    var BUILDERS = { mixed: buildMixed, big: buildBig, camera: buildCamera };

    var state = { variant: variant, run: 'mixed', sources: [] };
    var cycleVariant = null;

    // ---------------------------------------------------------------- helpers

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    function pad(n, w) {
        var s = String(n);
        while (s.length < w) s = '0' + s;
        return s;
    }

    // HRI escape: control chars as \xNN — what CSV and clipboard get (per #27)
    function escapeHRI(text) {
        var out = '';
        for (var i = 0; i < text.length; i++) {
            var c = text.charCodeAt(i);
            if (c < 0x20 || c === 0x7f) {
                var hex = c.toString(16).toUpperCase();
                out += '\\x' + (hex.length < 2 ? '0' + hex : hex);
            } else {
                out += text.charAt(i);
            }
        }
        return out;
    }

    function isUrl(text) {
        return /^https?:\/\//i.test(text);
    }

    // ---------------------------------------------------------------- demo data

    function src(name, origin, kind, items, results) {
        return { name: name, origin: origin, kind: kind, items: items, results: results };
    }

    function res(symbology, payload, locator, opts) {
        var r = Object.assign({ symbology: symbology, payload: payload, locator: locator }, opts || {});
        return r;
    }

    function binRes(symbology, locator, byteCount) {
        var hex = '1e2d009f4e31c0ff0d5a7b9c3f8e22a1b4c6d0e9f7a3b5c8d2e6f0a4b8c1d5e9f2a6b3c7d8e4a0b6c2d9e5f1a3b7c8d4';
        var raw = '';
        for (var i = 0; i < byteCount; i++) {
            raw += String.fromCharCode(parseInt(hex.substr(i * 2, 2), 16));
        }
        return {
            symbology: symbology,
            payload: raw,
            locator: locator,
            binary: true,
            contentType: 'application/octet-stream',
            byteCount: byteCount
        };
    }

    // 10 sources, 13 codes, 1 empty source, 1 binary payload, long payloads, duplicate names
    function buildMixed() {
        return [
            src('invoice-batch-2026.pdf', '', 'pdf', 12, [
                res('QR Code', 'https://accounts.example.com/verify?id=8f4e9d2a-7c1b-4e3f-9a2d-6b5c8e7f1a2b&source=invoice&expires=2027-04-30T23:59:59Z', 3),
                res('QR Code', 'WiFi:T:WPA;S:Office-5G;P:correct-horse-battery-staple;H:false;;', 7),
                res('DataMatrix', '{"invoice":"2026-0417","total":"1,284.50 EUR","issuer":"Nordlicht GmbH"}', 11)
            ]),
            src('customer-cards.pdf', '', 'pdf', 24, [
                res('DataMatrix', 'MEMBER:0042-2026-AR', 2),
                res('DataMatrix', 'MEMBER:0317-2026-BR', 19)
            ]),
            src('scan.png', 'photos/holiday/', 'image', 1, [
                res('EAN-13', '4006381333931', 1)
            ]),
            src('poster.jpg', 'photos/holiday/', 'image', 1, [
                res('QR Code', 'https://expo.example.com/hall-4?track=ai-infra&day=2', 1)
            ]),
            src('form.pdf', 'batch-2026.zip \u203A docs/', 'pdf', 4, [
                res('QR Code', 'https://forms.example.com/r/2026-registration?ref=zip', 2)
            ]),
            src('scan.png', 'batch-2026.zip \u203A docs/', 'image', 1, [
                res('QR Code', 'tel:+41446681800', 1)
            ]),
            src('pasted image', 'clipboard', 'pasted', 1, [
                binRes('DataMatrix', 1, 48)
            ]),
            src('camera session', '', 'camera', 40, [
                res('QR Code', 'https://example.com/menu?store=143', 3, { capturedAt: '14:32:07' }),
                res('QR Code', 'MECARD:N:Z\u00FCrcher Jonas;TEL:+41791234567;EMAIL:jonas@example.com;;', 7, { capturedAt: '14:32:11' })
            ]),
            src('empty-page-notes.pdf', '', 'pdf', 8, []),
            src('receipt.pdf', '', 'pdf', 2, [
                res('Code128', 'INV-2026-0417', 2)
            ])
        ];
    }

    // 202 codes over 4 sources: one big PDF, 1 empty source, 1 image with 2 codes
    function buildBig() {
        var results = [];
        for (var i = 1; i <= 200; i++) {
            results.push(res('QR Code', 'https://catalog.example.com/p/' + pad(i, 4), i));
        }
        return [
            src('catalog-2026.pdf', '', 'pdf', 200, results),
            src('scan.png', 'photos/holiday/', 'image', 1, [
                res('EAN-13', '4006381333931', 1),
                res('DataMatrix', 'MEMBER:0042-2026-AR', 1)
            ]),
            src('empty-page-notes.pdf', '', 'pdf', 8, []),
            src('poster.jpg', 'photos/holiday/', 'image', 1, [
                res('QR Code', 'https://expo.example.com/hall-4?track=ai-infra&day=2', 1)
            ])
        ];
    }

    // a single camera session, 1 code: bare CSV export, no ZIP
    function buildCamera() {
        return [
            src('camera session', '', 'camera', 40, [
                res('QR Code', 'https://example.com/coupon?code=SPRING26', 12, { capturedAt: '14:32:19' })
            ])
        ];
    }

    // ---------------------------------------------------------------- labels

    function pillLabel(kind) {
        return { pdf: 'PDF', image: 'Image', pasted: 'Pasted', camera: 'Camera' }[kind] || kind;
    }

    function itemMeta(s) {
        if (s.kind === 'pdf') return s.items + ' pages';
        if (s.kind === 'camera') return s.items + ' frames';
        return s.items + ' image' + (s.items === 1 ? '' : 's');
    }

    // locator label: "p." for PDFs, "frame " for camera; single-item image/pasted sources hide it
    function locatorLabel(s) {
        if (s.kind === 'pdf') return 'p.';
        if (s.kind === 'camera') return 'frame ';
        return null;
    }

    // per-source CSV file name (per #27): pasted.csv / camera.csv for unnamed sources,
    // name.csv otherwise, " (n)" suffixes when names collide within the run
    function csvNameMap() {
        var used = {};
        var map = [];
        state.sources.forEach(function (s) {
            var base;
            if (s.kind === 'pasted') base = 'pasted';
            else if (s.kind === 'camera') base = 'camera';
            else base = (s.name.replace(/\.[^.]+$/, '') || 'codes');
            var n = 1, name = base;
            while (used[name]) { n++; name = base + ' (' + n + ')'; }
            used[name] = true;
            map.push(name);
        });
        return map;
    }

    // ---------------------------------------------------------------- exports (per #27)

    function csvField(v) {
        var s = String(v);
        if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    function csvFor(s) {
        var rows = [];
        if (s.kind === 'pdf') {
            rows.push(['page', 'data']);
        } else {
            rows.push(['source', 'locator', 'symbology', 'data']);
        }
        s.results.forEach(function (r) {
            var payload = escapeHRI(r.payload);
            if (s.kind === 'pdf') {
                rows.push([r.locator, payload]);
            } else {
                rows.push([s.name, r.locator, r.symbology, payload]);
            }
        });
        return rows.map(function (row) { return row.map(csvField).join(','); }).join('\r\n');
    }

    function jsonRun() {
        var names = csvNameMap();
        var sources = [];
        state.sources.forEach(function (s, i) {
            if (!s.results.length) return;
            var entry = {
                name: s.name,
                csvFile: names[i] + '.csv',
                kind: s.kind,
                items: s.items
            };
            if (s.origin) entry.origin = s.origin;
            entry.codes = s.results.map(function (r) {
                var code = {
                    symbology: r.symbology,
                    payload: r.payload,
                    locator: r.locator
                };
                if (r.binary) {
                    code.contentType = r.contentType;
                    code.bytesBase64 = btoa(r.payload);
                }
                if (r.capturedAt) code.capturedAt = r.capturedAt;
                return code;
            });
            sources.push(entry);
        });
        return {
            version: 1,
            scannedAt: new Date().toISOString(),
            selection: { preset: 'QR codes' },
            sources: sources
        };
    }

    function download(blob, name) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.style.visibility = 'hidden';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    }

    // one adaptive Download button: bare CSV when exactly 1 source has results, barcodes.zip for 2+
    function downloadRun() {
        var names = csvNameMap();
        var withCodes = [];
        state.sources.forEach(function (s, i) {
            if (s.results.length) withCodes.push({ source: s, csvName: names[i] });
        });
        if (withCodes.length === 1) {
            download(new Blob([csvFor(withCodes[0].source)], { type: 'text/csv;charset=utf-8;' }), withCodes[0].csvName + '.csv');
        } else if (withCodes.length > 1) {
            var zip = new window.JSZip();
            withCodes.forEach(function (e) {
                zip.file(e.csvName + '.csv', csvFor(e.source));
            });
            zip.generateAsync({ type: 'blob' }).then(function (b) {
                download(b, 'barcodes.zip');
            });
        }
    }

    function downloadJson() {
        var json = JSON.stringify(jsonRun(), null, 2);
        download(new Blob([json], { type: 'application/json;charset=utf-8;' }), 'barcodes.json');
    }

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        var ta = el('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        return Promise.resolve();
    }

    function copyAll() {
        var lines = [];
        state.sources.forEach(function (s) {
            s.results.forEach(function (r) { lines.push(escapeHRI(r.payload)); });
        });
        if (!lines.length) return;
        copyText(lines.join('\n')).then(function () {
            toast('Copied ' + lines.length + ' codes');
        });
    }

    function copyOne(r) {
        copyText(escapeHRI(r.payload)).then(function () {
            toast('Copied');
        });
    }

    function copySource(s) {
        var lines = [];
        s.results.forEach(function (r) { lines.push(escapeHRI(r.payload)); });
        if (!lines.length) return;
        copyText(lines.join('\n')).then(function () {
            toast('Copied ' + lines.length + ' codes');
        });
    }

    // ---------------------------------------------------------------- shared pieces

    function counts() {
        var codes = 0, withCodes = 0, empty = 0;
        state.sources.forEach(function (s) {
            codes += s.results.length;
            if (s.results.length) withCodes++;
            else empty++;
        });
        return { codes: codes, withCodes: withCodes, empty: empty };
    }

    function exportActions() {
        var c = counts();
        var actions = el('div', 'rp-export__actions');
        var copyBtn = el('button', 'btn btn-sm btn-outline-secondary rp-btn', 'Copy all');
        copyBtn.addEventListener('click', copyAll);
        var jsonBtn = el('button', 'btn btn-sm btn-outline-secondary rp-btn', 'JSON');
        jsonBtn.addEventListener('click', downloadJson);
        var dlBtn = el('button', 'btn btn-sm btn-primary rp-btn',
            c.withCodes > 1 ? 'Download ZIP' : 'Download CSV');
        dlBtn.addEventListener('click', downloadRun);
        if (c.withCodes > 1) {
            dlBtn.title = 'ZIP with one CSV per source';
        } else {
            dlBtn.title = 'Bare CSV download (single source)';
        }
        actions.appendChild(copyBtn);
        actions.appendChild(jsonBtn);
        actions.appendChild(dlBtn);
        return actions;
    }

    function exportLabel() {
        var c = counts();
        var label = c.codes + ' code' + (c.codes === 1 ? '' : 's') + ' \u00B7 ' +
            c.withCodes + ' of ' + state.sources.length + ' sources';
        if (c.empty) label += ' \u00B7 ' + c.empty + ' empty';
        return label;
    }

    var SYM_CLASSES = {
        'QR Code': 'rp-sym--qr',
        'DataMatrix': 'rp-sym--dm',
        'EAN-13': 'rp-sym--ean',
        'Code128': 'rp-sym--code128'
    };

    function symBadge(r) {
        return el('span', 'rp-sym ' + (SYM_CLASSES[r.symbology] || 'rp-sym--other'), r.symbology);
    }

    function locatorChip(r, s) {
        var label = locatorLabel(s);
        if (!label) return null;
        return el('span', 'rp-locator', label + r.locator);
    }

    function payloadEl(r) {
        var wrap = el('div', 'rp-payload');
        var text = escapeHRI(r.payload);
        var span = el('span', 'rp-payload__text', text);
        if (r.binary) {
            span.classList.add('is-binary');
            wrap.appendChild(el('span', 'rp-payload__binary', 'binary \u00B7 ' + r.contentType + ' \u00B7 ' + r.byteCount + ' bytes'));
        }
        wrap.appendChild(span);
        if (text.length > 88) {
            span.classList.add('is-clamped');
            var more = el('button', 'rp-payload__more', 'Show more');
            more.addEventListener('click', function () {
                var clamped = span.classList.toggle('is-clamped');
                more.textContent = clamped ? 'Show more' : 'Show less';
            });
            wrap.appendChild(more);
        }
        return wrap;
    }

    function actions(r) {
        var wrap = el('div', 'rp-actions');
        var copy = el('button', 'rp-act', 'Copy');
        copy.addEventListener('click', function () { copyOne(r); });
        wrap.appendChild(copy);
        if (isUrl(r.payload)) {
            var open = el('a', 'rp-act rp-act--open', 'Open');
            open.href = r.payload;
            open.target = '_blank';
            open.rel = 'noopener noreferrer';
            wrap.appendChild(open);
        }
        return wrap;
    }

    var toastNode = null;
    function toast(msg) {
        if (toastNode) toastNode.remove();
        toastNode = el('div', 'rp-toast', msg);
        document.body.appendChild(toastNode);
        setTimeout(function () {
            if (toastNode) { toastNode.remove(); toastNode = null; }
        }, 3500);
    }

    // ---------------------------------------------------------------- variant A · One list

    function renderA(root) {
        var bar = el('div', 'rp-export');
        bar.appendChild(el('span', 'rp-export__label', exportLabel()));
        bar.appendChild(exportActions());
        root.appendChild(bar);

        var list = el('div', 'rp-listA');
        state.sources.forEach(function (s) {
            var head = el('div', 'rp-listA__head');
            head.appendChild(el('span', 'rp-pill rp-pill--' + s.kind, pillLabel(s.kind)));
            head.appendChild(el('span', 'rp-listA__name', s.name));
            if (s.origin) head.appendChild(el('span', 'rp-listA__origin', s.origin));
            head.appendChild(el('span', 'rp-listA__count',
                s.results.length + ' code' + (s.results.length === 1 ? '' : 's')));
            list.appendChild(head);
            if (!s.results.length) {
                list.appendChild(el('div', 'rp-listA__empty', 'No codes found'));
                return;
            }
            s.results.forEach(function (r) {
                var row = el('div', 'rp-listA__row');
                var chip = locatorChip(r, s);
                if (chip) row.appendChild(chip);
                row.appendChild(symBadge(r));
                row.appendChild(payloadEl(r));
                row.appendChild(actions(r));
                list.appendChild(row);
            });
        });
        root.appendChild(list);
    }

    // ---------------------------------------------------------------- variant B · Source cards

    function renderB(root) {
        var summary = el('div', 'rp-summary');
        summary.appendChild(el('span', 'rp-summary__title', exportLabel()));
        summary.appendChild(exportActions());
        root.appendChild(summary);

        var names = csvNameMap();
        var cards = el('div', 'rp-cards');
        state.sources.forEach(function (s, i) {
            var card = el('div', 'rp-card' + (s.results.length ? '' : ' rp-card--empty'));
            var head = el('div', 'rp-card__head');
            var toggle = el('button', 'rp-card__toggle');
            toggle.type = 'button';
            toggle.appendChild(el('span', 'rp-pill rp-pill--' + s.kind, pillLabel(s.kind)));
            toggle.appendChild(el('span', 'rp-card__name', s.name));
            if (s.origin) toggle.appendChild(el('span', 'rp-card__origin', s.origin));
            toggle.appendChild(el('span', 'rp-card__meta',
                itemMeta(s) + ' \u00B7 ' + s.results.length + ' code' + (s.results.length === 1 ? '' : 's')));
            toggle.appendChild(el('span', 'rp-card__chev', '\u25BE'));
            toggle.addEventListener('click', function () {
                card.classList.toggle('is-open');
            });
            head.appendChild(toggle);
            if (s.results.length) {
                var acts = el('div', 'rp-card__acts');
                var copyBtn = el('button', 'rp-act', 'Copy source');
                copyBtn.addEventListener('click', function () { copySource(s); });
                var csvBtn = el('button', 'rp-act', 'CSV');
                csvBtn.addEventListener('click', function () {
                    download(new Blob([csvFor(s)], { type: 'text/csv;charset=utf-8;' }), names[i] + '.csv');
                });
                acts.appendChild(copyBtn);
                acts.appendChild(csvBtn);
                head.appendChild(acts);
            }
            card.appendChild(head);
            var body = el('div', 'rp-card__body');
            if (!s.results.length) {
                body.appendChild(el('div', 'rp-card__empty', 'No codes found'));
            } else {
                s.results.forEach(function (r) {
                    var row = el('div', 'rp-listA__row');
                    var chip = locatorChip(r, s);
                    if (chip) row.appendChild(chip);
                    row.appendChild(symBadge(r));
                    row.appendChild(payloadEl(r));
                    row.appendChild(actions(r));
                    body.appendChild(row);
                });
            }
            card.appendChild(body);
            if (s.results.length) card.classList.add('is-open');
            cards.appendChild(card);
        });
        root.appendChild(cards);
    }

    // ---------------------------------------------------------------- variant C · Summary + table

    function renderC(root) {
        var c = counts();
        var summary = el('div', 'rp-sum');
        var nums = el('div', 'rp-sum__nums');
        var big = el('div', 'rp-sum__big');
        big.appendChild(el('span', 'rp-sum__bignum', String(c.codes)));
        big.appendChild(el('span', 'rp-sum__biglabel', 'codes'));
        nums.appendChild(big);
        var sub = el('div', 'rp-sum__sub');
        sub.appendChild(el('span', 'rp-sum__stat', c.withCodes + ' of ' + state.sources.length + ' sources'));
        if (c.empty) sub.appendChild(el('span', 'rp-sum__stat rp-sum__stat--empty', c.empty + ' empty'));
        var bySym = {};
        state.sources.forEach(function (s) {
            s.results.forEach(function (r) {
                bySym[r.symbology] = (bySym[r.symbology] || 0) + 1;
            });
        });
        Object.keys(bySym).sort().forEach(function (sym) {
            sub.appendChild(el('span', 'rp-sym ' + (SYM_CLASSES[sym] || 'rp-sym--other'), sym + ' \u00D7' + bySym[sym]));
        });
        nums.appendChild(sub);
        summary.appendChild(nums);
        summary.appendChild(exportActions());
        root.appendChild(summary);

        var tablewrap = el('div', 'rp-tablewrap');
        var table = el('table', 'rp-table');
        var thead = el('thead');
        var hr = el('tr');
        ['#', 'Source', 'Locator', 'Symbology', 'Payload', ''].forEach(function (h) {
            hr.appendChild(el('th', null, h));
        });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = el('tbody');
        var n = 0;
        state.sources.forEach(function (s) {
            s.results.forEach(function (r) {
                n++;
                var tr = el('tr');
                tr.appendChild(el('td', 'rp-table__idx', String(n)));
                var tdSrc = el('td');
                var srcWrap = el('div', 'rp-table__src');
                srcWrap.appendChild(el('span', 'rp-pill rp-pill--' + s.kind, pillLabel(s.kind)));
                srcWrap.appendChild(el('span', 'rp-table__srcname', s.name));
                if (s.origin) srcWrap.appendChild(el('span', 'rp-table__srcorigin', s.origin));
                tdSrc.appendChild(srcWrap);
                tr.appendChild(tdSrc);
                var chip = locatorChip(r, s);
                tr.appendChild(el('td', 'rp-table__locator', chip ? chip.textContent : ''));
                var tdSym = el('td');
                tdSym.appendChild(symBadge(r));
                tr.appendChild(tdSym);
                var tdPay = el('td');
                tdPay.appendChild(payloadEl(r));
                tr.appendChild(tdPay);
                var tdAct = el('td');
                tdAct.appendChild(actions(r));
                tr.appendChild(tdAct);
                tbody.appendChild(tr);
            });
        });
        table.appendChild(tbody);
        tablewrap.appendChild(table);
        root.appendChild(tablewrap);

        var emptyNames = [];
        state.sources.forEach(function (s) {
            if (!s.results.length) emptyNames.push(s.name);
        });
        if (emptyNames.length) {
            root.appendChild(el('p', 'rp-table__empty',
                emptyNames.length + ' source' + (emptyNames.length === 1 ? '' : 's') + ' with no codes: ' +
                emptyNames.join(', ')));
        }
    }

    // ---------------------------------------------------------------- queue seeding (butt against the real app)

    function seedQueue() {
        var list = document.getElementById('fileList');
        if (!list) return;
        list.innerHTML = '';
        state.sources.forEach(function (s) {
            var li = el('li', 'file-row ' + (s.results.length ? 'is-done' : 'is-empty'));
            var top = el('div', 'file-row__top');
            top.appendChild(el('span', 'rp-pill rp-pill--' + s.kind, pillLabel(s.kind)));
            top.appendChild(el('span', 'file-row__name', s.name));
            top.appendChild(el('span', 'file-row__meta', itemMeta(s)));
            li.appendChild(top);
            var second = el('div', 'file-row__top');
            second.appendChild(el('span', 'fstate fstate--' + (s.results.length ? 'done' : 'empty'),
                s.results.length
                    ? s.results.length + ' code' + (s.results.length === 1 ? '' : 's') + ' found'
                    : 'No codes'));
            if (s.origin) second.appendChild(el('span', 'rp-origin', s.origin));
            li.appendChild(second);
            list.appendChild(li);
        });
    }

    // ---------------------------------------------------------------- variant switcher

    function buildBar() {
        var bar = el('div', 'rp-bar');
        var prev = el('button', 'rp-bar__arrow', '\u25C0');
        prev.type = 'button';
        var label = el('span', 'rp-bar__label', state.variant.toUpperCase() + ' \u00B7 ' + VARIANTS[state.variant]);
        var next = el('button', 'rp-bar__arrow', '\u25B6');
        next.type = 'button';

        cycleVariant = function (dir) {
            var keys = Object.keys(VARIANTS);
            var i = keys.indexOf(state.variant);
            state.variant = keys[(i + dir + keys.length) % keys.length];
            var url = new URL(window.location.href);
            url.searchParams.set('variant', state.variant);
            history.replaceState(null, '', url.toString());
            label.textContent = state.variant.toUpperCase() + ' \u00B7 ' + VARIANTS[state.variant];
            render();
        };

        prev.addEventListener('click', function () { cycleVariant(-1); });
        next.addEventListener('click', function () { cycleVariant(1); });
        bar.appendChild(prev);
        bar.appendChild(label);
        bar.appendChild(next);

        var runs = el('div', 'rp-bar__runs');
        function updateRunButtons() {
            runs.querySelectorAll('.rp-bar__run').forEach(function (b) {
                b.classList.toggle('is-active', b.dataset.run === state.run);
            });
        }
        RUNS.forEach(function (r) {
            var b = el('button', 'rp-bar__run', RUN_LABELS[r]);
            b.type = 'button';
            b.dataset.run = r;
            b.addEventListener('click', function () {
                state.run = r;
                state.sources = BUILDERS[r]();
                var url = new URL(window.location.href);
                url.searchParams.set('run', r);
                history.replaceState(null, '', url.toString());
                render();
                updateRunButtons();
            });
            runs.appendChild(b);
        });
        updateRunButtons();
        bar.appendChild(runs);
        document.body.appendChild(bar);
    }

    document.addEventListener('keydown', function (e) {
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (e.key === 'ArrowLeft') cycleVariant(-1);
        if (e.key === 'ArrowRight') cycleVariant(1);
    });

    // ---------------------------------------------------------------- boot

    function render() {
        seedQueue();
        var root = document.getElementById('rp-root');
        if (!root) return;
        root.innerHTML = '';
        if (state.variant === 'a') renderA(root);
        else if (state.variant === 'b') renderB(root);
        else renderC(root);
    }

    var run = (params.get('run') || 'mixed').toLowerCase();
    if (RUNS.indexOf(run) >= 0) state.run = run;
    state.sources = BUILDERS[state.run]();

    // the real scan-finished chrome is replaced by the prototype in the same slot
    var zipReady = document.getElementById('zipReady');
    var scanningZone = document.getElementById('scanningZone');
    if (zipReady) zipReady.hidden = true;
    if (scanningZone) scanningZone.hidden = true;

    var form = document.getElementById('pdfScanForm');
    var root = el('div', 'rp-root');
    root.id = 'rp-root';
    if (zipReady && zipReady.parentNode) {
        zipReady.parentNode.insertBefore(root, zipReady);
    } else if (form && form.parentNode) {
        form.parentNode.insertAdjacentElement('afterend', root);
    } else {
        document.querySelector('.scan-card').appendChild(root);
    }

    buildBar();
    render();
})();
