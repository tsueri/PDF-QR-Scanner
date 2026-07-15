import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  './node_modules/pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export async function scanPDF(pdfDoc, options = {}) {
  const { scale = 2.0, onProgress } = options;
  const results = [];
  const total = pdfDoc.numPages;

  for (let pageNum = 1; pageNum <= total; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);

    const data = await renderAndScan(page, scale);
    if (data) {
      results.push({ page: pageNum, data });
    } else {
      const hiResData = await renderAndScan(page, scale * 2, true);
      if (hiResData) {
        results.push({ page: pageNum, data: hiResData });
      }
    }

    onProgress?.(pageNum, total);
  }

  return results;
}

async function renderAndScan(page, scale, isRetry = false) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({ canvasContext: ctx, viewport }).promise;

  const data = scanForQRCode(ctx, canvas.width, canvas.height);
  if (!data && isRetry) {
    console.log(`[QR-Scanner] No QR found at scale ${scale / 2} — retrying at ${scale}x`);
  }
  return data;
}

function scanForQRCode(context, width, height) {
  const jsQR = globalThis.jsQR;
  if (!jsQR) {
    console.warn("jsQR library not found on globalThis. Ensure jsQR is loaded before scan.js.");
    return null;
  }

  try {
    const imageData = context.getImageData(0, 0, width, height);
    let code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });
    if (code) return String(code.data);

    for (let dir = 0; dir < 2; dir++) {
      for (let angle = 5; angle <= 45; angle += 5) {
        const sign = dir === 0 ? 1 : -1;
        const rotated = rotateCanvas(context.canvas, sign * angle);
        const rImgData = rotated.ctx.getImageData(0, 0, rotated.width, rotated.height);
        code = jsQR(rImgData.data, rImgData.width, rImgData.height, {
          inversionAttempts: "dontInvert",
        });
        if (code) return String(code.data);
      }
    }
  } catch (err) {
    console.warn("QR scan error:", err);
  }

  return null;
}

function rotateCanvas(sourceCanvas, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const newW = Math.ceil(w * cos + h * sin);
  const newH = Math.ceil(w * sin + h * cos);

  const rotated = document.createElement('canvas');
  rotated.width = newW;
  rotated.height = newH;
  const rCtx = rotated.getContext('2d');
  rCtx.imageSmoothingEnabled = false;

  rCtx.translate(newW / 2, newH / 2);
  rCtx.rotate(rad);
  rCtx.drawImage(sourceCanvas, -w / 2, -h / 2);

  return { canvas: rotated, ctx: rCtx, width: newW, height: newH };
}
