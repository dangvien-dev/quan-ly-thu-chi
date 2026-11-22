// Google Apps Script URL configuration and Google Sheets synchronization.
//
// Two protocols are supported. The app never writes to a server before it has read from it and
// recognised its protocol (GET ?v=2: a JSON array means legacy, {version: 2} means v2):
//
//  - legacy: the script the owner originally deployed (see tests/gas/fixtures/user-script.gs).
//    GET returns the list of transactions; a save is POST {"transactions": [...]}, or
//    GET ?action=save&data=... as a fallback. Its body format is strict: any other body makes the
//    script clear the whole sheet and then fail, so the shape must never change here.
//    The legacy sheet has 7 columns, so a transfer's destination travels inside the category, and
//    only transactions are synchronized (the whole list is rewritten).
//
//  - v2: apps-script/Code.gs. Rows are sent one by one (upserts/deletes with updatedAt, the
//    newest wins) together with the "meta" values (categories, sources, budgets, salary, ...), and every
//    reply is the full server state, which is merged back. A token protects the URL; it only ever
//    travels in a POST body, never in a URL (URLs end up in logs and proxies). The first read is a
//    tokenless GET ?v=2: only Code.gs answers "unauthorized", which identifies it, and the state is
//    then read with an empty sync POST that carries the token. When the POST cannot be made the
//    GET ?action=sync fallback is only used without a token; with one the change stays queued.
//
// To keep data safe in both:
//  - The Sheet is only written after it has been read successfully in this session.
//  - Local changes the Sheet has not confirmed stay recorded across reloads (fm_sync_dirty and the
//    pending lists below) and are merged with, not replaced by, the Sheet's content.
//  - Transactions deleted locally are remembered (fm_deleted_ids) so a merge does not bring them
//    back from the Sheet.
//  - A v2 server that suddenly lacks many rows this device already synced (an emptied or damaged
//    Sheet, see isMassRemoteLoss) does not delete them here without asking (decideRemoteLoss):
//    only an explicit OK on the "Xóa" question deletes; closing a dialog keeps them.

const SYNC_DIRTY_KEY = 'fm_sync_dirty'; // '' | 'merge' | 'replace'
const SYNC_BASELINE_KEY = 'fm_sync_baseline'; // URL whose content this device last synced with
const SYNC_DELETED_KEY = 'fm_deleted_ids'; // ids deleted here, not yet deleted on the server
const SYNC_UPSERTS_KEY = 'fm_pending_upserts'; // ids created or edited here (v2)
const SYNC_META_KEY = 'fm_pending_meta'; // meta kinds changed here (v2)
const GET_FALLBACK_MAX_URL = 6000;
// Rows the user chose to "decide later" for (see decideRemoteLoss): kept here, not uploaded, and
// not asked about again until the app is opened again.
const deferredLossIds = new Set();
const TRANSFER_CATEGORY_PREFIX = `${TRANSFER_CATEGORY} → `;

let remoteReady = false;
let syncProtocol = ''; // set by the first successful read: 'legacy' | 'v2'
let pushInFlight = false;
// Another device may change the data while this one stays open, so the Sheet is read again when
// the user comes back, but never more often than this.
const REFRESH_MIN_INTERVAL_MS = 30000;
let lastPullAt = 0;
let pushQueued = false;
let localChangeCount = 0;
// True when the last tokenless read was answered with data: anyone who has the URL can read it.
let serverIsOpen = false;

const SYNC_BADGES = {
    idle: '<i class="fa-solid fa-hard-drive"></i> Chỉ lưu trên máy',
    loading: '<i class="fa-solid fa-spinner fa-spin"></i> Đang tải...',
    syncing: '<i class="fa-solid fa-spinner fa-spin"></i> Đang đồng bộ...',
    synced: '<i class="fa-solid fa-cloud-arrow-up"></i> Đã lưu Google Drive',
    offline:
        '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i> Dùng bản offline',
    error: '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i> Lỗi kết nối',
    locked: '<i class="fa-solid fa-lock" style="color:var(--danger)"></i> Sai mã bảo vệ',
};

function setSyncBadge(state, detail = '') {
    const badge = document.getElementById('sync-status');

    if (badge) {
        badge.innerHTML = SYNC_BADGES[state];
        badge.title = detail;
    }
}

/** The badge state for a failed request: a wrong token is not a connection problem. */
function failureBadge(error, fallback) {
    return error && error.message === 'unauthorized' ? 'locked' : fallback;
}

// What browsers say when a request got no usable answer (offline, blocked, or Google sent a login
// page, which has no CORS headers). A Web App deployed as "Only myself" ends up here too.
const NETWORK_ERROR = /failed to fetch|networkerror|load failed/i;

function failureDetail(error) {
    const message = (error && error.message) || '';

    if (message === 'unauthorized') {
        return 'Sai hoặc thiếu mã bảo vệ (token). Kiểm tra lại trong Cài đặt & Dữ liệu.';
    }

    return NETWORK_ERROR.test(message)
        ? `${message}. Kiểm tra mạng và URL Web App. Nếu vừa triển khai Apps Script: "Thực thi bằng" phải là Tôi và "Người có quyền truy cập" phải là Bất kỳ ai.`
        : message;
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

function readList(key) {
    const list = readStoredJson(key, []);

    return Array.isArray(list) ? list : [];
}

function writeList(key, list) {
    if (list.length) {
        localStorage.setItem(key, JSON.stringify(list));
    } else {
        localStorage.removeItem(key);
    }
}

function addToList(key, items) {
    writeList(key, Array.from(new Set([...readList(key), ...items])));
}

function readDeletedIds() {
    return readList(SYNC_DELETED_KEY);
}

function clearDeletedIds() {
    localStorage.removeItem(SYNC_DELETED_KEY);
}

/** Is there anything the server has not confirmed yet? Meta only counts for protocol v2. */
function hasPendingChanges() {
    return Boolean(getSyncDirty()) || (syncProtocol === 'v2' && readList(SYNC_META_KEY).length > 0);
}

// --- CHANGE QUEUE ---
// Call these after a local change, then syncToGoogleSheet(). The legacy protocol only needs the
// dirty flag and the deleted ids, because it rewrites the whole list.
function queueUpsert(ids) {
    if (!ids || !ids.length) return;

    addToList(SYNC_UPSERTS_KEY, ids);
    setSyncDirty('merge');
}

function queueDelete(ids) {
    const upserts = new Set(readList(SYNC_UPSERTS_KEY));

    ids.forEach((id) => upserts.delete(id));
    writeList(SYNC_UPSERTS_KEY, Array.from(upserts));
    addToList(SYNC_DELETED_KEY, ids);
    setSyncDirty('merge');
}

/** Meta values are only sent by protocol v2; the legacy script cannot store them. */
function queueMeta(key) {
    addToList(SYNC_META_KEY, [key]);
}

// --- SETTINGS ---
function setScriptUrl(url) {
    webAppUrl = url;
    localStorage.setItem('fm_script_url', url);
    remoteReady = false;
    syncProtocol = '';
    updateSyncNote();

    return syncFromGoogleSheet();
}

function saveScriptUrl() {
    const urlInput = document.getElementById('setting-script-url');
    const tokenInput = document.getElementById('setting-script-token');

    if (!urlInput) return;

    const url = urlInput.value.trim();

    if (url && !/^https:\/\//i.test(url)) {
        alert('URL Google Apps Script phải bắt đầu bằng https://');
        return;
    }

    urlInput.value = url;
    webAppToken = tokenInput ? tokenInput.value.trim() : '';
    localStorage.setItem('fm_script_token', webAppToken);
    setScriptUrl(url);
    alert(
        url
            ? 'Đã lưu cấu hình. Đang đồng bộ với Google Sheets...'
            : 'Đã tắt đồng bộ Google Sheets. Dữ liệu chỉ lưu trên máy này.',
    );
}

/** Explain which kind of Apps Script is connected (shown under the settings form). */
function updateSyncNote() {
    const note = document.getElementById('sync-protocol-note');

    if (!note) return;

    const notes = {
        legacy: 'Đang dùng Apps Script phiên bản cũ: chỉ đồng bộ giao dịch (7 cột). Danh mục, nguồn tiền, ngân sách, định kỳ và vay nợ chỉ lưu trên máy này. Dán apps-script/Code.gs mới vào Apps Script để đồng bộ tất cả và bật mã bảo vệ.',
        v2: 'Đã kết nối Apps Script v2: đồng bộ từng giao dịch cùng danh mục, nguồn tiền, ngân sách, định kỳ và vay nợ.',
    };

    const openWarning =
        syncProtocol === 'v2' && serverIsOpen
            ? ' Cảnh báo: Apps Script này chưa có mã bảo vệ, ai biết URL cũng đọc và ghi được dữ liệu. Thêm FM_TOKEN trong Script properties và nhập cùng giá trị vào ô Mã bảo vệ.'
            : '';

    note.textContent = webAppUrl
        ? (notes[syncProtocol] || '') + (notes[syncProtocol] ? openWarning : '')
        : '';
    note.hidden = !note.textContent;
}

// --- RESPONSES AND URLS ---
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
/** The legacy sheet has no targetSource column: carry it in the category ("... → Nguồn nhận"). */
function encodeLegacyRow(transaction) {
    return transaction.type === 'transfer' && transaction.targetSource
        ? { ...transaction, category: `${TRANSFER_CATEGORY_PREFIX}${transaction.targetSource}` }
        : transaction;
}

function decodeLegacyRow(row) {
    const category = row && row.type === 'transfer' && !row.targetSource ? row.category : '';

    return typeof category === 'string' && category.startsWith(TRANSFER_CATEGORY_PREFIX)
        ? {
              ...row,
              category: TRANSFER_CATEGORY,
              targetSource: category.slice(TRANSFER_CATEGORY_PREFIX.length),
          }
        : row;
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
        if (url.length > GET_FALLBACK_MAX_URL || payload.includes('%')) {
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
        if (!mode) setSyncDirty('merge');

        syncToGoogleSheet();
    } else {
        localStorage.setItem(SYNC_BASELINE_KEY, webAppUrl);
        setSyncBadge('synced');
    }
}

async function pushLegacy() {
    const changeCountAtStart = localChangeCount;

    await writeLegacySheet(transactions);
    localStorage.setItem(SYNC_BASELINE_KEY, webAppUrl);

    if (changeCountAtStart === localChangeCount) {
        setSyncDirty('');
        clearDeletedIds();
        writeList(SYNC_UPSERTS_KEY, []);
        setSyncBadge('synced');
    } else {
        pushQueued = true;
    }
}

// --- PROTOCOL V2 ---
/** Send a sync request; if the POST cannot be made at all, retry as a GET when it is small. */
async function postSyncV2(payload) {
    let response;

    try {
        response = await fetch(webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
        });
    } catch (error) {
        // The fallback puts the whole payload in the URL, and URLs end up in logs and proxies: never
        // with a token. The change stays queued and is sent again later.
        if (payload.token) throw error;

        const url = sheetUrl({ action: 'sync', payload: JSON.stringify(payload) });

        if (url.length > GET_FALLBACK_MAX_URL) {
            throw new Error(
                'Không gửi được dữ liệu: trình duyệt chặn POST tới Apps Script và lượng thay đổi quá lớn để gửi dự phòng.',
            );
        }

        response = await fetch(url);
    }

    const state = await parseSheetResponse(response);

    if (!state || state.version !== 2) {
        throw new Error('Phản hồi từ Apps Script không đúng định dạng.');
    }

    return state;
}

function buildV2Payload() {
    const replace = getSyncDirty() === 'replace';
    const pendingIds = new Set(readList(SYNC_UPSERTS_KEY));
    const upserts = replace
        ? transactions
        : transactions.filter((transaction) => pendingIds.has(transaction.id));
    const metaKeys = (replace ? Object.keys(META_DEFS) : readList(SYNC_META_KEY)).filter(
        (key) => META_DEFS[key],
    );
    const updated = readMetaUpdated();

    return {
        action: 'sync',
        token: webAppToken,
        replace,
        // Code.gs refuses a replace that empties the Sheet unless it is asked for explicitly.
        confirmWipe: replace && upserts.length === 0,
        upserts,
        deletes: replace ? [] : readDeletedIds(),
        meta: Object.fromEntries(
            metaKeys.map((key) => [
                key,
                { value: META_ACCESSORS[key].get(), updatedAt: updated[key] || '' },
            ]),
        ),
    };
}

/** After a successful request, forget what was sent unless it changed again in the meantime. */
function clearSentPending(payload) {
    const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));
    const sentUpserts = new Map(payload.upserts.map((item) => [item.id, item.updatedAt]));
    const upserts = readList(SYNC_UPSERTS_KEY).filter((id) => {
        const current = byId.get(id);

        if (!current) return false; // deleted since: nothing left to send
        if (!sentUpserts.has(id)) return true; // queued after the request was built

        return current.updatedAt !== sentUpserts.get(id); // edited again meanwhile
    });
    // After a replace the server holds exactly what was sent, so a deletion of one of those rows
    // still has to be sent; other recorded deletions concern rows the server no longer has.
    const deletes = readDeletedIds().filter((id) =>
        payload.replace ? sentUpserts.has(id) : !payload.deletes.includes(id),
    );
    const updated = readMetaUpdated();
    const meta = readList(SYNC_META_KEY).filter(
        (key) => !payload.meta[key] || (updated[key] || '') !== payload.meta[key].updatedAt,
    );

    writeList(SYNC_UPSERTS_KEY, upserts);
    writeList(SYNC_DELETED_KEY, deletes);
    writeList(SYNC_META_KEY, meta);

    // A replace has been applied; anything still pending is an ordinary change made meanwhile.
    setSyncDirty('');

    if (upserts.length || deletes.length) setSyncDirty('merge');
}

function unionBy(primary, secondary, keyOf) {
    const known = new Set(primary.map(keyOf));

    return [...primary, ...secondary.filter((item) => !known.has(keyOf(item)))];
}

/** First contact with a server that already has this kind of data: keep both sides' items. */
function mergeMetaFirstContact(key, local, remote) {
    const lower = (text) => String(text).toLocaleLowerCase('vi');

    if (key === 'categories') {
        return unionBy(remote, local, (item) => `${item.type}|${lower(item.name)}`);
    }

    if (key === 'sources') return unionBy(remote, local, (item) => lower(item.name));

    if (key === 'recurring' || key === 'debts') return unionBy(remote, local, (item) => item.id);

    return { ...local, ...remote };
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function reconcileMeta(remoteMeta, hasBaseline, replace) {
    const pending = new Set(readList(SYNC_META_KEY));
    const updated = readMetaUpdated();

    Object.keys(META_DEFS).forEach((key) => {
        const definition = META_DEFS[key];
        const local = META_ACCESSORS[key].get();
        const localStamp = updated[key] || '';
        const entry = remoteMeta[key];
        const remoteValue = entry ? definition.normalize(entry.value) : null;

        if (replace) {
            if (!localStamp) stampMeta(key);

            pending.add(key);
            return;
        }

        if (remoteValue === null) {
            // The server has nothing usable: offer ours if it was ever customised.
            if (pending.has(key) || localStamp || !sameValue(local, definition.fallback())) {
                if (!localStamp) stampMeta(key);

                pending.add(key);
            }

            return;
        }

        const remoteStamp = String(entry.updatedAt || '');

        if (!hasBaseline) {
            const merged = mergeMetaFirstContact(key, local, remoteValue);

            storeMetaValue(key, merged, remoteStamp);

            if (!sameValue(merged, remoteValue)) {
                stampMeta(key);
                pending.add(key);
            }

            return;
        }

        // A local edit that is not older than the server's stays and is sent.
        if (pending.has(key) && localStamp >= remoteStamp) return;

        pending.delete(key);

        if (remoteStamp !== localStamp || !sameValue(local, remoteValue)) {
            storeMetaValue(key, remoteValue, remoteStamp);
        }
    });

    writeList(SYNC_META_KEY, Array.from(pending));
}

/**
 * Rows this device had already synced that the server no longer has. When that looks like an
 * emptied or damaged Sheet (isMassRemoteLoss) the user decides, and only an explicit "OK" on the
 * question that says "Xóa" deletes anything here; closing or cancelling a dialog never does:
 *  - 'restore': keep the rows and queue them so the Sheet gets them back;
 *  - 'delete':  follow the Sheet and delete them here;
 *  - 'defer':   keep them here without uploading, and ask again next time the app opens;
 *  - 'none':    an ordinary deletion elsewhere, applied without asking.
 */
function decideRemoteLoss(lostIds, syncedCount, remoteCount) {
    if (!isMassRemoteLoss(lostIds.length, syncedCount, remoteCount)) return 'none';
    if (lostIds.every((id) => deferredLossIds.has(id))) return 'defer';

    const count = lostIds.length;
    const restore = confirm(
        `Google Sheet vừa thiếu ${count} giao dịch mà máy này vẫn còn` +
            (remoteCount === 0 ? ' (Sheet không còn giao dịch nào).' : '.') +
            '\n\nNếu bạn không chủ động xóa chúng ở máy khác, có thể Sheet đã bị xóa nhầm hoặc ghi lỗi.' +
            '\n\nOK: Khôi phục — giữ trên máy này và đưa lại lên Sheet (khuyên dùng).' +
            '\nHủy: chọn cách khác (xóa trên máy hoặc để sau).',
    );

    if (restore) return 'restore';

    const remove = confirm(
        `Xóa ${count} giao dịch này khỏi máy này cho giống Google Sheet?` +
            '\n\nKhông hoàn tác được, trừ khi bạn có file sao lưu.' +
            '\n\nOK: Xóa trên máy này.' +
            '\nHủy: Để sau — giữ trên máy, chưa gửi lên Sheet, hỏi lại khi mở app lần sau.',
    );

    if (remove) return 'delete';

    lostIds.forEach((id) => deferredLossIds.add(id));

    return 'defer';
}

/**
 * Merge the server state into local data, keeping local changes the server has not confirmed:
 *  - rows pending here win when they are not older than the server's copy;
 *  - everything else follows the server, so deletions made elsewhere arrive here.
 */
function reconcileV2(state) {
    const rawRows = state.transactions || [];
    const remote = normalizeTransactions(rawRows.map(decodeLegacyRow));
    // Rows written by the legacy client carry a transfer's destination in the category; they are
    // read correctly, and queued so the server gets them back in the clean v2 form.
    const migratedIds = new Set(
        rawRows.filter((row) => decodeLegacyRow(row) !== row).map((row) => String(row.id)),
    );
    const hasBaseline = localStorage.getItem(SYNC_BASELINE_KEY) === webAppUrl;
    const replace = getSyncDirty() === 'replace';

    if (!hasBaseline && !replace) {
        // First contact: everything held locally counts as not yet on the server.
        addToList(
            SYNC_UPSERTS_KEY,
            transactions.map((transaction) => transaction.id),
        );
    }

    const localById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
    // An id whose transaction no longer exists here has nothing left to send.
    const pendingUpserts = new Set(readList(SYNC_UPSERTS_KEY).filter((id) => localById.has(id)));

    if (!replace) migratedIds.forEach((id) => pendingUpserts.add(id));
    const deleted = new Set(readDeletedIds());

    // Rows kept here for now without being uploaded ("Để sau").
    const keptIds = new Set();

    if (!replace && hasBaseline) {
        const remoteIdSet = new Set(remote.map((row) => row.id));
        const synced = transactions.filter(
            (transaction) => !pendingUpserts.has(transaction.id) && !deleted.has(transaction.id),
        );
        const lostIds = synced
            .filter((transaction) => !remoteIdSet.has(transaction.id))
            .map((transaction) => transaction.id);

        const decision = decideRemoteLoss(lostIds, synced.length, remote.length);

        if (decision === 'restore') {
            lostIds.forEach((id) => pendingUpserts.add(id));
            addToList(SYNC_UPSERTS_KEY, lostIds);
        } else if (decision === 'defer') {
            lostIds.forEach((id) => keptIds.add(id));
        }
    }

    if (!replace) {
        const merged = [];
        const remoteIds = new Set();

        remote.forEach((row) => {
            remoteIds.add(row.id);

            if (deleted.has(row.id)) return;

            const local = localById.get(row.id);

            if (local && pendingUpserts.has(row.id) && local.updatedAt >= row.updatedAt) {
                merged.push(local);
            } else {
                if (!migratedIds.has(row.id)) pendingUpserts.delete(row.id);

                merged.push(row);
            }
        });

        transactions.forEach((transaction) => {
            const keep = pendingUpserts.has(transaction.id) || keptIds.has(transaction.id);

            if (keep && !remoteIds.has(transaction.id)) {
                merged.push(transaction);
            }
        });

        transactions = merged;
        // Rows adopted from the server are no longer pending; the others still are.
        writeList(SYNC_UPSERTS_KEY, Array.from(pendingUpserts));

        if (pendingUpserts.size || deleted.size) setSyncDirty('merge');
    }

    saveDataLocally();
    reconcileMeta(state.meta || {}, hasBaseline, replace);

    ensureSourcesForTransactions();
    updateCategoriesDropdown();
    populateSourceOptions();
    renderAll();
    // Rules that arrived from another device may be due; this can queue new transactions.
    generateRecurringTransactions();
    generateSavingsDeposits();
}

async function pushV2() {
    const payload = buildV2Payload();
    const state = await postSyncV2(payload);

    localStorage.setItem(SYNC_BASELINE_KEY, webAppUrl);
    clearSentPending(payload);
    reconcileV2(state);

    if (hasPendingChanges()) {
        pushQueued = true;
    } else {
        setSyncBadge('synced');
    }
}

// --- SYNCHRONIZATION ---
/**
 * Call after local changes were queued. `replace` means the local data is the truth (reset or
 * restored backup); otherwise local changes are merged with the Sheet's content.
 */
function syncToGoogleSheet(mode = 'merge') {
    localChangeCount++;

    if (mode === 'replace') setSyncDirty('replace');

    if (!webAppUrl || !remoteReady) return;

    if (pushInFlight) {
        pushQueued = true;
        return;
    }

    pushToGoogleSheet();
}

function pushToGoogleSheet() {
    // Never write before a read has told us which protocol the script speaks.
    if (!syncProtocol || !hasPendingChanges()) return Promise.resolve();

    pushInFlight = true;
    setSyncBadge('syncing');

    return (syncProtocol === 'v2' ? pushV2() : pushLegacy())
        .catch((error) => {
            setSyncBadge(failureBadge(error, 'error'), failureDetail(error));
        })
        .finally(() => {
            pushInFlight = false;

            if (pushQueued) {
                pushQueued = false;
                pushToGoogleSheet();
            }
        });
}

/** An empty v2 sync: changes nothing on the server and returns its full state. */
function readStateV2() {
    return postSyncV2({
        action: 'sync',
        token: webAppToken,
        replace: false,
        upserts: [],
        deletes: [],
        meta: {},
    });
}

/**
 * Read the server without ever putting the token in a URL. The tokenless GET ?v=2 answers with
 * the data (legacy script, or a v2 script left open) or with "unauthorized", which only Code.gs
 * says; only then is a POST safe (the legacy script clears the sheet on any unknown POST body).
 */
async function readSheet() {
    const response = await fetch(sheetUrl({ v: 2 }));

    try {
        const result = await parseSheetResponse(response);

        serverIsOpen = Boolean(result && result.version === 2);

        return result;
    } catch (error) {
        if (!error || error.message !== 'unauthorized' || !webAppToken) throw error;

        serverIsOpen = false;

        return readStateV2();
    }
}

function syncFromGoogleSheet({ quiet = false } = {}) {
    if (!webAppUrl) {
        setSyncBadge('idle');
        updateSyncNote();
        return Promise.resolve();
    }

    const requestedUrl = webAppUrl;

    lastPullAt = Date.now();

    // A refresh in the background does not flash "Đang tải..." over a badge that is already fine.
    if (!quiet) setSyncBadge('loading');

    return readSheet()
        .then((result) => {
            if (requestedUrl !== webAppUrl) return;

            if (Array.isArray(result)) {
                syncProtocol = 'legacy';
                updateSyncNote();
                reconcileWithSheet(result);
            } else if (result && result.version === 2) {
                syncProtocol = 'v2';
                updateSyncNote();
                reconcileV2(result);
                remoteReady = true;

                if (hasPendingChanges()) {
                    syncToGoogleSheet();
                } else {
                    localStorage.setItem(SYNC_BASELINE_KEY, webAppUrl);
                    setSyncBadge('synced');
                }
            } else {
                throw new Error('Phản hồi từ Apps Script không đúng định dạng.');
            }
        })
        .catch((error) => {
            setSyncBadge(failureBadge(error, 'offline'), failureDetail(error));
        });
}

/** Read the Sheet again when the user returns to this window or tab (see REFRESH_MIN_INTERVAL_MS). */
function refreshFromSheet() {
    if (document.visibilityState !== 'visible' || !webAppUrl || !remoteReady) {
        return Promise.resolve();
    }

    if (pushInFlight || Date.now() - lastPullAt < REFRESH_MIN_INTERVAL_MS) {
        return Promise.resolve();
    }

    return syncFromGoogleSheet({ quiet: true });
}

/** The user came back to the window: refresh, then remind about card dues with fresh data. */
function handleReturnToApp() {
    refreshFromSheet().then(() => {
        if (document.visibilityState === 'visible') remindCardDues();
    });
}

/** Retry after the connection comes back: read the Sheet first, or flush pending changes. */
function resumeSync() {
    if (!webAppUrl) return;

    if (!remoteReady) {
        syncFromGoogleSheet();
    } else if (hasPendingChanges() && !pushInFlight) {
        pushToGoogleSheet();
    }
}
