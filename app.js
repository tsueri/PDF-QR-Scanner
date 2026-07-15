import * as pdfjsLib from 'pdfjs-dist';
import { scanPDF } from './scan.js';

document.addEventListener('DOMContentLoaded', function() {
    const pdfInput = document.getElementById('pdfInput');
    const scanButton = document.getElementById('scanButton');
    const progressBar = document.getElementById('progressBar');
    let pdfDoc = null;

    async function onFileSelected(event) {
        const file = event.target.files[0];
        if (file.type !== 'application/pdf') {
            alert('Please upload a PDF file.');
            return;
        }
        scanButton.disabled = false;
        progressBar.value = 0;
        pdfDoc = await pdfjsLib.getDocument(URL.createObjectURL(file)).promise;
    }

    pdfInput.addEventListener('change', onFileSelected);

    scanButton.addEventListener('click', async () => {
        if (!pdfDoc) return;

        progressBar.max = pdfDoc.numPages;

        const results = await scanPDF(pdfDoc, {
            onProgress: (page, total) => {
                progressBar.value = page;
            }
        });

        if (results.length > 0) {
            downloadCSV(results);
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
