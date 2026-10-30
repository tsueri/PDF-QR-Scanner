# PDF QR Scanner

A static, entirely client-side web app that reads barcodes from whatever people bring it — documents, images, pastes, whole folders, or a live camera — and shows and exports what it finds. Nothing leaves the browser.

## Language

### Sources and items

**Source**:
A single thing the scanner reads codes from: a PDF document, an image file, a pasted image, or a live camera session. A container is not a source.
_Avoid_: Input, file, scan target

**Container**:
A bundle that expands into sources when it is brought in, such as an archive or a dropped folder. A container never yields results itself.
_Avoid_: Bundle

**Origin**:
Where a source came from: its file path, its path inside an archive, the clipboard, or the camera. Origin is a source's identity — names may repeat, origins do not.
_Avoid_: Path, filename

**Name**:
The human-readable label for a source. Two sources may share a name; only origin tells them apart.
_Avoid_: Filename, title

**Camera session**:
A source read live from the device camera. Its items are frames and its origin is the camera.
_Avoid_: Live scan, camera input

**Item**:
The single picture handed to the decoder: a page of a document, a whole image, or one camera frame. An item is the place a sighting is located.
_Avoid_: Frame, page, image (as a general term)

**Locator**:
The 1-based position of an item within its source, shown to people as a page number or a frame number depending on the source.
_Avoid_: Index, offset

### Codes and results

**Code**:
What the decoder read: a symbology together with a payload. A code is a value, not a thing with its own identity.
_Avoid_: Barcode, QR, data, text

**Symbology**:
The barcode format a code uses — QR Code, DataMatrix, EAN-13 and so on.
_Avoid_: Format, type

**Payload**:
The content a code carries. Its text is what people see and export; binary content is also kept as raw bytes with its content type.
_Avoid_: Data, value, message

**Sighting**:
A code together with where it was found: its source, its item's locator, and its position inside that item.
_Avoid_: Detection, hit, match, occurrence

**Position**:
Where inside an item a code was found, as the corners of the code. A sighting may carry no position.
_Avoid_: Coordinates, bounding box

**Result**:
A sighting that survived deduplication — the unit the app shows and exports. For file sources, deduplication is within one item and keyed on symbology plus payload. For a camera session it spans the session's frames: a consecutive run of frames showing the same code is one sighting — the run collapses, not accumulates. The same payload found in two different sources always yields two results.

**Re-sighting**:
A detection of a code that already has a result in the same camera session, after the code left the view. A re-sighting increments the result's count rather than creating a new result.
_Avoid_: Duplicate, repeat
_Avoid_: Detection, entry, row

**Reading order**:
The order results are listed within an item: top to bottom, then left to right.

### Failures

**Source failure**:
A source that could not be read at all and therefore yields no results: it could not be brought in, could not be decoded, was rejected for its size, or was refused by the camera. A source failure carries a kind and a message.
_Avoid_: Load error, scan error (the old per-PDF category names)

**Item failure**:
An item that could not be decoded while other items of the same source scanned. The source carries item failures, each with its locator; the source itself is not failed.
_Avoid_: Page error, partial failure

**Failure kind**:
The category of a failure, naming what went wrong and what can be done about it. Every failure has exactly one kind, and one set of kinds covers every source, container, paste, and camera failure.
_Avoid_: Error code, error message (the message is the human text, not the kind)

**Empty**:
A source whose read completed but found no codes. Empty is not a failure, and no completed read guarantees that nothing was missed — a damaged file can decode as if it were empty.
_Avoid_: No codes (as a failure), not found

### Choosing symbologies

**Symbology selection**:
The app-wide setting that says which symbologies the decoder looks for. One selection governs every source, with no per-source or per-file override. A scan of files uses the selection it was started with; a camera session follows the selection while it runs. The selection persists between visits.
_Avoid_: Format filter, format picker, barcode settings

**Preset**:
A named shorthand for a symbology selection: QR codes (the default), 1D barcodes, 2D barcodes, Everything. The QR codes preset reads the whole QR family — Micro QR and rMQR included — not only the common square QR.
_Avoid_: Mode, profile
