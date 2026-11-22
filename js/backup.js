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

    downloadTextFile(
        `finmanager-backup-${toLocalDateString()}.json`,
        JSON.stringify(backup, null, 2),
        'application/json;charset=utf-8',
    );
}

// A backup file can come from anywhere. Its URL decides where every transaction on this device is
// uploaded, so it is only taken if it is a Google Apps Script Web App and the user agrees to it.
const BACKUP_SCRIPT_URL =
    /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/?#]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/;

function backupScriptUrl(url) {
    const value = String(url || '').trim();

    if (!value) return '';

    if (!BACKUP_SCRIPT_URL.test(value)) {
        alert(
            'URL đồng bộ trong file sao lưu không phải URL Google Apps Script nên bị bỏ qua. Dữ liệu chỉ được khôi phục trên máy này.',
        );
        return '';
    }

    return confirm(
        `File sao lưu chứa URL đồng bộ:\n${value}\n\nDùng URL này thì toàn bộ dữ liệu trên máy sẽ được gửi lên đó. Chỉ đồng ý nếu đây là Apps Script của bạn. Dùng URL này?`,
    )
        ? value
        : '';
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
        'Khôi phục bản sao lưu sẽ thay thế giao dịch, danh mục, nguồn tiền, số dư ban đầu, lương và các dữ liệu khác trên máy này. Máy này giữ nguyên URL Google Apps Script đang dùng (chỉ máy chưa có URL mới lấy URL trong file), và dữ liệu trên Google Sheet đó cũng sẽ được thay bằng bản sao lưu. Bạn có muốn tiếp tục?',
    );

    if (!confirmed) return;

    // Which Sheet this device talks to is its own setup, not data: a file made on another device, or
    // before the Web App was redeployed, must not point it back at an older deployment. Only a
    // device without a URL takes the one in the file.
    const targetUrl = webAppUrl || backupScriptUrl(backup.data.scriptUrl);
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
            urlInput.value = targetUrl;
        }

        updateCategoriesDropdown();
        populateSourceOptions();
        renderAll();

        // With a Sheet configured, the restored list becomes the Sheet's content as well. The flag
        // is only set here; setScriptUrl() reads the new Sheet first and then uploads the list.
        if (targetUrl) {
            setSyncDirty('replace');
        }

        // The replace above is meant for exactly this URL: do not set it aside as a URL change.
        setScriptUrl(targetUrl, { keepPending: true });

        alert(
            'Đã khôi phục dữ liệu từ bản sao lưu.' +
                (skippedCount ? ` Bỏ qua ${skippedCount} dòng giao dịch không hợp lệ.` : '') +
                (targetUrl ? ' Đang đồng bộ lên Google Sheets.' : ''),
        );
    } catch (error) {
        console.error('Không thể khôi phục bản sao lưu:', error);
        alert('Không thể lưu dữ liệu khôi phục vào trình duyệt. Hãy kiểm tra dung lượng lưu trữ.');
    }
}
