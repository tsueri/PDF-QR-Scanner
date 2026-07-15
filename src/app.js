import * as pdfjsLib from 'pdfjs-dist';
import { scanPDF } from './scan.js';
import { fileResultsToCSV } from './csv.js';
import { buildZip } from './zip.js';

document.addEventListener('DOMContentLoaded', function() {
    const pdfInput = document.getElementById('pdfInput');
    const scanButton = document.getElementById('scanButton');
    const clearButton = document.getElementById('clearButton');
    const scanForm = document.getElementById('pdfScanForm');
    const scanningZone = document.getElementById('scanningZone');
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    const dropZone = document.getElementById('dropZone');
    const fileList = document.getElementById('fileList');
    const progressFileInfo = document.getElementById('progressFileInfo');
    const scanStatus = document.getElementById('scanStatus');
    const batchBar = document.getElementById('batchBar');
    const batchBarCounter = document.getElementById('batchBarCounter');
    const batchBarTotal = document.getElementById('batchBarTotal');
    const batchBarFill = document.getElementById('batchBarFill');
    const zipReady = document.getElementById('zipReady');
    const zipReadyLabel = document.getElementById('zipReadyLabel');
    const zipReadyBtn = document.getElementById('zipReadyBtn');
    const progressCurrent = document.getElementById('progressCurrent');
    const progressTotal = document.getElementById('progressTotal');
    const scanButtonLabel = scanButton ? scanButton.textContent : 'Scan for QR codes';

    let fileEntries = [];
    let _nextId = 0;
    let _scanning = false;

    var MSG_LOAD_ERROR = 'Could not open — file may be damaged';
    var MSG_PASSWORD = 'Password-protected — cannot read';
    var MSG_SCAN_ERROR = 'Scan failed — unexpected error';

    if (scanForm) {
        scanForm.addEventListener('submit', function(e) { e.preventDefault(); });
    }

    function pct(value, total) {
        return total > 0 ? Math.round((value / total) * 10000) / 100 : 0;
    }

    function statusText(entry) {
        switch (entry.state) {
            case 'queued': return 'Queued';
            case 'scanning': return entry.page === 0 ? 'Starting\u2026' : 'Scanning p.' + entry.page + '/' + entry.pages;
            case 'done': return entry.codes + ' code' + (entry.codes === 1 ? '' : 's') + ' found';
            case 'empty': return 'No QR codes';
            case 'error': return entry.errorMessage || MSG_SCAN_ERROR;
        }
    }

    function setStatus(message, variant) {
        if (!scanStatus) return;
        scanStatus.textContent = message;
        scanStatus.classList.remove('scan-status--success', 'scan-status--error', 'scan-status--neutral');
        if (variant) scanStatus.classList.add('scan-status--' + variant);
        scanStatus.hidden = false;
        scanningZone.hidden = false;
    }

    function clearStatus() {
        if (!scanStatus) return;
        scanStatus.hidden = true;
        scanStatus.textContent = '';
        scanStatus.classList.remove('scan-status--success', 'scan-status--error', 'scan-status--neutral');
    }

    function resetProgress() {
        scanningZone.hidden = true;
        progressFill.style.width = '0%';
        progressBar.setAttribute('aria-valuenow', '0');
        progressBar.setAttribute('aria-valuemax', '0');
        progressBar.classList.remove('scan-progress--complete');
        if (progressFileInfo) progressFileInfo.textContent = '';
        clearStatus();
        batchBar.hidden = true;
        zipReady.hidden = true;
    }

    function setBusy(busy) {
        _scanning = busy;
        if (!scanButton) return;
        scanButton.disabled = busy || fileEntries.length === 0;
        scanButton.textContent = busy ? 'Scanning\u2026' : scanButtonLabel;
        if (clearButton) clearButton.disabled = busy;
        if (pdfInput) pdfInput.disabled = busy;
    }

    function isBusy() {
        return _scanning;
    }

    function updateScanButton() {
        if (!scanButton) return;
        scanButton.disabled = _scanning || fileEntries.length === 0;
    }

    function updateClearButton() {
        if (!clearButton) return;
        clearButton.hidden = fileEntries.length === 0 || _scanning;
    }

    async function loadPageCount(entry) {
        try {
            const pdfDoc = await pdfjsLib.getDocument(URL.createObjectURL(entry.file)).promise;
            entry.pdfDoc = pdfDoc;
            entry.pages = pdfDoc.numPages;
            entry.loadError = false;
        } catch (err) {
            console.error('[QR-Scanner] PDF load error:', err);
            entry.pages = 0;
            entry.pdfDoc = null;
            entry.loadError = true;
            entry.state = 'error';
            if (err instanceof pdfjsLib.PasswordException) {
                entry.errorMessage = MSG_PASSWORD;
            } else {
                entry.errorMessage = MSG_LOAD_ERROR;
            }
        }
        render();
    }

    function addFiles(fileListInput) {
        if (isBusy()) return;
        const names = new Set(fileEntries.map(function(f) { return f.name; }));
        for (var i = 0; i < fileListInput.length; i++) {
            var file = fileListInput[i];
            if (file.type !== 'application/pdf') continue;
            if (names.has(file.name)) continue;
            names.add(file.name);
            var entry = {
                id: ++_nextId,
                file: file,
                pdfDoc: null,
                name: file.name,
                pages: 0,
                loadError: false,
                state: 'queued',
                page: 0,
                codes: 0,
                results: [],
                errorMessage: ''
            };
            fileEntries.push(entry);
            loadPageCount(entry);
        }
        batchBar.hidden = true;
        zipReady.hidden = true;
        render();
    }

    function removeFile(id) {
        if (isBusy()) return;
        fileEntries = fileEntries.filter(function(f) { return f.id !== id; });
        if (fileEntries.length === 0) {
            batchBar.hidden = true;
            zipReady.hidden = true;
        }
        render();
    }

    function clearAll() {
        if (isBusy()) return;
        fileEntries = [];
        batchBar.hidden = true;
        zipReady.hidden = true;
        resetProgress();
        render();
    }

    function renderFileList() {
        fileList.innerHTML = '';

        for (var i = 0; i < fileEntries.length; i++) {
            var f = fileEntries[i];

            var pageText;
            if (f.loadError) {
                pageText = 'Error';
            } else if (f.pages > 0) {
                pageText = f.pages + 'p';
            } else {
                pageText = '\u2026';
            }

            var topDiv = document.createElement('div');
            topDiv.className = 'file-row__top';

            var nameSpan = document.createElement('span');
            nameSpan.className = 'file-row__name';
            nameSpan.textContent = f.name;
            topDiv.appendChild(nameSpan);

            var metaSpan = document.createElement('span');
            metaSpan.className = 'file-row__meta';
            metaSpan.textContent = pageText;
            topDiv.appendChild(metaSpan);

            var barDiv = document.createElement('div');
            barDiv.className = 'file-row__bar';

            var removeBtn = document.createElement('button');
            removeBtn.className = 'file-remove';
            removeBtn.setAttribute('aria-label', 'Remove');
            removeBtn.textContent = '\u00D7';
            (function(id) {
                removeBtn.addEventListener('click', function() { removeFile(id); });
            })(f.id);
            barDiv.appendChild(removeBtn);

            var row = document.createElement('li');
            row.className = 'file-row';
            row.appendChild(topDiv);

            if (f.state) {
                row.classList.add('is-' + f.state);

                var fileTrack = document.createElement('div');
                fileTrack.className = 'scan-progress__track filebar';
                var fileFill = document.createElement('div');
                fileFill.className = 'scan-progress__fill';
                fileFill.dataset.fileBar = String(f.id);
                fileFill.style.width = pct(f.page, f.pages) + '%';
                fileTrack.appendChild(fileFill);
                row.appendChild(fileTrack);

                var statusAndBtn = document.createElement('div');
                statusAndBtn.style.cssText = 'display:flex;align-items:center;gap:.5rem';

                var badge = document.createElement('span');
                badge.className = 'fstate fstate--' + f.state;
                badge.dataset.fileStatus = String(f.id);
                badge.textContent = statusText(f);
                statusAndBtn.appendChild(badge);

                if (f.state === 'queued') {
                    removeBtn.disabled = isBusy();
                    statusAndBtn.appendChild(barDiv);
                }

                row.appendChild(statusAndBtn);
            } else {
                removeBtn.disabled = isBusy();
                barDiv.appendChild(removeBtn);
                row.appendChild(barDiv);
            }

            fileList.appendChild(row);
        }

        if (fileEntries.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'batch-empty';
            empty.textContent = 'No files yet \u2014 drop or browse to add some.';
            fileList.appendChild(empty);
        }
    }

    function render() {
        updateScanButton();
        updateClearButton();
        renderFileList();
    }

    function liveUpdateProgress(entry) {
        var fill = fileList.querySelector('[data-file-bar="' + entry.id + '"]');
        if (fill) {
            fill.style.width = pct(entry.page, entry.pages) + '%';
        }
        var badge = fileList.querySelector('[data-file-status="' + entry.id + '"]');
        if (badge) {
            badge.className = 'fstate fstate--' + entry.state;
            badge.textContent = statusText(entry);
        }
        var row = fileList.querySelector('[data-file-bar="' + entry.id + '"]');
        if (row) {
            var li = row.closest('.file-row');
            if (li) {
                li.className = li.className.replace(/is-\w+/g, '');
                li.classList.add('is-' + entry.state);
            }
        }
    }

    function updateAggregateBar(done, total) {
        if (!batchBar) return;
        batchBar.hidden = false;
        if (batchBarCounter) batchBarCounter.textContent = String(done);
        if (batchBarTotal) batchBarTotal.textContent = String(total);
        if (batchBarFill) {
            batchBarFill.style.width = pct(done, total) + '%';
        }
    }

    function showZipBanner(doneCount, emptyCount, errorCount) {
        zipReady.hidden = false;

        var bits = [doneCount + ' CSV' + (doneCount === 1 ? '' : 's')];
        if (emptyCount) bits.push(emptyCount + ' empty skipped');
        if (errorCount) bits.push(errorCount + ' failed');
        zipReadyLabel.textContent = 'ZIP ready \u2014 ' + bits.join(' \u00B7 ');

        var hasDownload = !!_zipBlob;
        zipReadyBtn.textContent = hasDownload ? 'Download ZIP' : 'Nothing to download';
        zipReadyBtn.disabled = !hasDownload;
        zipReadyBtn.onclick = function() {
            triggerZipDownload();
        };
    }

    var _zipBlob = null;

    function setZipBlob(blob) {
        _zipBlob = blob;
    }

    function triggerZipDownload() {
        if (!_zipBlob) return;
        var url = URL.createObjectURL(_zipBlob);
        var link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'qr-codes.zip');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        zipReadyBtn.textContent = 'Downloaded \u2713';
        zipReadyBtn.disabled = true;
    }

    pdfInput.addEventListener('change', function() {
        if (pdfInput.files.length) {
            addFiles(pdfInput.files);
            pdfInput.value = '';
        }
    });

    clearButton.addEventListener('click', function() {
        clearAll();
    });

    if (dropZone) {
        ['dragenter', 'dragover'].forEach(function(evt) {
            dropZone.addEventListener(evt, function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (!isBusy()) dropZone.classList.add('is-dragover');
            });
        });
        dropZone.addEventListener('dragleave', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (!dropZone.contains(e.relatedTarget)) {
                dropZone.classList.remove('is-dragover');
            }
        });
        dropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('is-dragover');
            var files = e.dataTransfer && e.dataTransfer.files;
            if (files && files.length) {
                addFiles(files);
            }
        });
    }

    scanButton.addEventListener('click', async function() {
        if (fileEntries.length === 0 || isBusy()) return;

        var pendingLoads = fileEntries.filter(function(f) { return !f.pdfDoc && !f.loadError; });
        if (pendingLoads.length > 0) {
            await new Promise(function(r) { setTimeout(r, 100); });
        }

        for (var i = 0; i < fileEntries.length; i++) {
            var entry = fileEntries[i];
            if (entry.loadError) {
                entry.state = 'error';
                if (!entry.errorMessage) {
                    entry.errorMessage = MSG_LOAD_ERROR;
                }
                entry.results = [];
            } else if (!entry.pdfDoc) {
                entry.state = 'error';
                entry.errorMessage = entry.errorMessage || MSG_LOAD_ERROR;
                entry.results = [];
            } else {
                entry.state = 'queued';
            }
            entry.page = 0;
            entry.codes = 0;
            entry.results = [];
        }

        var scannable = fileEntries.filter(function(f) { return f.pdfDoc && !f.loadError; });
        var totalFiles = scannable.length;
        var filesDone = 0;

        setBusy(true);
        _zipBlob = null;
        scanningZone.hidden = false;
        clearStatus();
        progressBar.hidden = true;
        batchBar.hidden = false;
        progressBar.setAttribute('aria-valuemax', String(totalFiles));
        if (progressTotal) progressTotal.textContent = String(totalFiles);
        if (progressCurrent) progressCurrent.textContent = '0';
        updateAggregateBar(filesDone, totalFiles);
        zipReady.hidden = true;
        render();

        for (var fi = 0; fi < fileEntries.length; fi++) {
            var entry = fileEntries[fi];
            if (!entry.pdfDoc || entry.state === 'error') {
                continue;
            }

            entry.state = 'scanning';
            entry.page = 0;
            render();

            if (progressFileInfo) {
                progressFileInfo.textContent = entry.name + ': ';
            }

            try {
                var results = await scanPDF(entry.pdfDoc, {
                    onProgress: function(page, total) {
                        entry.page = page;
                        liveUpdateProgress(entry);
                    }
                });

                if (results.length > 0) {
                    entry.state = 'done';
                    entry.codes = results.length;
                    entry.results = results;
                    console.log('[QR-Scanner] Found', results.length, 'QR code(s) in', entry.name + ':', results.map(function(r) { return r.data; }));
                } else {
                    entry.state = 'empty';
                    entry.codes = 0;
                    entry.results = [];
                    console.log('[QR-Scanner] No QR codes found in', entry.name);
                }
            } catch (err) {
                console.error('[QR-Scanner] Scan error (' + entry.name + '):', err);
                entry.state = 'error';
                entry.errorMessage = MSG_SCAN_ERROR;
                entry.results = [];
            }

            filesDone++;
            updateAggregateBar(filesDone, totalFiles);
            entry.page = entry.pages || 0;
            liveUpdateProgress(entry);
            render();
        }

        var doneCount = fileEntries.filter(function(f) { return f.state === 'done'; }).length;
        var emptyCount = fileEntries.filter(function(f) { return f.state === 'empty'; }).length;
        var errorCount = fileEntries.filter(function(f) { return f.state === 'error'; }).length;

        var zipEntries = [];
        for (var j = 0; j < fileEntries.length; j++) {
            var e = fileEntries[j];
            if (e.state === 'done' && e.results.length > 0) {
                zipEntries.push({
                    filename: e.name,
                    csv: fileResultsToCSV(e.name, e.results)
                });
            }
        }

        if (zipEntries.length > 0) {
            try {
                var zipBlob = await buildZip(zipEntries);
                setZipBlob(zipBlob);
            } catch (err) {
                console.error('[QR-Scanner] ZIP build error:', err);
            }
        }

        showZipBanner(doneCount, emptyCount, errorCount);

        progressBar.classList.add('scan-progress--complete');
        batchBarFill.classList.add('scan-progress--complete');

        var parts = [];
        if (doneCount > 0) parts.push(doneCount + ' done');
        if (emptyCount > 0) parts.push(emptyCount + ' empty');
        if (errorCount > 0) parts.push(errorCount + ' failed');

        if (doneCount > 0 || emptyCount > 0 || errorCount > 0) {
            setStatus('Scan complete \u2014 ' + parts.join(' \u00B7 '), 'success');
        } else {
            setStatus('No valid PDF files to scan.', 'neutral');
        }

        setBusy(false);
        render();
    });

    function downloadCSV(results, pdfName) {
        var csv = fileResultsToCSV(pdfName, results);
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.setAttribute('href', url);
        var csvName = pdfName ? pdfName.replace(/\.pdf$/i, '') + '.csv' : 'qrcodes.csv';
        link.setAttribute('download', csvName);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    if (document.modelContext) {
        var toolReg = document.modelContext.registerTool({
            name: "scan-loaded-pdf",
            description: "Scan the currently loaded PDF files for QR codes and return the found codes with their page numbers.",
            inputSchema: {
                type: "object",
                properties: {}
            },
            async execute() {
                if (fileEntries.length === 0) {
                    return {
                        content: [{ type: "text", text: "No PDF files loaded. Please select PDF files first." }]
                    };
                }
                var allResults = [];
                for (var k = 0; k < fileEntries.length; k++) {
                    var e = fileEntries[k];
                    if (!e.pdfDoc) continue;
                    var r = await scanPDF(e.pdfDoc, {});
                    for (var m = 0; m < r.length; m++) {
                        allResults.push(r[m]);
                    }
                }
                if (allResults.length === 0) {
                    return {
                        content: [{ type: "text", text: "No QR codes found in any PDF." }]
                    };
                }
                var csv = fileResultsToCSV(null, allResults);
                return {
                    content: [{ type: "text", text: csv }]
                };
            }
        });
        if (toolReg && typeof toolReg.catch === 'function') {
            toolReg.catch(function(err) { console.warn('WebMCP tool registration failed:', err); });
        }
    }
});
