import * as pdfjsLib from 'pdfjs-dist';
import { decodeImageData, orderAndDedupeCodes } from './decode.js?v=__ASSET_VERSION__';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.mjs?v=__ASSET_VERSION__',
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
      const worker = new Worker(workerUrl, { type: 'module' });
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
        task.resolve(e.data.codes);
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
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, ctx, width: canvas.width, height: canvas.height };
}

async function scanRendered(pool, rendered) {
  if (pool) {
    const imageData = rendered.ctx.getImageData(0, 0, rendered.width, rendered.height);
    return (await pool.scan(imageData)) || [];
  }
  return decodeImageData(
    rendered.ctx.getImageData(0, 0, rendered.width, rendered.height)
  );
}

// --- Singleton pool (created once, reused across scans) --------------------

let _pool = null;
let _poolPromise = null;

async function _getPool() {
  if (_pool) return _pool;
  if (_poolPromise) return _poolPromise;

  _poolPromise = (async () => {
    const supportsOffscreen = typeof OffscreenCanvas !== 'undefined';
    const cores = navigator.hardwareConcurrency || 4;
    const poolSize = Math.max(1, cores - 1);

    if (supportsOffscreen && poolSize > 1) {
      const workerUrl = new URL('./scan.worker.js?v=__ASSET_VERSION__', import.meta.url);
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

  function markComplete(codes) {
    results.push(...codes);
    completed++;
    onProgress?.(completed, total);
  }

  async function processPage(entry) {
    const codes = await scanRendered(pool, entry.rendered);
    markComplete(orderAndDedupeCodes(entry.pageNum, codes));
  }

  let batch = [];

  async function flushBatch() {
    if (batch.length === 0) return;
    const entries = batch;
    batch = [];
    await Promise.all(entries.map(processPage));
  }

  for (let pageNum = 1; pageNum <= total; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const rendered = await renderPage(page, scale);
    batch.push({ page, pageNum, rendered });

    if (batch.length >= BATCH_SIZE) {
      await flushBatch();
    }
  }

  await flushBatch();

  results.sort((a, b) => a.page - b.page);
  return results;
}
