// PROTOTYPE — throwaway UI for ticket #28 (unified intake), branch prototype/unified-intake.
// Not for merge into main. Without ?variant= this module does nothing and the app is untouched;
// the only path to users is this branch, so the prototype chrome can't ship.
//
// Question under test: what does the drop zone / input area look like once it accepts more
// than PDFs? Three structurally different variants of the intake surface, mounted on the
// real page (real header, real stylesheet, real density), switchable via ?variant=a|b|c
// and the floating bottom bar:
//
//   A · One zone    — today's layout, widened: one drop zone for everything, paste + camera beneath
//   B · Three tiles — files/folders, paste and camera as three equal entry tiles
//   C · Queue first — slim "add sources" toolbar, whole page is the drop target, queue dominates
//
// Everything is fake: rows are seeded, scanning is simulated, the camera button is a stub
// (live-scan UX is ticket #30). Terms follow CONTEXT.md: sources, containers, origins.

(function () {
    var params = new URLSearchParams(window.location.search);
    var variant = (params.get('variant') || '').toLowerCase();
    var VARIANTS = { a: 'One zone', b: 'Three tiles', c: 'Queue first' };
    if (!VARIANTS[variant]) return; // normal app, untouched

    var current = variant;

    // ---------------------------------------------------------------- state

    var rows = [];
    var nextId = 1;
    var timers = [];

    // read "kinds": what the decoder can honestly take (per the image-decoding research)
    var SUPPORTED_EXT = {
        pdf: 'pdf',
        png: 'image', jpg: 'image', jpeg: 'image', webp: 'image',
        avif: 'image', bmp: 'image', gif: 'image'
    };

    function extOf(name) {
        var i = name.lastIndexOf('.');
        return i < 0 ? '' : name.slice(i + 1).toLowerCase();
    }

    function kindOf(name) {
        var ext = extOf(name);
        if (ext === 'pdf') return 'pdf';
        if (SUPPORTED_EXT[ext]) return 'image';
        return 'unknown';
    }

    function makeRow(spec) {
        return Object.assign({
            id: nextId++,
            kind: 'image',
            name: '',
            origin: '',        // origin subline: zip/folder path, clipboard, camera
            container: '',     // name of the container it came from (for grouping)
            state: 'queued',   // queued | scanning | done | empty | error
            items: 0,          // items in this source (pages for PDFs, 1 for images)
            page: 0,
            codes: 0,
            note: '',          // e.g. "first frame only"
            errorMessage: ''
        }, spec);
    }

    function seed() {
        scanStarted = false;
        timers.forEach(clearInterval);
        timers = [];
        rows = [
            makeRow({ kind: 'pdf', name: 'customer-cards.pdf', items: 4, state: 'done', codes: 6 }),
            makeRow({ kind: 'image', name: 'receipt-scan.png' }),
            makeRow({ kind: 'image', name: 'burst-48mp.png', meta: '48 MP' }),
            makeRow({ kind: 'image', name: 'whiteboard.jpg', state: 'done', codes: 1 }),
            makeRow({ kind: 'paste', name: 'Pasted image', origin: 'Clipboard', state: 'done', codes: 2 }),
            // a ZIP container: not a source itself, expanded at intake into sources.
            // Two rows share the name scan.png — origin is what tells them apart.
            makeRow({ kind: 'pdf', name: 'invoice.pdf', origin: 'docs/', container: 'batch-2026.zip', items: 2, state: 'done', codes: 1 }),
            makeRow({ kind: 'image', name: 'scan.png', origin: 'docs/', container: 'batch-2026.zip' }),
            makeRow({ kind: 'image', name: 'scan.png', origin: 'photos/', container: 'batch-2026.zip', state: 'empty' }),
            makeRow({ kind: 'unknown', name: 'readme.txt', origin: 'docs/', container: 'batch-2026.zip', state: 'error', errorMessage: 'Can\u2019t read this file type' }),
            // a dropped folder, also expanded at intake
            makeRow({ kind: 'image', name: 'qr-sign.jpg', origin: '', container: 'holidays/', state: 'done', codes: 1 }),
            makeRow({ kind: 'unknown', name: 'notes.txt', state: 'error', errorMessage: 'Can\u2019t read this file type' }),
            makeRow({ kind: 'image', name: 'animation.gif', note: 'First frame only' })
        ];
    }

    function sourceCount() {
        var n = 0;
        for (var i = 0; i < rows.length; i++) if (rows[i].kind !== 'unknown') n++;
        return n;
    }

    function unsupportedCount() {
        var n = 0;
        for (var i = 0; i < rows.length; i++) if (rows[i].kind === 'unknown') n++;
        return n;
    }

    // ---------------------------------------------------------------- helpers

    function el(tag, cls, text) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function stateText(row) {
        switch (row.state) {
            case 'queued': return 'Queued';
            case 'scanning': return row.items > 1 ? 'Scanning p.' + row.page + '/' + row.items : 'Scanning\u2026';
            case 'done': return row.codes + ' code' + (row.codes === 1 ? '' : 's') + ' found';
            case 'empty': return 'No codes';
            case 'error': return row.errorMessage || 'Scan failed';
        }
        return '';
    }

    var TYPE_LABEL = { pdf: 'PDF', image: 'Image', paste: 'Pasted', camera: 'Camera', unknown: 'File' };

    function typePill(row) {
        var pill = el('span', 'pi-type pi-type--' + row.kind, TYPE_LABEL[row.kind] || 'File');
        if (row.kind === 'paste' || row.kind === 'camera') pill.textContent = TYPE_LABEL[row.kind];
        return pill;
    }

    function metaText(row) {
        if (row.kind === 'pdf' && row.items > 0) return row.items + 'p';
        if (row.meta) return row.meta;
        return '';
    }

    function rowNode(row, showOrigin) {
        var li = el('li', 'pi-row is-' + row.state);
        li.dataset.rowId = String(row.id);

        var top = el('div', 'pi-row__top');
        top.appendChild(typePill(row));

        var name = el('span', 'pi-row__name', row.name);
        top.appendChild(name);

        if (row.note) {
            var note = el('span', 'pi-row__meta', row.note);
            note.title = 'Animated GIFs are scanned on their first frame.';
            top.appendChild(note);
        }

        var meta = el('span', 'pi-row__meta', metaText(row));
        top.appendChild(meta);
        li.appendChild(top);

        if (showOrigin && (row.origin || row.container)) {
            var origin = el('div', 'pi-row__origin');
            if (row.container) {
                var c = el('span', 'pi-originzip', row.container + ' \u203A ');
                origin.appendChild(c);
            }
            origin.appendChild(document.createTextNode(row.origin || ''));
            li.appendChild(origin);
        }

        var side = el('div', 'pi-row__side');
        var badge = el('span', 'fstate fstate--' + row.state, stateText(row));
        side.appendChild(badge);
        var remove = el('button', 'file-remove', '\u00D7');
        remove.setAttribute('aria-label', 'Remove');
        (function (id) {
            remove.addEventListener('click', function () {
                rows = rows.filter(function (r) { return r.id !== id; });
                render();
            });
        })(row.id);
        side.appendChild(remove);
        li.appendChild(side);

        var bar = el('div', 'pi-row__bar');
        var track = el('div', 'scan-progress__track filebar');
        track.style.width = '100%';
        var fill = el('div', 'scan-progress__fill');
        fill.style.width = (row.items > 0 ? Math.round((row.page / row.items) * 100) : 0) + '%';
        track.appendChild(fill);
        bar.appendChild(track);
        li.appendChild(bar);

        return li;
    }

    function queueNode(showOrigin, groupContainers) {
        var wrap = el('div');
        var head = el('div', 'pi-queuehead');
        var title = el('p', 'pi-queuehead__title', 'Sources (' + sourceCount() + ')');
        head.appendChild(title);
        var hint = el('span', 'pi-row__meta', 'Names may repeat \u2014 origin tells them apart');
        head.appendChild(hint);
        wrap.appendChild(head);

        var list = el('ul', 'pi-queue');

        if (rows.length === 0) {
            var ghost = el('div', 'pi-ghost', 'Nothing here yet \u2014 drop files anywhere on this page, paste an image, or use the camera.');
            wrap.appendChild(ghost);
            return wrap;
        }

        var lastContainer = null;
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            if (groupContainers && row.container && row.container !== lastContainer) {
                lastContainer = row.container;
                var group = el('div', 'pi-group');
                var members = rows.filter(function (r) { return r.container === row.container; }).length;
                var gname = el('span', 'pi-group__name', row.container);
                var gcount = el('span', 'pi-group__count', 'container \u00B7 ' + members + ' source' + (members === 1 ? '' : 's'));
                group.appendChild(gname);
                group.appendChild(gcount);
                list.appendChild(group);
            }
            list.appendChild(rowNode(row, showOrigin));
        }
        wrap.appendChild(list);
        return wrap;
    }

    function controlsNode() {
        var wrap = el('div', 'batch-controls');
        var scan = el('button', 'btn btn-primary scan-card__button', 'Scan for barcodes');
        scan.type = 'button';
        scan.disabled = sourceCount() === 0;
        scan.addEventListener('click', simulate);
        var clear = el('button', 'btn btn-outline-secondary', 'Clear');
        clear.type = 'button';
        clear.addEventListener('click', function () {
            timers.forEach(clearInterval);
            timers = [];
            rows = [];
            scanStarted = false;
            render();
        });
        wrap.appendChild(scan);
        wrap.appendChild(clear);
        return wrap;
    }

    function aggBarNode() {
        var bar = el('div', 'batch-bar');
        bar.hidden = !scanStarted;
        var label = el('p', 'batch-bar__label');
        var counter = el('span', 'batch-bar__counter', '0');
        bar._counter = counter;
        counter.textContent = String(rows.filter(function (r) { return r.kind !== 'unknown' && (r.state === 'done' || r.state === 'empty'); }).length);
        label.appendChild(counter);
        label.appendChild(document.createTextNode(' of ' + sourceCount() + ' sources done'));
        bar.appendChild(label);
        var track = el('div', 'scan-progress__track');
        var fill = el('div', 'scan-progress__fill');
        var done = rows.filter(function (r) { return r.kind !== 'unknown' && (r.state === 'done' || r.state === 'empty'); }).length;
        var total = sourceCount();
        fill.style.width = total > 0 ? Math.round((done / total) * 100) + '%' : '0%';
        track.appendChild(fill);
        bar.appendChild(track);
        return bar;
    }

    function noticeNode() {
        var n = unsupportedCount();
        var notice = el('div', 'pi-notice');
        if (n === 0) {
            notice.hidden = true;
            return notice;
        }
        notice.appendChild(document.createTextNode(
            n === 1 ? '1 file can\u2019t be read \u2014 PDFs and common images are supported.'
                    : n + ' files can\u2019t be read \u2014 PDFs and common images are supported.'));
        var dismiss = el('button', 'pi-notice__dismiss', '\u00D7');
        dismiss.setAttribute('aria-label', 'Dismiss');
        dismiss.addEventListener('click', function () {
            rows = rows.filter(function (r) { return r.kind !== 'unknown'; });
            render();
        });
        notice.appendChild(dismiss);
        return notice;
    }

    // ------------------------------------------------------------- file intake

    function addRealFiles(fileListLike, containerName, basePath) {
        var added = 0;
        for (var i = 0; i < fileListLike.length && added < 50; i++) {
            var file = fileListLike[i];
            var rel = file._piPath || file.webkitRelativePath || '';
            var name = file.name;
            var kind = kindOf(name);
            var ext = extOf(name);
            if (ext === 'zip') { expandZip(name); continue; }
            var row = makeRow({
                kind: kind,
                name: name,
                container: containerName || '',
                origin: rel ? rel.replace(/[^/]*$/, '') : (basePath || ''),
                note: ext === 'gif' ? 'First frame only' : '',
                meta: ''
            });
            if (kind === 'unknown') {
                row.state = 'error';
                row.errorMessage = 'Can\u2019t read this file type';
            }
            rows.push(row);
            added++;
        }
        if (fileListLike.length > 50) toast('Demo caps at 50 files \u2014 the rest were ignored');
        render();
    }

    function expandZip(name) {
        // fake expansion: a real container expands at intake into sources (CONTEXT.md);
        // contents here are pretend, including one unsupported file inside the archive.
        var base = name;
        rows.push(makeRow({ kind: 'pdf', name: 'ticket.pdf', origin: 'scans/', container: base, items: 1, state: 'queued' }));
        rows.push(makeRow({ kind: 'image', name: 'poster.png', origin: 'scans/', container: base }));
        rows.push(makeRow({ kind: 'unknown', name: 'about.html', origin: '', container: base, state: 'error', errorMessage: 'Can\u2019t read this file type' }));
        toast('ZIP expanded at intake \u2014 ' + base + ' \u2192 3 sources (demo contents)');
        render();
    }

    function walkEntry(entry, path, out, resolve) {
        if (out.length >= 50) { resolve(); return; }
        if (entry.isFile) {
            entry.file(function (file) {
                file._piPath = path + entry.name;
                out.push(file);
                resolve();
            }, resolve);
        } else if (entry.isDirectory) {
            var reader = entry.createReader();
            var readBatch = function () {
                reader.readEntries(function (entries) {
                    if (entries.length === 0) { resolve(); return; }
                    var waiting = entries.length;
                    entries.forEach(function (child) {
                        walkEntry(child, path + entry.name + '/', out, function () {
                            if (--waiting === 0) readBatch();
                        });
                    });
                }, resolve);
            };
            readBatch();
        } else {
            resolve();
        }
    }

    function handleDrop(fileList, evt) {
        var items = evt && evt.dataTransfer ? evt.dataTransfer.items : null;
        var entries = [];
        if (items && items.length && items[0].webkitGetAsEntry) {
            for (var i = 0; i < items.length; i++) {
                var entry = items[i].webkitGetAsEntry();
                if (entry) entries.push(entry);
            }
        }
        if (entries.length) {
            var out = [];
            var pending = entries.length;
            entries.forEach(function (e) {
                walkEntry(e, '', out, function () {
                    if (--pending === 0) {
                        // classify: a single dropped directory becomes one container
                        var dirs = entries.filter(function (e) { return e.isDirectory; });
                        addRealFiles(out, dirs.length === 1 && entries.length === 1 ? entries[0].name : '', '');
                    }
                });
            });
        } else {
            addRealFiles(fileList);
        }
    }

    function addPasteDemo() {
        rows.push(makeRow({ kind: 'paste', name: 'Pasted image', origin: 'Clipboard' }));
        render();
    }

    function tryClipboard() {
        if (navigator.clipboard && navigator.clipboard.read) {
            navigator.clipboard.read().then(function (items) {
                var found = false;
                for (var i = 0; i < items.length; i++) {
                    var types = items[i].types || [];
                    for (var j = 0; j < types.length; j++) {
                        if (types[j].indexOf('image') === 0) { found = true; break; }
                    }
                }
                if (found) {
                    rows.push(makeRow({ kind: 'paste', name: 'Pasted image', origin: 'Clipboard' }));
                    render();
                } else {
                    toast('No image on the clipboard');
                }
            }).catch(function () {
                toast('Clipboard read blocked here \u2014 added a demo pasted source');
                addPasteDemo();
            });
        } else {
            toast('Clipboard API unavailable \u2014 added a demo pasted source');
            addPasteDemo();
        }
    }

    function addCameraStub() {
        rows.push(makeRow({
            kind: 'camera',
            name: 'Camera session',
            state: 'done',
            codes: 3,
            note: 'Stub \u2014 live UX is ticket #30'
        }));
        toast('Camera entry point is a stub here \u2014 the live-scan UX is its own prototype (#30)');
        render();
    }

    var scanStarted = false;

    function simulate() {
        var pending = rows.filter(function (r) { return r.state === 'queued'; });
        if (pending.length === 0) return;
        scanStarted = true;
        pending.forEach(function (row, i) {
            var items = row.kind === 'pdf' ? (row.items || 3) : 1;
            row.items = items;
            var t = setTimeout(function () {
                row.state = 'scanning';
                row.page = 0;
                var tick = setInterval(function () {
                    row.page++;
                    if (row.page >= items) {
                        clearInterval(tick);
                        var out = Math.random();
                        if (out < 0.2) { row.state = 'empty'; row.codes = 0; }
                        else { row.state = 'done'; row.codes = 1 + Math.floor(Math.random() * 3); }
                    }
                    render();
                }, 450);
                timers.push(tick);
            }, 250 + i * 350);
            timers.push(t);
        });
        render();
    }

    // ---------------------------------------------------------------- variants

    function heroNode(icon, title, lead) {
        var hero = el('div', 'pi-hero');
        if (icon) {
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '44');
            svg.setAttribute('height', '44');
            svg.setAttribute('fill', 'currentColor');
            svg.setAttribute('viewBox', '0 0 16 16');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('class', 'pi-hero__icon');
            var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            // bootstrap-icons "upc-scan"
            p.setAttribute('d', 'M1.5 1a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 1 0v-13a.5.5 0 0 0-.5-.5m2.5 0a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 1 0v-13a.5.5 0 0 0-.5-.5m3.5 0a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 1 0v-13a.5.5 0 0 0-.5-.5m2.5 0a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 1 0v-13a.5.5 0 0 0-.5-.5m3.5 0a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 1 0v-13a.5.5 0 0 0-.5-.5M1.5 3.5a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm3 0a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm3 0a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm3 0a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zM1.5 6a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm3 0a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm3 0a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm3 0a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm3.5.5a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0-.5.5M1.5 8.5a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm3 0a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm3 0a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm3 0a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm3.5.5a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0-.5.5M1.5 11a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm3 0a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm3 0a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1zm3 0a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1z');
            svg.appendChild(p);
            hero.appendChild(svg);
        }
        hero.appendChild(el('h1', 'pi-hero__title', title));
        hero.appendChild(el('p', 'pi-hero__lead', lead));
        return hero;
    }

    function hiddenInput(multiple, directory) {
        var input = el('input');
        input.type = 'file';
        input.multiple = !!multiple;
        if (directory) input.webkitdirectory = true;
        input.addEventListener('change', function () {
            var files = Array.from(input.files || []);
            if (directory) {
                // one dropped/chosen folder is one container expanding into sources
                var root = files.length && files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : '';
                addRealFiles(files, root, '');
            } else {
                addRealFiles(files);
            }
            input.value = '';
        });
        return input;
    }

    function pasteButton(cls) {
        var b = el('button', cls, 'Paste image');
        b.type = 'button';
        b.addEventListener('click', tryClipboard);
        return b;
    }

    function cameraButton(cls) {
        var b = el('button', cls, 'Scan with camera');
        b.type = 'button';
        b.addEventListener('click', addCameraStub);
        return b;
    }

    function typesLine() {
        return el('p', 'pi-types', 'Reads PDF \u00B7 PNG \u00B7 JPG \u00B7 WebP \u00B7 GIF (first frame) \u00B7 BMP \u00B7 AVIF \u2014 folders and ZIPs expand automatically');
    }

    function variantA(root) {
        root.appendChild(heroNode(true,
            'Scan QR codes and barcodes',
            'Drop PDFs, images, folders or ZIP archives \u2014 or paste a screenshot. Everything runs in your browser; nothing is uploaded.'));

        var fileInput = hiddenInput(true, false);
        var dirInput = hiddenInput(false, true);

        var zone = el('label', 'pi-zone');
        zone.appendChild(el('span', 'pi-zone__hint'));
        zone.querySelector('.pi-zone__hint').innerHTML = 'Drop <strong>files, folders or ZIPs</strong> here, or <span class="pi-zone__browse">browse</span>';
        zone.addEventListener('click', function (e) { e.preventDefault(); fileInput.click(); });
        wireDrop(zone);
        root.appendChild(zone);

        var secondary = el('div', 'batch-controls');
        secondary.appendChild(pasteButton('btn btn-outline-secondary'));
        secondary.appendChild(cameraButton('btn btn-outline-secondary'));
        var folderLink = el('button', 'btn btn-link btn-sm pi-zone__browse', 'choose folder\u2026');
        folderLink.type = 'button';
        folderLink.addEventListener('click', function () { dirInput.click(); });
        secondary.appendChild(folderLink);
        root.appendChild(secondary);
        root.appendChild(typesLine());

        var agg = aggBarNode();
        root.appendChild(agg);
        root.appendChild(noticeNode());
        root.appendChild(queueNode(true, false));
        root.appendChild(controlsNode());

        root.appendChild(fileInput);
        root.appendChild(dirInput);
    }

    function variantB(root) {
        root.appendChild(heroNode(true,
            'Scan anything with a barcode',
            'Bring PDFs, photos, screenshots, whole folders \u2014 even a live camera. Nothing leaves your device.'));

        var fileInput = hiddenInput(true, false);
        var dirInput = hiddenInput(false, true);

        var tiles = el('div', 'pi-tiles');

        var dropTile = el('button', 'pi-tile pi-tile--drop');
        dropTile.type = 'button';
        var dropTitle = el('span', 'pi-tile__title', 'Files & folders');
        var dropSub = el('span', 'pi-tile__sub', 'Drop here, browse, or add a ZIP');
        dropTile.appendChild(dropTitle);
        dropTile.appendChild(dropSub);
        dropTile.addEventListener('click', function () { fileInput.click(); });
        wireDrop(dropTile);
        tiles.appendChild(dropTile);

        var pasteTile = el('button', 'pi-tile');
        pasteTile.type = 'button';
        pasteTile.appendChild(el('span', 'pi-tile__title', 'Paste image'));
        pasteTile.appendChild(el('span', 'pi-tile__sub', 'Ctrl/\u2318+V, or tap'));
        pasteTile.addEventListener('click', tryClipboard);
        tiles.appendChild(pasteTile);

        var camTile = el('button', 'pi-tile');
        camTile.type = 'button';
        camTile.appendChild(el('span', 'pi-tile__title', 'Camera'));
        camTile.appendChild(el('span', 'pi-tile__sub', 'Scan live, on this device'));
        camTile.addEventListener('click', addCameraStub);
        tiles.appendChild(camTile);

        root.appendChild(tiles);

        var links = el('div', 'batch-controls');
        var folderLink = el('button', 'btn btn-link btn-sm pi-zone__browse', 'choose folder\u2026');
        folderLink.type = 'button';
        folderLink.addEventListener('click', function () { dirInput.click(); });
        links.appendChild(folderLink);
        root.appendChild(links);

        root.appendChild(typesLine());

        var agg = aggBarNode();
        root.appendChild(agg);
        root.appendChild(noticeNode());
        root.appendChild(queueNode(true, false));
        root.appendChild(controlsNode());

        root.appendChild(fileInput);
        root.appendChild(dirInput);
    }

    function variantC(root) {
        root.appendChild(heroNode(false,
            'Barcode scanner',
            'Drop files anywhere on this page \u2014 PDFs, images, folders, ZIPs. Or paste a screenshot, or use your camera.'));

        var fileInput = hiddenInput(true, false);
        var dirInput = hiddenInput(false, true);

        var toolbar = el('div', 'pi-toolbar');
        var addBtn = el('button', 'btn btn-primary btn-sm', 'Add files\u2026');
        addBtn.type = 'button';
        addBtn.addEventListener('click', function () { fileInput.click(); });
        var dirBtn = el('button', 'btn btn-outline-secondary btn-sm', 'Folder\u2026');
        dirBtn.type = 'button';
        dirBtn.addEventListener('click', function () { dirInput.click(); });
        var pasteBtn = pasteButton('btn btn-outline-secondary btn-sm');
        var camBtn = cameraButton('btn btn-outline-secondary btn-sm');
        var spacer = el('span', 'pi-toolbar__spacer');
        var clearBtn = el('button', 'btn btn-outline-secondary btn-sm', 'Clear');
        clearBtn.type = 'button';
        clearBtn.addEventListener('click', function () {
            timers.forEach(clearInterval);
            timers = [];
            rows = [];
            scanStarted = false;
            render();
        });
        toolbar.appendChild(addBtn);
        toolbar.appendChild(dirBtn);
        toolbar.appendChild(pasteBtn);
        toolbar.appendChild(camBtn);
        toolbar.appendChild(spacer);
        toolbar.appendChild(clearBtn);
        root.appendChild(toolbar);
        root.appendChild(el('p', 'pi-toolbar-hint', 'Or just drop anywhere \u2014 this whole card is the drop zone.'));

        wireDrop(root, true);

        var agg = aggBarNode();
        root.appendChild(agg);
        root.appendChild(noticeNode());
        root.appendChild(queueNode(true, true));

        var scanWrap = el('div', 'd-grid');
        var scan = el('button', 'btn btn-primary scan-card__button', 'Scan for barcodes');
        scan.type = 'button';
        scan.disabled = sourceCount() === 0;
        scan.addEventListener('click', simulate);
        scanWrap.appendChild(scan);
        root.appendChild(scanWrap);

        root.appendChild(fileInput);
        root.appendChild(dirInput);
    }

    // ------------------------------------------------------------------ wiring

    function wireDrop(target, wholeCard) {
        target.addEventListener('dragover', function (e) {
            e.preventDefault();
            target.classList.add('is-dragover');
            if (wholeCard) target.classList.add('is-dragover');
        });
        target.addEventListener('dragleave', function (e) {
            if (!target.contains(e.relatedTarget)) target.classList.remove('is-dragover');
        });
        target.addEventListener('drop', function (e) {
            e.preventDefault();
            target.classList.remove('is-dragover');
            handleDrop(e.dataTransfer ? e.dataTransfer.files : [], e);
        });
    }

    window.addEventListener('paste', function (e) {
        var files = e.clipboardData && e.clipboardData.files;
        if (files && files.length) {
            for (var i = 0; i < files.length; i++) {
                if ((files[i].type || '').indexOf('image') === 0) {
                    rows.push(makeRow({ kind: 'paste', name: 'Pasted image', origin: 'Clipboard' }));
                    render();
                    return;
                }
            }
        }
    });

    function render() {
        var root = document.getElementById('pi-root');
        if (!root) return;
        root.innerHTML = '';
        if (current === 'a') variantA(root);
        else if (current === 'b') variantB(root);
        else variantC(root);
        updateBar();
    }

    function setVariant(v) {
        current = v;
        var url = new URL(window.location.href);
        url.searchParams.set('variant', v);
        history.replaceState(null, '', url.toString());
        render();
    }

    var bar = null;
    function buildBar() {
        bar = el('div', 'pi-bar');
        var prev = el('button', null, '\u25C0');
        prev.title = 'Previous variant (\u2190)';
        prev.addEventListener('click', function () { cycle(-1); });
        var label = el('span', 'pi-bar__label');
        var next = el('button', null, '\u25B6');
        next.title = 'Next variant (\u2192)';
        next.addEventListener('click', function () { cycle(1); });
        var sep = el('span', 'pi-bar__sep');
        var sim = el('button', null, 'Simulate scan');
        sim.addEventListener('click', simulate);
        var reset = el('button', null, 'Reset demo');
        reset.addEventListener('click', function () { seed(); render(); });
        var keys = el('span', 'pi-bar__keys', '\u2190 \u2192 switch');
        bar.appendChild(prev);
        bar.appendChild(label);
        bar.appendChild(next);
        bar.appendChild(sep);
        bar.appendChild(sim);
        bar.appendChild(reset);
        bar.appendChild(keys);
        document.body.appendChild(bar);
    }

    function updateBar() {
        if (bar) bar.querySelector('.pi-bar__label').textContent = current.toUpperCase() + ' \u00B7 ' + VARIANTS[current];
    }

    function cycle(dir) {
        var keys = Object.keys(VARIANTS);
        var i = keys.indexOf(current);
        setVariant(keys[(i + dir + keys.length) % keys.length]);
    }

    var toastNode = null;
    function toast(msg) {
        if (toastNode) toastNode.remove();
        toastNode = el('div', 'pi-toast', msg);
        document.body.appendChild(toastNode);
        setTimeout(function () { if (toastNode) { toastNode.remove(); toastNode = null; } }, 3500);
    }

    document.addEventListener('keydown', function (e) {
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (e.key === 'ArrowLeft') cycle(-1);
        if (e.key === 'ArrowRight') cycle(1);
    });

    // ------------------------------------------------------------------- boot

    // page copy broadens with the intake (footer too) — one proposal, all variants
    var footerText = document.querySelector('.scan-footer__text');
    if (footerText) footerText.textContent = 'Privacy by design \u2014 your files stay on your device.';

    var hero = document.querySelector('.scan-card__hero');
    var form = document.getElementById('pdfScanForm');
    if (hero) hero.hidden = true;
    if (form) form.hidden = true;

    var root = el('div', 'pi-root');
    root.id = 'pi-root';
    if (form && form.parentNode) {
        form.parentNode.insertBefore(root, form);
    } else {
        document.querySelector('.scan-card').appendChild(root);
    }

    seed();
    buildBar();
    render();
})();
