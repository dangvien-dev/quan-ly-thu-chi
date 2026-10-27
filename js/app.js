// --- KHỞI TẠO KHI TẢI TRANG ---
window.onload = function() {
    const urlInput = document.getElementById('setting-script-url');
    if(urlInput && webAppUrl) urlInput.value = webAppUrl;

    const txDateEl = document.getElementById('txDate');
    if(txDateEl) txDateEl.value = new Date().toISOString().split('T')[0];

    updateCategoriesDropdown();
    renderAll();
    syncFromGoogleSheet();
    renderQuickChips();
};   
