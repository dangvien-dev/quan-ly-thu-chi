/**
 * FinManager - Google Apps Script backend (protocol v2, backward compatible).
 *
 * Setup
 *  1. Open the spreadsheet > Extensions > Apps Script and paste this file (replace the old code).
 *  2. Deploy > New deployment (or Manage deployments > Edit > New version) > type "Web app" >
 *     Execute as: Me > Who has access: Anyone. Copy the /exec URL into FinManager
 *     (Cài đặt & Dữ liệu > Web App URL).
 *  3. Required: Project Settings > Script properties > add FM_TOKEN with a long random secret
 *     (32+ characters), then enter the same value in FinManager ("Mã bảo vệ") on every device.
 *     Without FM_TOKEN every request is refused ("unauthorized"). Only if the data really may be
 *     public, add FM_ALLOW_OPEN = true instead: then anyone who learns the URL can read and
 *     overwrite it.
 *     FinManager never puts the token in a URL: it reads with GET ?v=2 (answered "unauthorized")
 *     and then with a POST that carries the token in its body.
 *
 * Sheets (created on first use)
 *  - "Transactions": id, date, type, source, category, amount, note, targetSource, updatedAt.
 *    Existing columns keep their place; missing ones are appended. The sheet is fully managed
 *    by the app. The date column holds real dates and is displayed as dd/mm/yyyy.
 *  - "Meta": key, value (JSON), updatedAt - categories, sources, opening balances, budgets,
 *    salary plan, recurring rules and debts.
 *
 * Requests
 *  v2 (FinManager with sync v2)
 *    GET  ?v=2[&token=...]                -> {version: 2, transactions: [...], meta: {...}}
 *    POST {action: 'sync', token, replace, upserts: [...], deletes: [ids], meta: {key: {value,
 *          updatedAt}}}                   -> the same object, after applying the changes.
 *         A row or meta value is only overwritten by one with an equal or newer updatedAt.
 *         With replace: true the upserts are the complete list and meta is overwritten.
 *         Any request that would leave no transaction at all (while the sheet still has some:
 *         a replace with an empty list, or deletes of every row) is refused unless the body also
 *         says confirmWipe: true, so no stray request can empty the sheet. A request is checked
 *         as a whole before either sheet is written (the writes themselves are best effort).
 *         A write may carry requestId; every state reply carries revision. A client that lost the
 *         reply to a write asks {appliedCheck: <requestId>, appliedAfter: <revision it had seen
 *         when it built that request>} and gets applied: true, false or "unknown". "unknown"
 *         means the script cannot prove either (the request log dropped it, or the write ended
 *         in a flush / log failure): the client must then never send a replace or deletes again.
 *    GET  ?action=sync&payload=<json>     -> same as the POST (fallback when a POST is blocked).
 *  Legacy (the original script's requests, so older clients keep working)
 *    GET                                  -> JSON array of transactions
 *    POST {"transactions": [...]}         -> replaces every row (an empty list on a sheet that
 *                                            has rows needs "confirmWipe": true)
 *    GET  ?action=save&data=<json array>  -> replaces every row (empty list: &confirmWipe=true)
 *
 * Nothing is ever cleared before the request has been validated: a malformed body is rejected
 * and the sheet is left untouched; every cell is checked against the 50,000-character limit of
 * Sheets and the sheet is grown to the rows and columns it needs before the old rows are
 * cleared, and a write that still fails puts the old rows back. Emptying the sheet (v2 replace
 * or legacy save with an empty list) needs confirmWipe. Errors are returned as {"error": "..."}.
 */

const TRANSACTIONS_SHEET = 'Transactions';
const META_SHEET = 'Meta';
const COLUMNS = [
    'id',
    'date',
    'type',
    'source',
    'category',
    'amount',
    'note',
    'targetSource',
    'updatedAt',
];
// Stored as plain text so a note such as "=1+1" or "+50k" is never evaluated as a formula.
const TEXT_COLUMNS = ['id', 'type', 'source', 'category', 'note', 'targetSource', 'updatedAt'];
const META_COLUMNS = ['key', 'value', 'updatedAt'];
const TRANSACTION_TYPES = ['income', 'expense', 'transfer'];
const DATE_FORMAT = 'yyyy-MM-dd';
const MAX_CELL_CHARS = 49000; // a Sheets cell holds at most 50,000 characters
const PROTOCOL_VERSION = 2;

// --- ENTRY POINTS ---
function doGet(e) {
    const params = (e && e.parameter) || {};

    try {
        if (params.action === 'sync') {
            return jsonResponse_(withLock_(() => handleSync_(JSON.parse(params.payload))));
        }

        if (!isAuthorized_(params.token)) return jsonResponse_({ error: 'unauthorized' });

        if (params.action === 'save') {
            return jsonResponse_(
                withLock_(() =>
                    replaceAllTransactions_(JSON.parse(params.data), params.confirmWipe === 'true'),
                ),
            );
        }

        // Reads take the lock too, so they never see a sheet half-way through a write.
        return jsonResponse_(
            withLock_(() => (params.v === '2' ? readState_() : readTransactions_())),
        );
    } catch (error) {
        return errorResponse_(error);
    }
}

function doPost(e) {
    try {
        const body = JSON.parse(e.postData.contents);

        if (body && body.action === 'sync') {
            return jsonResponse_(withLock_(() => handleSync_(body)));
        }

        if (!isAuthorized_(body && body.token)) return jsonResponse_({ error: 'unauthorized' });

        if (body && Array.isArray(body.transactions)) {
            return jsonResponse_(
                withLock_(() =>
                    replaceAllTransactions_(body.transactions, body.confirmWipe === true),
                ),
            );
        }

        throw new Error('Yêu cầu không hợp lệ');
    } catch (error) {
        return errorResponse_(error);
    }
}

// --- HELPERS ---
function jsonResponse_(payload) {
    return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
        ContentService.MimeType.JSON,
    );
}

function errorResponse_(error) {
    return jsonResponse_({ error: String(error && error.message ? error.message : error) });
}

function withLock_(action) {
    const lock = LockService.getScriptLock();

    lock.waitLock(20000);

    try {
        let result;
        let failure = null;

        try {
            result = action();
        } catch (error) {
            failure = error;
        }

        // Apply pending spreadsheet changes while the lock is still held, whether the action
        // worked or failed and put the old rows back: a rollback that is still pending is not
        // "nothing changed" yet, and the next request (or reader) must start from what the sheet
        // really holds.
        try {
            SpreadsheetApp.flush();
        } catch (flushError) {
            throw uncertainFlush_(flushError, failure);
        }

        if (failure) throw failure;

        return result;
    } finally {
        lock.releaseLock();
    }
}

/**
 * The error for a SpreadsheetApp.flush() that failed: the writes before it may or may not have
 * reached the sheet, so neither a rollback nor a blind retry is known to be safe. `earlier` is the
 * error the flush was following, if any. `uncertain` is what handleSync_ looks at.
 */
function uncertainFlush_(flushError, earlier) {
    const text = function (error) {
        return String(error && error.message ? error.message : error);
    };
    const failure = new Error(
        'Không chắc dữ liệu đã được ghi xong (' +
            text(flushError) +
            ')' +
            (earlier ? ' sau lỗi: ' + text(earlier) : '') +
            '. Mở Google Sheet kiểm tra dữ liệu; app không tự gửi lại lệnh thay thế hoặc xóa khi chưa chắc.',
    );

    failure.uncertain = true;

    return failure;
}

// --- REQUEST LOG ---
// A client that lost the reply to a write must not send a destructive request again (a replace
// drops what another device added since, a delete removes a row that was re-created): it asks
// whether the request was applied (appliedCheck) and is told true, false or 'unknown'.
//
// One Script Property holds {rev, floor, entries: [[requestId, rev, status], ...]}, oldest first.
//  - rev counts the writes that carry a requestId. Every state reply carries it (revision), and a
//    client says which revision it had seen when it built a request (appliedAfter).
//  - A request is logged as 'uncertain' BEFORE any sheet is touched and becomes 'ok' only after
//    its data was flushed. A flush or log failure, or an execution that stops half way, therefore
//    never leaves it looking as if it had not run. It is taken out again only when a failed write
//    is known to have left the sheets as they were.
//  - Only the newest MAX_LOGGED_REQUESTS entries are kept; floor is the highest revision of an
//    entry that was dropped. A request that is not in the log is "false" only when it cannot have
//    been dropped: it would have a revision above appliedAfter, so floor <= appliedAfter proves
//    it never ran. Anything else is 'unknown', never "no".
const REQUEST_LOG_KEY = 'FM_REQUEST_LOG';
const MAX_LOGGED_REQUESTS = 100;
const MAX_REQUEST_LOG_CHARS = 8000; // a Script Property value holds at most 9 KB

function readRequestLog_() {
    try {
        const log = JSON.parse(
            PropertiesService.getScriptProperties().getProperty(REQUEST_LOG_KEY) || 'null',
        );

        if (
            log &&
            Array.isArray(log.entries) &&
            typeof log.rev === 'number' &&
            typeof log.floor === 'number'
        ) {
            return log;
        }
    } catch (error) {
        // An unreadable log counts as empty; its lost history makes older requests 'unknown'
        // (a client's appliedAfter is then above rev).
    }

    return { rev: 0, floor: 0, entries: [] };
}

function writeRequestLog_(log) {
    const next = { rev: log.rev, floor: log.floor, entries: log.entries.slice() };

    while (
        next.entries.length > MAX_LOGGED_REQUESTS ||
        (next.entries.length > 1 && JSON.stringify(next).length > MAX_REQUEST_LOG_CHARS)
    ) {
        next.floor = Math.max(next.floor, next.entries.shift()[1]);
    }

    PropertiesService.getScriptProperties().setProperty(REQUEST_LOG_KEY, JSON.stringify(next));
}

function findRequest_(log, id) {
    for (let i = 0; i < log.entries.length; i++) {
        if (log.entries[i][0] === id) return log.entries[i];
    }

    return null;
}

/**
 * Logs `id` as about to be applied. Throws, with nothing written yet, when that cannot be
 * recorded. Returns the log as it was, to put back if the request turns out not to have changed
 * anything.
 */
function startRequest_(id) {
    const before = readRequestLog_();

    try {
        writeRequestLog_({
            rev: before.rev + 1,
            floor: before.floor,
            entries: before.entries.concat([[id, before.rev + 1, 'uncertain']]),
        });
    } catch (error) {
        throw new Error(
            'Không ghi được nhật ký yêu cầu (' +
                String(error && error.message ? error.message : error) +
                '); chưa ghi gì vào Sheet.',
        );
    }

    return before;
}

/**
 * The writes of `id` are flushed: it was applied. Failing to record that is not fatal: the entry
 * stays 'uncertain', so a client that asks is told 'unknown' and merges instead of sending again.
 */
function finishRequest_(id) {
    try {
        const log = readRequestLog_();
        const entry = findRequest_(log, id);

        if (entry) {
            entry[2] = 'ok';
            writeRequestLog_(log);
        }
    } catch (error) {
        // stays 'uncertain'
    }
}

/** A failed write that is known to have left the sheets as they were: the request never ran. */
function abandonRequest_(before) {
    try {
        writeRequestLog_(before);
    } catch (error) {
        // stays 'uncertain': a client that asks is told 'unknown', which is safe
    }
}

/** true: applied. false: proven never applied. 'unknown': cannot tell (see REQUEST LOG). */
function requestStatus_(id, afterRevision) {
    const log = readRequestLog_();
    const entry = findRequest_(log, id);

    if (entry) return entry[2] === 'ok' ? true : 'unknown';

    if (
        typeof afterRevision !== 'number' ||
        afterRevision > log.rev || // the log is older than the client's view: its history is lost
        log.floor > afterRevision // the entry may have been dropped
    ) {
        return 'unknown';
    }

    return false;
}

/**
 * Fail closed: without FM_TOKEN every request is refused, so a URL that leaks (a commit, a backup
 * file, a screenshot) never opens the data by accident. A deployment that really wants to stay
 * open must say so with the Script Property FM_ALLOW_OPEN = true.
 */
function isAuthorized_(token) {
    const properties = PropertiesService.getScriptProperties();
    const expected = properties.getProperty('FM_TOKEN');

    if (!expected) return properties.getProperty('FM_ALLOW_OPEN') === 'true';

    return String(token || '') === expected;
}

function getSheet_(name) {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function getTimeZone_() {
    return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
}

/**
 * Grows the sheet to at least `rows` x `columns`. A range outside the sheet throws on Google
 * ("The coordinates of the range are outside the dimensions of the sheet"), so this must run
 * before anything is cleared.
 */
function ensureSize_(sheet, rows, columns) {
    const maxRows = sheet.getMaxRows();
    const maxColumns = sheet.getMaxColumns();

    if (rows > maxRows) sheet.insertRowsAfter(maxRows, rows - maxRows);
    if (columns > maxColumns) sheet.insertColumnsAfter(maxColumns, columns - maxColumns);
}

/**
 * Clears rows 2.. and writes `rows` there (after `beforeWrite`, e.g. number formats). If the write
 * fails, the previous rows are put back before the error is rethrown: Apps Script does not roll
 * back what it already did, and a cleared sheet would read as "no data" on every device.
 */
function replaceDataRows_(sheet, width, rows, beforeWrite, label) {
    ensureSize_(sheet, rows.length + 1, width);

    const lastRow = sheet.getLastRow();
    const previous = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];

    try {
        if (previous.length) sheet.getRange(2, 1, previous.length, width).clearContent();
        if (!rows.length) return;
        if (beforeWrite) beforeWrite();

        sheet.getRange(2, 1, rows.length, width).setValues(rows);
    } catch (error) {
        try {
            if (rows.length) sheet.getRange(2, 1, rows.length, width).clearContent();
            if (previous.length) sheet.getRange(2, 1, previous.length, width).setValues(previous);
        } catch (restoreError) {
            throw restoreFailure_(error, label, restoreError);
        }

        throw error;
    }
}

/**
 * The error for a write that failed and whose rollback failed too: the sheet may now hold neither
 * the old nor the new data, so the message names every sheet that could not be put back and where
 * to recover it from. Nested failures are merged into one message (the first cause, all sheets).
 */
function restoreFailure_(error, label, restoreError) {
    const cause =
        (error && error.rootMessage) || String(error && error.message ? error.message : error);
    const sheets = [];

    [error, restoreError].forEach(function (failure) {
        ((failure && failure.failedSheets) || []).forEach(function (name) {
            if (sheets.indexOf(name) === -1) sheets.push(name);
        });
    });

    if (sheets.indexOf(label) === -1) sheets.push(label);

    const failure = new Error(
        cause +
            ' — KHÔNG khôi phục được dữ liệu cũ của sheet ' +
            sheets
                .map(function (name) {
                    return '"' + name + '"';
                })
                .join(', ') +
            '. Đừng đồng bộ tiếp; mở Google Sheet > Tệp > Nhật ký phiên bản để khôi phục, hoặc khôi phục từ file sao lưu.',
    );

    failure.rootMessage = cause;
    failure.failedSheets = sheets;
    failure.uncertain = true;

    return failure;
}

/** Returns the header row, appending any column from `columns` the sheet does not have yet. */
function ensureHeader_(sheet, columns) {
    const width = sheet.getLastColumn();
    const header = width ? sheet.getRange(1, 1, 1, width).getValues()[0].map(String) : [];
    const missing = columns.filter(function (name) {
        return header.indexOf(name) === -1;
    });

    if (missing.length) {
        ensureSize_(sheet, 1, header.length + missing.length);
        sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
        header.push.apply(header, missing);
    }

    return header;
}

// --- TRANSACTIONS ---
function readTransactions_() {
    const sheet = getSheet_(TRANSACTIONS_SHEET);
    const header = ensureHeader_(sheet, COLUMNS);
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) return [];

    const timeZone = getTimeZone_();
    const values = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();

    return values
        .filter(function (row) {
            return row.some(function (cell) {
                return cell !== '';
            });
        })
        .map(function (row) {
            const item = {};

            header.forEach(function (name, index) {
                const value = row[index];

                item[name] =
                    value instanceof Date
                        ? Utilities.formatDate(value, timeZone, DATE_FORMAT)
                        : value;
            });

            return item;
        });
}

function toDateCell_(value, timeZone) {
    const text = String(value).slice(0, 10);

    try {
        return Utilities.parseDate(text, timeZone, DATE_FORMAT);
    } catch (error) {
        return text;
    }
}

/**
 * Throws when a value cannot be stored in one Sheets cell. Called before anything is cleared: a
 * setValues() that fails after clearContent() would leave the sheet empty (Apps Script does not
 * roll back what it already did).
 */
function assertCellFits_(value, label) {
    if (typeof value === 'string' && value.length > MAX_CELL_CHARS) {
        throw new Error(label + ' quá dài để lưu trong một ô của Google Sheets');
    }
}

function writeTransactions_(list) {
    const sheet = getSheet_(TRANSACTIONS_SHEET);
    const header = ensureHeader_(sheet, COLUMNS);
    const timeZone = getTimeZone_();

    // Build and check every row first; only then touch the sheet.
    const rows = list.map(function (item) {
        return header.map(function (name) {
            const value = item[name];

            if (value === undefined || value === null) return '';

            assertCellFits_(value, 'Giao dịch "' + item.id + '" (' + name + ')');

            return name === 'date' ? toDateCell_(value, timeZone) : value;
        });
    });

    replaceDataRows_(
        sheet,
        header.length,
        rows,
        function () {
            header.forEach(function (name, index) {
                const column = sheet.getRange(2, index + 1, rows.length, 1);

                if (TEXT_COLUMNS.indexOf(name) !== -1) {
                    column.setNumberFormat('@');
                } else if (name === 'date') {
                    column.setNumberFormat('dd/mm/yyyy');
                }
            });
        },
        TRANSACTIONS_SHEET,
    );
}

/** A valid transaction row with only the known columns, or null for anything else. */
function cleanTransaction_(item) {
    if (!item || typeof item !== 'object') return null;

    const id = String(item.id === undefined || item.id === null ? '' : item.id).trim();
    const amount = Number(item.amount);

    if (!id || TRANSACTION_TYPES.indexOf(item.type) === -1 || !isFinite(amount)) return null;

    const row = {};

    COLUMNS.forEach(function (name) {
        row[name] = item[name] === undefined || item[name] === null ? '' : item[name];
    });
    row.id = id;
    row.amount = amount;
    row.date = String(row.date).slice(0, 10);
    row.updatedAt = String(row.updatedAt);

    return row;
}

/** Legacy full replace: validated first, so an invalid request never clears the sheet. */
function replaceAllTransactions_(list, confirmWipe) {
    if (!Array.isArray(list)) throw new Error('Yêu cầu không hợp lệ');

    if (!list.length && confirmWipe !== true && readTransactions_().length > 0) {
        throw new Error('Từ chối xóa toàn bộ giao dịch: yêu cầu không có confirmWipe');
    }

    const rows = list.map(cleanTransaction_);

    if (
        rows.some(function (row) {
            return row === null;
        })
    ) {
        throw new Error('Dữ liệu giao dịch không hợp lệ');
    }

    writeTransactions_(rows);

    return { status: 'success', ok: true, rows: rows.length };
}

// --- META ---
function readMetaRows_() {
    const sheet = getSheet_(META_SHEET);
    const header = ensureHeader_(sheet, META_COLUMNS);
    const lastRow = sheet.getLastRow();
    const result = {};

    if (lastRow < 2) return result;

    sheet
        .getRange(2, 1, lastRow - 1, header.length)
        .getValues()
        .forEach(function (row) {
            const entry = {};

            header.forEach(function (name, index) {
                entry[name] = row[index];
            });

            if (entry.key) {
                result[String(entry.key)] = {
                    value: String(entry.value),
                    updatedAt: String(entry.updatedAt),
                };
            }
        });

    return result;
}

function writeMetaRows_(rows) {
    const sheet = getSheet_(META_SHEET);
    const header = ensureHeader_(sheet, META_COLUMNS);
    const keys = Object.keys(rows);

    keys.forEach(function (key) {
        assertCellFits_(key, 'Khóa meta');
        assertCellFits_(rows[key].value, 'Dữ liệu "' + key + '"');
        assertCellFits_(rows[key].updatedAt, 'Dữ liệu "' + key + '" (updatedAt)');
    });

    const values = keys.map(function (key) {
        return header.map(function (name) {
            return name === 'key' ? key : rows[key][name];
        });
    });

    replaceDataRows_(
        sheet,
        header.length,
        values,
        function () {
            sheet.getRange(2, 1, values.length, header.length).setNumberFormat('@');
        },
        META_SHEET,
    );
}

function readMeta_() {
    const rows = readMetaRows_();
    const meta = {};

    Object.keys(rows).forEach(function (key) {
        try {
            meta[key] = { value: JSON.parse(rows[key].value), updatedAt: rows[key].updatedAt };
        } catch (error) {
            // A hand-edited cell that is not valid JSON is ignored instead of breaking the sync.
        }
    });

    return meta;
}

// --- SYNC (v2) ---
function readState_() {
    return {
        version: PROTOCOL_VERSION,
        transactions: readTransactions_(),
        meta: readMeta_(),
        revision: readRequestLog_().rev,
        serverTime: new Date().toISOString(),
    };
}

/**
 * Rejects a sync body whose shape is wrong instead of reading it as "nothing to do": every field
 * that is present must have its type, and every upsert must be a valid transaction (a replace
 * that silently dropped one bad row would answer "ok" with data missing).
 */
function validateSyncBody_(body) {
    const fail = function (what) {
        throw new Error('Yêu cầu đồng bộ không hợp lệ: ' + what);
    };
    // A field may be left out; when it is present (null included) it must have its type.
    const optional = function (value, check) {
        return value === undefined || check(value);
    };
    const requestKey = function (value) {
        return typeof value === 'string' && value.length > 0 && value.length <= 100;
    };
    const revision = function (value) {
        return typeof value === 'number' && isFinite(value) && value >= 0 && value % 1 === 0;
    };

    if (!optional(body.replace, isBoolean_)) fail('replace phải là true / false');
    if (!optional(body.confirmWipe, isBoolean_)) fail('confirmWipe phải là true / false');
    if (!optional(body.upserts, Array.isArray)) fail('upserts phải là một danh sách');
    if (!optional(body.deletes, Array.isArray)) fail('deletes phải là một danh sách');
    if (!optional(body.meta, isPlainObject_)) fail('meta phải là một đối tượng');
    if (!optional(body.requestId, requestKey)) fail('requestId');
    if (!optional(body.appliedCheck, requestKey)) fail('appliedCheck');
    if (!optional(body.appliedAfter, revision)) fail('appliedAfter');

    // A replace states the complete content: both lists must be there explicitly.
    if (body.replace === true) {
        if (!Array.isArray(body.upserts)) fail('replace cần upserts');
        if (!isPlainObject_(body.meta)) fail('replace cần meta');
    }

    (body.deletes || []).forEach(function (id, index) {
        if (typeof id !== 'string' && typeof id !== 'number') fail('deletes[' + index + ']');
    });

    (body.upserts || []).forEach(function (item, index) {
        if (cleanTransaction_(item) === null) {
            fail('giao dịch thứ ' + (index + 1) + ' trong upserts không hợp lệ');
        }
    });

    Object.keys(body.meta || {}).forEach(function (key) {
        if (!key || !isPlainObject_(body.meta[key])) fail('meta "' + key + '"');
    });
}

function isBoolean_(value) {
    return value === true || value === false;
}

function isPlainObject_(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Throws when one field of a transaction row cannot be stored in a Sheets cell. */
function assertTransactionFits_(row) {
    COLUMNS.forEach(function (name) {
        assertCellFits_(row[name], 'Giao dịch "' + row.id + '" (' + name + ')');
    });
}

/**
 * The complete transaction list a sync request leads to, or null when it changes nothing. Reads
 * only: every check (wipe guard, cell sizes) happens here, before anything is written.
 * A request that would leave no transaction on a sheet that has some (a replace with an empty
 * list, or deletes of every row) needs confirmWipe: true.
 */
function planTransactionChanges_(body) {
    const upserts = Array.isArray(body.upserts) ? body.upserts : [];
    const deletes = Array.isArray(body.deletes) ? body.deletes.map(String) : [];
    const replace = body.replace === true;

    if (!replace && !upserts.length && !deletes.length) return null;

    const existing = readTransactions_();
    // Rows by id, in sheet order (ids are unique in `order`).
    const rows = Object.create(null);
    const order = [];

    if (!replace) {
        existing.forEach(function (row) {
            const id = String(row.id);

            if (!(id in rows)) order.push(id);

            rows[id] = row;
        });
    }

    deletes.forEach(function (id) {
        delete rows[id];
    });

    upserts.forEach(function (item) {
        const row = cleanTransaction_(item);

        if (!row) return;

        if (!(row.id in rows)) {
            order.push(row.id);
            rows[row.id] = row;
        } else if (String(row.updatedAt) >= String(rows[row.id].updatedAt || '')) {
            rows[row.id] = row;
        }
    });

    // A deleted id stays in `order` but no longer has a row; an id deleted and upserted again
    // appears once.
    const written = Object.create(null);
    const list = order
        .filter(function (id) {
            if (!(id in rows) || id in written) return false;

            written[id] = true;

            return true;
        })
        .map(function (id) {
            return rows[id];
        });

    if (!list.length && existing.length && body.confirmWipe !== true) {
        throw new Error('Từ chối xóa toàn bộ giao dịch: yêu cầu không có confirmWipe');
    }

    list.forEach(assertTransactionFits_);

    return list;
}

/** The complete Meta rows a sync request leads to, or null when nothing changes. Reads only. */
function planMetaChanges_(incoming, force) {
    if (!incoming || typeof incoming !== 'object') return null;

    const keys = Object.keys(incoming);

    if (!keys.length) return null;

    const current = readMetaRows_();
    let changed = false;

    keys.forEach(function (key) {
        const entry = incoming[key];

        if (!key || !entry || typeof entry !== 'object') return;

        const text = JSON.stringify(entry.value === undefined ? null : entry.value);
        const updatedAt = String(entry.updatedAt || '');

        if (text.length > MAX_CELL_CHARS) {
            throw new Error('Dữ liệu "' + key + '" quá lớn để lưu trong một ô của Google Sheets');
        }

        assertCellFits_(key, 'Khóa meta');
        assertCellFits_(updatedAt, 'Dữ liệu "' + key + '" (updatedAt)');

        if (force || !current[key] || updatedAt >= current[key].updatedAt) {
            current[key] = { value: text, updatedAt: updatedAt };
            changed = true;
        }
    });

    return changed ? current : null;
}

/** The current data rows of a sheet, to put back with restoreDataRows_. */
function snapshotDataRows_(name, columns) {
    const sheet = getSheet_(name);
    const width = ensureHeader_(sheet, columns).length;
    const lastRow = sheet.getLastRow();

    return {
        name: name,
        sheet: sheet,
        width: width,
        rows: lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [],
    };
}

/** Puts a snapshot back; returns the error if that failed (null when it worked). */
function restoreDataRows_(snapshot) {
    try {
        replaceDataRows_(snapshot.sheet, snapshot.width, snapshot.rows, null, snapshot.name);
        return null;
    } catch (error) {
        return error;
    }
}

/**
 * Writes the planned rows. Apps Script has no transactions, so this is best effort: a failed write
 * puts its sheet back, a Meta write that fails after Transactions was rewritten puts Transactions
 * back, and when a rollback itself fails the error says so explicitly (restoreFailure_).
 */
function writeChanges_(transactions, meta) {
    if (transactions) {
        const before = meta ? snapshotDataRows_(TRANSACTIONS_SHEET, COLUMNS) : null;

        writeTransactions_(transactions);

        if (meta) {
            try {
                writeMetaRows_(meta);
            } catch (error) {
                const restoreError = restoreDataRows_(before);

                throw restoreError
                    ? restoreFailure_(error, TRANSACTIONS_SHEET, restoreError)
                    : error;
            }
        }
    } else if (meta) {
        writeMetaRows_(meta);
    }
}

/**
 * Applies a planned request. A request with a requestId is logged first (see REQUEST LOG), so a
 * failure at any later point - a failed write, a flush that throws, a log write that fails, an
 * execution that stops - can never make it look as if it had not run. Only a failed write whose
 * rollback was flushed successfully is known to have changed nothing; then the log entry is taken
 * out again.
 */
function applyChanges_(requestId, transactions, meta) {
    const logBefore = requestId ? startRequest_(requestId) : null;
    let failure = null;
    let flushFailure = null;

    try {
        writeChanges_(transactions, meta);
    } catch (error) {
        failure = error;
    }

    // Flushed on both paths: a rollback that is still pending is not "nothing changed" yet.
    try {
        SpreadsheetApp.flush();
    } catch (error) {
        flushFailure = error;
    }

    if (failure) {
        if (logBefore && !flushFailure && !failure.uncertain) abandonRequest_(logBefore);

        throw flushFailure ? uncertainFlush_(flushFailure, failure) : failure;
    }

    if (flushFailure) throw uncertainFlush_(flushFailure, null);

    if (requestId) finishRequest_(requestId);
}

/**
 * A sync request is checked as a whole before anything is written (planTransactionChanges_,
 * planMetaChanges_); the writes themselves are applyChanges_. A request that changes nothing
 * is not logged, so it cannot push real requests out of the log.
 */
function handleSync_(body) {
    if (!body || typeof body !== 'object' || !isAuthorized_(body.token)) {
        throw new Error('unauthorized');
    }

    validateSyncBody_(body);

    const requestId = body.requestId || '';
    const known = requestId ? findRequest_(readRequestLog_(), requestId) : null;

    if (known) {
        // Sent again. One that was applied is not applied a second time (a replace would drop what
        // another device added since, a delete would remove a row it re-created): only the current
        // state is returned. One whose outcome is not known is refused for the same reason.
        if (known[2] !== 'ok') {
            throw new Error(
                'Yêu cầu này đã được gửi trước đó và không rõ đã ghi xong chưa. Mở Google Sheet kiểm tra dữ liệu trước khi gửi lại.',
            );
        }

        return withApplied_(readState_(), true);
    }

    const transactions = planTransactionChanges_(body);
    const meta = planMetaChanges_(body.meta, body.replace === true);

    if (transactions || meta) applyChanges_(requestId, transactions, meta);

    let state;

    try {
        state = readState_();
    } catch (error) {
        throw new Error(
            'Đã ghi xong nhưng không đọc lại được trạng thái (' +
                String(error && error.message ? error.message : error) +
                '); app sẽ hỏi lại server trước khi gửi lại.',
        );
    }

    return body.appliedCheck
        ? withApplied_(state, requestStatus_(body.appliedCheck, body.appliedAfter))
        : state;
}

function withApplied_(state, applied) {
    state.applied = applied;

    return state;
}
