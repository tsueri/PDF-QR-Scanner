import {
  prepareZXingModule,
  readBarcodes,
} from '../node_modules/zxing-wasm/dist/es/reader/index.js?v=__ASSET_VERSION__';

// Asset base. The release build rewrites this specifier and the wasm path
// below to the vendored copies under ./vendor/.
const ZXING_DIST = new URL('../node_modules/zxing-wasm/dist/', import.meta.url);
const ASSET_VERSION = '__ASSET_VERSION__';

function locateZXingAsset(path) {
  const url = new URL('reader/' + path, ZXING_DIST);
  // Emscripten reads the wasm with fs when running under Node (tests).
  if (url.protocol === 'file:') return decodeURIComponent(url.pathname);
  url.searchParams.set('v', ASSET_VERSION);
  return url.href;
}

const MODULE_OVERRIDES = { locateFile: locateZXingAsset };

// Emscripten's browser build can't fetch a file:// URL, so hand Node the bytes.
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  MODULE_OVERRIDES.wasmBinary = readFileSync(
    fileURLToPath(new URL('reader/zxing_reader.wasm', ZXING_DIST))
  );
}

prepareZXingModule({ overrides: MODULE_OVERRIDES });

// QR only: the customer cards also carry DataMatrix marks, which are out of scope.
const READER_OPTIONS = {
  tryHarder: true,
  formats: ['QRCode'],
};

let _warmup = null;

// Compile the wasm once per thread so the first page doesn't pay the cost.
export function prewarmDecoder() {
  if (!_warmup) {
    _warmup = Promise.resolve(
      prepareZXingModule({ overrides: MODULE_OVERRIDES, fireImmediately: true })
    ).catch(function (err) {
      console.warn('QR decoder warm-up failed:', err);
      _warmup = null;
    });
  }
  return _warmup;
}

export async function decodeImageData(imageData) {
  try {
    const results = await readBarcodes(imageData, READER_OPTIONS);
    return results.map(function (result) {
      return { data: String(result.text), position: result.position };
    });
  } catch (err) {
    console.warn('QR scan error:', err);
    return [];
  }
}

// One record per code: page number repeated, exact payload duplicates within
// a page collapsed, reading order top-to-bottom then left-to-right.
export function orderAndDedupeCodes(page, codes) {
  if (!Array.isArray(codes)) return [];

  const seen = new Set();
  const ordered = [];

  for (const code of codes) {
    if (!code || typeof code.data !== 'string') continue;
    if (seen.has(code.data)) continue;
    seen.add(code.data);
    ordered.push({ page, data: code.data, position: code.position || null });
  }

  ordered.sort(function (a, b) {
    const ay = a.position ? a.position.topLeft.y : 0;
    const by = b.position ? b.position.topLeft.y : 0;
    if (ay !== by) return ay - by;
    const ax = a.position ? a.position.topLeft.x : 0;
    const bx = b.position ? b.position.topLeft.x : 0;
    return ax - bx;
  });

  return ordered;
}
