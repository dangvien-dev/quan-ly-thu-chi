// Minimal static file server for local development and the e2e tests (no dependencies).
// Usage: node tests/serve.js   (PORT env var overrides the default 4173)

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 4173;
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
    const file = path.join(ROOT, relative);

    // Never serve anything outside the project folder, nor dependencies and git data.
    if (
        !file.startsWith(ROOT + path.sep) ||
        /(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(relative)
    ) {
        response.writeHead(403).end('Forbidden');
        return;
    }

    fs.readFile(file, (error, content) => {
        if (error) {
            response.writeHead(404).end('Not found');
            return;
        }

        response.writeHead(200, {
            'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        response.end(content);
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`FinManager: http://127.0.0.1:${PORT}/`);
});
