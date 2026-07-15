import * as pdfjsLib from 'pdfjs-dist';
import { scanPDF } from './scan.js';

document.addEventListener('DOMContentLoaded', function() {
    const pdfInput = document.getElementById('pdfInput');
    const scanButton = document.getElementById('scanButton');
    const scanForm = document.getElementById('pdfScanForm');
    const scanningZone = document.getElementById('scanningZone');
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    const dropZone = document.getElementById('dropZone');
    const dropZoneFilename = document.getElementById('dropZoneFilename');
    const scanStatus = document.getElementById('scanStatus');
    const scanButtonLabel = scanButton ? scanButton.textContent : 'Scan for QR codes';
    let pdfDoc = null;
    let pdfFileName = null;

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
        clearStatus();
    }

    function setBusy(busy) {
        if (!scanButton) return;
        scanButton.disabled = busy;
        scanButton.textContent = busy ? 'Scanning…' : scanButtonLabel;
    }

    async function loadFile(file) {
        if (!file) return;
        if (file.type !== 'application/pdf') {
            setStatus('Please choose a PDF file.', 'error');
            scanButton.disabled = true;
            return;
        }
        clearStatus();
        scanButton.disabled = false;
        resetProgress();
        pdfFileName = file.name;
        if (dropZoneFilename) {
            dropZoneFilename.textContent = file.name;
            dropZoneFilename.hidden = false;
        }
        try {
            pdfDoc = await pdfjsLib.getDocument(URL.createObjectURL(file)).promise;
        } catch (err) {
            console.error('[QR-Scanner] PDF load error:', err);
            pdfDoc = null;
            scanButton.disabled = true;
            setStatus('Could not open this PDF. It may be damaged.', 'error');
        }
    }

    pdfInput.addEventListener('change', (event) => loadFile(event.target.files[0]));

    if (dropZone) {
        ['dragenter', 'dragover'].forEach((evt) => {
            dropZone.addEventListener(evt, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('is-dragover');
            });
        });
        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!dropZone.contains(e.relatedTarget)) {
                dropZone.classList.remove('is-dragover');
            }
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('is-dragover');
            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) {
                try {
                    pdfInput.files = e.dataTransfer.files;
                } catch {
                    // Some browsers reject assigning .files; loadFile handles it directly.
                }
                loadFile(file);
            }
        });
    }

    scanButton.addEventListener('click', async () => {
        if (!pdfDoc) return;

        const total = pdfDoc.numPages;
        console.log('[QR-Scanner] Scan starting — pages:', total, '— scan.js v2 (rotation sweep)');
        scanningZone.hidden = false;
        clearStatus();
        progressBar.setAttribute('aria-valuemax', total);
        document.getElementById('progressTotal').textContent = total;
        document.getElementById('progressCurrent').textContent = '0';
        setBusy(true);

        try {
            const results = await scanPDF(pdfDoc, {
                onProgress: (page, total) => {
                    const pct = (page / total) * 100;
                    progressFill.style.width = pct + '%';
                    progressBar.setAttribute('aria-valuenow', page);
                    const currentEl = document.getElementById('progressCurrent');
                    if (currentEl) currentEl.textContent = page;
                }
            });

            progressBar.classList.add('scan-progress--complete');

            if (results.length > 0) {
                console.log('[QR-Scanner] Found', results.length, 'QR code(s):', results.map(r => r.data));
                const noun = results.length === 1 ? 'code' : 'codes';
                setStatus(`Done — ${results.length} QR ${noun} found. Downloading CSV.`, 'success');
                setTimeout(() => downloadCSV(results), 150);
            } else {
                console.log('[QR-Scanner] No QR codes found on any page');
                setStatus('No QR codes found in this PDF.', 'neutral');
            }
        } catch (err) {
            console.error('[QR-Scanner] Scan error:', err);
            setStatus('Scan failed: ' + err.message, 'error');
        } finally {
            setBusy(false);
        }
    });

    function downloadCSV(results) {
        const header = 'page,qr-code\n';
        const rows = results.map(r => `"${r.page}","${r.data}"`).join('\n');
        const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        const csvName = pdfFileName ? pdfFileName.replace(/\.pdf$/i, '') + '.csv' : 'qrcodes.csv';
        link.setAttribute('download', csvName);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    if (document.modelContext) {
        const toolReg = document.modelContext.registerTool({
            name: "scan-loaded-pdf",
            description: "Scan the currently loaded PDF file for QR codes and return the found codes with their page numbers.",
            inputSchema: {
                type: "object",
                properties: {}
            },
            async execute() {
                if (!pdfDoc) {
                    return {
                        content: [{ type: "text", text: "No PDF file loaded. Please select a PDF file first." }]
                    };
                }
                const results = await scanPDF(pdfDoc, {});
                if (results.length === 0) {
                    return {
                        content: [{ type: "text", text: "No QR codes found in the PDF." }]
                    };
                }
                const csv = 'page,qr-code\n' + results.map(r => `"${r.page}","${r.data}"`).join('\n');
                return {
                    content: [{
                        type: "text",
                        text: csv
                    }]
                };
            }
        });
        if (toolReg && typeof toolReg.catch === 'function') {
            toolReg.catch(err => console.warn('WebMCP tool registration failed:', err));
        }
    }
});
