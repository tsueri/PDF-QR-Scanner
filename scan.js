import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  './node_modules/pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

// --- Worker pool -----------------------------------------------------------

class WorkerPool {
  constructor(workerUrl, size) {
    this.workers = [];
    this.available = [];
    this.taskQueue = [];
    this.size = size;

    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerUrl);
      this.workers.push(worker);
      this.available.push(worker);
    }
  }

  scan(imageData) {
    return new Promise((resolve) => {
      this.taskQueue.push({
        buffer: imageData.data.buffer,
        width: imageData.width,
        height: imageData.height,
        resolve,
      });
      this._flush();
    });
  }

  _flush() {
    while (this.available.length > 0 && this.taskQueue.length > 0) {
      const worker = this.available.pop();
      const task = this.taskQueue.shift();

      const handleMessage = (e) => {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        task.resolve(e.data.data);
        this.available.push(worker);
        this._flush();
      };

      const handleError = (err) => {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        console.warn('Worker error:', err.message);
        task.resolve(null);
        this.available.push(worker);
        this._flush();
      };

      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);

      worker.postMessage(
        {
          imageDataBuffer: task.buffer,
          width: task.width,
          height: task.height,
        },
        [task.buffer]
      );
    }
  }

  destroy() {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.available.length = 0;
    this.taskQueue.length = 0;
  }
}

// --- Scan helpers (main thread) --------------------------------------------

async function renderPage(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, ctx, width: canvas.width, height: canvas.height };
}

function scanFirstPass(ctx, width, height) {
  const jsQR = globalThis.jsQR;
  if (!jsQR) return null;

  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'attemptBoth',
    });
    if (code) return String(code.data);
  } catch (err) {
    console.warn('QR scan error:', err);
  }
  return null;
}

function mainThreadRotationSweep(ctx, width, height) {
  const jsQR = globalThis.jsQR;
  if (!jsQR) return null;

  try {
    const imageData = ctx.getImageData(0, 0, width, height);

    for (let dir = 0; dir < 2; dir++) {
      for (let angle = 5; angle <= 45; angle += 5) {
        const sign = dir === 0 ? 1 : -1;
        const rotated = rotateCanvas(ctx.canvas, sign * angle);
        const rImgData = rotated.ctx.getImageData(0, 0, rotated.width, rotated.height);
        const code = jsQR(rImgData.data, rImgData.width, rImgData.height, {
          inversionAttempts: 'dontInvert',
        });
        if (code) return String(code.data);
      }
    }
  } catch (err) {
    console.warn('QR scan error:', err);
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

// --- Singleton pool (created once, reused across scans) --------------------

let _pool = null;
let _poolPromise = null;

async function _getWorkerUrl() {
  const [jsqrResp, workerResp] = await Promise.all([
    fetch('./node_modules/jsqr/dist/jsQR.js'),
    fetch(new URL('./scan.worker.js', import.meta.url)),
  ]);

  const [jsqrSrc, workerSrc] = await Promise.all([
    jsqrResp.text(),
    workerResp.text(),
  ]);

  const combined = jsqrSrc + '\n' + workerSrc;
  return URL.createObjectURL(
    new Blob([combined], { type: 'application/javascript' })
  );
}

async function _getPool() {
  if (_pool) return _pool;
  if (_poolPromise) return _poolPromise;

  _poolPromise = (async () => {
    const supportsOffscreen = typeof OffscreenCanvas !== 'undefined';
    const cores = navigator.hardwareConcurrency || 4;
    const poolSize = Math.max(1, cores - 1);

    if (supportsOffscreen && poolSize > 1) {
      const workerUrl = await _getWorkerUrl();
      _pool = new WorkerPool(workerUrl, poolSize);
      console.log('[QR-Scanner] Worker pool with', poolSize, 'threads');
    }

    _poolPromise = null;
    return _pool;
  })();

  return _poolPromise;
}

export function destroyPool() {
  _pool?.destroy();
  _pool = null;
}

// --- Main scan entry point -------------------------------------------------

export async function scanPDF(pdfDoc, options = {}) {
  const { scale = 2.0, onProgress } = options;
  const total = pdfDoc.numPages;
  const results = [];

  const pool = await _getPool();
  const BATCH_SIZE = pool ? pool.size * 2 : 1;

  let completed = 0;

  function markComplete(pageNum, data) {
    results.push({ page: pageNum, data });
    completed++;
    onProgress?.(completed, total);
  }

  // ---- Phase 1: render all pages at default scale, fast first-pass scan ----
  const pending = [];

  for (let pageNum = 1; pageNum <= total; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const rendered = await renderPage(page, scale);

    const data = scanFirstPass(rendered.ctx, rendered.width, rendered.height);
    if (data) {
      markComplete(pageNum, data);
      continue;
    }

    pending.push({ page, pageNum, canvas: rendered.canvas, scale });
  }

  // ---- Phase 2: rotation sweep in batches (parallel via worker pool) ----
  if (pending.length > 0) {
    const pendingPhase2 = [];

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const batchTasks = batch.map((entry) => {
        const ctx = entry.canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, entry.canvas.width, entry.canvas.height);

        const scanPromise = pool
          ? pool.scan(imageData)
          : Promise.resolve(
              mainThreadRotationSweep(ctx, entry.canvas.width, entry.canvas.height)
            );

        return scanPromise.then((data) => {
          if (data) {
            markComplete(entry.pageNum, data);
          } else {
            pendingPhase2.push(entry);
          }
        });
      });

      await Promise.all(batchTasks);
    }

    // ---- Phase 3: retry at double scale ----
    for (let i = 0; i < pendingPhase2.length; i += BATCH_SIZE) {
      const batch = pendingPhase2.slice(i, i + BATCH_SIZE);
      const batchTasks = batch.map(async (entry) => {
        const retryScale = entry.scale * 2;
        console.log(
          `[QR-Scanner] No QR found at scale ${entry.scale} — retrying at ${retryScale}x`
        );

        const rendered = await renderPage(entry.page, retryScale);

        const data = scanFirstPass(rendered.ctx, rendered.width, rendered.height);
        if (data) {
          markComplete(entry.pageNum, data);
          return;
        }

        const ctx = rendered.ctx;
        const imageData = ctx.getImageData(0, 0, rendered.width, rendered.height);

        const retryData = pool
          ? await pool.scan(imageData)
          : mainThreadRotationSweep(ctx, rendered.width, rendered.height);

        if (retryData) {
          markComplete(entry.pageNum, retryData);
        } else {
          completed++;
          onProgress?.(completed, total);
        }
      });

      await Promise.all(batchTasks);
    }
  }

  return results;
}
