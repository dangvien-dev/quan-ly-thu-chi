// Application startup and the existing reset-data action.

function initializeApp() {
    const urlInput = document.getElementById('setting-script-url');

    if (urlInput && webAppUrl) {
        urlInput.value = webAppUrl;
    }

    const txDateEl = document.getElementById('txDate');

    if (txDateEl) {
        txDateEl.value = new Date().toISOString().split('T')[0];
    }

    updateCategoriesDropdown();
    renderAll();
    syncFromGoogleSheet();
    renderQuickChips();
}

function resetAllData() {
    if (!confirm('Xóa toàn bộ dữ liệu?')) return;

    transactions = [];
    saveDataLocally();
    renderAll();
    syncToGoogleSheet();
}

window.addEventListener('load', initializeApp);
