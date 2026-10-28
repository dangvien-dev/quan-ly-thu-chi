// Runs apps-script/Code.gs in a Node vm against an in-memory spreadsheet, so the backend logic can
// be tested without Google. Only the parts of the Apps Script API that Code.gs uses are mocked.
// This is a mock: it cannot prove the script behaves identically on Google's servers.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE_FILE = path.join(__dirname, '..', '..', 'apps-script', 'Code.gs');
// The script the repo owner had deployed before Code.gs (kept verbatim, see CLAUDE.md).
const USER_SCRIPT_FILE = path.join(__dirname, 'fixtures', 'user-script.gs');
const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const OFFSET_HOURS = 7; // Asia/Ho_Chi_Minh has no daylight saving

function createSheet(grid = []) {
    const sheet = {
        grid,
        formats: {},
        getLastColumn: () => Math.max(0, ...grid.map((row) => row.length)),
        getLastRow: () => grid.length,
        getMaxColumns: () => Math.max(26, sheet.getLastColumn()),
        getRange(row, column, rows = 1, columns = 1) {
            return {
                getValues: () =>
                    Array.from({ length: rows }, (_, i) =>
                        Array.from(
                            { length: columns },
                            (_, j) => (grid[row - 1 + i] || [])[column - 1 + j] ?? '',
                        ),
                    ),
                setValues: (values) =>
                    values.forEach((line, i) =>
                        line.forEach((value, j) => {
                            (grid[row - 1 + i] = grid[row - 1 + i] || [])[column - 1 + j] = value;
                        }),
                    ),
                clearContent: () => {
                    for (let i = 0; i < rows; i++) {
                        for (let j = 0; j < columns; j++) {
                            if (grid[row - 1 + i]) grid[row - 1 + i][column - 1 + j] = '';
                        }
                    }
                },
                setNumberFormat: (format) => {
                    sheet.formats[column] = format;
                },
            };
        },
        clearContents() {
            grid.length = 0;
        },
        /** Like Sheets, a "yyyy-mm-dd" string typed into a cell becomes a real date. */
        appendRow(row) {
            grid.push(
                row.map((value) =>
                    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
                        ? dateCell(value)
                        : value,
                ),
            );
        },
        getDataRange() {
            const width = sheet.getLastColumn();

            return {
                getValues: () =>
                    grid.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? '')),
            };
        },
    };

    return sheet;
}

/**
 * @param {object} options
 * @param {Record<string, any[][]>} [options.sheets] initial sheets by name (arrays of rows)
 * @param {Record<string, string>} [options.properties] Script Properties, e.g. { FM_TOKEN: 'x' }
 */
function createGas({ sheets = {}, properties = {}, codeFile = CODE_FILE } = {}) {
    const book = new Map(Object.entries(sheets).map(([name, grid]) => [name, createSheet(grid)]));
    const sandbox = {
        SpreadsheetApp: {
            getActiveSpreadsheet: () => ({
                getSheetByName: (name) => book.get(name) || null,
                insertSheet: (name) => {
                    const sheet = createSheet();

                    book.set(name, sheet);

                    return sheet;
                },
                getSpreadsheetTimeZone: () => TIME_ZONE,
            }),
        },
        LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
        PropertiesService: {
            getScriptProperties: () => ({ getProperty: (key) => properties[key] ?? null }),
        },
        ContentService: {
            MimeType: { JSON: 'json', JAVASCRIPT: 'javascript' },
            createTextOutput: (text) => ({
                text,
                setMimeType() {
                    return this;
                },
            }),
        },
        Utilities: {
            formatDate: (date) =>
                new Date(date.getTime() + OFFSET_HOURS * 3600e3).toISOString().slice(0, 10),
            parseDate: (text) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`Cannot parse "${text}"`);

                return new Date(Date.parse(`${text}T00:00:00+0${OFFSET_HOURS}:00`));
            },
        },
        JSON,
        String,
        Array,
        Date,
        Error,
        Math,
        Object,
        Number,
    };

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(codeFile, 'utf8'), sandbox, {
        filename: path.basename(codeFile),
    });

    const respond = (output) => JSON.parse(output.text);

    return {
        book,
        sheet: (name) => book.get(name),
        /** GET request; returns the parsed JSON body. */
        get: (parameter = {}) => respond(sandbox.doGet({ parameter })),
        /** GET request; returns the raw response text (for JSONP or non-JSON replies). */
        getText: (parameter = {}) => sandbox.doGet({ parameter }).text,
        /** POST with a raw string body; returns the raw response text. */
        postText: (contents, parameter = {}) =>
            sandbox.doPost({ parameter, postData: { contents } }).text,
        /** POST request with a JSON body; returns the parsed JSON response. */
        post: (body, parameter = {}) =>
            respond(sandbox.doPost({ parameter, postData: { contents: JSON.stringify(body) } })),
        /** POST with a raw string body. */
        postRaw: (contents) => respond(sandbox.doPost({ parameter: {}, postData: { contents } })),
    };
}

/** A real date cell value for a calendar day, like Sheets returns for a date column. */
const dateCell = (isoDay) => new Date(Date.parse(`${isoDay}T00:00:00+0${OFFSET_HOURS}:00`));

/** Rows as objects -> sheet grid with a header, dates as real date cells. */
function gridFromRows(
    rows,
    header = ['id', 'date', 'type', 'source', 'category', 'amount', 'note'],
) {
    return [
        header,
        ...rows.map((row) =>
            header.map((name) => {
                const value = row[name] ?? '';

                return name === 'date' && value
                    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? dateCell(value) : value)
                    : value;
            }),
        ),
    ];
}

module.exports = { createGas, dateCell, gridFromRows, CODE_FILE, USER_SCRIPT_FILE, TIME_ZONE };
