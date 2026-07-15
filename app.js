import * as pdfjsLib from 'pdfjs-dist';
import { scanPDF } from './scan.js';

document.addEventListener('DOMContentLoaded', function() {
    const pdfInput = document.getElementById('pdfInput');
    const scanButton = document.getElementById('scanButton');
    const scanForm = document.getElementById('pdfScanForm');
    const scanningZone = document.getElementById('scanningZone');
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    let pdfDoc = null;

    if (scanForm) {
        scanForm.addEventListener('submit', (e) => e.preventDefault());
    }

    function resetProgress() {
        scanningZone.hidden = true;
        progressFill.style.width = '0%';
        progressBar.setAttribute('aria-valuenow', '0');
        progressBar.setAttribute('aria-valuemax', '0');
        progressBar.classList.remove('scan-progress--complete');
    }

    async function onFileSelected(event) {
        const file = event.target.files[0];
        if (file.type !== 'application/pdf') {
            alert('Please upload a PDF file.');
            return;
        }
        scanButton.disabled = false;
        resetProgress();
        pdfDoc = await pdfjsLib.getDocument(URL.createObjectURL(file)).promise;
    }

    pdfInput.addEventListener('change', onFileSelected);

    scanButton.addEventListener('click', async () => {
        if (!pdfDoc) return;

        const total = pdfDoc.numPages;
        console.log('[QR-Scanner] Scan starting — pages:', total, '— scan.js v2 (rotation sweep)');
        scanningZone.hidden = false;
        progressBar.setAttribute('aria-valuemax', total);
        document.getElementById('progressTotal').textContent = total;
        document.getElementById('progressCurrent').textContent = '0';

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
                setTimeout(() => downloadCSV(results), 150);
            } else {
                console.log('[QR-Scanner] No QR codes found on any page');
                alert('No QR codes found.');
            }
        } catch (err) {
            console.error('[QR-Scanner] Scan error:', err);
            alert('Scan error: ' + err.message);
        }
    });

    function downloadCSV(results) {
        const header = 'page,qr-code\n';
        const rows = results.map(r => `"${r.page}","${r.data}"`).join('\n');
        const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'qrcodes.csv');
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
