# pdf.js (vendored)

`pdf.min.js` and `pdf.worker.min.js` are the unmodified `build/` files of
[`pdfjs-dist@3.11.174`](https://www.npmjs.com/package/pdfjs-dist/v/3.11.174) (Apache-2.0, see `LICENSE`),
the last release that ships a classic (non-module) build, which this app needs because its scripts
are plain `<script>` files.

They are not listed in `index.html`: `js/import.js` loads them the first time a PDF bank statement
is chosen (`loadPdfJs`), so the app opens without them. The service worker caches them after that
first use, so reading a PDF works offline afterwards.

To update: `npm pack pdfjs-dist@<version>`, copy the two files and `LICENSE` from the package.
