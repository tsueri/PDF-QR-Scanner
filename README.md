# PDF QR Scanner

Welcome to **PDF QR Scanner**, an open-source project designed to scan PDF files for QR codes and present any found as a CSV file. The app runs entirely client-side — no data is ever sent to a server. Try it [here](https://qrscan.campa.tools/).

## Overview

The main purpose of this project is to provide users with a straightforward tool to extract QR code information from PDF documents with multiple pages. Whether you're managing inventory, tracking items, or simply organizing digital content, PDF QR Scanner offers an easy solution.

## Installation

Getting started with PDF QR Scanner is incredibly simple:

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/tsueri/PDF-QR-Scanner.git
   cd PDF-QR-Scanner
   npm install
   ```

2. **Serve the application**: The app uses ES modules and web workers, so it must be served over HTTP — opening `index.html` directly from disk won't work. Use any static file server:

   ```bash
   python3 -m http.server 8080
   ```

   Then open `http://localhost:8080` in your browser.

## Features

- **Client-side processing**: PDF rendering and QR decoding happen entirely in your browser. No data is uploaded anywhere.
- **Multi-page PDF support**: Scans every page of the document.
- **Multiple files per run**: Batch-scan several PDFs with per-file progress.
- **Every QR code on every page**: Finds all QR codes on a page, not just the first one.
- **CSV output**: One row per code, with the page number and decoded QR data. Results are downloaded as a ZIP containing one CSV per file.
- **Self-hosted decoder**: The WebAssembly decoder ships with the app — no third-party requests.
- **Zero build step at runtime**: Plain ES modules served directly — no bundler required to run the app.

## Usage

1. Open the application in your web browser.
2. Upload the PDF files you wish to scan for QR codes.
3. Wait for the scan to complete, then download the ZIP containing one CSV per file with results.

## Contributing

We welcome contributions! If you have any suggestions, bug reports, or feature requests, please feel free to open an issue on GitHub. For code contributions, submit a pull request.

## License

This project is licensed under the MIT License. See the [LICENSE](https://github.com/tsueri/PDF-QR-Scanner/blob/main/LICENSE) file for more details.

## Support

For any questions or support, please create an issue in the [GitHub repository](https://github.com/tsueri/PDF-QR-Scanner/issues).

Thank you for using PDF QR Scanner! Your feedback and contributions are greatly appreciated. 🚀
