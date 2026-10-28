// Google Apps Script URL configuration and Google Sheets synchronization.
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

function setSyncBadge(state) {
    const badge = document.getElementById('sync-status');

    if (badge) {
        badge.innerHTML = SYNC_BADGES[state];
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

// --- SETTINGS ---
function setScriptUrl(url) {
    webAppUrl = url;
    localStorage.setItem('fm_script_url', url);
    remoteReady = false;

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
function parseSheetResponse(response) {
    if (!response.ok) {
        throw new Error('Server Error');
    }

    return response.json().then((result) => {
        if (result && result.error) {
            throw new Error(result.error);
        }

        return result;
    });
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
    const changeCountAtStart = localChangeCount;

    pushInFlight = true;
    setSyncBadge('syncing');

    return fetch(webAppUrl, {
        method: 'POST',
        // text/plain keeps this a "simple" CORS request: Apps Script cannot answer a preflight.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'save', data: transactions }),
    })
        .then(parseSheetResponse)
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
        .catch(() => {
            setSyncBadge('error');
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
    const remote = normalizeTransactions(rows);
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

    return fetch(requestedUrl)
        .then(parseSheetResponse)
        .then((rows) => {
            if (requestedUrl !== webAppUrl) return;

            if (!Array.isArray(rows)) {
                throw new Error('Unexpected response');
            }

            reconcileWithSheet(rows);
        })
        .catch(() => {
            setSyncBadge('offline');
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
