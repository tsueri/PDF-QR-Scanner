# Live camera capture: APIs, BarcodeDetector, and mobile quirks

Research for ticket [#22](https://github.com/tsueri/PDF-QR-Scanner/issues/22), child of the map [#18](https://github.com/tsueri/PDF-QR-Scanner/issues/18). Planning input only; no app code was changed.

Researched 2026-10-27. Compat data: `@mdn/browser-compat-data` 8.1.7 (the dataset behind MDN's tables) and caniuse (page footer shows September 2026 usage stats). Experiments: Chrome 150.0.7871.24 (Puppeteer's bundled build), Puppeteer 25.3.0 (the repo's version), zxing-wasm 3.1.5 (the repo's version), Node 22, Intel Core Ultra 7 155H (Linux desktop). **No physical phone was available**, so everything about real mobile hardware (decode speed, battery, autofocus, camera selection) is flagged as unmeasured.

## Recommendation

1. **One decoder everywhere: zxing-wasm in a worker.** Do not use native `BarcodeDetector` in milestone 1. It exists only in Chrome on Android and Chrome on macOS/ChromeOS, is flag-gated off in Safari, and is missing in Firefox. Its format list differs per OS and it returns less data than zxing. Keep the decode step behind a small interface (`frame -> codes[]`) so a native fast path can be added later without touching the UI.
2. **Capture recipe.** `getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } })`, started from a button tap, rendered into a `<video playsinline muted>`. Pull frames with `requestVideoFrameCallback` (fall back to `requestAnimationFrame` where it is missing). Draw into a reusable canvas (`willReadFrequently: true`), `getImageData`, transfer the buffer to a worker. This is the same `{imageDataBuffer, width, height}` message the PDF pipeline already uses.
3. **Latest-frame-wins, not a queue.** One in-flight decode per worker; discard frames that arrive while busy. The existing `WorkerPool.scan()` queues every task unboundedly, which is right for PDF pages and wrong for video.
4. **Camera needs its own reader options.** `decode.js` pins `{ tryHarder: true, formats: ['QRCode'] }`. For live video use `tryHarder:false, tryRotate:false, tryInvert:false`: that is 1.2-2.5x faster and the biggest factor is those flags, not the number of formats. `decodeImageData` therefore needs an options parameter (or a second preset); the PDF preset must stay unchanged.
5. **Torch and zoom are optional extras, feature-detected through `track.getCapabilities()`.** Never gate scanning on them. They are realistically available on Chrome for Android and iOS Safari (when the hardware has them); Firefox has no evidence of support.
6. **Lifecycle.** Stop all tracks on `visibilitychange` (hidden) and `pagehide`; restart only via a visible control. Also handle `track.onmute/onunmute/onended`.
7. **iOS Home Screen web apps are the weak spot** (permission re-prompts, see below). Treat them as best-effort and keep the camera strictly user-initiated.
8. **Headless testing works** with Chromium's fake-device flags and a `.y4m` file, in the repo's Puppeteer setup. Torch cannot be tested headlessly; zoom can.

## What contradicts or sharpens the map

- The map says "reuse `decode.js` and the worker pool". `decode.js` is reusable, but the **pool is not suited as-is**: unbounded queue (see 3), and `_getPool()` returns `null` when `hardwareConcurrency - 1 <= 1`, falling back to main-thread decoding. For live video a decode on the main thread would stall the preview, so camera mode needs a dedicated worker regardless of core count.
- `decode.js` `READER_OPTIONS` is a module constant (see 4). Per-source options is a design change in a module the PDF tests guard.
- The map's fog item "feedback (beep/haptics)" has a platform hole: **`navigator.vibrate` is not available in Safari (iOS or macOS)** (BCD: `false`) and was removed from Firefox desktop in 130; haptics cannot be a baseline feature.
- Test scope: an automated test cannot prove torch, facing-mode selection, or permission persistence. Those need a manual device checklist.

## 1. getUserMedia: constraints, secure context, permissions

**Availability.** `getUserMedia`: Chrome 53, Firefox 36, Safari/iOS 11 (BCD). `HTMLVideoElement` `playsinline`: Safari/iOS 10 ([BCD](https://github.com/mdn/browser-compat-data), `html.elements.video.playsinline`).

**Secure context.** `navigator.mediaDevices` is `[SecureContext]` ([Media Capture and Streams](https://w3c.github.io/mediacapture-main/)); on insecure pages `getUserMedia` fails with `NotAllowedError` ([MDN: getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)). `http://localhost` counts as secure (this is why the repo's integration test, which serves on `http://localhost`, works; verified below). Testing on a phone against a dev machine therefore needs HTTPS or a tunnel. Hosting must not send `Permissions-Policy: camera=()` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia): rejects with `NotAllowedError` when the policy forbids it); check the qrscan.campa.tools host config.

**Rear camera.** Use `facingMode: { ideal: 'environment' }`, not `exact`. MDN documents `exact` as the way to *require* the rear camera, and a device that cannot satisfy it rejects with `OverconstrainedError`. I confirmed the failure mode: Chrome's fake camera has no facing mode, `exact: 'environment'` rejects with `OverconstrainedError`, `ideal` succeeds. MDN also notes that user preference (the camera chosen in the permission prompt) may override the request, and that switching facing modes may require `track.stop()` first.

**Resolution / frame rate.** Request `ideal` values; read what you got from `track.getSettings()` (verified: asking 1280x720@30 returned exactly that). The spec says that on devices that rotate with orientation, `getSettings()` width/height are flipped to match the actual frame ([mediacapture-main, facingMode/orientation note](https://w3c.github.io/mediacapture-main/)), so size the capture canvas from `video.videoWidth/videoHeight` on every frame and listen for the video `resize` event rather than caching dimensions.

**Error classes** that feed the map's error-taxonomy fog ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)): `NotAllowedError` (denied, insecure, policy), `NotFoundError` (no camera), `NotReadableError` (hardware/OS/page-level failure, e.g. camera busy), `OverconstrainedError` (constraints unsatisfiable), `SecurityError`. MDN also notes the promise can stay pending forever if the user ignores the prompt: show a "waiting for permission" state, not a spinner with a timeout error.

**Autoplay.** WebKit allows `<video muted>`/no-audio-track `play()` without a gesture, and `playsinline` prevents iPhone fullscreen takeover ([WebKit: New video policies for iOS](https://webkit.org/blog/6784/new-video-policies-for-ios/)). Camera stream: set `muted` and `playsinline`.

### Permission persistence and iOS

- **Safari (tab):** Settings > Safari > Camera (or per-site Website Settings) has Ask / Deny / Allow; the default is Ask ([Apple Support](https://support.apple.com/en-mt/guide/iphone/iphb01fc3c85/ios)). With Ask, expect a prompt on each page load; do not design around persistence.
- **Safari Home Screen web app ("standalone/PWA"):** `getUserMedia` works since iOS 13.4 ([WebKit bug 185448](https://bugs.webkit.org/show_bug.cgi?id=185448), resolved fixed; before that `navigator.mediaDevices` was effectively unusable in standalone mode). But there are open reports:
  - [Bug 215884](https://bugs.webkit.org/show_bug.cgi?id=215884): permission re-prompt when only the URL hash changes, and again after roughly 90 s. **Implication: do not use hash routing or `pushState` navigation while the camera is live.**
  - [Bug 327237](https://bugs.webkit.org/show_bug.cgi?id=327237) (filed 2026-10-12 against iOS 26.6.2, state NEW, only auto-imported to Apple's Radar so far): permission is asked again on **every cold launch** of a Home Screen web app, with no per-app "Allow". This is a single user report with a repro page; I have not confirmed it independently and WebKit has not triaged it. Plan for it as probable.
  - [Bug 273938](https://bugs.webkit.org/show_bug.cgi?id=273938) / [282327](https://bugs.webkit.org/show_bug.cgi?id=282327): camera stream failing in standalone PWAs on some devices/iOS versions (NEW; user reports).
  These are the kind of thing that make "PWA/install" (a fog item) risky for the camera flow.
- **Other iOS browsers** (Chrome/Firefox on iOS) are WKWebView-based; `getUserMedia` there was blocked until iOS 14.3-era WKWebView work ([WebKit bug 208667](https://bugs.webkit.org/show_bug.cgi?id=208667)); treat as untested.
- **Android Chrome/desktop:** not covered by primary sources I could verify; the Permissions API can read the camera state where supported (`navigator.permissions.query({name:'camera'})`; Permissions API: Chrome 43, Firefox 46, Safari 16, BCD; whether each browser accepts the `camera` name is not in BCD, so wrap in try/catch).
- Chrome additionally gates pan/tilt/zoom behind a **separate PTZ permission**: a site "is allowed to control camera PTZ only if the user has explicitly granted the camera with PTZ permission through a prompt", requested by passing `zoom: true` (etc.) in the `getUserMedia` constraints; a previously granted plain camera permission does not upgrade ([web.dev: Control camera pan, tilt, and zoom](https://web.dev/articles/camera-pan-tilt-zoom)). I reproduced this in headless Chrome (see section 6): with only `camera` granted, a `zoom` constraint rejects with `NotAllowedError`. So on Chrome, if the UI offers zoom, request `zoom: true` up front, accepting a second prompt line on devices that support zoom. (Torch is not described as PTZ-gated in these sources.)

## 2. Torch, zoom, focus

Defined in [MediaStream Image Capture](https://www.w3.org/TR/image-capture/) section 9: `torch`, `zoom`, `focusMode`, `focusDistance` etc. are constrainable properties exposed through `MediaStreamTrack.getCapabilities()/getSettings()/applyConstraints()`. If the source cannot turn on torch, `capabilities.torch` is `[false]`; if the source does not support zoom the UA MUST NOT expose a zoom range. **`getSupportedConstraints()` only says the browser knows the name, not that the camera has the feature** (web.dev, above). I saw this in Chrome 150: `getSupportedConstraints()` lists `torch: true, zoom: true`, but the fake camera's `getCapabilities()` has neither, and `applyConstraints({advanced:[{torch:true}]})` rejects with `OverconstrainedError`.

Apply them through `applyConstraints({ advanced: [{ torch: true }] })` (MDN's own `zoom` example uses `advanced`); `ImageCapture` is **not** required for torch/zoom on a video track.

| Browser | Evidence | Verdict |
|---|---|---|
| Chrome Android | `ImageCapture` since Chrome 59 (BCD); Chrome's launch post lists "zoom, brightness, and torch mode" as track capabilities ([Chrome: Take photos and control camera settings](https://developer.chrome.com/blog/imagecapture)); PTZ on Android = zoom only since Chrome 87 (web.dev). | torch + zoom on supporting hardware |
| Chrome desktop | PTZ supported since Chrome 87 (web.dev); depends on the webcam. Torch irrelevant. | zoom only with PTZ webcams |
| iOS/macOS Safari | WebKit's capture source exposes `torch` when `-[AVCaptureDevice hasTorch]` and `zoom` when the preset supports it; iOS zoom max is capped at 10x ([WebKit `AVVideoCaptureSource.mm`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/mediastream/cocoa/AVVideoCaptureSource.mm), `computeMaxZoom`, `hasTorch`). Safari 18.4 release notes mention a fix for stale `torch` values in `getSettings()` ([Safari 18.4 notes](https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes)), so torch existed by then. `ImageCapture` arrived in Safari 18.4, `grabFrame` in Safari 26. | torch + zoom likely on iPhone; the exact first version is not documented in the sources I found |
| Firefox (desktop/Android) | `ImageCapture`: behind a pref on desktop, absent on Android (BCD: `firefox: 35 [flag]`, `firefox_android: false`); implementation bug [888177](https://bugzilla.mozilla.org/show_bug.cgi?id=888177) open since 2013. `getCapabilities()` itself only since Firefox 132. I found no source showing torch/zoom constraints. | assume none; feature-detect |

**Focus.** `focusMode`/`focusDistance`/`pointsOfInterest` are in the spec, and Chrome plumbs `focusMode` (the fake device reports `manual` with a distance). I found no primary source on which mobile browsers expose them. Design for the default continuous autofocus; do not build tap-to-focus into M1.

## 3. Frame extraction

| API | Support (BCD) | Notes |
|---|---|---|
| `HTMLVideoElement.requestVideoFrameCallback` | Chrome 83, Safari/iOS 15.4, **Firefox 132** | Fires at min(video fps, paint rate); main thread; "no strict guarantees" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)). Baseline since 2024. |
| `createImageBitmap(video)` | Chrome 50, Firefox 42, Safari 15 | Transferable to workers. |
| `ImageCapture.grabFrame()` | Chrome 59, **Safari 26**, Firefox none | Awaits the next frame. Measured 33.3 ms median at 30 fps, i.e. it is paced by the camera, not cheap CPU work. |
| `MediaStreamTrackProcessor` / `VideoFrame` | Chrome 94, Safari 18 (processor); Firefox none (processor) | Worker-friendly but not universal. Skip. |
| `OffscreenCanvas` | Chrome 69, Firefox 105, Safari 16.4 | Needed for any worker-side drawing. |

**Measured cost** (Chrome 150, desktop, fake camera, 60 samples each, ms):

| Resolution | `drawImage`+`getImageData` (main thread) median / p95 | `createImageBitmap(video)` median / p95 | `grabFrame` median |
|---|---|---|---|
| 640x480 | 1.3 / 3.1 | 0.5 / 0.6 | 33.3 |
| 1280x720 | 3.6 / 8.7 | 1.5 / 5.0 | 33.3 |
| 1920x1080 | 8.2 / 20.8 | 4.4 / 9.5 | 33.2 |

A second run that transferred the `ImageBitmap` to the worker and did `OffscreenCanvas.drawImage`+`getImageData` there measured the main-thread `createImageBitmap` at 1.8 / 6.5 / 11.2 ms (640/720p/1080p) with 2.0 / 5.0 / 9.8 ms of worker-side extraction. The numbers are noisy and the main-thread saving over `getImageData` is **not clearly worth a second code path on desktop**. Whether it helps on a phone (where `getImageData` readback is likelier to hurt) is untested. **Start with `drawImage`+`getImageData`+transfer**: it reuses `scan.worker.js` as-is. Keep a capture-size cap (long side <= 1280) so extraction and decode stay in the single-digit-ms range.

Transfer: the `ImageData` buffer is transferred, not copied (`WorkerPool` already does `postMessage(..., [buffer])`); after transfer the main thread must allocate/draw a fresh `ImageData` each frame (so the in-flight buffer is not reused).

## 4. Native `BarcodeDetector`: worth a fast path?

**Availability** ([caniuse](https://caniuse.com/mdn-api_barcodedetector), [BCD](https://github.com/mdn/browser-compat-data) `api.BarcodeDetector`, [Chromium `services/shape_detection/BUILD.gn`](https://chromium.googlesource.com/chromium/src/+/main/services/shape_detection/BUILD.gn)):

| Platform | Status |
|---|---|
| Chrome / Samsung Internet / WebView **Android** | Supported (in Chromium's `BUILD.gn` Android barcode detection is "provided by Java", i.e. a platform component rather than Chromium C++; Samsung Internet 13+) |
| Chrome / Edge **macOS** | Supported via Apple Vision (partial; a macOS Ventura bug silently failed before Chrome 113) |
| Chrome **ChromeOS** | Supported per BCD |
| Chrome / Edge **Windows, Linux** | **Not supported** per BCD (macOS and ChromeOS only on desktop). `'BarcodeDetector' in window` is `false` in Chrome 150 on Linux (verified, but that was Puppeteer's non-branded Chrome build; Chromium's `BUILD.gn` uses a stub implementation unless `build_with_internal_shape_detection`, so branded builds could differ; BCD is the better guide). |
| **Safari / iOS Safari** | Behind the "Shape Detection API" preference, **disabled by default** through Safari 27.x (caniuse Sept 2026 data) |
| **Firefox** (desktop and Android) | Not supported (implementation bug [1553738](https://bugzil.la/1553738)) |

It is a WICG draft, not on the W3C standards track ([spec](https://wicg.github.io/shape-detection-api/)), and MDN marks it "Limited availability / Experimental".

**Formats are platform-dependent.** The spec enum has 13 formats (`aztec, code_128, code_39, code_93, codabar, data_matrix, ean_13, ean_8, itf, pdf417, qr_code, upc_a, upc_e`) and says `getSupportedFormats()` is platform dependent. Chrome's own docs show a macOS machine returning 11 (no `codabar`, no `upc_a`) ([Chrome: Shape Detection](https://developer.chrome.com/docs/capabilities/shape-detection)); Chromium's internal (branded-build) implementation enumerates all 13 (`barcode_detection_impl_chrome.cc`). zxing-wasm 3.1.5 reads 40+ formats including Micro QR, rMQR, MaxiCode, GS1 DataBar variants, Telepen, ISBN/PZN (`BARCODE_FORMATS` in `zxing-wasm/dist/cjs/bindings/barcodeFormat.d.ts`), i.e. a superset of everything native offers.

**Result shape.** Native `DetectedBarcode` = `boundingBox`, `rawValue` (string), `format`, `cornerPoints` ([spec](https://wicg.github.io/shape-detection-api/)). zxing's `ReadResult` additionally has `bytes`, `bytesECI`, `contentType`, `hasECI`, `ecLevel`, `symbologyIdentifier`, `isMirrored`, `isInverted`, `orientation`, structured-append fields. Format names differ (`qr_code` vs `QRCode`), so using both requires a mapping layer. The raw-bytes/ECI fields matter for the map's results view and JSON export.

**Privacy.** The spec frames it as on-device analysis (section 3, Security and Privacy) and I found no source saying otherwise, but the actual decoder is an OS/platform component the app cannot audit or self-host, which cuts against the map's hard rule of a self-hosted decoder.

**Performance.** I found no primary-source benchmark of native vs zxing. The plausible win is battery on Android Chrome; unmeasured.

**Verdict.** Not worth it in M1: it is missing on iOS, Firefox, and Windows/Linux Chrome; results differ by platform (consistency, testing, `getSupportedFormats()` drift); it would need a second code path and tests that headless Linux Chrome cannot run (it is absent there). Revisit as a feature-flagged optimisation after on-device measurements, behind the `frame -> codes[]` interface. If added: gate on `await BarcodeDetector.getSupportedFormats()` containing every format the user selected, otherwise use zxing.

## 5. Decode rate, CPU/battery, lifecycle

**zxing-wasm reader options relevant to video** (`ReaderOptions` in `zxing-wasm/dist/cjs/bindings/readerOptions.d.ts`): `tryHarder` (default true), `tryRotate` (true), `tryInvert` (true), `tryDownscale` (true; starts when `min(w,h) >= downscaleThreshold`, default 500, factor 3), `maxNumberOfSymbols` (255), `minLineCount` (2). `readBarcodes` accepts `Blob | ArrayBuffer | Uint8Array | ImageData` only, so video needs the `ImageData` extraction step above. Reader wasm is about 0.97 MB (`zxing_reader.wasm`).

**Measured decode** (median ms per frame; Chrome 150, one worker, desktop; fake camera showing a large, easy QR code at 30 fps; 40 frames):

| Options | 640x480 | 1280x720 | 1920x1080 |
|---|---|---|---|
| QR only, `tryHarder` (the current `decode.js` preset) | 4.5 | 11.0 | 22.4 |
| QR only, `tryHarder/tryRotate/tryInvert = false` | 3.8 | 8.7 | 17.9 |
| 9 common formats, fast flags | 4.4 | 11.4 | 20.7 |
| all formats, **default flags** | 15.6 | 38.7 | 74.7 |

**Worst case: a frame with no code** (Node, same wasm, synthetic cluttered grayscale frame, median of 15; this is the usual case while the user is aiming):

| Options | 640x480 | 1280x720 | 1920x1080 |
|---|---|---|---|
| QR only, `tryHarder` (current) | 5.3 | 9.8 | 26.5 |
| QR only, fast flags | 3.3 | 4.9 | 11.3 |
| all formats, default flags | 34.1 | 97.9 | 219.2 |
| all formats, fast flags | 3.3 | 8.8 | 19.2 |

Takeaways: (a) cost scales roughly with pixel count, (b) **"all formats" is only expensive with the default heavy flags**; with fast flags it costs about the same as QR-only, so the user-selectable symbology list in the map does not need a performance tax in camera mode, (c) 720p is the sweet spot; 1080p doubles the cost for no gain on an in-focus code held at normal distance.

**Mobile:** not measured. A phone's cores are slower than this desktop and run thermally constrained, so treat the numbers above as a lower bound, not an estimate. Design so the decode rate is self-limiting rather than assuming a number: one decode in flight, drop frames while busy (decode loop naturally runs at 1/decode-time, a few to a few tens of frames per second), cap capture at 1280 long side, and consider a hard ceiling (e.g. 10-15 decodes/s) to bound heat/battery. **No primary source exists for battery cost; it needs an on-device measurement.** (Suggested ticket below.)

**Lifecycle.**
- `track.stop()` releases the camera: verified `readyState` becomes `"ended"` immediately.
- Hidden pages: the spec's "Best Practice 5" allows a UA to forcibly mute camera tracks for privacy and expects pages to react to `mute`/`unmute` ([Media Capture and Streams](https://w3c.github.io/mediacapture-main/getusermedia.html)); WebKit does this on iOS when the document is hidden ([WebKit changeset 217734 / bug 172858](https://bugs.webkit.org/show_bug.cgi?id=172858)). Related quirks: iOS 15 once failed to unmute after a sub-500 ms background trip ([bug 230538](https://bugs.webkit.org/show_bug.cgi?id=230538), resolved fixed), and `getUserMedia` called from a background tab only prompts once the tab is visible ([bug 259465](https://bugs.webkit.org/show_bug.cgi?id=259465) comment).
- So: on `visibilitychange` -> `hidden`, stop tracks and cancel the frame callback; on return show a "Resume camera" state (needs a gesture on iOS anyway) rather than silently re-calling `getUserMedia`. Never rely on `unmute` alone; also check `track.readyState`.
- Optional: Screen Wake Lock to stop the screen dimming during a scan: `navigator.wakeLock` Chrome 84, Firefox 126, Safari 16.4; Safari 18.4 notes fix wake lock for Home Screen web apps, so earlier iOS standalone is partial ([BCD](https://github.com/mdn/browser-compat-data); [Safari 18.4 notes](https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes)).
- Haptics: `navigator.vibrate` unsupported in Safari (iOS and macOS) and in Firefox desktop since 130 (BCD); audio beep is the portable feedback (needs a prior user gesture to start an `AudioContext`).

## 6. Testing camera flows headlessly (verified)

Chromium has three relevant switches (source: [`media/base/media_switches.cc`](https://chromium.googlesource.com/chromium/src/+/main/media/base/media_switches.cc); [webrtc.org: Testing WebRTC applications](https://webrtc.org/getting-started/testing)):
- `--use-fake-device-for-media-stream` replaces camera/mic with fake devices; takes `name=value` options parsed by `FakeVideoCaptureDeviceFactory::ParseFakeDevicesConfigFromOptionsString` (`fps`, `device-count`, `hardware-support=pan-tilt-zoom`, ...).
- `--use-file-for-fake-video-capture=<file>` plays a file as the webcam, looped. Supported formats: **Y4M (`.y4m`) and MJPEG (`.mjpeg`)**; "only trivial Y4M per-frame headers" ([`file_video_capture_device.h`](https://chromium.googlesource.com/chromium/src/+/main/media/capture/video/file_video_capture_device.h)).
- `--use-fake-ui-for-media-stream` auto-accepts the camera prompt.

**What I verified in the repo's setup (Puppeteer 25.3.0, Chrome 150, `headless: true` and `chrome-headless-shell`), page served from `http://localhost`:**
1. Args `['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=/abs/path/qr.y4m']` work in both headless modes: `getUserMedia` resolves, `rVFC` fires at 30 fps, and zxing-wasm in a worker decoded the QR in 40/40 frames. The existing test's `--no-sandbox` args are compatible.
2. **Permission alternatives.** Without `--use-fake-ui-for-media-stream` and without a grant, `getUserMedia` rejects with `NotAllowedError`. `browserContext.overridePermissions(origin, ['camera'])` works for plain camera access, so tests that must exercise the *denied* path can omit the flag (no grant = `NotAllowedError`).
3. **Zoom is testable, torch is not.** With `--use-fake-device-for-media-stream=hardware-support=zoom` (default fake pattern device) and `browserContext.setPermission(origin, {permission:{name:'camera', panTiltZoom:true}, state:'granted'}, {permission:{name:'camera'}, state:'granted'})`, the track reports `capabilities.zoom = {min:100, max:400, step:1}` and `applyConstraints({advanced:[{zoom:400}]})` succeeds (`getSettings().zoom === 400`). The fake factory only models pan/tilt/zoom, so a `torch` constraint rejects with `OverconstrainedError: Unsupported constraint`: this is useful, since it exercises the "torch unavailable" fallback for free. (I did not test whether file-based video and `hardware-support` combine.)
4. Fake devices have no facing mode: `exact: 'environment'` -> `OverconstrainedError`; `ideal` -> OK. Another reason to use `ideal`.
5. Native `BarcodeDetector` is **absent** in headless Linux Chrome, so the zxing path is the one the tests will exercise (consistent with the recommendation).
6. **Generating the video.** `ffmpeg -framerate 30 -i f%03d.png -pix_fmt yuv420p qr.y4m` works, but an ffmpeg-free generator is trivial and was verified (10 frames of 640x480, 4.6 MB, decoded 40/40): write `YUV4MPEG2 W640 H480 F30:1 Ip A1:1 C420jpeg\n`, then per frame `FRAME\n` + Y plane + U plane + V plane (4:2:0, planar), converting from the repo's existing `canvas`/`qrcode` dev-dependencies with Y = 0.299R+0.587G+0.114B, U = 128-0.168736R-0.331264G+0.5B, V = 128+0.5R-0.418688G-0.081312B sampled at even pixels. Generate it into `os.tmpdir()` at test time rather than committing a multi-MB file.

What headless tests can not cover (needs a manual real-device checklist): torch on real hardware, real `facingMode` selection and which physical lens is chosen, iOS permission persistence/re-prompts, Home Screen web app behaviour, background/foreground muting on iOS, autofocus quality, battery/thermal.

## Not verified / needs a real device

- Decode speed, heat, and battery on actual phones (suggest a measurement ticket on one mid-range Android and one iPhone).
- Which rear lens `facingMode: environment` selects on multi-camera phones (ultra-wide vs wide) and its focus behaviour. Commonly discussed, but I found no primary source, so I am not asserting it.
- Exact Safari version that first shipped `torch`/`zoom` track constraints.
- Chrome/Firefox permission persistence semantics beyond the Permissions API surface.
- Whether Android Chrome's native detector needs any network/model download on first use (not documented in the sources I could verify).

## Sources

- Media Capture and Streams (W3C): https://w3c.github.io/mediacapture-main/ and https://w3c.github.io/mediacapture-main/getusermedia.html
- MediaStream Image Capture (W3C): https://www.w3.org/TR/image-capture/ , https://w3c.github.io/mediacapture-image/
- Accelerated Shape Detection in Images (WICG): https://wicg.github.io/shape-detection-api/
- MDN: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia , https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback , https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API , https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints
- `@mdn/browser-compat-data` 8.1.7: https://github.com/mdn/browser-compat-data
- caniuse: https://caniuse.com/mdn-api_barcodedetector , https://caniuse.com/stream
- Chrome for Developers: https://developer.chrome.com/docs/capabilities/shape-detection , https://developer.chrome.com/blog/imagecapture ; web.dev: https://web.dev/articles/camera-pan-tilt-zoom
- Chromium source: https://chromium.googlesource.com/chromium/src/+/main/media/base/media_switches.cc , https://chromium.googlesource.com/chromium/src/+/main/media/capture/video/file_video_capture_device.h , https://chromium.googlesource.com/chromium/src/+/main/media/capture/video/fake_video_capture_device_factory.cc , https://chromium.googlesource.com/chromium/src/+/main/services/shape_detection/BUILD.gn
- WebKit: https://webkit.org/blog/6784/new-video-policies-for-ios/ , https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/mediastream/cocoa/AVVideoCaptureSource.mm , bugs 185448, 215884, 327237, 273938, 282327, 208667, 230538, 259465, 172858 at https://bugs.webkit.org/
- Apple: Safari 18.4 release notes https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes ; Safari 26 release notes (`ImageCapture.grabFrame`) https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes ; Safari camera settings https://support.apple.com/en-mt/guide/iphone/iphb01fc3c85/ios
- Firefox: https://bugzilla.mozilla.org/show_bug.cgi?id=888177 (ImageCapture), https://bugzil.la/1553738 (BarcodeDetector)
- WebRTC testing flags: https://webrtc.org/getting-started/testing
- zxing-wasm 3.1.5 type definitions (as installed in this repo's `node_modules`).
