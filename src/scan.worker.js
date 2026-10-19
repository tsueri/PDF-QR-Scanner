import {
  decodeImageData,
  orderAndDedupeCodes,
  prewarmDecoder,
} from './decode.js?v=__ASSET_VERSION__';

prewarmDecoder();

self.onmessage = async function (e) {
  const { imageDataBuffer, width, height } = e.data;
  try {
    const imageData = new ImageData(
      new Uint8ClampedArray(imageDataBuffer),
      width,
      height
    );
    const codes = await decodeImageData(imageData);
    self.postMessage({ codes });
  } catch (err) {
    self.postMessage({ codes: null, error: err.message });
  }
};
