/**
 * FinManager - Google Apps Script backend for the "Transactions" sheet.
 *
 * Setup
 *  1. Open the spreadsheet > Extensions > Apps Script and paste this file.
 *  2. Deploy > New deployment > type "Web app" > Execute as: Me > Who has access: Anyone.
 *  3. Copy the /exec URL into FinManager (Cài đặt & Dữ liệu > Web App URL).
 *  After editing the script use Deploy > Manage deployments > Edit > New version.
 *
 * Contract used by js/sync.js
 *  GET  -> JSON array of transactions.
 *  POST -> text/plain body {"action":"save","data":[...]} replaces every row of the sheet and
 *          returns {"ok":true,"rows":n}. Errors are returned as {"error":"..."}.
 *
 * The "Transactions" sheet is fully managed by the app: rows are rewritten on every save.
 * Columns A-G keep their original order; "targetSource" is appended so transfers keep their
 * destination account.
 */

const SHEET_NAME = 'Transactions';
const COLUMNS = ['id', 'date', 'type', 'source', 'category', 'amount', 'note', 'targetSource'];
// Stored as plain text so a note such as "=1+1" or "+50k" is never evaluated as a formula.
const TEXT_COLUMNS = ['id', 'type', 'source', 'category', 'note', 'targetSource'];
const DATE_FORMAT = 'yyyy-MM-dd';

function doGet() {
    return jsonResponse_(readTransactions_());
}

function doPost(e) {
    const lock = LockService.getScriptLock();

    lock.waitLock(20000);

    try {
        const request = JSON.parse(e.postData.contents);

        if (request.action !== 'save' || !Array.isArray(request.data)) {
            throw new Error('Yêu cầu không hợp lệ');
        }

        writeTransactions_(request.data);

        return jsonResponse_({ ok: true, rows: request.data.length });
    } catch (error) {
        return jsonResponse_({ error: String(error && error.message ? error.message : error) });
    } finally {
        lock.releaseLock();
    }
}

function jsonResponse_(payload) {
    return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
        ContentService.MimeType.JSON,
    );
}

function getSheet_() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    return spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
}

function getTimeZone_() {
    return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
}

/** Returns the header row, appending any column from COLUMNS that the sheet does not have yet. */
function ensureHeader_(sheet) {
    const width = sheet.getLastColumn();
    const header = width ? sheet.getRange(1, 1, 1, width).getValues()[0].map(String) : [];
    const missing = COLUMNS.filter(function (name) {
        return header.indexOf(name) === -1;
    });

    if (missing.length) {
        sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
        header.push.apply(header, missing);
    }

    return header;
}

function readTransactions_() {
    const sheet = getSheet_();
    const header = ensureHeader_(sheet);
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
    const sheet = getSheet_();
    const header = ensureHeader_(sheet);
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
            column.setNumberFormat('yyyy-mm-dd');
        }
    });

    sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
}
