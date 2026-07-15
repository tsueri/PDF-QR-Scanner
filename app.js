import * as pdfjsLib from 'pdfjs-dist';
import { scanPDF } from './scan.js';
import { fileResultsToCSV } from './csv.js';

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
    const scanButtonLabel = scanButton ? scanButton.textContent : 'Scan for QR codes';

    let fileEntries = [];
    let _nextId = 0;

    if (scanForm) {
        scanForm.addEventListener('submit', (e) => e.preventDefault());
    }

    function setStatus(message, variant) {
        if (!scanStatus) return;
        scanStatus.textContent = message;
        scanStatus.classList.remove('scan-status--success', 'scan-status--error', 'scan-status--neutral');
        if (variant) scanStatus.classList.add('scan-status--' + variant);
        scanStatus.hidden = false;
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
    }

    function setBusy(busy) {
        if (!scanButton) return;
        scanButton.disabled = busy;
        scanButton.textContent = busy ? 'Scanning…' : scanButtonLabel;
        if (clearButton) clearButton.disabled = busy;
    }

    function updateScanButton() {
        if (!scanButton) return;
        scanButton.disabled = fileEntries.length === 0;
    }

    function updateClearButton() {
        if (!clearButton) return;
        clearButton.hidden = fileEntries.length === 0;
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
        }
        render();
    }

    function addFiles(fileListInput) {
        const names = new Set(fileEntries.map(function(f) { return f.name; }));
        for (const file of fileListInput) {
            if (file.type !== 'application/pdf') continue;
            if (names.has(file.name)) continue;
            names.add(file.name);
            const entry = { id: ++_nextId, file: file, pdfDoc: null, name: file.name, pages: 0, loadError: false };
            fileEntries.push(entry);
            loadPageCount(entry);
        }
        render();
    }

    function removeFile(id) {
        fileEntries = fileEntries.filter(function(f) { return f.id !== id; });
        render();
    }

    function clearAll() {
        fileEntries = [];
        render();
    }

    function renderFileList() {
        fileList.innerHTML = '';

        for (const f of fileEntries) {
            var pageText;
            if (f.loadError) {
                pageText = 'Error';
            } else if (f.pages > 0) {
                pageText = f.pages + 'p';
            } else {
                pageText = '…';
            }

            const topDiv = document.createElement('div');
            topDiv.className = 'file-row__top';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'file-row__name';
            nameSpan.textContent = f.name;
            topDiv.appendChild(nameSpan);

            const metaSpan = document.createElement('span');
            metaSpan.className = 'file-row__meta';
            metaSpan.textContent = pageText;
            topDiv.appendChild(metaSpan);

            const barDiv = document.createElement('div');
            barDiv.className = 'file-row__bar';

            const removeBtn = document.createElement('button');
            removeBtn.className = 'file-remove';
            removeBtn.setAttribute('aria-label', 'Remove');
            removeBtn.textContent = '\u00D7';
            removeBtn.addEventListener('click', function() { removeFile(f.id); });
            barDiv.appendChild(removeBtn);

            const row = document.createElement('li');
            row.className = 'file-row';
            row.appendChild(topDiv);
            row.appendChild(barDiv);

            fileList.appendChild(row);
        }

        if (fileEntries.length === 0) {
            const empty = document.createElement('p');
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

    pdfInput.addEventListener('change', function() {
        if (pdfInput.files.length) {
            addFiles(pdfInput.files);
            pdfInput.value = '';
        }
    });

    clearButton.addEventListener('click', function() {
        clearAll();
        resetProgress();
    });

    if (dropZone) {
        ['dragenter', 'dragover'].forEach(function(evt) {
            dropZone.addEventListener(evt, function(e) {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('is-dragover');
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
        if (fileEntries.length === 0) return;

        var pendingLoads = fileEntries.filter(function(f) { return !f.pdfDoc && !f.loadError; });
        if (pendingLoads.length > 0) {
            await new Promise(function(r) { setTimeout(r, 100); });
        }

        const totalFiles = fileEntries.length;
        var overallCompleted = 0;
        var totalPageCount = 0;
        for (var i = 0; i < fileEntries.length; i++) {
            if (fileEntries[i].pdfDoc) {
                totalPageCount += fileEntries[i].pages || 0;
            }
        }

        scanningZone.hidden = false;
        clearStatus();
        if (totalPageCount > 0) {
            progressBar.setAttribute('aria-valuemax', String(totalPageCount));
            document.getElementById('progressTotal').textContent = String(totalPageCount);
        }
        document.getElementById('progressCurrent').textContent = '0';
        setBusy(true);

        for (var fi = 0; fi < fileEntries.length; fi++) {
            var entry = fileEntries[fi];
            if (!entry.pdfDoc) {
                overallCompleted += entry.pages || 0;
                continue;
            }

            if (progressFileInfo) {
                progressFileInfo.textContent = 'File ' + String(fi + 1) + ' of ' + String(totalFiles) + ': ';
            }

            try {
                var pageOffset = overallCompleted;
                var results = await scanPDF(entry.pdfDoc, {
                    onProgress: function(page, total) {
                        var pct = ((pageOffset + page) / totalPageCount) * 100;
                        progressFill.style.width = pct + '%';
                        progressBar.setAttribute('aria-valuenow', String(pageOffset + page));
                        var currentEl = document.getElementById('progressCurrent');
                        if (currentEl) currentEl.textContent = String(pageOffset + page);
                    }
                });

                overallCompleted += entry.pages;

                if (results.length > 0) {
                    console.log('[QR-Scanner] Found', results.length, 'QR code(s) in', entry.name + ':', results.map(function(r) { return r.data; }));
                    downloadCSV(results, entry.name);
                } else {
                    console.log('[QR-Scanner] No QR codes found in', entry.name);
                }
            } catch (err) {
                console.error('[QR-Scanner] Scan error (' + entry.name + '):', err);
                overallCompleted += entry.pages;
            }
        }

        progressBar.classList.add('scan-progress--complete');

        var scannedCount = fileEntries.filter(function(f) { return f.pdfDoc; }).length;
        if (scannedCount > 0) {
            setStatus('Done \u2014 scanned ' + String(scannedCount) + ' file' + (scannedCount === 1 ? '' : 's') + '. CSVs downloaded.', 'success');
        } else {
            setStatus('No valid PDF files to scan.', 'neutral');
        }

        setBusy(false);
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
