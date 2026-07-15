import * as pdfjsLib from 'pdfjs-dist';
import { scanPDF } from './scan.js';

document.addEventListener('DOMContentLoaded', function() {
    const pdfInput = document.getElementById('pdfInput');
    const scanButton = document.getElementById('scanButton');
    const scanningZone = document.getElementById('scanningZone');
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    let pdfDoc = null;

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
        scanningZone.hidden = false;
        progressBar.setAttribute('aria-valuemax', total);
        document.getElementById('progressTotal').textContent = total;
        document.getElementById('progressCurrent').textContent = '0';

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
            setTimeout(() => downloadCSV(results), 150);
        } else {
            alert('No QR codes found.');
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
});
