// Google Apps Script URL configuration and Google Sheets synchronization.

function saveScriptUrl() {
    const urlInput = document.getElementById('setting-script-url');

    if (!urlInput) return;

    webAppUrl = urlInput.value;
    localStorage.setItem('fm_script_url', webAppUrl);
    alert('Đã lưu URL thành công!');
    syncToGoogleSheet();
}

function syncToGoogleSheet() {
    if (!webAppUrl) return;

    // Do not overwrite remote data with an empty local list unintentionally.
    if (!transactions || transactions.length === 0) {
        console.log('Dữ liệu đang trống, bỏ qua đồng bộ lên để tránh xóa nhầm.');
        return;
    }

    const badge = document.getElementById('sync-status');

    if (badge) {
        badge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang đồng bộ...';
    }

    fetch(webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', data: transactions }),
    })
        .then((response) => {
            if (!response.ok) {
                throw new Error('Server Error');
            }

            return response.json();
        })
        .then(() => {
            if (badge) {
                badge.innerHTML =
                    '<i class="fa-solid fa-cloud-arrow-up"></i> Đã lưu Google Drive';
            }
        })
        .catch(() => {
            if (badge) {
                badge.innerHTML =
                    '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i> Lỗi kết nối';
            }
        });
}

function syncFromGoogleSheet() {
    if (!webAppUrl) return;

    const badge = document.getElementById('sync-status');

    if (badge) {
        badge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tải...';
    }

    fetch(webAppUrl)
        .then((response) => response.json())
        .then((data) => {
            if (Array.isArray(data) && data.length > 0) {
                transactions = data;
                saveDataLocally();
                renderAll();
            }

            if (badge) {
                badge.innerHTML =
                    '<i class="fa-solid fa-cloud-arrow-up"></i> Đã lưu Google Drive';
            }
        })
        .catch(() => {
            if (badge) {
                badge.innerHTML =
                    '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i> Dùng bản offline';
            }
        });
}
