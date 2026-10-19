# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.1] - 2026-10-19

### Fixed

- Corrected stale documentation: `AGENTS.md` and `docs/agents/domain.md` no longer
  claim `CONTEXT.md` / `docs/adr/` exist, and the unrelated ADR examples were removed.
- README now describes the actual output — a ZIP containing one CSV per file — instead
  of claiming results are viewed in the browser.
- “Zero build step” is scoped to runtime; `llms.txt` now distinguishes development
  (`node_modules/`) from release (`vendor/`) asset paths.

### Added

- `CHANGELOG.md`.
- README documents batch scanning, the ZIP output and the self-hosted decoder.

## [1.3.0] - 2026-10-19

### Added

- Every QR code on every page is reported, not just the first one.
- Per-code records carry page number, payload and detection position; results are sorted
  top-to-bottom / left-to-right and exact duplicates within a page are removed.
- Synthetic A5 signature-card fixture with two codes per page, plus regression and
  integration coverage for multi-code pages, rotation and reading order.

### Changed

- Multi-QR decoding now uses `zxing-wasm` (reader build), pinned to QR codes only.
- CSV keeps the `page,qr-code` header with one row per code and the page number repeated.
- The release vendors the wasm decoder and overrides `locateFile`; no third-party requests.

### Removed

- jsQR dependency.
- The 18-attempt rotation sweep and the 2× scale retry.
- The README “one QR code per page” limitation.

[1.3.1]: https://github.com/tsueri/PDF-QR-Scanner/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/tsueri/PDF-QR-Scanner/compare/v1.2.0...v1.3.0
