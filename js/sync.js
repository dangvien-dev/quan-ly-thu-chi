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
//  - A replace or a delete whose reply was lost is only sent again when the server can prove it
//    was never applied. When it cannot (or is an older Code.gs that does not answer), the data of
//    both sides is merged instead and nothing is destroyed (see abandonDestructiveWrite).
//  - A replace or a deletion that is still unconfirmed when the Web App URL changes is never sent
//    to the new Sheet (secureUnconfirmedWrites); the user is told and the notice stays visible.
//    A reply that arrives after the URL changed is dropped (syncGeneration), and deletions queued
//    before the first contact with a Sheet have no authority over what it holds
//    (giveUpDeletesAtFirstContact).
//  - Only ONE request that answers with a snapshot of the Sheet is on its way at a time (a read, a
//    push, a settle check; inSyncLane). The order in which a server works through requests that
//    overlap is not the order they were sent in (network delay, the lock wait, Apps Script
//    scheduling), so a snapshot that arrived second may be the OLDER one and would roll the local
//    data back (rows the newer snapshot had would be read as deleted on the Sheet). With one request
//    at a time the reply of the previous one has been applied before the next is sent, whatever the
//    server does. And a reply only settles the replace that was pending when its request was
//    built, never one made while it was on its way (fm_sync_replace_seq, clearSentPending).
//  - The record of a request that was sent (fm_sync_inflight) is the only way to ask the server
//    what became of it, so it is the LAST thing to go: the pending lists and flags are settled first,
//    in steps that can be repeated, and a crash in between leaves a record that is simply asked
//    about again.

const SYNC_DIRTY_KEY = 'fm_sync_dirty'; // '' | 'merge' | 'replace'
const SYNC_BASELINE_KEY = 'fm_sync_baseline'; // URL whose content this device last synced with
const SYNC_DELETED_KEY = 'fm_deleted_ids'; // ids deleted here, not yet deleted on the server
const SYNC_UPSERTS_KEY = 'fm_pending_upserts'; // ids created or edited here (v2)
const SYNC_META_KEY = 'fm_pending_meta'; // meta kinds changed here (v2)
// The last v2 write whose reply never arrived: {requestId, url, baseRevision, baseEpoch, replace,
// upserts: [{id, updatedAt}], deletes, meta: {key: {updatedAt}}}. Before sending anything else the
// server is asked whether it was applied (appliedCheck): true, false or 'unknown'. Only a proven
// "false" lets a replace or deletes go out again; 'unknown' never does (settleInflightV2).
const SYNC_INFLIGHT_KEY = 'fm_sync_inflight';
// {url, revision, epoch}: the revision and epoch of the server's request log in the last state
// received from `url`. A request records them (baseRevision, baseEpoch) so the server can tell
// "never applied" from "forgotten" (a log that was lost starts again with another epoch).
const SYNC_REVISION_KEY = 'fm_sync_revision';
// Warnings about writes that were not sent on purpose (see abandonDestructiveWrite): kept until the
// user has seen them, so a toast that went by is not the only trace.
const SYNC_REVIEW_KEY = 'fm_sync_review';
// Counts the intents to replace the Sheet (a backup restored, "Xóa toàn bộ dữ liệu"). A reply may
// only settle the replace that was pending when its request was built (clearSentPending).
const SYNC_REPLACE_SEQ_KEY = 'fm_sync_replace_seq';
const GET_FALLBACK_MAX_URL = 6000;
// Rows the user chose to "decide later" for (see decideRemoteLoss): kept here, not uploaded, and
// not asked about again until the app is opened again.
const deferredLossIds = new Set();
const TRANSFER_CATEGORY_PREFIX = `${TRANSFER_CATEGORY} → `;

let remoteReady = false;
let syncProtocol = ''; // set by the first successful read: 'legacy' | 'v2'
// Bumped whenever the Web App URL changes. A request that was made before that belongs to a Sheet
// that is no longer the connected one: when its reply arrives it must not touch the baseline, the
// pending lists or the local data (see postSyncV2, pushV2, pushToGoogleSheet).
let syncGeneration = 0;
// The tail of the queue of operations that talk to the connected Sheet (inSyncLane). Replaced when
// the Web App URL changes, so a request that never gets an answer from the old Sheet cannot hold the
// new connection back.
let syncLane = Promise.resolve();
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

/** Transactions kept here with "Để sau": on this device but not on the Sheet. */
function deferredLossCount() {
    return transactions.filter((transaction) => deferredLossIds.has(transaction.id)).length;
}

function setSyncBadge(state, detail = '') {
    const badge = document.getElementById('sync-status');

    if (!badge) return;

    const waiting = state === 'synced' ? deferredLossCount() : 0;

    if (waiting) {
        // Not "saved": these rows exist only here until the user decides (see decideRemoteLoss).
        badge.innerHTML = `<i class="fa-solid fa-circle-exclamation" style="color:var(--warning)"></i> Chờ xử lý (${waiting})`;
        badge.title = `${waiting} giao dịch có trên máy này nhưng không còn trên Google Sheet và đang chờ bạn quyết định. Tải lại ứng dụng để chọn Khôi phục hoặc Xóa.`;
        return;
    }

    badge.innerHTML = SYNC_BADGES[state];
    badge.title = detail;
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

/**
 * Sets the dirty flag to exactly `mode` ('' removes it), even over 'replace' (which setSyncDirty never
 * lowers). One write: clearing and then setting again would leave a moment, and a crash, with no flag
 * while changes are still pending.
 */
function overwriteSyncDirty(mode) {
    if (mode) {
        localStorage.setItem(SYNC_DIRTY_KEY, mode);
    } else {
        localStorage.removeItem(SYNC_DIRTY_KEY);
    }
}

/** How many replace intents this device has made (persisted: in-flight records carry it). */
function readReplaceSeq() {
    return Number(readStoredText(SYNC_REPLACE_SEQ_KEY)) || 0;
}

function setSyncDirty(mode) {
    if (mode === 'replace') {
        localStorage.setItem(SYNC_REPLACE_SEQ_KEY, String(readReplaceSeq() + 1));
    }

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

/**
 * Work this device still has to settle with the Sheet: changes not sent yet, or a request that was
 * sent and whose outcome is not noted down (a record of fm_sync_inflight left by a crash, or by a
 * reply that never came). Such a record is settled on its own, not only when the next change comes.
 */
function hasUnsettledWork() {
    return hasPendingChanges() || (syncProtocol === 'v2' && Boolean(readInflight()));
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
/**
 * `keepPending`: the caller has just queued a replace for exactly this URL on purpose (restoring a
 * backup on a device that had no URL and takes the file's), so nothing is secured.
 */
function setScriptUrl(url, { keepPending = false } = {}) {
    // What was written to the old Sheet and never confirmed must not reach the new one.
    const notice =
        url !== webAppUrl && !keepPending
            ? secureUnconfirmedWrites(webAppUrl ? 'url' : 'connect')
            : '';

    if (url !== webAppUrl) {
        // Whatever is still on its way to the old Sheet is answered into a connection that is gone.
        syncGeneration++;
        pushInFlight = false;
        pushQueued = false;
        syncLane = Promise.resolve();
    }

    webAppUrl = url;
    localStorage.setItem('fm_script_url', url);
    remoteReady = false;
    syncProtocol = '';
    updateSyncNote();

    if (notice) announceUnsentWrites(notice);

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

/** The host the app is served from (a function, so a test can pretend to be on another one). */
function currentHostname() {
    return window.location.hostname;
}

/** Warns in Settings when this address is shared with other sites (see isSharedPagesOrigin). */
function updateOriginNote() {
    const note = document.getElementById('origin-note');

    if (!note) return;

    const host = currentHostname();

    note.textContent = isSharedPagesOrigin(host)
        ? `Lưu ý cách ly dữ liệu: ứng dụng đang chạy ở ${host}. Trình duyệt dùng chung bộ nhớ (localStorage) cho mọi trang cùng tên miền này, kể cả các trang GitHub Pages khác của cùng tài khoản, nên một trang khác bị lỗi bảo mật có thể đọc dữ liệu thu chi và mã bảo vệ lưu trên máy. Hãy dùng một tên miền riêng cho ứng dụng này (xem README, mục "Triển khai và cách ly dữ liệu").`
        : '';
    note.hidden = !note.textContent;
}

/** Explain which kind of Apps Script is connected (shown under the settings form). */
function updateSyncNote() {
    const note = document.getElementById('sync-protocol-note');

    updateOriginNote();

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
function sheetUrl(params = {}, base = webAppUrl) {
    const query = new URLSearchParams(params).toString();

    return query ? `${base}${base.includes('?') ? '&' : '?'}${query}` : base;
}

/**
 * Runs an operation that sends requests answered with a snapshot of the Sheet (a read, a push with
 * its settle check) after every earlier one has finished, whether it succeeded or failed. Nothing
 * that is built from the local data or that applies a reply may run beside another: the reply of one
 * must be merged before the next request is made, so the Sheet always answers in the order the data
 * here was prepared. Every call site of fetch that returns a state must be inside this. A request
 * that never gets an answer holds the later ones back until the browser gives up on it (what was
 * asked for stays queued, nothing is lost); changing the Web App URL frees the lane.
 * An operation that was queued for a connection that has been replaced is not run at all.
 */
function inSyncLane(operation) {
    const generation = syncGeneration;
    const run = syncLane.then(() => {
        if (generation !== syncGeneration) throw staleConnection();

        return operation();
    });

    syncLane = run.then(
        () => {},
        () => {},
    );

    return run;
}

/** What a request that outlived its connection (the Web App URL changed) fails with. */
function staleConnection() {
    const error = new Error('Kết nối Google Sheet đã đổi trong lúc đang gửi.');

    error.stale = true;

    return error;
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
    const target = webAppUrl;
    let response;

    try {
        response = await fetch(target, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ transactions: rows }),
        });
    } catch (error) {
        const payload = JSON.stringify(rows);
        const url = sheetUrl({ action: 'save', data: payload }, target);

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
    const replaceSeqAtStart = readReplaceSeq();
    const generation = syncGeneration;

    await writeLegacySheet(transactions);

    if (generation !== syncGeneration) throw staleConnection();

    localStorage.setItem(SYNC_BASELINE_KEY, webAppUrl);

    // A restored backup does not go through syncToGoogleSheet, so it is not in localChangeCount.
    if (changeCountAtStart === localChangeCount && replaceSeqAtStart === readReplaceSeq()) {
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
    const target = webAppUrl;
    const generation = syncGeneration;
    let response;

    try {
        response = await fetch(target, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
        });
    } catch (error) {
        // The fallback puts the whole payload in the URL, and URLs end up in logs and proxies: never
        // with a token. The change stays queued and is sent again later.
        if (payload.token || generation !== syncGeneration) throw error;

        const url = sheetUrl({ action: 'sync', payload: JSON.stringify(payload) }, target);

        if (url.length > GET_FALLBACK_MAX_URL) {
            throw new Error(
                'Không gửi được dữ liệu: trình duyệt chặn POST tới Apps Script và lượng thay đổi quá lớn để gửi dự phòng.',
            );
        }

        response = await fetch(url);
    }

    const state = await parseSheetResponse(response);

    // The reply of a request made to the Sheet that was connected before is not about this one.
    if (generation !== syncGeneration) throw staleConnection();

    if (!state || state.version !== 2) {
        throw new Error('Phản hồi từ Apps Script không đúng định dạng.');
    }

    return state;
}

/**
 * Keeps the revision and epoch of the server's request log (absent from an older Code.gs). Call it
 * for every snapshot that is applied. Within one epoch the revision only grows; a smaller number
 * could only weaken what appliedAfter proves.
 */
function rememberRevision(state) {
    if (!(Number.isInteger(state.revision) && state.revision >= 0)) {
        localStorage.removeItem(SYNC_REVISION_KEY);
        return;
    }

    const epoch = typeof state.epoch === 'string' ? state.epoch : null;
    const known = readStoredJson(SYNC_REVISION_KEY, null);
    const sameLog =
        Boolean(known) &&
        known.url === webAppUrl &&
        known.epoch === epoch &&
        Number.isInteger(known.revision);

    localStorage.setItem(
        SYNC_REVISION_KEY,
        JSON.stringify({
            url: webAppUrl,
            revision: sameLog ? Math.max(known.revision, state.revision) : state.revision,
            epoch,
        }),
    );
}

/** {revision, epoch} last seen from the current server; null members when there is none. */
function lastKnownServerView() {
    const record = readStoredJson(SYNC_REVISION_KEY, null);
    const usable = Boolean(record) && record.url === webAppUrl;

    return {
        revision: usable && Number.isInteger(record.revision) ? record.revision : null,
        epoch: usable && typeof record.epoch === 'string' ? record.epoch : null,
    };
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
    const deletes = replace ? [] : readDeletedIds();

    return {
        action: 'sync',
        token: webAppToken,
        replace,
        // Code.gs refuses a request that empties the Sheet unless it is asked for explicitly: only
        // when this device holds no transaction any more (reset, empty backup, the last one
        // deleted) is an empty Sheet what the user wants.
        confirmWipe: transactions.length === 0 && (replace || deletes.length > 0),
        upserts,
        deletes,
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
    // A replace made after this request was built (a backup restored, "Xóa toàn bộ dữ liệu" while
    // it was on its way) is not what its reply confirms: it stays pending, with everything it will
    // send. Records of older versions carry no number and settle as before.
    if (payload.replaceSeq !== undefined && payload.replaceSeq !== readReplaceSeq()) return;

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
    overwriteSyncDirty(upserts.length || deletes.length ? 'merge' : '');
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

function newRequestId() {
    const random =
        window.crypto && typeof window.crypto.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

    return `fm-${Date.now().toString(36)}-${random}`;
}

/** What clearSentPending needs to know about a request, small enough to keep across reloads. */
function inflightRecord(payload) {
    const view = lastKnownServerView();

    return {
        requestId: payload.requestId,
        url: webAppUrl,
        baseRevision: view.revision,
        baseEpoch: view.epoch,
        replaceSeq: readReplaceSeq(),
        replace: payload.replace,
        upserts: payload.upserts.map((item) => ({ id: item.id, updatedAt: item.updatedAt })),
        deletes: payload.deletes,
        meta: Object.fromEntries(
            Object.entries(payload.meta).map(([key, entry]) => [
                key,
                { updatedAt: entry.updatedAt },
            ]),
        ),
    };
}

function readInflight() {
    const record = readStoredJson(SYNC_INFLIGHT_KEY, null);

    return record && typeof record.requestId === 'string' ? record : null;
}

/** A replace or a deletion: sending it again could undo what another device wrote since. */
function isDestructiveWrite(inflight) {
    return inflight.replace === true || (inflight.deletes || []).length > 0;
}

/**
 * A replace or deletion that must not be sent (the server could not say whether it went through,
 * or the Web App URL changed since): sending it could remove what another device wrote or what
 * the other Sheet holds. Nothing is destroyed either way:
 *  - a replace becomes an ordinary merge: everything held here is queued as a change and the
 *    server's content is kept (rows the replace was meant to drop may come back);
 *  - deletions are not sent: a row still on the server comes back here, one already gone stays
 *    gone.
 * `intent` is {replace, deletes}; `why` is 'unknown', 'url' (the Web App URL changed) or 'connect'
 * (a first Sheet was just switched on). Returns the sentence to tell the
 * user ('' when there was nothing to give up).
 */
function abandonDestructiveWrite(intent, why) {
    const notes = [];
    const leads = {
        url: 'Bạn vừa đổi Google Sheet khi còn thay đổi chưa được Sheet cũ xác nhận, nên app không gửi chúng sang Sheet mới. ',
        connect:
            'Bạn vừa bật Google Sheet khi còn một lần thay toàn bộ dữ liệu chưa gửi đi, nên app không gửi nó lên Sheet. ',
        unknown: 'Không rõ lần ghi trước lên Google Sheet đã được áp dụng chưa (mất phản hồi). ',
    };
    const lead = leads[why];

    if (intent.replace && getSyncDirty() === 'replace') {
        addToList(
            SYNC_UPSERTS_KEY,
            transactions.map((transaction) => transaction.id),
        );
        addToList(SYNC_META_KEY, Object.keys(META_DEFS));
        // Everything is queued by now; only then does the flag change (one write).
        overwriteSyncDirty('merge');
        notes.push(
            'Lần thay toàn bộ dữ liệu trên Sheet đã được đổi thành gộp: dữ liệu trên máy được gộp với Sheet thay vì ghi đè (dòng định bỏ có thể quay lại). Muốn thay toàn bộ Sheet, hãy thực hiện lại.',
        );
    }

    const dropped = new Set(intent.deletes || []);

    if (dropped.size) {
        writeList(
            SYNC_DELETED_KEY,
            readDeletedIds().filter((id) => !dropped.has(id)),
        );
        notes.push(
            `Lệnh xóa ${dropped.size} giao dịch không được gửi lại: giao dịch nào còn trên Google Sheet sẽ quay về máy này, hãy xóa lại nếu cần.`,
        );
    }

    return notes.length ? lead + notes.join(' ') : '';
}

/**
 * First contact with a Sheet (nothing was ever synced with this URL): deletions queued before have
 * no authority over what it holds. Sending them would delete rows that were there before this
 * device connected (and, with nothing else on the device, empty the Sheet). They are given up; rows
 * of the Sheet that they named come back here, and the user is told when there were such rows.
 */
function giveUpDeletesAtFirstContact(state) {
    const deleted = readDeletedIds();

    if (!deleted.length) return;
    if (localStorage.getItem(SYNC_BASELINE_KEY) === webAppUrl) return;
    if (getSyncDirty() === 'replace') return;

    const onSheet = new Set((state.transactions || []).map((row) => String(row.id)));
    const named = deleted.filter((id) => onSheet.has(id));

    writeList(SYNC_DELETED_KEY, []);

    if (named.length) {
        announceUnsentWrites(
            `Google Sheet vừa kết nối đã có ${named.length} giao dịch mà trước đó bạn xóa trên máy này (lúc chưa kết nối). App không xóa chúng trên Sheet mà giữ lại; hãy xóa lại nếu muốn.`,
        );
    }
}

/**
 * The Web App URL is about to change (or the server of an in-flight write is not the current one):
 * what is still unconfirmed - an in-flight request, a pending replace, pending deletions - was made
 * against the old Sheet and is not sent to the new one. Returns the notice ('' when nothing was
 * pending). `why` 'connect' = there was no Sheet before: only a pending replace (which would
 * overwrite the Sheet that is being connected) is given up; deletions made while no Sheet was
 * configured are ordinary changes and are still sent.
 */
function secureUnconfirmedWrites(why) {
    const inflight = readInflight();
    const notice = abandonDestructiveWrite(
        {
            replace: getSyncDirty() === 'replace',
            deletes:
                why === 'connect'
                    ? []
                    : Array.from(
                          new Set([
                              ...(inflight ? inflight.deletes || [] : []),
                              ...readDeletedIds(),
                          ]),
                      ),
        },
        why,
    );

    // Only when what it stood for has been given up: until then it is the way back to the request.
    localStorage.removeItem(SYNC_INFLIGHT_KEY);

    return notice;
}

// --- WARNINGS THAT STAY ---
function readSyncReview() {
    const list = readStoredJson(SYNC_REVIEW_KEY, []);

    return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : [];
}

/** Shows the warnings the user has not dismissed yet (the banner under the header). */
function renderSyncReview() {
    const banner = document.getElementById('sync-review');

    if (!banner) return;

    const list = readSyncReview();
    const body = document.getElementById('sync-review-list');

    body.replaceChildren(
        ...list.map((text) => {
            const item = document.createElement('p');

            item.textContent = text;

            return item;
        }),
    );
    banner.hidden = !list.length;
}

function addSyncReview(text) {
    writeList(
        SYNC_REVIEW_KEY,
        [...readSyncReview().filter((item) => item !== text), text].slice(-5),
    );
    renderSyncReview();
}

function dismissSyncReview() {
    writeList(SYNC_REVIEW_KEY, []);
    renderSyncReview();
}

/** A toast for the moment, and a notice that stays until it is dismissed. */
function announceUnsentWrites(notice) {
    addSyncReview(notice);
    showToast(notice, 'warning', 20000);
}

/**
 * A previous write may or may not have been applied (its reply was lost). Ask the server, which
 * answers true, false (proven never applied) or 'unknown'. `true` is handled exactly as if the
 * reply had arrived. `false`, or 'unknown' for a write that is safe to repeat (upserts only: the
 * newest updatedAt wins), leaves the changes queued to be sent. A replace or deletion whose
 * outcome is not known is never sent again (abandonDestructiveWrite). A Code.gs that predates
 * request ids does not answer `applied` at all, which counts as 'unknown'. Either way the server's
 * current state is merged before anything new is built.
 */
async function settleInflightV2() {
    const inflight = readInflight();

    if (!inflight) return;

    // A request made to another deployment cannot be asked about here, and what it left pending
    // must not go to this one.
    if (inflight.url && inflight.url !== webAppUrl) {
        const notice = secureUnconfirmedWrites('url');

        if (notice) announceUnsentWrites(notice);

        return;
    }

    const state = await postSyncV2({
        action: 'sync',
        token: webAppToken,
        replace: false,
        upserts: [],
        deletes: [],
        meta: {},
        appliedCheck: inflight.requestId,
        ...(Number.isInteger(inflight.baseRevision) ? { appliedAfter: inflight.baseRevision } : {}),
        ...(typeof inflight.baseEpoch === 'string' ? { appliedEpoch: inflight.baseEpoch } : {}),
    });
    let notice = '';

    if (state.applied === true) {
        localStorage.setItem(SYNC_BASELINE_KEY, webAppUrl);
        clearSentPending(inflight);
    } else if (state.applied !== false && isDestructiveWrite(inflight)) {
        notice = abandonDestructiveWrite(
            {
                // A newer replace (made while this one was in flight) is the user's current
                // intent, a request of its own: only the old one is given up.
                replace:
                    inflight.replace === true &&
                    (inflight.replaceSeq === undefined || inflight.replaceSeq === readReplaceSeq()),
                deletes: inflight.deletes || [],
            },
            'unknown',
        );
    }

    localStorage.removeItem(SYNC_INFLIGHT_KEY);
    rememberRevision(state);
    reconcileV2(state);

    if (notice) announceUnsentWrites(notice);
}

async function pushV2() {
    const generation = syncGeneration;

    await settleInflightV2();

    if (generation !== syncGeneration) throw staleConnection();

    if (!hasPendingChanges()) {
        setSyncBadge('synced');
        return;
    }

    const payload = { ...buildV2Payload(), requestId: newRequestId() };
    const record = inflightRecord(payload);

    localStorage.setItem(SYNC_INFLIGHT_KEY, JSON.stringify(record));

    // On any failure the record stays: even an error reply ("Không chắc dữ liệu đã được ghi xong",
    // a failed rollback, an HTTP error after a timeout) can follow a write, so the next push asks.
    const state = await postSyncV2(payload);

    // Settle first, remove the record LAST: a crash or a full disk in between must leave a record
    // to ask the server about (appliedCheck), not a replace or deletion that is still pending with
    // nothing to say it was sent. Every step can be repeated (settleInflightV2 repeats them).
    localStorage.setItem(SYNC_BASELINE_KEY, webAppUrl);
    // The reply confirms what was sent; only that.
    clearSentPending({ ...payload, replaceSeq: record.replaceSeq });
    localStorage.removeItem(SYNC_INFLIGHT_KEY);
    rememberRevision(state);
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
    if (!syncProtocol || !hasUnsettledWork()) return Promise.resolve();

    const generation = syncGeneration;

    pushInFlight = true;
    setSyncBadge('syncing');

    return inSyncLane(() => {
        // A request ahead of this one in the lane (a read) may have changed what there is to send,
        // or failed before the protocol was known.
        if (!syncProtocol) return undefined;

        if (!hasUnsettledWork()) {
            setSyncBadge('synced');
            return undefined;
        }

        return syncProtocol === 'v2' ? pushV2() : pushLegacy();
    })
        .catch((error) => {
            // A push of the previous connection says nothing about this one.
            if (generation !== syncGeneration || (error && error.stale)) return;

            setSyncBadge(failureBadge(error, 'error'), failureDetail(error));
        })
        .finally(() => {
            // setScriptUrl reset the flags for the new connection; this push is not part of it.
            if (generation !== syncGeneration) return;

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

    return inSyncLane(async () => {
        if (requestedUrl !== webAppUrl) return;

        // A refresh in the background does not flash "Đang tải..." over a badge that is already fine.
        if (!quiet) setSyncBadge('loading');

        const result = await readSheet();

        if (requestedUrl !== webAppUrl) return;

        if (Array.isArray(result)) {
            syncProtocol = 'legacy';
            updateSyncNote();
            reconcileWithSheet(result);
        } else if (result && result.version === 2) {
            syncProtocol = 'v2';
            updateSyncNote();
            // Also from the tokenless GET of an open server, which never goes through postSyncV2.
            rememberRevision(result);
            giveUpDeletesAtFirstContact(result);
            reconcileV2(result);
            remoteReady = true;

            if (hasUnsettledWork()) {
                syncToGoogleSheet();
            } else {
                localStorage.setItem(SYNC_BASELINE_KEY, webAppUrl);
                setSyncBadge('synced');
            }
        } else {
            throw new Error('Phản hồi từ Apps Script không đúng định dạng.');
        }
    }).catch((error) => {
        if (requestedUrl !== webAppUrl || (error && error.stale)) return;

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
