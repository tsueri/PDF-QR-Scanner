# Client-side ZIP library & bundler-less integration

## Question

Which client-side ZIP library should PDF-QR-Scanner use to generate a ZIP entirely in the browser (one CSV per file), and how is it integrated given the project's bundler-less setup?

## Recommendation

Use **JSZip 3.10.1**, loaded exactly like `jsQR` is today: a plain `<script src="node_modules/jszip/dist/jszip.min.js"></script>` tag in `index.html` that exposes the global `JSZip` (read as `globalThis.JSZip`). It is the cleanest fit for this bundler-less project because its UMD dist file mirrors the existing `jsQR` pattern 1:1, and its API is purpose-built for "add N named string files, produce one `Blob`" — `new JSZip()`, `zip.file(name, csvString)`, `await zip.generateAsync({ type: 'blob' })`. **fflate** is noted below as a lighter, actively-maintained alternative for a size-conscious swap.

## Candidates considered

| Library | Min size (dist) | Maintenance | Browser-only use | Pros | Cons |
| --- | --- | --- | --- | --- | --- |
| **JSZip 3.10.1** | ~95 KB (`dist/jszip.min.js`, UMD; pako bundled) | Stable but stagnant — last publish 4 years ago; ~38M weekly downloads, 7000+ dependents | Yes — UMD global `JSZip`, no bundler needed | De-facto standard; object-oriented API (`zip.file()`, `folder()`); `generateAsync({type:'blob'})` returns a `Promise<Blob>` directly (ideal for download); mirrors the project's `jsQR` `<script>`+global pattern exactly; rich docs | ~95 KB min (~3x fflate); dual MIT/GPL-3.0 license (GPL clause is a caveat to note); no activity/ESM build |
| **fflate 0.8.x** | ~33 KB (`umd/index.js`, UMD; 0 deps) | Active — 0.8.3 published ~2 months ago; ~52M weekly downloads | Yes — UMD global `fflate`, also ships `esm/browser.js` | ~3x smaller, faster, 0 deps, pure MIT; ships ESM + UMD; async APIs use Web Workers (non-blocking, multi-threaded) | `zipSync({name: strToU8(csv)})` returns a `Uint8Array` (must wrap `new Blob([u8])` yourself) and needs `strToU8()` per file; async `zip()` is callback-based, not promises; slightly more manual for the "string files → Blob" flow |

Both were inspected on disk (see *Dist layout*). Either works; JSZip is recommended for lowest integration friction and the Blob-direct API, fflate if payload size becomes a priority.

## Dist layout

Verified by downloading the npm tarballs (`npm pack jszip@3.10.1 fflate@0.8.2`) into a scratch dir and listing the extracted `package/` contents — no dependency was added to the project's `package.json`.

**JSZip 3.10.1** — `node_modules/jszip/dist/`:

```
dist/jszip.js        374,191 bytes  (UMD, non-minified, with comment header)
dist/jszip.min.js     97,630 bytes  (UMD, minified)  <-- use this one
```

`package.json` entry fields (from the tarball):

```json
{ "main": "./lib/index", "browser": { "./lib/index": "./dist/jszip.min.js" } }
```

- No `module`/ESM field — JSZip ships UMD + CommonJS only. The browser entry resolves to `dist/jszip.min.js`.
- UMD wrapper (verbatim, from `dist/jszip.js`): `(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}... g.JSZip=f()}})` — i.e. in a plain `<script>` tag it attaches **`window.JSZip`** (equivalently `globalThis.JSZip`). pako is bundled inside, so no extra script tag is needed.

**fflate 0.8.2** — `node_modules/fflate/`:

```
umd/index.js          32,665 bytes  (UMD, minified)  global: window.fflate
esm/browser.js                       (ESM build)
esm/index.mjs                        (ESM build, Node-targeted)
lib/index.cjs                        (CommonJS)
```

`package.json` entry fields: `{ "main": "./lib/index.cjs", "module": "./esm/browser.js", "unpkg": "./umd/index.js", "jsdelivr": "./umd/index.js" }`. UMD wrapper attaches **`window.fflate`** (lowercase): `!function(f){... (typeof self!='undefined'?self:this).fflate=f()}(...)`.

## Integration approach

Mirror the existing `jsQR` pattern (see `index.html:20` and `scan.js:93`'s `globalThis.jsQR`). Add this one line to `index.html` next to the existing jsQR script tag:

```html
<script src="node_modules/jszip/dist/jszip.min.js"></script>
```

Then reference the library in code as `globalThis.JSZip` (or `window.JSZip`), exactly like `scan.js` reads `globalThis.jsQR`. Add `"jszip": "^3.10.1"` to `dependencies` in `package.json` so `npm install` fetches it; no bundler, no importmap entry, no build step is required.

Why the `<script>` + global approach (and not the fetched-Blob-URL pattern from `scan.js:_getWorkerUrl()`): the Blob-URL technique exists only because `scan.worker.js` must run inside a `Worker` and needs `jsQR`'s source concatenated into the worker script — a Web-Worker-specific constraint. JSZip runs on the main thread (and is too large to want to copy into a worker), so a direct `<script>` tag + global is simpler, cacheable, and consistent with how `jsQR` is already loaded for the main-thread scan path.

## Usage snippet

Build a ZIP containing N CSV strings (`{ filename: csvContent }`), produce a `Blob`, and trigger a single browser download. Uses the recommended `<script>` + `globalThis.JSZip` integration.

```js
/**
 * Bundle { filename: csvString } entries into one ZIP and download it.
 * @param {Record<string, string>} csvFiles  e.g. { "page-1.csv": "page,code\n1,..." }
 * @param {string} zipName                     download filename, default "qr-results.zip"
 */
async function downloadCsvZip(csvFiles, zipName = 'qr-results.zip') {
  const JSZip = globalThis.JSZip;
  if (!JSZip) throw new Error('JSZip global not loaded — missing <script> tag');

  const zip = new JSZip();
  for (const [name, csv] of Object.entries(csvFiles)) {
    zip.file(name, csv); // strings are stored as UTF-8
  }

  // generateAsync is non-blocking (internal promise chain); type:'blob' -> Promise<Blob>
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',           // Blob type for the download
    compression: 'DEFLATE',                 // 'STORE' = no compression
    compressionOptions: { level: 6 },       // 1=fast .. 9=best; CSV compresses well
  });

  // Trigger a single download (application/zip)
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Example: one CSV per scanned PDF file
// downloadCsvZip({ 'result-fileA.csv': csvA, 'result-fileB.csv': csvB });
```

MIME type for the download: `application/zip` (set both as JSZip's `mimeType` option and implicitly on the `Blob`). The anchor-element `download` attribute + `URL.createObjectURL` is the standard no-library download pattern (MDN, see Sources).

## Memory / large-batch notes

- JSZip assembles the whole archive in memory: a small JS object per file plus one final output `Uint8Array`/`Blob`. `generateAsync({type:'blob'})` is **non-blocking** (it chunks work through an internal promise/setImmediate chain) so the UI does not freeze while building, but the completed archive is fully held in memory before download.
- JSZip also offers `generateInternalStream()` for streaming very large archives incrementally, but it is markedly more complex and **overkill here**: the ZIP holds only CSVs, never the PDFs themselves. CSV payloads are small (kilobytes to low megabytes even for hundreds of pages), so peak memory is trivial and `generateAsync` is the right call.
- For big PDF batches: the memory-heavy objects are the rendered PDF page canvases and the pdfjs document, not the ZIP. The ZIP's contribution is negligible by comparison. If CSVs are tiny and you want maximum speed, set `compression: 'STORE'` (level 0 / no compression) to skip DEFLATE entirely; otherwise `level: 6` (default) is fine since CSV compresses well.
- fflate alternative note: `fflate.zipSync` is synchronous and would block the main thread (fine for these small CSVs), while its async `fflate.zip(files, opts, cb)` offloads to Web Workers for true non-blocking, multi-threaded compression — useful only if archive size ever grows substantially.

## Sources

- JSZip — npm: https://www.npmjs.com/package/jszip
- JSZip — official docs / homepage: https://stuk.github.io/jszip/
- JSZip — repo (API, `generateAsync`, dist layout): https://github.com/Stuk/jszip
- JSZip — bundle size: https://bundlephobia.com/package/jszip
- fflate — npm: https://www.npmjs.com/package/fflate
- fflate — repo / docs: https://github.com/101arrowz/fflate
- fflate — demo: https://101arrowz.github.io/fflate
- MDN — `URL.createObjectURL` (Blob download pattern): https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL
- MDN — `<a download>`: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a#attr-download
- MDN — Blob: https://developer.mozilla.org/en-US/docs/Web/API/Blob
- In-repo references: `index.html` (jsQR `<script>` tag + `importmap`), `scan.js` (`globalThis.jsQR` usage and `_getWorkerUrl()` Blob-URL pattern), `package.json` (current deps, no bundler).
