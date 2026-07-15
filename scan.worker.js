function rotateImageData(imageData, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const w = imageData.width;
  const h = imageData.height;

  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const newW = Math.ceil(w * cos + h * sin);
  const newH = Math.ceil(w * sin + h * cos);

  const sourceCanvas = new OffscreenCanvas(w, h);
  const sourceCtx = sourceCanvas.getContext('2d');
  sourceCtx.putImageData(imageData, 0, 0);

  const rotated = new OffscreenCanvas(newW, newH);
  const rCtx = rotated.getContext('2d');
  rCtx.imageSmoothingEnabled = false;
  rCtx.translate(newW / 2, newH / 2);
  rCtx.rotate(rad);
  rCtx.drawImage(sourceCanvas, -w / 2, -h / 2);

  return rCtx.getImageData(0, 0, newW, newH);
}

function scanForQRCode(buffer, width, height) {
  const jsQR = self.jsQR;
  if (!jsQR) return null;

  const imageData = new ImageData(
    new Uint8ClampedArray(buffer),
    width,
    height
  );

  let code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  });
  if (code) return String(code.data);

  for (let dir = 0; dir < 2; dir++) {
    for (let angle = 5; angle <= 45; angle += 5) {
      const sign = dir === 0 ? 1 : -1;
      const rotated = rotateImageData(imageData, sign * angle);
      code = jsQR(rotated.data, rotated.width, rotated.height, {
        inversionAttempts: 'dontInvert',
      });
      if (code) return String(code.data);
    }
  }

  return null;
}

self.onmessage = function (e) {
  const { imageDataBuffer, width, height } = e.data;
  try {
    const data = scanForQRCode(imageDataBuffer, width, height);
    self.postMessage({ data });
  } catch (err) {
    self.postMessage({ data: null, error: err.message });
  }
};
