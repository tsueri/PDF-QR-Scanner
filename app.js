import * as pdfjsLib from './node_modules/pdfjs-dist/build/pdf.min.mjs';
import './node_modules/pdfjs-dist/build/pdf.worker.min.mjs'

document.addEventListener('DOMContentLoaded', function() {
    const pdfInput = document.getElementById('pdfInput');
    const canvasContainer = document.getElementById('canvasContainer');
    const scanButton = document.getElementById('scanButton');
    const progressBar = document.getElementById('progressBar');
    let pdfDoc = null;

    async function onFileSelected(event) {
        const file = event.target.files[0];
        if (file.type !== 'application/pdf') {
            alert('Please upload a PDF file.');
            return;
        }
        // Enable the scan button once a valid PDF is selected
        scanButton.disabled = false;
        // Clear previous canvases and progress bar
        canvasContainer.innerHTML = '';
        progressBar.value = 0;
        pdfDoc = await pdfjsLib.getDocument(URL.createObjectURL(file)).promise;
    }

    pdfInput.addEventListener('change', onFileSelected);

    scanButton.addEventListener('click', async () => {
        if (!pdfDoc) return;
        const qrCodes = [];
        
        // Update progress bar for each page scanned
        progressBar.max = pdfDoc.numPages;

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; ++pageNum) {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.5 });
            
            // Create a canvas for each page
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            canvasContainer.appendChild(canvas);

            const renderContext = {
                canvasContext: ctx,
                viewport: viewport
            };
            
            await page.render(renderContext).promise;

            // Scan the rendered PDF page for QR codes
            const qrCodeData = scanForQRCode(ctx, canvas.width, canvas.height);
            if (qrCodeData) {
                qrCodes.push(`"${pageNum}","${qrCodeData}"`);
            }

            // Update progress bar
            progressBar.value = pageNum;
        }
        
        if (qrCodes.length > 0) {
            downloadCSV(qrCodes.join('\n'));
        } else {
            alert('No QR codes found.');
        }
    });

    function scanForQRCode(context, width, height) {
        const imageData = context.getImageData(0, 0, width, height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
        });
        
        return code ? code.data : null;
    }

    function downloadCSV(dataString) {
        const blob = new Blob([`page,qr-code\n${dataString}`], { type: 'text/csv;charset=utf-8;' });
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