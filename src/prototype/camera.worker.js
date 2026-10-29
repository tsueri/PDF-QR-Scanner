// PROTOTYPE (ticket #30) — latest-frame-wins decode worker for the camera variants.
// Lives only on prototype/camera-ux; never merge to main.
//
// Mirrors the message shape of src/scan.worker.js ({imageDataBuffer, width, height} in,
// {codes} out) but with the camera preset from research/camera-capture.md:
//   - QR only, fast flags (tryHarder / tryRotate / tryInvert off — 1.2-2.5x faster on video)
//   - one in-flight decode; the main thread drops frames while this worker is busy
// The zxing setup is copied (not imported) from src/decode.js so the prototype never
// touches production code paths.

import {
    prepareZXingModule,
    readBarcodes,
} from '../../node_modules/zxing-wasm/dist/es/reader/index.js';

const ZXING_DIST = new URL('../../node_modules/zxing-wasm/dist/', import.meta.url);

function locateZXingAsset(path) {
    return new URL('reader/' + path, ZXING_DIST).href;
}

prepareZXingModule({ overrides: { locateFile: locateZXingAsset }, fireImmediately: true });

const CAMERA_OPTIONS = {
    tryHarder: false,
    tryRotate: false,
    tryInvert: false,
    formats: ['QRCode'],
};

self.onmessage = async function (e) {
    const { imageDataBuffer, width, height } = e.data;
    try {
        const imageData = new ImageData(new Uint8ClampedArray(imageDataBuffer), width, height);
        const results = await readBarcodes(imageData, CAMERA_OPTIONS);
        const codes = results.map(function (result) {
            return { data: String(result.text), position: result.position || null };
        });
        self.postMessage({ codes });
    } catch (err) {
        self.postMessage({ codes: null, error: err.message });
    }
};
