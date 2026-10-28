// Export and restore a complete FinManager local-data backup.

const BACKUP_FORMAT = 'finmanager-backup';
const BACKUP_VERSION = 1;

function exportBackup() {
    const backup = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
            transactions,
            ...Object.fromEntries(
                Object.keys(META_DEFS).map((key) => [key, META_ACCESSORS[key].get()]),
            ),
            scriptUrl: webAppUrl,
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
        'Khôi phục bản sao lưu sẽ thay thế giao dịch, danh mục, số dư ban đầu và URL Google Apps Script hiện tại. Nếu bản sao lưu có URL Google Sheets, dữ liệu trên Sheet cũng sẽ được thay bằng bản sao lưu. Bạn có muốn tiếp tục?',
    );

    if (!confirmed) return;

    const restoredTransactions = normalizeTransactions(backup.data.transactions);
    const skippedCount = backup.data.transactions.length - restoredTransactions.length;

    try {
        transactions = restoredTransactions;
        saveDataLocally();

        // Data kinds missing from an older backup keep their current value.
        Object.keys(META_DEFS).forEach((key) => {
            const value = META_DEFS[key].normalize(backup.data[key]);

            if (value !== null) {
                META_ACCESSORS[key].set(value);
                saveMeta(key);
            }
        });
        ensureSourcesForTransactions();

        const urlInput = document.getElementById('setting-script-url');

        if (urlInput) {
            urlInput.value = backup.data.scriptUrl;
        }

        updateCategoriesDropdown();
        populateSourceOptions();
        renderAll();

        // With a Sheet configured, the restored list becomes the Sheet's content as well. The flag
        // is only set here; setScriptUrl() reads the new Sheet first and then uploads the list.
        if (backup.data.scriptUrl) {
            setSyncDirty('replace');
        }

        setScriptUrl(backup.data.scriptUrl);

        alert(
            'Đã khôi phục dữ liệu từ bản sao lưu.' +
                (skippedCount ? ` Bỏ qua ${skippedCount} dòng giao dịch không hợp lệ.` : '') +
                (backup.data.scriptUrl ? ' Đang đồng bộ lên Google Sheets.' : ''),
        );
    } catch (error) {
        console.error('Không thể khôi phục bản sao lưu:', error);
        alert('Không thể lưu dữ liệu khôi phục vào trình duyệt. Hãy kiểm tra dung lượng lưu trữ.');
    }
}
