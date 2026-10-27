// Export and restore a complete FinManager local-data backup.

const BACKUP_FORMAT = 'finmanager-backup';
const BACKUP_VERSION = 1;
const BACKUP_STORAGE_KEYS = {
    transactions: 'fm_transactions',
    categories: 'fm_categories',
    initialBalances: 'fm_initial_balances',
    scriptUrl: 'fm_script_url',
};

function exportBackup() {
    const backup = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
            transactions: JSON.parse(
                localStorage.getItem(BACKUP_STORAGE_KEYS.transactions) || '[]',
            ),
            categories: JSON.parse(
                localStorage.getItem(BACKUP_STORAGE_KEYS.categories) || JSON.stringify(categories),
            ),
            initialBalances: JSON.parse(
                localStorage.getItem(BACKUP_STORAGE_KEYS.initialBalances) || '{}',
            ),
            scriptUrl: localStorage.getItem(BACKUP_STORAGE_KEYS.scriptUrl) || '',
        },
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json;charset=utf-8',
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = downloadUrl;
    link.download = `finmanager-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
}

async function importBackup(file) {
    if (!file) {
        alert('Vui lòng chọn file sao lưu JSON.');
        return;
    }

    let backup;

    try {
        backup = JSON.parse(await file.text());
    } catch {
        alert('Không thể đọc file: nội dung không phải JSON hợp lệ.');
        return;
    }

    if (
        !backup ||
        backup.format !== BACKUP_FORMAT ||
        backup.version !== BACKUP_VERSION ||
        !backup.data ||
        !Array.isArray(backup.data.transactions) ||
        !Array.isArray(backup.data.categories) ||
        !backup.data.initialBalances ||
        typeof backup.data.initialBalances !== 'object' ||
        Array.isArray(backup.data.initialBalances) ||
        typeof backup.data.scriptUrl !== 'string'
    ) {
        alert('File sao lưu không đúng định dạng FinManager hoặc thiếu dữ liệu bắt buộc.');
        return;
    }

    const confirmed = confirm(
        'Khôi phục bản sao lưu sẽ thay thế giao dịch, danh mục, số dư ban đầu và URL Google Apps Script hiện tại. Bạn có muốn tiếp tục?',
    );

    if (!confirmed) return;

    try {
        localStorage.setItem(
            BACKUP_STORAGE_KEYS.transactions,
            JSON.stringify(backup.data.transactions),
        );
        localStorage.setItem(
            BACKUP_STORAGE_KEYS.categories,
            JSON.stringify(backup.data.categories),
        );
        localStorage.setItem(
            BACKUP_STORAGE_KEYS.initialBalances,
            JSON.stringify(backup.data.initialBalances),
        );
        localStorage.setItem(BACKUP_STORAGE_KEYS.scriptUrl, backup.data.scriptUrl);

        transactions = backup.data.transactions;
        categories = backup.data.categories;
        webAppUrl = backup.data.scriptUrl;

        const urlInput = document.getElementById('setting-script-url');

        if (urlInput) {
            urlInput.value = webAppUrl;
        }

        updateCategoriesDropdown();
        renderAll();

        alert('Đã khôi phục dữ liệu từ bản sao lưu. Google Sheets chưa được đồng bộ tự động.');
    } catch (error) {
        console.error('Không thể khôi phục bản sao lưu:', error);
        alert('Không thể lưu dữ liệu khôi phục vào trình duyệt. Hãy kiểm tra dung lượng lưu trữ.');
    }
}
