/**
 * FinManager - Google Apps Script backend (protocol v2, backward compatible).
 *
 * Setup
 *  1. Open the spreadsheet > Extensions > Apps Script and paste this file (replace the old code).
 *  2. Deploy > New deployment (or Manage deployments > Edit > New version) > type "Web app" >
 *     Execute as: Me > Who has access: Anyone. Copy the /exec URL into FinManager
 *     (Cài đặt & Dữ liệu > Web App URL).
 *  3. Recommended: Project Settings > Script properties > add FM_TOKEN with a long random secret,
 *     then enter the same value in FinManager ("Mã bảo vệ"). Without a token anyone who learns
 *     the URL can read and overwrite the data.
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
 *    GET  ?action=sync&payload=<json>     -> same as the POST (fallback when a POST is blocked).
 *  Legacy (the original script's requests, so older clients keep working)
 *    GET                                  -> JSON array of transactions
 *    POST {"transactions": [...]}         -> replaces every row
 *    GET  ?action=save&data=<json array>  -> replaces every row
 *
 * Nothing is ever cleared before the request has been validated: a malformed body is rejected
 * and the sheet is left untouched. Errors are returned as {"error": "..."}.
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
            return jsonResponse_(withLock_(() => replaceAllTransactions_(JSON.parse(params.data))));
        }

        return jsonResponse_(params.v === '2' ? readState_() : readTransactions_());
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
            return jsonResponse_(withLock_(() => replaceAllTransactions_(body.transactions)));
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
        return action();
    } finally {
        lock.releaseLock();
    }
}

function isAuthorized_(token) {
    const expected = PropertiesService.getScriptProperties().getProperty('FM_TOKEN');

    return !expected || String(token || '') === expected;
}

function getSheet_(name) {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function getTimeZone_() {
    return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
}

/** Returns the header row, appending any column from `columns` the sheet does not have yet. */
function ensureHeader_(sheet, columns) {
    const width = sheet.getLastColumn();
    const header = width ? sheet.getRange(1, 1, 1, width).getValues()[0].map(String) : [];
    const missing = columns.filter(function (name) {
        return header.indexOf(name) === -1;
    });

    if (missing.length) {
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

function writeTransactions_(list) {
    const sheet = getSheet_(TRANSACTIONS_SHEET);
    const header = ensureHeader_(sheet, COLUMNS);
    const timeZone = getTimeZone_();
    const lastRow = sheet.getLastRow();

    if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, header.length).clearContent();
    }

    if (!list.length) return;

    const rows = list.map(function (item) {
        return header.map(function (name) {
            const value = item[name];

            if (value === undefined || value === null) return '';

            return name === 'date' ? toDateCell_(value, timeZone) : value;
        });
    });

    header.forEach(function (name, index) {
        const column = sheet.getRange(2, index + 1, rows.length, 1);

        if (TEXT_COLUMNS.indexOf(name) !== -1) {
            column.setNumberFormat('@');
        } else if (name === 'date') {
            column.setNumberFormat('dd/mm/yyyy');
        }
    });

    sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
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
function replaceAllTransactions_(list) {
    if (!Array.isArray(list)) throw new Error('Yêu cầu không hợp lệ');

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
    const lastRow = sheet.getLastRow();
    const keys = Object.keys(rows);

    if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, header.length).clearContent();
    }

    if (!keys.length) return;

    sheet.getRange(2, 1, keys.length, header.length).setNumberFormat('@');
    sheet.getRange(2, 1, keys.length, header.length).setValues(
        keys.map(function (key) {
            return header.map(function (name) {
                return name === 'key' ? key : rows[key][name];
            });
        }),
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
        serverTime: new Date().toISOString(),
    };
}

function applyTransactionChanges_(body) {
    const upserts = Array.isArray(body.upserts) ? body.upserts : [];
    const deletes = Array.isArray(body.deletes) ? body.deletes.map(String) : [];
    const replace = body.replace === true;

    if (!replace && !upserts.length && !deletes.length) return;

    // Rows by id, in sheet order (ids are unique in `order`).
    const rows = Object.create(null);
    const order = [];

    if (!replace) {
        readTransactions_().forEach(function (row) {
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

    writeTransactions_(
        order
            .filter(function (id) {
                if (!(id in rows) || id in written) return false;

                written[id] = true;

                return true;
            })
            .map(function (id) {
                return rows[id];
            }),
    );
}

function applyMetaChanges_(incoming, force) {
    if (!incoming || typeof incoming !== 'object') return;

    const keys = Object.keys(incoming);

    if (!keys.length) return;

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

        if (force || !current[key] || updatedAt >= current[key].updatedAt) {
            current[key] = { value: text, updatedAt: updatedAt };
            changed = true;
        }
    });

    if (changed) writeMetaRows_(current);
}

function handleSync_(body) {
    if (!body || typeof body !== 'object' || !isAuthorized_(body.token)) {
        throw new Error('unauthorized');
    }

    applyTransactionChanges_(body);
    applyMetaChanges_(body.meta, body.replace === true);

    return readState_();
}
