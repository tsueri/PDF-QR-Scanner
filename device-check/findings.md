# Device check findings — ticket #33

Generated 2026-10-29T23:20:32.415Z from device-check/results/*.json.
Devices run: iphone-safari.

## iphone-safari

**Device:** Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1  
Platform: iPhone · touch points: 5 · cores: 4  
Screen: 402×874 @ 3x · timezone: Europe/Zurich · sent: 2026-10-29T23:17:47.940Z

### Bundled decode tests

| fixture | <img> | createImageBitmap (main) | createImageBitmap (worker) | full OffscreenCanvas read |
|---|---|---|---|---|
| 12 MP HEIC (4032×3024) | 4032×3024 (—) | 4032×3024 (82 ms) | 4032×3024 (87 ms) | — not run |
| 12 MP JPEG (4000×3000) | 4032×3024 (—) | 4032×3024 (47 ms) | 4032×3024 (50 ms) | — not run |
| 48 MP JPEG (8000×6000) | 8000×6000 (—) | 8000×6000 (170 ms) | 8000×6000 (145 ms) | ✓ 48,000,000 px (145 ms) |

### File picker (original HEIC or converted JPEG?)

| input | file.name | sniff | bytes | <img> | bitmap |
|---|---|---|---|---|---|
| accept="image/*" | IMG_0645.jpeg | JPEG | 6671680 | 5712×4284 | 5712×4284 |
| accept=".heic,image/heic" | IMG_0645.jpeg | JPEG | 6671680 | 5712×4284 | 5712×4284 |

### Special HEIC variants

| file.name | sniff | bytes | kind | <img> | bitmap |
|---|---|---|---|---|---|
| IMG_0645.jpeg | JPEG | 6671680 | (unlabelled) | 5712×4284 | 5712×4284 |

### Camera capture path (`<input capture="environment">`)

| file.name | sniff | bytes | <img> | bitmap |
|---|---|---|---|---|
| image.jpg | JPEG | 1781010 | 3024×4032 | 3024×4032 |

Camera format setting: high-efficiency

### Canvas area limit probe

**Main-thread canvas:**

| size | backing store | result |
|---|---|---|
| 4096×8192 | 128 MB | ✓ corner 255,0,0 · centre 255,0,0 |
| 8192×4096 | 128 MB | ✓ corner 255,0,0 · centre 255,0,0 |
| 2048×2048 | 16 MB | ✓ corner 255,0,0 · centre 255,0,0 |
| 4096×4096 | 64 MB | ✓ corner 255,0,0 · centre 255,0,0 |
| 6000×6000 | 137 MB | ✓ corner 255,0,0 · centre 255,0,0 |
| 8192×8192 | 256 MB | ✓ corner 255,0,0 · centre 255,0,0 |
| 10000×10000 | 381 MB | **BLANK** |
| 12000×12000 | 549 MB | **BLANK** |
| 16384×16384 | 1024 MB | **BLANK** |

**OffscreenCanvas in worker:**

| size | backing store | result |
|---|---|---|
| 4096×8192 | — | ✓ corner 255,0,0 · centre 255,0,0 |
| 8192×4096 | — | ✓ corner 255,0,0 · centre 255,0,0 |
| 2048×2048 | — | ✓ corner 255,0,0 · centre 255,0,0 |
| 4096×4096 | — | ✓ corner 255,0,0 · centre 255,0,0 |
| 6000×6000 | — | ✓ corner 255,0,0 · centre 255,0,0 |
| 8192×8192 | — | ✓ corner 255,0,0 · centre 255,0,0 |
| 10000×10000 | — | **BLANK** |
| 12000×12000 | — | **BLANK** |
| 16384×16384 | — | **BLANK** |

### Camera prototype notes

- **decodeFeel:** smooth
- **lens:** unknown
- **zoom:** yes
- **homescreen:** yes

