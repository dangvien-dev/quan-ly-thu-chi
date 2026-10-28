// Registers the service worker so the app opens offline (needs https or localhost).

function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;

    navigator.serviceWorker.register('sw.js').catch((error) => {
        console.warn('Không đăng ký được service worker:', error);
    });
}

window.addEventListener('load', registerServiceWorker);
