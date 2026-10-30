// Service worker: caches the app shell so FinManager opens offline.
//
// Same-origin GET requests are served stale-while-revalidate: the cached copy is returned at once
// and refreshed in the background, so a new deployment shows up on the second load.
// Requests to other origins (the Google Apps Script Web App) always go straight to the network.
//
// Every local file referenced by index.html must be listed in APP_SHELL (tests check this).
// CACHE_VERSION, js/version.js and version.json are stamped by `npm run stamp` (a hash of the files
// below): every release is a new service worker with its own cache, which drops the old one.
// version.json is never cached, so the app can ask what the newest deployed version is.

const CACHE_VERSION = 'fm-6c4fa79';
const APP_SHELL = [
    './',
    'index.html',
    'manifest.json',
    'css/style.css',
    'vendor/chart.umd.js',
    'vendor/fontawesome/css/all.min.css',
    'vendor/fontawesome/webfonts/fa-solid-900.woff2',
    'assets/icons/icon.svg',
    'assets/icons/icon-192.png',
    'assets/icons/icon-512.png',
    'assets/icons/apple-touch-icon.png',
    'js/version.js',
    'js/utils.js',
    'js/data.js',
    'js/ui.js',
    'js/categories.js',
    'js/budgets.js',
    'js/salary.js',
    'js/recurring.js',
    'js/debts.js',
    'js/transactions.js',
    'js/sources.js',
    'js/savings.js',
    'js/charts.js',
    'js/sync.js',
    'js/backup.js',
    'js/app.js',
    'js/pwa.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE_VERSION)
            // `reload` skips the browser's HTTP cache, so a release is cached from the server.
            .then((cache) =>
                cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))),
            )
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key.startsWith('fm-') && key !== CACHE_VERSION)
                        .map((key) => caches.delete(key)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

async function staleWhileRevalidate(event) {
    const request = event.request;
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(request);

    const refresh = fetch(request)
        .then((response) => {
            if (response && response.ok) {
                cache.put(request, response.clone());
            }

            return response;
        })
        .catch(() => null);

    if (cached) {
        event.waitUntil(refresh);
        return cached;
    }

    const response = await refresh;

    if (response) return response;

    return request.mode === 'navigate'
        ? (await cache.match('index.html')) || Response.error()
        : Response.error();
}

self.addEventListener('fetch', (event) => {
    const request = event.request;

    if (request.method !== 'GET') return;
    if (new URL(request.url).origin !== self.location.origin) return;
    if (new URL(request.url).pathname.endsWith('/version.json')) return;

    event.respondWith(staleWhileRevalidate(event));
});
