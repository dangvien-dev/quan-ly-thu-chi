// Registers the service worker so the app opens offline (needs https or localhost), and tells the
// user which version is running and when a newer one is available.

// True when this page was already controlled by a service worker as it loaded: a controller change
// after that means a newer version took over while this page still runs the old code.
const hadServiceWorker =
    'serviceWorker' in navigator && Boolean(navigator.serviceWorker.controller);
let updateRequested = false;

function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (updateRequested) {
            location.reload();
        } else if (hadServiceWorker) {
            showUpdateBanner();
        }
    });

    navigator.serviceWorker.register('sw.js').catch((error) => {
        console.warn('Không đăng ký được service worker:', error);
    });
}

function showUpdateBanner() {
    const banner = document.getElementById('update-banner');

    if (banner) banner.hidden = false;
}

function setUpdateStatus(message, { canApply = false } = {}) {
    document.getElementById('update-status').textContent = message;
    document.getElementById('apply-update-btn').hidden = !canApply;
}

function showAppVersion() {
    const sidebar = document.getElementById('sidebar-version');
    const settings = document.getElementById('app-version');

    if (sidebar) sidebar.textContent = `Phiên bản ${APP_VERSION}`;
    if (settings) settings.textContent = APP_VERSION;
}

/** Ask the server which version is deployed now (version.json is never served from a cache). */
async function checkForUpdate() {
    setUpdateStatus('Đang kiểm tra...');

    try {
        const response = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const latest = await response.json();

        if (!latest || typeof latest.version !== 'string')
            throw new Error('version.json sai định dạng');

        if (latest.version === APP_VERSION) {
            setUpdateStatus('Bạn đang dùng phiên bản mới nhất.');
        } else {
            setUpdateStatus(`Có phiên bản mới ${latest.version}. Bấm "Cập nhật ngay" để dùng.`, {
                canApply: true,
            });
        }
    } catch (error) {
        console.warn('Không kiểm tra được phiên bản mới:', error);
        setUpdateStatus('Không kiểm tra được phiên bản mới (cần kết nối mạng).');
    }
}

/** Let the service worker fetch the new files, then reload on its takeover (or after 3 seconds). */
async function applyUpdate() {
    updateRequested = true;
    setUpdateStatus('Đang cập nhật...');

    try {
        const registration =
            'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;

        if (registration) await registration.update();
    } catch (error) {
        console.warn('Không cập nhật được service worker:', error);
    }

    setTimeout(() => location.reload(), 3000);
}

showAppVersion();
window.addEventListener('load', registerServiceWorker);
