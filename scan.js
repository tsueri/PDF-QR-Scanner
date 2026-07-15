import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  './node_modules/pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export async function scanPDF(pdfDoc, options = {}) {
  const { scale = 1.5, onProgress } = options;
  const results = [];
  const total = pdfDoc.numPages;

  for (let pageNum = 1; pageNum <= total; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const data = scanForQRCode(ctx, canvas.width, canvas.height);
    if (data) {
      results.push({ page: pageNum, data });
    }

    onProgress?.(pageNum, total);
  }

  return results;
}

function scanForQRCode(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height);
  const code = globalThis.jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "dontInvert",
  });
  return code ? code.data : null;
}
