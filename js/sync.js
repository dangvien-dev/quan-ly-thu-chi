// Google Apps Script URL configuration and Google Sheets synchronization.
//
// Protocols. The app never writes to a server before it has read from it and recognised it:
//  - legacy: the script the owner originally deployed (see tests/gas/fixtures/user-script.gs).
//    GET returns the list of transactions; a save is POST {"transactions": [...]}, or
//    GET ?action=save&data=... as a fallback. Its body format is strict: any other body makes the
//    script clear the whole sheet and then fail, so the shape must never change here.
//    The legacy sheet has 7 columns, so a transfer's destination travels inside the category.
//
// The whole transaction list is read from / written to the Sheet. To keep data safe:
//  - The Sheet is only overwritten after it has been read successfully in this session.
//  - Local changes the Sheet has not confirmed stay flagged (fm_sync_dirty) across reloads, so
//    they are merged into the Sheet's content on the next load instead of being discarded.
//  - Transactions deleted locally are remembered (fm_deleted_ids) so a merge does not bring them
//    back from the Sheet.

const SYNC_DIRTY_KEY = 'fm_sync_dirty'; // '' | 'merge' | 'replace'
const SYNC_BASELINE_KEY = 'fm_sync_baseline'; // URL whose content this device last synced with
const SYNC_DELETED_KEY = 'fm_deleted_ids';

let remoteReady = false;
let syncProtocol = ''; // set by the first successful read: 'legacy'
let pushInFlight = false;
let pushQueued = false;
let localChangeCount = 0;

const SYNC_BADGES = {
    idle: '<i class="fa-solid fa-hard-drive"></i> Chỉ lưu trên máy',
    loading: '<i class="fa-solid fa-spinner fa-spin"></i> Đang tải...',
    syncing: '<i class="fa-solid fa-spinner fa-spin"></i> Đang đồng bộ...',
    synced: '<i class="fa-solid fa-cloud-arrow-up"></i> Đã lưu Google Drive',
    offline:
        '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i> Dùng bản offline',
    error: '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i> Lỗi kết nối',
};

function setSyncBadge(state, detail = '') {
    const badge = document.getElementById('sync-status');

    if (badge) {
        badge.innerHTML = SYNC_BADGES[state];
        badge.title = detail;
    }
}

// --- LOCAL SYNC STATE ---
function getSyncDirty() {
    return readStoredText(SYNC_DIRTY_KEY);
}

function setSyncDirty(mode) {
    if (!mode) {
        localStorage.removeItem(SYNC_DIRTY_KEY);
    } else if (mode === 'replace' || getSyncDirty() !== 'replace') {
        localStorage.setItem(SYNC_DIRTY_KEY, mode);
    }
}

function readDeletedIds() {
    const ids = readStoredJson(SYNC_DELETED_KEY, []);

    return Array.isArray(ids) ? ids : [];
}

function rememberDeletedIds(ids) {
    const merged = Array.from(new Set([...readDeletedIds(), ...ids]));

    localStorage.setItem(SYNC_DELETED_KEY, JSON.stringify(merged));
}

function clearDeletedIds() {
    localStorage.removeItem(SYNC_DELETED_KEY);
}

// --- CHANGE QUEUE ---
// Call these after a local change, before syncToGoogleSheet(). The legacy protocol only needs the
// dirty flag and the deleted ids; meta values are not part of it.
function queueUpsert(ids) {
    if (ids && ids.length) setSyncDirty('merge');
}

function queueDelete(ids) {
    rememberDeletedIds(ids);
    setSyncDirty('merge');
}

function queueMeta() {}

// --- SETTINGS ---
function setScriptUrl(url) {
    webAppUrl = url;
    localStorage.setItem('fm_script_url', url);
    remoteReady = false;
    syncProtocol = '';

    return syncFromGoogleSheet();
}

function saveScriptUrl() {
    const urlInput = document.getElementById('setting-script-url');

    if (!urlInput) return;

    const url = urlInput.value.trim();

    if (url && !/^https:\/\//i.test(url)) {
        alert('URL Google Apps Script phải bắt đầu bằng https://');
        return;
    }

    urlInput.value = url;
    setScriptUrl(url);
    alert(
        url
            ? 'Đã lưu URL. Đang đồng bộ với Google Sheets...'
            : 'Đã tắt đồng bộ Google Sheets. Dữ liệu chỉ lưu trên máy này.',
    );
}

// --- SYNCHRONIZATION ---
function sheetUrl(params = {}) {
    const query = new URLSearchParams(params).toString();

    return query ? `${webAppUrl}${webAppUrl.includes('?') ? '&' : '?'}${query}` : webAppUrl;
}

/** The Apps Script answers HTTP 200 even for errors: look inside the JSON body. */
function parseSheetResponse(response) {
    if (!response.ok) {
        throw new Error('Server Error');
    }

    return response.json().then((result) => {
        if (result && (result.error || result.status === 'error')) {
            throw new Error(result.error || result.message || 'Server Error');
        }

        return result;
    });
}

// --- LEGACY PROTOCOL ---
const LEGACY_GET_SAVE_MAX_URL = 6000;

/** The legacy sheet has no targetSource column: carry it in the category ("... → Nguồn nhận"). */
function encodeLegacyRow(transaction) {
    return transaction.type === 'transfer' && transaction.targetSource
        ? { ...transaction, category: `${TRANSFER_CATEGORY} → ${transaction.targetSource}` }
        : transaction;
}

function decodeLegacyRow(row) {
    const match =
        row && row.type === 'transfer' && !row.targetSource
            ? String(row.category ?? '').match(/^Chuyển tiền nội bộ → (.+)$/)
            : null;

    return match ? { ...row, category: TRANSFER_CATEGORY, targetSource: match[1] } : row;
}

/**
 * Replace the legacy sheet's content. POST first (plain text, so no CORS preflight); only if the
 * request itself cannot be made, fall back to the GET form the script also understands.
 */
async function writeLegacySheet(list) {
    const rows = list.map(encodeLegacyRow);
    let response;

    try {
        response = await fetch(webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ transactions: rows }),
        });
    } catch (error) {
        const payload = JSON.stringify(rows);
        const url = sheetUrl({ action: 'save', data: payload });

        // The script decodes the parameter a second time, so "%" in the data would break it.
        if (url.length > LEGACY_GET_SAVE_MAX_URL || payload.includes('%')) {
            throw new Error(
                'Không gửi được dữ liệu (trình duyệt chặn POST và dữ liệu quá lớn để gửi dự phòng). Hãy cập nhật Apps Script theo hướng dẫn trong README.',
            );
        }

        response = await fetch(url);
    }

    return parseSheetResponse(response);
}

/** Union of two lists: everything in `primary`, plus items of `secondary` it does not have. */
function mergeTransactions(primary, secondary, excludedIds) {
    const knownIds = new Set(primary.map((transaction) => transaction.id));
    const extras = secondary.filter(
        (transaction) => !knownIds.has(transaction.id) && !excludedIds.has(transaction.id),
    );

    return [...primary, ...extras];
}

/**
 * Call after every local change to transactions. `replace` means the local list is the truth
 * (reset or restored backup); `merge` means local edits are combined with the Sheet's content.
 */
function syncToGoogleSheet(mode = 'merge') {
    localChangeCount++;
    setSyncDirty(mode);

    if (!webAppUrl || !remoteReady) return;

    if (pushInFlight) {
        pushQueued = true;
        return;
    }

    pushToGoogleSheet();
}

function pushToGoogleSheet() {
    // Never write before a read has told us which protocol the script speaks.
    if (!syncProtocol) return Promise.resolve();

    const changeCountAtStart = localChangeCount;

    pushInFlight = true;
    setSyncBadge('syncing');

    return writeLegacySheet(transactions)
        .then(() => {
            localStorage.setItem(SYNC_BASELINE_KEY, webAppUrl);

            if (changeCountAtStart === localChangeCount) {
                setSyncDirty('');
                clearDeletedIds();
                setSyncBadge('synced');
            } else {
                pushQueued = true;
            }
        })
        .catch((error) => {
            setSyncBadge('error', error.message);
        })
        .finally(() => {
            pushInFlight = false;

            if (pushQueued) {
                pushQueued = false;
                pushToGoogleSheet();
            }
        });
}

function reconcileWithSheet(rows) {
    const remote = normalizeTransactions(rows.map(decodeLegacyRow));
    const mode = getSyncDirty();
    const hasBaseline = localStorage.getItem(SYNC_BASELINE_KEY) === webAppUrl;
    const hasRowsWithoutId = rows.some((row) => row && row.type && !row.id);

    let merged;

    if (mode === 'replace') {
        merged = transactions;
    } else if (mode && hasBaseline) {
        // Unsynced local edits win; add what other devices created, minus what was deleted here.
        merged = mergeTransactions(transactions, remote, new Set(readDeletedIds()));
    } else if (remote.length === 0) {
        // An empty Sheet never wipes local data; the local list is uploaded instead.
        merged = transactions;
    } else if (hasBaseline) {
        merged = remote;
    } else {
        // First contact with this Sheet: keep anything entered locally next to the Sheet's data.
        merged = mergeTransactions(remote, transactions, new Set());
    }

    const remoteIds = new Set(remote.map((transaction) => transaction.id));
    const needsPush =
        Boolean(mode) ||
        hasRowsWithoutId ||
        merged.length !== remote.length ||
        merged.some((transaction) => !remoteIds.has(transaction.id));

    transactions = merged;
    saveDataLocally();
    renderAll();
    remoteReady = true;

    if (needsPush) {
        syncToGoogleSheet(mode === 'replace' ? 'replace' : 'merge');
    } else {
        localStorage.setItem(SYNC_BASELINE_KEY, webAppUrl);
        setSyncBadge('synced');
    }
}

function syncFromGoogleSheet() {
    if (!webAppUrl) {
        setSyncBadge('idle');
        return Promise.resolve();
    }

    const requestedUrl = webAppUrl;

    setSyncBadge('loading');

    return fetch(sheetUrl({ v: 2 }))
        .then(parseSheetResponse)
        .then((result) => {
            if (requestedUrl !== webAppUrl) return;

            if (!Array.isArray(result)) {
                throw new Error('Phản hồi từ Apps Script không đúng định dạng.');
            }

            syncProtocol = 'legacy';
            reconcileWithSheet(result);
        })
        .catch((error) => {
            setSyncBadge('offline', error.message);
        });
}

/** Retry after the connection comes back: read the Sheet first, or flush pending changes. */
function resumeSync() {
    if (!webAppUrl) return;

    if (!remoteReady) {
        syncFromGoogleSheet();
    } else if (getSyncDirty() && !pushInFlight) {
        pushToGoogleSheet();
    }
}
