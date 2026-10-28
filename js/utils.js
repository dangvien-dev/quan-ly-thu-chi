// Pure helpers shared by the other modules: HTML escaping, formatting, dates, and normalization.

const TRANSACTION_TYPES = ['income', 'expense', 'transfer'];

/**
 * Escape text before it is interpolated into innerHTML.
 * Notes, categories, and ids can come from Google Sheets or an imported backup.
 */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatMoney(amount) {
    return Math.round(Number(amount) || 0).toLocaleString('vi-VN') + ' đ';
}

function padTwoDigits(value) {
    return String(value).padStart(2, '0');
}

/** Format a date as YYYY-MM-DD using the device time zone (toISOString would use UTC). */
function toLocalDateString(date = new Date()) {
    return `${date.getFullYear()}-${padTwoDigits(date.getMonth() + 1)}-${padTwoDigits(date.getDate())}`;
}

function currentMonthKey() {
    return toLocalDateString().slice(0, 7);
}

function shiftMonthKey(monthKey, offset) {
    const [year, month] = monthKey.split('-').map(Number);

    return toLocalDateString(new Date(year, month - 1 + offset, 1)).slice(0, 7);
}

/**
 * Convert any stored date (YYYY-MM-DD, DD/MM/YYYY, or the UTC ISO string Google Sheets returns
 * for a date cell) to a local YYYY-MM-DD string. Returns '' when it cannot be parsed.
 */
function normalizeDate(value) {
    const text = String(value ?? '').trim();

    if (!text) return '';

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

    const vietnamese = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

    if (vietnamese) {
        return `${vietnamese[3]}-${padTwoDigits(vietnamese[2])}-${padTwoDigits(vietnamese[1])}`;
    }

    const parsed = new Date(text);

    return Number.isNaN(parsed.getTime()) ? '' : toLocalDateString(parsed);
}

function parseAmount(value) {
    if (typeof value === 'number') return value;

    const text = String(value ?? '').trim();

    if (!text) return NaN;

    // Plain numbers ("224500", "17000.5") are read as-is; "224.500" / "224,500" as grouped digits.
    if (/^-?\d+(\.\d{1,2})?$/.test(text)) return Number(text);

    return Number(text.replace(/[.,\s]/g, ''));
}

/**
 * Coerce a raw row (local storage, Google Sheets, or backup) to the shape the app expects.
 * Returns null for rows that are not transactions, such as blank spreadsheet rows.
 */
function normalizeTransaction(raw, index = 0) {
    if (!raw || typeof raw !== 'object') return null;

    const type = String(raw.type ?? '').trim();
    const amount = parseAmount(raw.amount);

    if (!TRANSACTION_TYPES.includes(type) || !Number.isFinite(amount)) return null;

    return {
        id: String(raw.id ?? '').trim() || `TX_${Date.now()}_${index}`,
        date: normalizeDate(raw.date),
        type,
        source: String(raw.source ?? ''),
        targetSource: type === 'transfer' && raw.targetSource ? String(raw.targetSource) : null,
        category: String(raw.category ?? ''),
        amount,
        note: String(raw.note ?? ''),
    };
}

function normalizeTransactions(list) {
    if (!Array.isArray(list)) return [];

    const seenIds = new Set();
    const result = [];

    list.forEach((raw, index) => {
        const transaction = normalizeTransaction(raw, index);

        if (transaction && !seenIds.has(transaction.id)) {
            seenIds.add(transaction.id);
            result.push(transaction);
        }
    });

    return result;
}

/** Ids look like TX_<epoch ms>; use the timestamp to order transactions on the same day. */
function transactionTimestamp(transaction) {
    return Number(String(transaction.id).replace(/\D/g, '').slice(0, 13)) || 0;
}

function compareNewestFirst(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;

    return transactionTimestamp(b) - transactionTimestamp(a);
}
