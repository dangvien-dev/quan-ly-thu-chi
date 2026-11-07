// Pure helpers shared by the other modules: HTML escaping, formatting, dates, and normalization.

const TRANSACTION_TYPES = ['income', 'expense', 'transfer'];
// Category recorded on every transfer (a transfer has no category of its own).
const TRANSFER_CATEGORY = 'Chuyển tiền nội bộ';

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
        updatedAt: String(raw.updatedAt ?? ''),
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

// --- SOURCES (money accounts) ---

// debt: a negative balance on this kind of source is money owed.
// saving: a savings book; its money is set aside, so it is left out of the available balance.
const SOURCE_KINDS = {
    cash: { label: 'Tiền mặt', debt: false },
    bank: { label: 'Ngân hàng', debt: false },
    ewallet: { label: 'Ví điện tử', debt: false },
    savings: { label: 'Sổ tiết kiệm', debt: false, saving: true },
    credit: { label: 'Thẻ tín dụng / Trả sau', debt: true },
    debt: { label: 'Khoản nợ', debt: true },
    other: { label: 'Khác', debt: false },
};

/**
 * Move the item at `index` one place up (step -1) or down (step 1): it swaps with the nearest item
 * on that side that `isNeighbour(candidate, moving)` accepts, and everything between stays put.
 * Returns a new array, or the same one when there is nowhere to go.
 */
function moveInList(list, index, step, isNeighbour = () => true) {
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return list;
    if (step !== -1 && step !== 1) return list;

    for (let target = index + step; target >= 0 && target < list.length; target += step) {
        if (isNeighbour(list[target], list[index])) {
            const next = [...list];

            [next[index], next[target]] = [next[target], next[index]];

            return next;
        }
    }

    return list;
}

function dayOfMonthOrNull(value) {
    const day = Math.round(Number(value));

    return Number.isFinite(day) && day >= 1 && day <= 31 ? day : null;
}

/** Coerce a stored source (the old format was a plain name string) to its current shape. */
function normalizeSource(raw) {
    const source = typeof raw === 'string' ? { name: raw } : raw;
    const name = String((source && source.name) ?? '').trim();

    if (!name) return null;

    const kind = Object.hasOwn(SOURCE_KINDS, source.kind) ? source.kind : 'other';
    const lastStatement = kind === 'credit' ? normalizeLastStatement(source.lastStatement) : null;

    return {
        name,
        kind,
        creditLimit: kind === 'credit' ? Math.max(0, Number(source.creditLimit) || 0) : 0,
        statementDay: kind === 'credit' ? dayOfMonthOrNull(source.statementDay) : null,
        dueDay: kind === 'credit' ? dayOfMonthOrNull(source.dueDay) : null,
        archived: Boolean(source.archived),
        // Only present when the person gave it, so older sources keep their shape.
        ...(lastStatement ? { lastStatement } : {}),
    };
}

/**
 * The closing balance printed on a card's last statement: { date: statement day (YYYY-MM-DD),
 * balance: what was owed that day, as a positive whole number }. Null when it is not usable.
 */
function normalizeLastStatement(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const date = normalizeDate(raw.date);
    const balance = parseAmount(raw.balance);

    if (!date || !Number.isFinite(balance) || balance < 0) return null;

    return { date, balance: Math.round(balance) };
}

/** Returns null when the value is not a usable list, so callers can fall back to defaults. */
function normalizeSources(list) {
    if (!Array.isArray(list)) return null;

    const seen = new Set();
    const result = [];

    list.forEach((raw) => {
        const source = normalizeSource(raw);

        if (source && !seen.has(source.name)) {
            seen.add(source.name);
            result.push(source);
        }
    });

    return result.length ? result : null;
}

function normalizeCategories(list) {
    if (!Array.isArray(list)) return null;

    return list.filter(
        (category) =>
            category &&
            category.name &&
            (category.type === 'income' || category.type === 'expense'),
    );
}

/**
 * Opening balance that makes a source show `target` today. The transactions stay as they are, so
 * only the opening balance moves: target - (balance - opening) = target - sum of transactions.
 */
function openingBalanceToMatch({ target, balance, opening = 0 }) {
    return target - (balance - opening);
}

/** Balance (negative = owed) of a credit line from its limit and the amount still available. */
function balanceFromAvailable(limit, available) {
    return available - limit;
}

/** { sourceName: openingBalance } with only finite numbers kept. */
function normalizeBalances(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    return Object.fromEntries(
        Object.entries(value)
            .map(([name, amount]) => [name, Number(amount)])
            .filter(([, amount]) => Number.isFinite(amount)),
    );
}

/** The next date (today included) whose day of month is `day`, clamped to short months. */
function nextDayOfMonth(day, from = new Date()) {
    const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());

    for (let offset = 0; offset < 3; offset++) {
        const lastDay = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0).getDate();
        const candidate = new Date(
            today.getFullYear(),
            today.getMonth() + offset,
            Math.min(day, lastDay),
        );

        if (candidate >= today) return candidate;
    }

    return today;
}

function daysUntil(date, from = new Date()) {
    const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());

    return Math.round((date - today) / 86400000);
}

function describeDaysUntil(days) {
    return days === 0 ? 'hôm nay' : `còn ${days} ngày`;
}

// --- FILTERING, SEARCH AND CSV EXPORT ---

/** Lower-case text without diacritics, so "ca phe" finds "Cà phê" and "d" finds "đ". */
function normalizeSearchText(value) {
    return String(value ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/\s+/g, ' ')
        .trim();
}

// --- TAGS ---
// A tag is a word written in the note: "#khachA". It lives in the note, not in a field of its own,
// so the Sheet (old and new script), the CSV and a backup all carry it, and searching the note
// finds it. A tag starts with a letter and goes on with letters, digits, "_" or "-" (30 at most);
// "#12" (a room number) is plain text.
const MAX_TAGS = 10;
const TAG_WORD = /^\p{L}[\p{L}\p{N}_-]{0,29}$/u;

const tagKey = (tag) => String(tag).toLocaleLowerCase('vi');

/** The tags without repeats ("KhachA" and "khacha" are one tag; the first spelling stays). */
function uniqueTags(tags) {
    const seen = new Set();

    return tags.filter((tag) => {
        const key = tagKey(tag);

        if (seen.has(key)) return false;

        seen.add(key);

        return true;
    });
}

/** Split a note into its plain text and its tags (words "#tag"); the other words keep their order. */
function extractTags(note) {
    const tags = [];
    const rest = [];

    String(note ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .forEach((word) => {
            if (word.startsWith('#') && TAG_WORD.test(word.slice(1))) tags.push(word.slice(1));
            else rest.push(word);
        });

    return { text: rest.join(' '), tags: uniqueTags(tags) };
}

/** Read what was typed in the tags field: "khachA, #dh102  hoa-don" → tags, plus the bad words. */
function parseTagInput(input) {
    const tags = [];
    const invalid = [];

    String(input ?? '')
        .split(/[\s,;]+/)
        .map((word) => word.replace(/^#+/, ''))
        .filter(Boolean)
        .forEach((word) => (TAG_WORD.test(word) ? tags : invalid).push(word));

    return { tags: uniqueTags(tags), invalid };
}

/** The note as it is stored: the text, then the tags as "#tag" words. */
function composeNote(text, tags) {
    return [String(text ?? '').trim(), ...tags.map((tag) => `#${tag}`)].filter(Boolean).join(' ');
}

/** Every tag in use with how many transactions carry it, the most used first. */
function collectTags(list) {
    const found = new Map();

    list.forEach((transaction) => {
        extractTags(transaction.note).tags.forEach((tag) => {
            const entry = found.get(tagKey(tag));

            if (entry) entry.count++;
            else found.set(tagKey(tag), { tag, count: 1 });
        });
    });

    return [...found.values()].sort(
        (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'vi'),
    );
}

/**
 * Money per tag for the transactions whose date starts with `prefix` ('' = all, 'YYYY' = a year,
 * 'YYYY-MM' = a month): how many, income, expense, net (income - expense) and the latest date.
 * A transaction with two tags counts for both. Transfers are not profit or loss, so they only
 * count as a transaction. Most recently used first.
 */
function computeTagReport(list, prefix = '') {
    const rows = new Map();

    list.forEach((transaction) => {
        if (prefix && !transaction.date.startsWith(prefix)) return;

        extractTags(transaction.note).tags.forEach((tag) => {
            const key = tagKey(tag);
            const row = rows.get(key) || { tag, count: 0, income: 0, expense: 0, last: '' };

            row.count++;

            if (transaction.type === 'income') row.income += transaction.amount;
            else if (transaction.type === 'expense') row.expense += transaction.amount;

            if (transaction.date > row.last) row.last = transaction.date;

            rows.set(key, row);
        });
    });

    return [...rows.values()]
        .map((row) => ({ ...row, net: row.income - row.expense }))
        .sort((a, b) => b.last.localeCompare(a.last) || a.tag.localeCompare(b.tag, 'vi'));
}

/**
 * The note with one tag renamed. Giving a tag that is already on the note merges the two into
 * one; the plain text is kept. A note without the tag comes back unchanged (the same string).
 */
function renameTagInNote(note, fromTag, toTag) {
    const { text, tags } = extractTags(note);
    const from = tagKey(fromTag);

    if (!tags.some((tag) => tagKey(tag) === from)) return note;

    return composeNote(text, uniqueTags(tags.map((tag) => (tagKey(tag) === from ? toTag : tag))));
}

/**
 * Check a new name typed for a tag. Returns { error }, or { tag, merge }: `tag` is the spelling to
 * write (the one already in use when the name is another existing tag) and `merge` is true when
 * that other tag exists, so the transactions join it instead of getting a new name.
 */
function planTagRename(list, fromTag, input) {
    const { tags, invalid } = parseTagInput(input);

    if (invalid.length || tags.length !== 1) {
        return {
            error: 'Nhập đúng một thẻ: bắt đầu bằng chữ, chỉ gồm chữ, số, "_" hoặc "-", tối đa 30 ký tự.',
        };
    }

    const wanted = tags[0];

    if (wanted === fromTag) return { error: 'Tên mới giống tên cũ.' };

    // Only a change of capitals ("khachA" → "KhachA") keeps the same tag, so it is never a merge.
    if (tagKey(wanted) === tagKey(fromTag)) return { tag: wanted, merge: false };

    const existing = collectTags(list).find((entry) => tagKey(entry.tag) === tagKey(wanted));

    return existing ? { tag: existing.tag, merge: true } : { tag: wanted, merge: false };
}

function transactionSearchText(transaction) {
    return normalizeSearchText(
        [
            transaction.note,
            transaction.category,
            transaction.source,
            transaction.targetSource,
            transaction.date,
            formatDateDisplay(transaction.date),
            transaction.amount,
            formatMoney(transaction.amount),
        ].join(' '),
    );
}

/**
 * filters: { month: 'YYYY-MM', from, to (YYYY-MM-DD, inclusive), type, category, source, sources,
 * tag, search }; empty or 'ALL' means no filter. tag keeps the transactions that carry that tag (spelling and case do not matter). source matches either side of a transfer; sources (a list of names) keeps transactions
 * that touch any of them on either side; every word of search must match.
 */
function filterTransactions(list, filters = {}) {
    const words = normalizeSearchText(filters.search).split(' ').filter(Boolean);
    const active = (value) => value && value !== 'ALL';

    return list.filter((transaction) => {
        if (filters.month && !transaction.date.startsWith(filters.month)) return false;
        if (filters.from && transaction.date < filters.from) return false;
        if (filters.to && transaction.date > filters.to) return false;
        if (active(filters.type) && transaction.type !== filters.type) return false;
        if (active(filters.category) && transaction.category !== filters.category) return false;

        if (
            active(filters.source) &&
            transaction.source !== filters.source &&
            transaction.targetSource !== filters.source
        ) {
            return false;
        }

        if (active(filters.tag)) {
            const wanted = tagKey(filters.tag);

            if (!extractTags(transaction.note).tags.some((tag) => tagKey(tag) === wanted)) {
                return false;
            }
        }

        if (
            Array.isArray(filters.sources) &&
            !filters.sources.includes(transaction.source) &&
            !filters.sources.includes(transaction.targetSource)
        ) {
            return false;
        }

        if (words.length) {
            const haystack = transactionSearchText(transaction);

            return words.every((word) => haystack.includes(word));
        }

        return true;
    });
}

const CSV_HEADER = [
    'Ngày',
    'Loại',
    'Nguồn tiền',
    'Nguồn nhận',
    'Danh mục',
    'Số tiền',
    'Ghi chú',
    'Thẻ',
];
const CSV_TYPE_LABELS = { income: 'Thu', expense: 'Chi', transfer: 'Chuyển' };

/**
 * One CSV field. Text starting with = + - @ is prefixed with an apostrophe so a spreadsheet
 * cannot run it as a formula (CSV injection).
 */
function csvCell(value, { isText = true } = {}) {
    let text = String(value ?? '');

    if (isText && /^[=+\-@\t\r]/.test(text)) {
        text = `'${text}`;
    }

    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 CSV with a BOM, which Excel needs to show Vietnamese text correctly. */
function buildTransactionsCsv(list) {
    const lines = [CSV_HEADER.map((name) => csvCell(name))].concat(
        list.map((transaction) => [
            csvCell(formatDateDisplay(transaction.date)),
            csvCell(CSV_TYPE_LABELS[transaction.type]),
            csvCell(transaction.source),
            csvCell(transaction.targetSource),
            csvCell(transaction.category),
            csvCell(transaction.amount, { isText: false }),
            // The note keeps its #tags as typed; the last column lists them again for a pivot table.
            csvCell(transaction.note),
            csvCell(
                extractTags(transaction.note)
                    .tags.map((tag) => `#${tag}`)
                    .join(' '),
            ),
        ]),
    );

    return '\uFEFF' + lines.map((line) => line.join(',')).join('\r\n') + '\r\n';
}

// --- BANK STATEMENT IMPORT (CSV) ---
// A statement is read in four steps, each a pure function: parseCsvText (cells), detectCsvLayout
// (which column is what), buildImportItems (transaction candidates) and markImportDuplicates
// (what is already in the book). Nothing here touches the page.

const MAX_IMPORT_ROWS = 2000;
// A bank posts a purchase a day or two after the user typed it, so the same amount this close
// is probably the same transaction.
const IMPORT_DUPLICATE_DAYS = 2;
// A statement rounds a fraction of a đồng (582.719,50 of a USD purchase) one way and a person types
// it the other (582.719), so an amount 1 đ off is still the same one, from this size up (below it
// 1 đ is a different amount: an interest of 1 đ is not one of 2 đ).
const IMPORT_AMOUNT_TOLERANCE = 1;
const IMPORT_AMOUNT_TOLERANCE_FROM = 1000;
const IMPORT_FALLBACK_CATEGORIES = { expense: 'Chưa phân loại', income: 'Thu nhập khác' };

function countOutsideQuotes(line, char) {
    let quoted = false;
    let count = 0;

    for (const current of line) {
        if (current === '"') quoted = !quoted;
        else if (current === char && !quoted) count++;
    }

    return count;
}

/**
 * The delimiter a CSV uses: the one that splits the first lines into the same number of cells most
 * often. (Counting commas alone fails on "1,234,567" amounts in a semicolon file.)
 */
function detectCsvDelimiter(text) {
    const lines = String(text ?? '')
        .split(/\r\n|\n|\r/)
        .filter((line) => line.trim())
        .slice(0, 20);
    let best = ',';
    let bestScore = 0;

    [',', ';', '\t', '|'].forEach((candidate) => {
        const frequency = new Map();

        lines.forEach((line) => {
            const count = countOutsideQuotes(line, candidate);

            if (count > 0) frequency.set(count, (frequency.get(count) || 0) + 1);
        });

        frequency.forEach((lineCount, cells) => {
            if (lineCount * cells > bestScore) {
                bestScore = lineCount * cells;
                best = candidate;
            }
        });
    });

    return best;
}

/**
 * CSV text → rows of trimmed cells. Handles quotes and "" inside them, line breaks inside a quoted
 * cell, CR / LF / CRLF, a BOM, and blank lines (dropped). The delimiter is detected unless given.
 */
function parseCsvText(text, delimiter = '') {
    const source = String(text ?? '').replace(/^﻿/, '');
    const separator = delimiter || detectCsvDelimiter(source);
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;

    const endCell = () => {
        row.push(cell.trim());
        cell = '';
    };
    const endRow = () => {
        endCell();

        if (row.some((value) => value !== '')) rows.push(row);

        row = [];
    };

    for (let index = 0; index < source.length; index++) {
        const char = source[index];

        if (quoted) {
            if (char !== '"') cell += char;
            else if (source[index + 1] === '"') {
                cell += '"';
                index++;
            } else quoted = false;
        } else if (char === '"' && cell.trim() === '') {
            quoted = true;
            cell = '';
        } else if (char === separator) {
            endCell();
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && source[index + 1] === '\n') index++;

            endRow();
        } else {
            cell += char;
        }
    }

    if (cell !== '' || row.length) endRow();

    return rows;
}

function validDateKey(year, month, day) {
    const date = new Date(year, month - 1, day);

    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return '';
    }

    return toLocalDateString(date);
}

/**
 * A date as banks write it → YYYY-MM-DD, or '' when it is not one. Day comes first
 * (27/10/2026, 27-10-26, 27.10.2026), the year-first forms are read too, and a time after the
 * date is ignored. 03/04/2026 is the 3rd of April: statements here are day-first.
 */
function parseBankDate(value) {
    const text = String(value ?? '').trim();
    const yearFirst = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[\sT].*)?$/);

    if (yearFirst) return validDateKey(+yearFirst[1], +yearFirst[2], +yearFirst[3]);

    const dayFirst = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:[\s,T].*)?$/);

    if (!dayFirst) return '';

    const year = dayFirst[3].length === 2 ? 2000 + Number(dayFirst[3]) : Number(dayFirst[3]);

    return validDateKey(year, +dayFirst[2], +dayFirst[1]);
}

/**
 * An amount as banks write it → its exact value (NaN when it is not a number); parseBankAmount
 * rounds it to a whole number of đồng.
 * "1.234.567", "1,234,567", "1.234.567,89", "1,234,567.89", "-250.000", "(250.000)", "250000 VND"
 * and "+1.000.000" are all understood. A lone separator followed by exactly three digits is a
 * thousands mark ("1.234" is 1234), otherwise it is a decimal point ("1234.5").
 */
function parseBankNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;

    let text = String(value ?? '')
        .replace(/[\s ]/g, '')
        .replace(/(vnd|vnđ|đ)$/i, '');
    let negative = false;

    if (/^\(.*\)$/.test(text)) {
        negative = true;
        text = text.slice(1, -1);
    }

    if (/^[-−–]/.test(text)) {
        negative = !negative;
        text = text.slice(1);
    } else if (text.startsWith('+')) {
        text = text.slice(1);
    }

    if (/-$/.test(text)) {
        negative = !negative;
        text = text.slice(0, -1);
    }

    if (!/^\d[\d.,]*$/.test(text)) return NaN;

    const dots = text.split('.').length - 1;
    const commas = text.split(',').length - 1;
    let number;

    if (dots && commas) {
        const decimal = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
        const grouping = decimal === '.' ? ',' : '.';

        if (text.split(decimal).length > 2) return NaN;

        number = Number(text.split(grouping).join('').replace(decimal, '.'));
    } else if (dots || commas) {
        const mark = dots ? '.' : ',';
        const parts = text.split(mark);

        if (parts.length > 2) {
            if (!parts.slice(1).every((part) => part.length === 3)) return NaN;

            number = Number(parts.join(''));
        } else if (parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0') {
            number = Number(parts.join(''));
        } else {
            number = Number(`${parts[0]}.${parts[1]}`);
        }
    } else {
        number = Number(text);
    }

    if (!Number.isFinite(number)) return NaN;

    return negative ? -number : number;
}

/** parseBankNumber rounded to a whole number of đồng. */
function parseBankAmount(value) {
    const number = parseBankNumber(value);

    if (Number.isNaN(number)) return NaN;

    // Round the size, then give it the sign: Math.round(-0.5) is -0 but Math.round(0.5) is 1.
    const rounded = Math.round(Math.abs(number));

    return (number < 0 ? -rounded : rounded) || 0;
}

// Header words of a statement, as written by Vietnamese and international banks (accents and
// case are ignored). The longest phrase that fits wins, so "so tien ghi no" is a debit column and
// not just an "amount".
const IMPORT_COLUMN_KEYWORDS = {
    date: [
        'ngay giao dich',
        'ngay hach toan',
        'ngay gd',
        'transaction date',
        'posting date',
        'booking date',
        'value date',
        'thoi gian',
        'ngay',
        'date',
    ],
    description: [
        'noi dung giao dich',
        'noi dung',
        'dien giai',
        'mo ta',
        'chi tiet giao dich',
        'chi tiet',
        'transaction details',
        'description',
        'narrative',
        'details',
        'remarks',
        'ghi chu',
    ],
    debit: [
        'so tien ghi no',
        'so tien rut',
        'so tien chi',
        'ghi no',
        'tien ra',
        'rut ra',
        'chi ra',
        'debit',
        'withdrawal',
        'withdrawals',
        'no',
    ],
    credit: [
        'so tien ghi co',
        'so tien gui',
        'so tien thu',
        'ghi co',
        'tien vao',
        'gui vao',
        'thu vao',
        'credit',
        'deposit',
        'deposits',
        'co',
    ],
    amount: [
        'so tien thanh toan vnd',
        'payment amount vnd',
        'so tien thanh toan',
        'payment amount',
        'so tien giao dich',
        'gia tri giao dich',
        'so tien quy doi',
        'so tien vnd',
        'quy doi',
        'billing amount',
        'so tien',
        'amount',
        'gia tri',
        'value',
    ],
    balance: ['so du cuoi', 'so du', 'balance'],
    reference: [
        'ma giao dich',
        'so tham chieu',
        'so but toan',
        'transaction id',
        'reference',
        'ma gd',
        'ref',
    ],
};
const IMPORT_FIELD_ORDER = [
    'date',
    'debit',
    'credit',
    'amount',
    'description',
    'reference',
    'balance',
];

// A header naming another currency ("Số tiền ngoại tệ", "Amount USD") is not the amount in đồng.
const IMPORT_FOREIGN_WORDS = [
    'ngoai te',
    'nguyen te',
    'foreign',
    'original',
    'usd',
    'eur',
    'jpy',
    'sgd',
    'aud',
    'gbp',
    'cny',
    'krw',
];
const IMPORT_MONEY_FIELDS = ['debit', 'credit', 'amount'];

/** How well a header cell fits a field: 0 for no match, higher for a longer or exact phrase. */
function importHeaderScore(cell, field) {
    const words = normalizeSearchText(cell)
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    let best = 0;

    if (
        IMPORT_MONEY_FIELDS.includes(field) &&
        IMPORT_FOREIGN_WORDS.some((word) => ` ${words} `.includes(` ${word} `))
    ) {
        return 0;
    }

    IMPORT_COLUMN_KEYWORDS[field].forEach((keyword) => {
        if (words === keyword) best = Math.max(best, 100 + keyword.length);
        else if (` ${words} `.includes(` ${keyword} `)) best = Math.max(best, keyword.length);
    });

    return best;
}

/** { field: column index } for one row read as a header row (fields it has no column for are left out). */
function matchImportHeader(row) {
    const scores = [];

    row.forEach((cell, column) => {
        IMPORT_FIELD_ORDER.forEach((field) => {
            const score = importHeaderScore(cell, field);

            if (score > 0) scores.push({ field, column, score });
        });
    });

    scores.sort((a, b) => b.score - a.score);

    const columns = {};
    const usedColumns = new Set();

    scores.forEach(({ field, column }) => {
        if (Object.hasOwn(columns, field) || usedColumns.has(column)) return;

        columns[field] = column;
        usedColumns.add(column);
    });

    return columns;
}

/**
 * A card statement can list the amount in the currency of the purchase, then its code ("USD"),
 * then the same amount in đồng. When a column of currency codes follows the detected amount and
 * not all of them are VND, the amount to import is the next column that holds numbers.
 */
function preferLocalCurrencyAmount(rows, headerIndex, columns) {
    if (columns.amount < 0 || columns.debit >= 0 || columns.credit >= 0) return columns;

    const data = rows.slice(headerIndex + 1, headerIndex + 41);
    const width = Math.max(0, ...data.map((row) => row.length));

    for (let column = columns.amount + 1; column < width; column++) {
        const cells = data.map((row) => row[column] ?? '').filter(Boolean);
        const codes = cells.filter((cell) => /^[A-Za-z]{3}$/.test(cell));

        if (cells.length === 0 || codes.length / cells.length < 0.6) continue;

        // Every purchase is in đồng: the detected column already is the amount in đồng.
        if (codes.every((code) => code.toUpperCase() === 'VND')) return columns;

        for (let next = column + 1; next < width; next++) {
            const values = data.map((row) => row[next] ?? '').filter(Boolean);

            if (values.length && values.every((value) => !Number.isNaN(parseBankAmount(value)))) {
                return { ...columns, amount: next };
            }
        }

        return columns;
    }

    return columns;
}

/**
 * Find the header row and the columns of a statement. A statement often starts with a few lines
 * about the account, so the first 30 rows are searched for one that names a date and an amount.
 * Returns { headerIndex, columns } with -1 for a missing header / column, so a person can fix it.
 */
function detectCsvLayout(rows) {
    const none = {
        date: -1,
        description: -1,
        debit: -1,
        credit: -1,
        amount: -1,
        balance: -1,
        reference: -1,
    };

    for (let index = 0; index < Math.min(rows.length, 30); index++) {
        const found = matchImportHeader(rows[index]);
        const hasMoney = ['debit', 'credit', 'amount'].some((field) => Object.hasOwn(found, field));

        if (Object.hasOwn(found, 'date') && hasMoney) {
            return {
                headerIndex: index,
                columns: preferLocalCurrencyAmount(rows, index, { ...none, ...found }),
            };
        }
    }

    // No header: guess the date column from the data, and the description as the widest text.
    const sample = rows.slice(0, 30);
    const width = Math.max(0, ...sample.map((row) => row.length));
    let date = -1;
    let description = -1;
    let widest = 0;

    for (let column = 0; column < width; column++) {
        const cells = sample.map((row) => row[column] ?? '').filter(Boolean);
        const dates = cells.filter((cell) => parseBankDate(cell)).length;
        const length = cells.reduce((total, cell) => total + cell.length, 0) / (cells.length || 1);

        if (date === -1 && cells.length && dates / cells.length >= 0.6) date = column;
        else if (!dates && Number.isNaN(parseBankAmount(cells[0])) && length > widest) {
            widest = length;
            description = column;
        }
    }

    return { headerIndex: -1, columns: { ...none, date, description } };
}

/** FNV-1a: a short stable hash, enough to tell statement rows apart in an id. */
function hashText(text) {
    let hash = 0x811c9dc5;

    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return hash.toString(16).padStart(8, '0');
}

/** Description of a statement row as a note: no "#" (it would turn words into tags), one line. */
function cleanImportNote(text) {
    return String(text ?? '')
        .replace(/#/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
}

/**
 * Statement rows → transaction candidates for one money source.
 * layout comes from detectCsvLayout (or from the person's own choice). With separate debit and
 * credit columns the column decides expense or income; with a single amount column the sign does
 * (negative = expense), or the opposite when `positiveIsExpense` (card statements list purchases
 * as positive numbers). Rows without a valid date or amount (totals, balances) are skipped with a
 * reason. The id depends only on what the row says (and the source), so importing the same
 * statement twice gives the same ids; identical rows in one file are told apart by a counter.
 * Returns { items, skipped: [{ row, reason }], tooMany }.
 */
function buildImportItems(rows, layout, { source = '', positiveIsExpense = false } = {}) {
    const { headerIndex, columns } = layout;
    const items = [];
    const skipped = [];
    const seen = new Map();
    const cellOf = (row, column) => (column >= 0 ? (row[column] ?? '') : '');
    const hasSplit = columns.debit >= 0 || columns.credit >= 0;

    for (let index = headerIndex + 1; index < rows.length; index++) {
        const row = rows[index];

        if (row.every((cell) => !cell)) continue;

        const date = parseBankDate(cellOf(row, columns.date));

        if (!date) {
            skipped.push({ row: index + 1, reason: 'Không đọc được ngày' });
            continue;
        }

        let type;
        let amount;

        if (hasSplit) {
            const debit = Math.abs(parseBankAmount(cellOf(row, columns.debit)) || 0);
            const credit = Math.abs(parseBankAmount(cellOf(row, columns.credit)) || 0);

            type = debit >= credit ? 'expense' : 'income';
            amount = Math.abs(debit - credit);
        } else {
            const value = parseBankAmount(cellOf(row, columns.amount));
            // Usually money going out is negative; a card statement lists purchases as positive.
            const isExpense = positiveIsExpense ? value >= 0 : value < 0;

            type = isExpense ? 'expense' : 'income';
            amount = Math.abs(value);
        }

        if (!(amount > 0)) {
            skipped.push({ row: index + 1, reason: 'Không có số tiền' });
            continue;
        }

        if (items.length >= MAX_IMPORT_ROWS) {
            return { items, skipped, tooMany: true };
        }

        const note = cleanImportNote(cellOf(row, columns.description));
        const reference = cellOf(row, columns.reference);
        const key = [source, date, type, amount, normalizeSearchText(note), reference].join('|');
        const occurrence = (seen.get(key) || 0) + 1;

        seen.set(key, occurrence);
        items.push({
            row: index + 1,
            id: `TX_IMP_${date.replace(/-/g, '')}_${hashText(key)}${occurrence > 1 ? `_${occurrence}` : ''}`,
            date,
            type,
            amount,
            note,
        });
    }

    return { items, skipped, tooMany: false };
}

/**
 * Which sign of a single amount column means money going out: the one most rows have, since
 * spending outnumbers refunds and payments. (A VPBank card statement writes charges as negative
 * numbers; other banks write them as positive ones.) False when there is no amount column.
 */
function guessPositiveIsExpense(rows, layout) {
    const column = layout.columns.amount;

    if (column < 0 || layout.columns.debit >= 0 || layout.columns.credit >= 0) return false;

    let positive = 0;
    let negative = 0;

    for (let index = layout.headerIndex + 1; index < rows.length; index++) {
        const value = parseBankAmount(rows[index][column] ?? '');

        if (value > 0) positive++;
        else if (value < 0) negative++;
    }

    return positive > negative;
}

/**
 * Say which candidates the book already has, for the money source they are imported into.
 *  - status 'imported': this very row was imported before (same id), so it is left out for good;
 *  - status 'duplicate': a transaction with the same effect on the source (to the đồng, or 1 đ off
 *    from IMPORT_AMOUNT_TOLERANCE_FROM up) within IMPORT_DUPLICATE_DAYS (typed by hand, or a
 *    transfer) is probably the same one; `match` is its id. Each existing transaction explains at
 *    most one row; the exact amounts are paired first, then the closest dates, so with two rows of
 *    the same amount the one nearer to the typed entry gets it.
 * Both are unticked (`include` false) so a person decides; everything else is ticked.
 */
function markImportDuplicates(items, existing, sourceName) {
    const ids = new Set(existing.map((transaction) => transaction.id));
    const pool = new Map();

    existing.forEach((transaction) => {
        const effect = sourceEffect(transaction, sourceName);

        if (!effect) return;

        if (!pool.has(effect)) pool.set(effect, []);

        pool.get(effect).push({
            id: transaction.id,
            time: parseLocalDate(transaction.date).getTime(),
        });
    });

    const pairs = [];

    items.forEach((item, position) => {
        if (ids.has(item.id)) return;

        const effect = item.type === 'income' ? item.amount : -item.amount;
        const time = parseLocalDate(item.date).getTime();
        const tolerance = item.amount >= IMPORT_AMOUNT_TOLERANCE_FROM ? IMPORT_AMOUNT_TOLERANCE : 0;

        for (let gap = -tolerance; gap <= tolerance; gap++) {
            (pool.get(effect + gap) || []).forEach((candidate) => {
                const days = Math.abs(Math.round((candidate.time - time) / 86400000));

                if (days <= IMPORT_DUPLICATE_DAYS) {
                    pairs.push({ position, candidate, days, off: Math.abs(gap) });
                }
            });
        }
    });

    pairs.sort((a, b) => a.off - b.off || a.days - b.days || a.position - b.position);

    const matchOf = new Map();
    const taken = new Set();

    pairs.forEach(({ position, candidate }) => {
        if (matchOf.has(position) || taken.has(candidate)) return;

        matchOf.set(position, candidate.id);
        taken.add(candidate);
    });

    return items.map((item, position) => {
        if (ids.has(item.id)) {
            return { ...item, status: 'imported', match: '', include: false };
        }

        if (matchOf.has(position)) {
            return { ...item, status: 'duplicate', match: matchOf.get(position), include: false };
        }

        return { ...item, status: 'new', match: '', include: true };
    });
}

/** The first two real words of a description ("GRAB*TRIP 4421 HCM" → "grab trip"): a merchant's key. */
function importDescriptionKey(description) {
    return normalizeSearchText(description)
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3 && !/^\d+$/.test(word))
        .slice(0, 2)
        .join(' ');
}

// Common merchants for a first import, before the book has any history to learn from. A rule
// only applies when the person has a category of that exact name.
const IMPORT_CATEGORY_RULES = [
    [
        'expense',
        'Ăn uống',
        /\b(grabfood|shopeefood|baemin|highlands|phuc long|starbucks|cafe|coffee|ca phe|tra sua|gong cha|kfc|lotteria|jollibee|pizza|quan an|nha hang|bun bo|com tam)\b/,
    ],
    [
        'expense',
        'Đi lại',
        /\b(grab|gojek|xanh sm|taxi|vinasun|mai linh|petrolimex|pvoil|xang|gui xe|parking|ve xe|bus)\b/,
    ],
    [
        'expense',
        'Mua sắm',
        /\b(shopee|lazada|tiki|tiktok shop|sendo|winmart|vinmart|bach hoa xanh|coopmart|co op|aeon|lotte mart|big c|circle k|familymart|ministop|gs25|the gioi di dong|dien may xanh|fpt shop)\b/,
    ],
    [
        'expense',
        'Hóa đơn & Tiện ích',
        /\b(evn|tien dien|dien luc|tien nuoc|viettel|vinaphone|mobifone|vnpt|fpt telecom|internet|cuoc dien thoai|netflix|spotify|icloud|phi duy tri|phi dich vu)\b/,
    ],
    ['income', 'Lương / Thưởng', /\b(luong|salary|payroll|thuong)\b/],
];

/**
 * A function (description, type) → category name for the rows of a statement. It learns from the
 * book first (the same merchant key, or a note the person wrote that the description contains),
 * then the common merchants above, then falls back to "Chưa phân loại" (expense) or
 * "Thu nhập khác" (income) so no row is left without one.
 */
function buildCategoryGuesser(history, categoryList) {
    const names = { expense: new Set(), income: new Set() };

    categoryList.forEach((category) => {
        if (names[category.type]) names[category.type].add(category.name);
    });

    const byKey = { expense: new Map(), income: new Map() };
    const byNote = { expense: new Map(), income: new Map() };
    const vote = (map, key, category) => {
        if (!map.has(key)) map.set(key, new Map());

        map.get(key).set(category, (map.get(key).get(category) || 0) + 1);
    };

    history.forEach((transaction) => {
        const type = transaction.type;

        if (!names[type] || !names[type].has(transaction.category)) return;

        const text = extractTags(transaction.note).text;
        const key = importDescriptionKey(text);
        const plain = normalizeSearchText(text);

        if (key) vote(byKey[type], key, transaction.category);

        if (plain.length >= 4) vote(byNote[type], plain, transaction.category);
    });

    const top = (votes) => [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];

    return (description, type) => {
        const kind = type === 'income' ? 'income' : 'expense';
        const key = importDescriptionKey(description);

        if (key && byKey[kind].has(key)) return top(byKey[kind].get(key));

        const plain = normalizeSearchText(description);
        let longest = '';

        byNote[kind].forEach((votes, note) => {
            if (note.length > longest.length && plain.includes(note)) longest = note;
        });

        if (longest) return top(byNote[kind].get(longest));

        const rule = IMPORT_CATEGORY_RULES.find(
            ([ruleType, name, pattern]) =>
                ruleType === kind && names[kind].has(name) && pattern.test(plain),
        );

        return rule ? rule[1] : IMPORT_FALLBACK_CATEGORIES[kind];
    };
}

// --- BANK STATEMENT IN PDF ---
// pdf.js hands over the text of a page as small pieces with a position: { text, x, y, width, height }
// (y is the baseline and grows upwards). These functions turn the pieces of a statement into the same
// rows of cells a CSV would give, so the rest of the import (columns, duplicates, categories,
// preview, undo) is shared. Everything here is pure; js/import.js reads the file.

/** Pieces on one line → segments: pieces closer than a space and a half are one piece of text. */
function mergePdfItems(items, height) {
    const segments = [];

    items.forEach((item) => {
        const end = item.x + item.width;
        const last = segments.at(-1);
        const gap = last ? item.x - last.x1 : Infinity;

        if (last && gap <= height * 0.6) {
            const joint =
                /\s$/.test(last.text) || /^\s/.test(item.text) || gap <= height * 0.1 ? '' : ' ';

            last.text += joint + item.text;
            last.x1 = Math.max(last.x1, end);
        } else {
            segments.push({ text: item.text, x0: item.x, x1: end });
        }
    });

    return segments
        .map((segment) => ({ ...segment, text: segment.text.replace(/\s+/g, ' ').trim() }))
        .filter((segment) => segment.text);
}

/** The pieces of one page → lines from top to bottom, each with its segments from left to right. */
function pdfPageLines(items, page = 0) {
    const sorted = items
        .filter((item) => String(item.text ?? '').trim() !== '')
        .map((item) => ({ ...item, height: item.height > 0 ? item.height : 8 }))
        .sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];

    sorted.forEach((item) => {
        const line = lines.at(-1);

        if (line && Math.abs(line.y - item.y) <= Math.max(2, item.height * 0.4)) {
            line.items.push(item);
            line.height = Math.max(line.height, item.height);
        } else {
            lines.push({ page, y: item.y, height: item.height, items: [item] });
        }
    });

    return lines.map((line) => ({
        page: line.page,
        y: line.y,
        height: line.height,
        segments: mergePdfItems(
            line.items.sort((a, b) => a.x - b.x),
            line.height,
        ),
    }));
}

/** Header cells from the segments of one or two lines: segments that overlap in x are one cell. */
function pdfHeaderColumns(lines) {
    const segments = lines
        .flatMap((line) => line.segments.map((segment) => ({ ...segment, y: line.y })))
        .sort((a, b) => a.x0 - b.x0);
    const columns = [];

    segments.forEach((segment) => {
        const last = columns.at(-1);

        if (last && segment.x0 <= last.x1 + 1) {
            last.parts.push(segment);
            last.x1 = Math.max(last.x1, segment.x1);
        } else {
            columns.push({ x0: segment.x0, x1: segment.x1, parts: [segment] });
        }
    });

    return columns.map((column) => ({
        x0: column.x0,
        x1: column.x1,
        text: column.parts
            .sort((a, b) => b.y - a.y || a.x0 - b.x0)
            .map((part) => part.text)
            .join(' '),
    }));
}

/**
 * The header of the transaction table starting at lines[index]: that line and the lines right under
 * it that do not begin with a date (a bilingual header has two). Returns { columns, end, found } when
 * the cells name a date, a description and an amount, else null.
 */
function pdfHeaderBlock(lines, index) {
    const block = [lines[index]];
    let end = index + 1;

    while (end < lines.length) {
        const line = lines[end];
        const previous = lines[end - 1];
        const first = line.segments[0];

        if (
            line.page !== previous.page ||
            previous.y - line.y > line.height * 1.8 ||
            (first && parseBankDate(first.text))
        ) {
            break;
        }

        block.push(line);
        end++;
    }

    const columns = pdfHeaderColumns(block);
    const found = matchImportHeader(columns.map((column) => column.text));
    const hasMoney = ['debit', 'credit', 'amount'].some((field) => Object.hasOwn(found, field));

    return columns.length >= 4 &&
        Object.hasOwn(found, 'date') &&
        Object.hasOwn(found, 'description') &&
        hasMoney
        ? { columns, end, found }
        : null;
}

/**
 * The transaction table of a statement as rows of cells (the header cells first), or null when no
 * table is found. A row starts at a line that begins with a date in the date columns; lines right
 * under it that start in the description column are the rest of its description (these wrap).
 * A cell is chosen by position: text left of the description is a date, text before the first
 * amount column is the description, and each amount is put in the column whose right edge is the
 * nearest (they are right-aligned), so an empty fee cell does not move the amount that follows.
 */
function pdfLinesToTable(lines) {
    let header = null;

    for (let index = 0; index < lines.length && !header; index++) {
        header = pdfHeaderBlock(lines, index);
    }

    if (!header) return null;

    const { columns, found } = header;
    const descriptionIndex = found.description;
    const dateIndexes = columns
        .map((_, index) => index)
        .filter((index) => index < descriptionIndex);
    const amountIndexes = columns
        .map((_, index) => index)
        .filter((index) => index > descriptionIndex);
    const dateEdge = Math.max(...dateIndexes.map((index) => columns[index].x1), -Infinity);
    const amountStart = amountIndexes.length ? columns[amountIndexes[0]].x0 : Infinity;
    const rows = [columns.map((column) => column.text)];
    const nearest = (indexes, distance) =>
        indexes.reduce(
            (best, index) => (distance(index) < distance(best) ? index : best),
            indexes[0],
        );
    let current = null;

    const put = (cells, index, text) => {
        cells[index] = cells[index] ? `${cells[index]} ${text}` : text;
    };
    const place = (cells, segment) => {
        if (segment.x1 > amountStart + 2 && amountIndexes.length) {
            const index = nearest(amountIndexes, (candidate) =>
                Math.abs(segment.x1 - columns[candidate].x1),
            );

            put(cells, index, segment.text);
        } else if (segment.x1 <= dateEdge + 2 && dateIndexes.length) {
            const centre = (segment.x0 + segment.x1) / 2;
            const index = nearest(dateIndexes, (candidate) =>
                Math.abs(centre - (columns[candidate].x0 + columns[candidate].x1) / 2),
            );

            put(cells, index, segment.text);
        } else {
            put(cells, descriptionIndex, segment.text);
        }
    };

    for (let index = header.end; index < lines.length; index++) {
        const line = lines[index];
        const first = line.segments[0];
        const again = first && pdfHeaderBlock(lines, index);

        if (again) {
            // The header repeated at the top of a page.
            index = again.end - 1;
            current = null;
            continue;
        }

        if (first && parseBankDate(first.text) && first.x1 <= dateEdge + 2) {
            const cells = columns.map(() => '');

            line.segments.forEach((segment) => place(cells, segment));
            rows.push(cells);
            current = { cells, page: line.page, y: line.y };
        } else if (
            current &&
            first &&
            line.page === current.page &&
            current.y - line.y <= line.height * 2.2 &&
            first.x0 >= dateEdge - 2
        ) {
            line.segments.forEach((segment) => place(current.cells, segment));
            current.y = line.y;
        } else {
            // Footer, page number, anything else: not part of a row.
            current = null;
        }
    }

    return { rows };
}

/**
 * The summary of a statement from its first page: the cycle ("Statement cycle : 21/09/2026 -
 * 20/10/2026"), the due date and minimum amount, and the four numbers of the summary table
 * (beginning balance, total debit, paid, closing balance). Amounts are positive; a field that is not
 * found is null (cycle and due date: '').
 */
function parsePdfStatementSummary(lines) {
    const texts = lines.map((line) => line.segments.map((segment) => segment.text).join('  '));
    const plain = texts.map((text) => normalizeSearchText(text));
    const summary = {
        cycleFrom: '',
        cycleTo: '',
        dueDate: '',
        minimumDue: null,
        closingBalance: null,
        beginningBalance: null,
        totalDebit: null,
        paid: null,
    };
    const DATE = /\d{1,2}\/\d{1,2}\/\d{2,4}/g;
    // The amounts on a line (not the parts of a date), as positive numbers.
    const amounts = (text) =>
        (text.replace(DATE, ' ').match(/-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/g) || [])
            .map((token) => Math.abs(parseBankNumber(token)))
            .filter((value) => Number.isFinite(value));
    const after = (from, test, span = 4) => {
        for (let index = from + 1; index <= Math.min(from + span, texts.length - 1); index++) {
            if (test(texts[index])) return index;
        }

        return -1;
    };

    plain.forEach((text, index) => {
        const cycle = texts[index].match(
            /(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{4})/,
        );

        if (cycle && (text.includes('statement cycle') || text.includes('ky sao ke'))) {
            summary.cycleFrom = parseBankDate(cycle[1]);
            summary.cycleTo = parseBankDate(cycle[2]);
        }
    });

    const due = plain.findIndex(
        (text) => text.includes('due date') || text.includes('ngay den han'),
    );
    const dueValues = due >= 0 ? after(due, (text) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(text)) : -1;

    if (dueValues >= 0) {
        const numbers = amounts(texts[dueValues]);

        summary.dueDate = parseBankDate(texts[dueValues].match(/\d{1,2}\/\d{1,2}\/\d{4}/)[0]);
        summary.minimumDue = numbers.length ? numbers[0] : null;
        summary.closingBalance = numbers.length > 1 ? numbers[1] : null;
    }

    const begin = plain.findIndex(
        (text) => text.includes('beginning balance') || text.includes('du no dau ky'),
    );
    const equation = begin >= 0 ? after(begin, (text) => amounts(text).length >= 4) : -1;

    if (equation >= 0) {
        const [beginning, debit, paid, closing] = amounts(texts[equation]);

        Object.assign(summary, {
            beginningBalance: beginning,
            totalDebit: debit,
            paid,
            closingBalance: closing,
        });
    }

    return summary;
}

/** The pieces of every page of a statement → { rows, summary }, or null when it has no table. */
function buildPdfStatementTable(pages) {
    const lines = pages.flatMap((items, index) => pdfPageLines(items, index));
    const table = pdfLinesToTable(lines);

    return table ? { rows: table.rows, summary: parsePdfStatementSummary(lines) } : null;
}

/**
 * Compare the rows read from the table with the summary of the statement: what went out
 * ("Nợ phát sinh trong kỳ") and what came in ("Đã thanh toán"), to the đồng. Null when the summary
 * has no such numbers or there is no amount column. A mismatch means a row was missed or misread.
 */
function reconcilePdfStatement(rows, layout, summary, positiveIsExpense = false) {
    const column = layout.columns.amount;

    if (!summary || summary.totalDebit == null || summary.paid == null || column < 0) return null;

    let charges = 0;
    let payments = 0;

    for (let index = layout.headerIndex + 1; index < rows.length; index++) {
        const value = parseBankNumber(rows[index][column] ?? '');

        if (!(value > 0 || value < 0)) continue;

        if (value > 0 === positiveIsExpense) charges += Math.abs(value);
        else payments += Math.abs(value);
    }

    charges = Math.round(charges * 100) / 100;
    payments = Math.round(payments * 100) / 100;

    return {
        charges,
        payments,
        expectedCharges: summary.totalDebit,
        expectedPayments: summary.paid,
        chargesOk: Math.abs(charges - summary.totalDebit) < 1,
        paymentsOk: Math.abs(payments - summary.paid) < 1,
    };
}

/**
 * What a statement read from a PDF changes on a card: the statement day (the last day of the cycle),
 * the due day and the closing balance of that statement. Only the fields that differ are returned;
 * null when nothing differs or the source is not a credit card. A closing balance of an older
 * statement than the one saved is not applied.
 */
function planCardStatementUpdate(source, summary) {
    if (!source || source.kind !== 'credit' || !summary || !summary.cycleTo) return null;

    const plan = {};
    const day = dayOfMonthOrNull(summary.cycleTo.slice(8, 10));
    // A card with statement day 31 closes on the 28th in February: that is the same day.
    const sameDay =
        Boolean(source.statementDay) &&
        latestStatementDate(source.statementDay, summary.cycleTo) === summary.cycleTo;

    if (day && !sameDay) plan.statementDay = day;

    const dueDay = summary.dueDate ? dayOfMonthOrNull(summary.dueDate.slice(8, 10)) : null;

    if (dueDay && dueDay !== source.dueDay) plan.dueDay = dueDay;

    if (Number.isFinite(summary.closingBalance) && summary.closingBalance >= 0) {
        const balance = Math.round(summary.closingBalance);
        const saved = source.lastStatement;
        const older = saved && saved.date > summary.cycleTo;
        const same = saved && saved.date === summary.cycleTo && saved.balance === balance;

        if (!older && !same) plan.lastStatement = { date: summary.cycleTo, balance };
    }

    return Object.keys(plan).length ? plan : null;
}

// --- BUDGETS ---

const BUDGET_WARN_RATIO = 0.8;

/** { categoryName: monthlyLimit } keeping only positive whole amounts. */
function normalizeBudgets(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    return Object.fromEntries(
        Object.entries(value)
            .map(([name, limit]) => [name, Math.round(Number(limit))])
            .filter(([name, limit]) => name && Number.isFinite(limit) && limit > 0),
    );
}

/** 0 = within budget, 1 = at least 80% used, 2 = at or over the limit. */
function budgetLevel(ratio) {
    if (ratio >= 1) return 2;

    return ratio >= BUDGET_WARN_RATIO ? 1 : 0;
}

/** Spending against each budget in the given month (YYYY-MM), most used first. */
function computeBudgetStatus(list, budgetMap, monthKey) {
    const spent = {};

    list.forEach((transaction) => {
        if (transaction.type === 'expense' && transaction.date.startsWith(monthKey)) {
            spent[transaction.category] = (spent[transaction.category] || 0) + transaction.amount;
        }
    });

    return Object.entries(budgetMap)
        .map(([category, limit]) => ({
            category,
            limit,
            spent: spent[category] || 0,
            ratio: (spent[category] || 0) / limit,
        }))
        .sort((a, b) => b.ratio - a.ratio);
}

// --- SALARY ---

const DEFAULT_SALARY_WARN_PERCENT = 80;
const DEFAULT_DEBT_WARN_PERCENT = 30;
const DEFAULT_CARD_WARN_PERCENT = 30;
const MAX_SALARY_GROUPS = 8;
const DEFAULT_SALARY_GROUPS = [
    { id: 'personal', name: 'Tiêu dùng cá nhân', percent: 50, saving: false },
    { id: 'work', name: 'Công việc', percent: 30, saving: false },
    { id: 'saving', name: 'Tiết kiệm', percent: 20, saving: true },
];

/**
 * The groups a salary is split into: [{ id, name, percent 0-100, saving }]. A "saving" group is
 * what is left of the salary after spending (at most one); the others are spending limits.
 * Returns null when the input is not a list.
 */
function normalizeSalaryGroups(value) {
    if (!Array.isArray(value)) return null;

    const seen = new Set();
    let hasSaving = false;

    return value
        .map((raw) => {
            if (!raw || typeof raw !== 'object') return null;

            const id = String(raw.id ?? '').trim();
            const name = String(raw.name ?? '')
                .trim()
                .slice(0, 40);
            const percent = Math.round(Number(raw.percent));

            if (!id || !name || seen.has(id) || !(percent >= 0 && percent <= 100)) return null;

            const saving = raw.saving === true && !hasSaving;

            seen.add(id);
            hasSaving = hasSaving || saving;

            return { id, name, percent, saving };
        })
        .filter(Boolean)
        .slice(0, MAX_SALARY_GROUPS);
}

/**
 * { amount: monthly salary in VND (0 = not set), warnPercent: 1-100, groups, assign } where
 * assign maps an expense category name to the id of the spending group it counts toward.
 * Returns null when the input is not an object.
 */
function normalizeSalaryPlan(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const amount = Math.round(Number(value.amount));
    const warnPercent = Math.round(Number(value.warnPercent));
    const debtWarnPercent = Math.round(Number(value.debtWarnPercent));
    const cardWarnPercent = Math.round(Number(value.cardWarnPercent));
    const groups =
        normalizeSalaryGroups(value.groups) ?? DEFAULT_SALARY_GROUPS.map((group) => ({ ...group }));
    const spendingIds = new Set(groups.filter((group) => !group.saving).map((group) => group.id));
    const assign =
        value.assign && typeof value.assign === 'object' && !Array.isArray(value.assign)
            ? Object.entries(value.assign)
                  .map(([category, groupId]) => [category, String(groupId)])
                  .filter(([category, groupId]) => category && spendingIds.has(groupId))
            : [];

    return {
        amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
        warnPercent:
            warnPercent >= 1 && warnPercent <= 100 ? warnPercent : DEFAULT_SALARY_WARN_PERCENT,
        debtWarnPercent:
            debtWarnPercent >= 1 && debtWarnPercent <= 100
                ? debtWarnPercent
                : DEFAULT_DEBT_WARN_PERCENT,
        cardWarnPercent:
            cardWarnPercent >= 1 && cardWarnPercent <= 100
                ? cardWarnPercent
                : DEFAULT_CARD_WARN_PERCENT,
        groups,
        assign: Object.fromEntries(assign),
    };
}

/** 0 = within the salary, 1 = reached the warning percent, 2 = at or over the whole salary. */
function salaryLevel(ratio, warnPercent) {
    if (ratio >= 1) return 2;

    return ratio >= warnPercent / 100 ? 1 : 0;
}

/**
 * Credit / pay-later debt against the salary; null when no salary is set. The percent is rounded
 * down (never 30% before the warning) and integer maths keeps "exactly at the limit" exact.
 * level 1 = the debt reached the warning percent of the salary.
 */
function computeDebtStatus(debt, plan) {
    if (!plan || !(plan.amount > 0)) return null;

    const owed = Math.max(0, Number(debt) || 0);

    return {
        debt: owed,
        salary: plan.amount,
        percent: Math.floor((owed * 100) / plan.amount),
        warnPercent: plan.debtWarnPercent,
        limit: Math.round((plan.amount * plan.debtWarnPercent) / 100),
        level: owed * 100 >= plan.amount * plan.debtWarnPercent ? 1 : 0,
    };
}

/**
 * Money put on credit / pay-later sources in a month (YYYY-MM): purchases, plus cash taken out of
 * a card (a transfer to a source that is not a card). Paying the statement does not lower it:
 * it measures how much of the month was spent on credit, which the debt balance forgets once paid.
 */
function computeCardSpend(list, sourceList, monthKey) {
    const kinds = new Map(sourceList.map((source) => [source.name, source.kind]));
    const isCard = (name) => kinds.get(name) === 'credit';

    return list.reduce((total, transaction) => {
        if (!transaction.date.startsWith(monthKey)) return total;

        if (transaction.type === 'expense' && isCard(transaction.source)) {
            return total + transaction.amount;
        }

        if (
            transaction.type === 'transfer' &&
            isCard(transaction.source) &&
            !isCard(transaction.targetSource)
        ) {
            return total + transaction.amount;
        }

        return total;
    }, 0);
}

/**
 * The month's card spending against the salary; null when no salary is set.
 * level 0 = below the warning percent, 1 = reached it, 2 = at or over the whole salary.
 */
function computeCardSpendStatus(spent, plan) {
    if (!plan || !(plan.amount > 0)) return null;

    const used = Math.max(0, Number(spent) || 0);
    let level = 0;

    if (used >= plan.amount) level = 2;
    else if (used * 100 >= plan.amount * plan.cardWarnPercent) level = 1;

    return {
        spent: used,
        salary: plan.amount,
        percent: Math.floor((used * 100) / plan.amount),
        warnPercent: plan.cardWarnPercent,
        limit: Math.round((plan.amount * plan.cardWarnPercent) / 100),
        level,
    };
}

// --- CARD STATEMENT DUE DATES ---

/** Remind (and colour the card) from this many days before the due day. */
const CARD_DUE_WARN_DAYS = 3;

/** How a transaction changes the balance of one source; the same rules as calculateSourceBalances. */
function sourceEffect(transaction, name) {
    if (transaction.type === 'income') return transaction.source === name ? transaction.amount : 0;
    if (transaction.type === 'expense')
        return transaction.source === name ? -transaction.amount : 0;
    if (transaction.type !== 'transfer') return 0;

    return (
        (transaction.targetSource === name ? transaction.amount : 0) -
        (transaction.source === name ? transaction.amount : 0)
    );
}

/** The latest date on or before `from` whose day of the month is `day` (short months use their last day). */
function previousDayOfMonth(day, from) {
    const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());

    for (let offset = 0; offset < 3; offset++) {
        const month = new Date(base.getFullYear(), base.getMonth() - offset, 1);
        const candidate = new Date(
            month.getFullYear(),
            month.getMonth(),
            Math.min(day, daysInMonth(month)),
        );

        if (candidate <= base) return candidate;
    }

    return base;
}

/**
 * What a credit source must pay next, and by when; null when it has no due day or owes nothing.
 * With a statement day the amount is what was owed on the last statement day minus what has been
 * paid into the card since, and the due date is the first due day after that statement (so a
 * statement that was not paid shows as overdue instead of jumping to next month). Without one it
 * is the whole debt and the next due day.
 * `opening` is the source's initial balance. daysLeft is negative once the due date has passed.
 * When the source has `lastStatement` (the closing balance printed on a statement), what was owed
 * on a later statement day is that balance plus what happened since, so the amount no longer depends
 * on the initial balance, which absorbs every charge the book is missing ("Khớp số dư").
 * `estimated` is true when there is a statement day but no such balance: the amount is then only a
 * guess from the initial balance and may be off by whatever the book is missing.
 */
function computeCardDue(source, list, opening, todayKey) {
    if (!source || source.kind !== 'credit' || source.archived || !source.dueDay) return null;

    const today = parseLocalDate(todayKey);
    const base = Number(opening) || 0;
    const balanceUpTo = (dateKey) =>
        list.reduce(
            (total, transaction) =>
                transaction.date <= dateKey
                    ? total + sourceEffect(transaction, source.name)
                    : total,
            base,
        );
    let amount;
    let due;
    let statementKey = '';
    let estimated = false;

    if (source.statementDay) {
        const statement = previousDayOfMonth(source.statementDay, today);

        statementKey = toLocalDateString(statement);
        due = nextDayOfMonth(source.dueDay, addDays(statement, 1));

        const paidSince = list.reduce((total, transaction) => {
            if (transaction.date <= statementKey || transaction.date > todayKey) return total;

            return total + Math.max(0, sourceEffect(transaction, source.name));
        }, 0);

        const anchor =
            source.lastStatement && source.lastStatement.date <= statementKey
                ? source.lastStatement
                : null;
        const owedAtStatement = anchor
            ? anchor.balance -
              list.reduce(
                  (total, transaction) =>
                      transaction.date > anchor.date && transaction.date <= statementKey
                          ? total + sourceEffect(transaction, source.name)
                          : total,
                  0,
              )
            : -balanceUpTo(statementKey);

        // Without the printed closing balance the debt on the statement day is worked out from the
        // initial balance, which "Khớp số dư" fills with every charge the book is missing.
        estimated = !anchor;
        amount = Math.max(0, owedAtStatement - paidSince);
    } else {
        due = nextDayOfMonth(source.dueDay, today);
        amount = Math.max(0, -balanceUpTo(todayKey));
    }

    if (!(amount > 0)) return null;

    return {
        name: source.name,
        amount,
        statementDate: statementKey,
        dueDate: toLocalDateString(due),
        daysLeft: daysUntil(due, today),
        estimated,
    };
}

// The printed closing balance is rounded and the rows it sums are rounded one by one, so a few đồng
// of difference is not a missing transaction.
const STATEMENT_GAP_TOLERANCE = 10;

/**
 * How far the book is from the closing balance printed on a card's last statement: what the book
 * says was owed on that statement day (initial balance + transactions up to it) minus the printed
 * balance, as { date, printed, book, gap }. Positive = the book owes more: the initial balance holds
 * debt the book has no transaction for (the foreign-currency fee and VAT lines of a statement that
 * were never entered, which "Khớp số dư" pushed there); negative = the book owes less. Null without
 * a closing balance or when they agree.
 */
function computeStatementGap(source, list, opening) {
    if (!source || source.kind !== 'credit' || !source.lastStatement) return null;

    const { date, balance } = source.lastStatement;
    const book = -list.reduce(
        (total, transaction) =>
            transaction.date <= date ? total + sourceEffect(transaction, source.name) : total,
        Number(opening) || 0,
    );
    const gap = book - balance;

    return Math.abs(gap) > STATEMENT_GAP_TOLERANCE ? { date, printed: balance, book, gap } : null;
}

/** The statement day on or before `todayKey` (YYYY-MM-DD) for a card whose statement closes on `day`. */
function latestStatementDate(day, todayKey) {
    return toLocalDateString(previousDayOfMonth(day, parseLocalDate(todayKey)));
}

/**
 * The statement cycles of a card, newest first: { start, end, open }. A cycle runs from the day
 * after one statement day to the next statement day (statement day 20: 21/09 to 20/10); `open`
 * marks the one that has not closed yet. The statement day itself belongs to the cycle it closes.
 */
function statementCycles(statementDay, todayKey, count = 12) {
    if (!statementDay) return [];

    const today = parseLocalDate(todayKey);
    const cycles = [];
    let end = nextDayOfMonth(statementDay, addDays(today, 1));

    for (let index = 0; index < count; index++) {
        const previous = previousDayOfMonth(statementDay, addDays(end, -1));

        cycles.push({
            start: toLocalDateString(addDays(previous, 1)),
            end: toLocalDateString(end),
            open: index === 0,
        });
        end = previous;
    }

    return cycles;
}

/**
 * What happened on one source between two dates (inclusive), as a card statement counts it:
 * `charges` is money that went out (purchases, fees, cash taken, transfers out), `payments` is
 * money that came in (payments into the card, refunds), `count` the transactions that moved it.
 */
function computeCardCycleTotals(list, sourceName, from, to) {
    const totals = { charges: 0, payments: 0, count: 0 };

    list.forEach((transaction) => {
        if (transaction.date < from || transaction.date > to) return;

        const effect = sourceEffect(transaction, sourceName);

        if (effect < 0) totals.charges -= effect;
        else if (effect > 0) totals.payments += effect;

        if (effect) totals.count++;
    });

    return totals;
}

/** 0 = nothing to worry about yet, 1 = due within CARD_DUE_WARN_DAYS, 2 = the due date has passed. */
function cardDueLevel(due) {
    if (!due) return 0;
    if (due.daysLeft < 0) return 2;

    return due.daysLeft <= CARD_DUE_WARN_DAYS ? 1 : 0;
}

/** The dues that need attention (level 1 or 2), the most urgent first. */
function cardDuesToRemind(sourceList, list, openings, todayKey) {
    return sourceList
        .map((source) => computeCardDue(source, list, openings[source.name], todayKey))
        .filter((due) => cardDueLevel(due) > 0)
        .sort((a, b) => a.daysLeft - b.daysLeft);
}

const isExpenseInMonth = (transaction, monthKey) =>
    transaction.type === 'expense' && transaction.date.startsWith(monthKey);

/** The month's (YYYY-MM) expenses against the salary; null when no salary is set. */
function computeSalaryStatus(list, plan, monthKey) {
    if (!plan || !(plan.amount > 0)) return null;

    const spent = list.reduce(
        (total, transaction) =>
            isExpenseInMonth(transaction, monthKey) ? total + transaction.amount : total,
        0,
    );
    const ratio = spent / plan.amount;

    return {
        salary: plan.amount,
        warnPercent: plan.warnPercent,
        spent,
        remaining: plan.amount - spent,
        ratio,
        // Rounded down so "80%" never shows before the warning level is actually reached.
        percent: Math.floor((spent * 100) / plan.amount),
        level: salaryLevel(ratio, plan.warnPercent),
    };
}

/** The spending group an expense category counts toward: the assigned one, else the first. */
function salaryGroupFor(plan, category) {
    const spending = plan.groups.filter((group) => !group.saving);
    const assigned = Object.hasOwn(plan.assign, category) ? plan.assign[category] : '';

    return spending.find((group) => group.id === assigned) || spending[0] || null;
}

/**
 * How the month's spending sits in each salary group; null without a salary or groups.
 * A spending group has cap = percent of the salary and a level from spent / cap. The saving
 * group is what remains of the salary: it reaches its target while spending stays within
 * (salary - target), and its level follows how close total spending is to that limit.
 */
function computeSalaryAllocation(list, plan, monthKey) {
    if (!plan || !(plan.amount > 0) || plan.groups.length === 0) return null;

    const spentBy = new Map(plan.groups.map((group) => [group.id, 0]));
    let totalSpent = 0;

    list.forEach((transaction) => {
        if (!isExpenseInMonth(transaction, monthKey)) return;

        const group = salaryGroupFor(plan, transaction.category);

        totalSpent += transaction.amount;

        if (group) spentBy.set(group.id, spentBy.get(group.id) + transaction.amount);
    });

    const share = (amount) => Math.floor((amount * 100) / plan.amount);
    const groups = plan.groups.map((group) => {
        const cap = Math.round((plan.amount * group.percent) / 100);

        if (group.saving) {
            const kept = Math.max(0, plan.amount - totalSpent);
            const limit = plan.amount - cap;
            const ratio = limit > 0 ? totalSpent / limit : totalSpent > 0 ? Infinity : 0;
            const reached = kept >= cap;

            return {
                ...group,
                cap,
                kept,
                reached,
                percentOfSalary: share(kept),
                level: reached ? Math.min(salaryLevel(ratio, plan.warnPercent), 1) : 2,
            };
        }

        const spent = spentBy.get(group.id);
        const ratio = cap > 0 ? spent / cap : spent > 0 ? Infinity : 0;

        return {
            ...group,
            cap,
            spent,
            ratio,
            remaining: cap - spent,
            percentOfSalary: share(spent),
            usedPercent: cap > 0 ? Math.floor((spent * 100) / cap) : spent > 0 ? 100 : 0,
            level: salaryLevel(ratio, plan.warnPercent),
        };
    });

    return {
        groups,
        totalSpent,
        totalPercent: plan.groups.reduce((total, group) => total + group.percent, 0),
    };
}

// --- SAVINGS BOOK ---

const DEFAULT_SAVINGS_PERCENT = 20;
const SAVINGS_ID_PREFIX = 'TX_SAV_';
const MAX_SAVINGS_CATCH_UP = 120;

/**
 * The automatic monthly deposit into a savings book, made on payday:
 * { enabled, day (1-31), from (source name), book (savings source name), mode 'percent' | 'fixed',
 *   percent (of the salary), amount (fixed), since (YYYY-MM-DD: nothing is deposited before it),
 *   lastMonth (YYYY-MM of the latest deposit, '' = none yet) }.
 * Returns null when the input is not an object.
 */
function normalizeSavingsPlan(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const day = dayOfMonthOrNull(value.day) || 0;
    const from = String(value.from ?? '').trim();
    const book = String(value.book ?? '').trim();
    const percent = Math.round(Number(value.percent));
    const amount = Math.round(Number(value.amount));
    const since = normalizeDate(value.since);
    const lastMonth = /^\d{4}-\d{2}$/.test(String(value.lastMonth ?? '')) ? value.lastMonth : '';

    return {
        enabled:
            value.enabled === true &&
            day > 0 &&
            from !== '' &&
            book !== '' &&
            from !== book &&
            since !== '',
        day,
        from,
        book,
        mode: value.mode === 'fixed' ? 'fixed' : 'percent',
        percent: percent >= 1 && percent <= 100 ? percent : DEFAULT_SAVINGS_PERCENT,
        amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
        since,
        lastMonth,
    };
}

/** The deposit date in a month (YYYY-MM): the payday, or the last day of a shorter month. */
function savingsDepositDate(monthKey, day) {
    const [year, month] = monthKey.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();

    return `${monthKey}-${padTwoDigits(Math.min(day, lastDay))}`;
}

/** The month keys from `fromKey` to `toKey` (both YYYY-MM, inclusive), at most `limit` of them. */
function monthKeysBetween(fromKey, toKey, limit = MAX_SAVINGS_CATCH_UP) {
    const keys = [];

    for (let key = fromKey; key <= toKey && keys.length < limit; key = shiftMonthKey(key, 1)) {
        keys.push(key);
    }

    return keys;
}

/** Deposits that have come due and were not made yet: [{ month, date }], oldest first. */
function savingsDueDeposits(plan, todayKey) {
    if (!plan.enabled) return [];

    return monthKeysBetween(plan.since.slice(0, 7), todayKey.slice(0, 7))
        .map((month) => ({ month, date: savingsDepositDate(month, plan.day) }))
        .filter(
            (deposit) =>
                deposit.date >= plan.since &&
                deposit.date <= todayKey &&
                (!plan.lastMonth || deposit.month > plan.lastMonth),
        );
}

/** The next deposit not made yet (it may already be overdue when it could not be worked out). */
function nextSavingsDeposit(plan, todayKey) {
    if (!plan.enabled) return null;

    const start = plan.since.slice(0, 7);
    const end = shiftMonthKey(todayKey.slice(0, 7), 2);

    return (
        monthKeysBetween(start, end)
            .map((month) => ({ month, date: savingsDepositDate(month, plan.day) }))
            .find(
                (deposit) =>
                    deposit.date >= plan.since &&
                    (!plan.lastMonth || deposit.month > plan.lastMonth),
            ) || null
    );
}

/** How much to put in each month; 0 when it cannot be worked out (a % of a salary that is not set). */
function savingsDepositAmount(plan, salary) {
    if (plan.mode === 'fixed') return plan.amount;

    return salary && salary.amount > 0 ? Math.round((salary.amount * plan.percent) / 100) : 0;
}

function savingsTransactionId(monthKey) {
    return `${SAVINGS_ID_PREFIX}${monthKey.replace('-', '')}`;
}

/**
 * Everything that moved money in or out of the savings books, newest first:
 * deposit / withdraw (transfers), move (between books), income (interest) and spend.
 */
function savingsMovements(list, bookNames) {
    const books = new Set(bookNames);
    const movements = [];

    list.slice()
        .sort(compareNewestFirst)
        .forEach((transaction) => {
            const fromBook = books.has(transaction.source);
            const toBook = transaction.type === 'transfer' && books.has(transaction.targetSource);
            let kind = '';
            let book = '';
            let other = '';

            if (transaction.type === 'transfer') {
                if (toBook && !fromBook) {
                    [kind, book, other] = ['deposit', transaction.targetSource, transaction.source];
                } else if (fromBook && !toBook) {
                    [kind, book, other] = [
                        'withdraw',
                        transaction.source,
                        transaction.targetSource || '',
                    ];
                } else if (fromBook && toBook) {
                    [kind, book, other] = ['move', transaction.targetSource, transaction.source];
                }
            } else if (fromBook) {
                [kind, book] = [
                    transaction.type === 'income' ? 'income' : 'spend',
                    transaction.source,
                ];
            }

            if (kind) {
                movements.push({
                    id: transaction.id,
                    date: transaction.date,
                    kind,
                    book,
                    other,
                    amount: transaction.amount,
                    note: transaction.note || '',
                    auto: String(transaction.id).startsWith(SAVINGS_ID_PREFIX),
                });
            }
        });

    return movements;
}

// --- RECURRING TRANSACTIONS ---

const MAX_RECURRING_PER_RUN = 400;
const WEEKDAY_LABELS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

function parseLocalDate(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);

    return new Date(year, month - 1, day);
}

function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function daysInMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * A recurring rule: { id, name, type, source, targetSource, category, amount, note,
 * frequency: 'monthly' | 'weekly', day (1-31 of the month, or 0-6 with 0 = Sunday),
 * startDate, endDate ('' = none), active, lastGenerated ('' = nothing yet), updatedAt }.
 * Returns null when the rule cannot be used.
 */
function normalizeRecurringRule(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const id = String(raw.id ?? '').trim();
    const type = String(raw.type ?? '');
    const amount = parseAmount(raw.amount);
    const startDate = normalizeDate(raw.startDate);

    if (!id || !TRANSACTION_TYPES.includes(type) || !(amount > 0) || !startDate) return null;

    const frequency = raw.frequency === 'weekly' ? 'weekly' : 'monthly';
    const day = Math.round(Number(raw.day));

    return {
        id,
        name: String(raw.name ?? '').trim(),
        type,
        source: String(raw.source ?? ''),
        targetSource: type === 'transfer' && raw.targetSource ? String(raw.targetSource) : null,
        category: type === 'transfer' ? TRANSFER_CATEGORY : String(raw.category ?? ''),
        amount,
        note: String(raw.note ?? ''),
        frequency,
        day:
            frequency === 'weekly'
                ? Number.isFinite(day) && day >= 0 && day <= 6
                    ? day
                    : 1
                : Number.isFinite(day) && day >= 1 && day <= 31
                  ? day
                  : 1,
        startDate,
        endDate: normalizeDate(raw.endDate),
        active: raw.active !== false,
        lastGenerated: normalizeDate(raw.lastGenerated),
        updatedAt: String(raw.updatedAt ?? ''),
    };
}

function normalizeRecurringRules(list) {
    if (!Array.isArray(list)) return null;

    const seen = new Set();
    const result = [];

    list.forEach((raw) => {
        const rule = normalizeRecurringRule(raw);

        if (rule && !seen.has(rule.id)) {
            seen.add(rule.id);
            result.push(rule);
        }
    });

    return result;
}

/** Does the rule fall on this date? A monthly day past the end of a short month means its last day. */
function recurringMatches(rule, date) {
    return rule.frequency === 'weekly'
        ? date.getDay() === rule.day
        : date.getDate() === Math.min(rule.day, daysInMonth(date));
}

/** Dates (YYYY-MM-DD) on which an active rule is due, after lastGenerated, up to today. */
function recurringDueDates(rule, todayKey, limit = MAX_RECURRING_PER_RUN) {
    if (!rule.active) return [];

    const lastDay = rule.endDate && rule.endDate < todayKey ? rule.endDate : todayKey;
    let cursor = parseLocalDate(rule.startDate);

    if (rule.lastGenerated) {
        const afterLast = addDays(parseLocalDate(rule.lastGenerated), 1);

        if (afterLast > cursor) cursor = afterLast;
    }

    const dates = [];

    for (
        ;
        toLocalDateString(cursor) <= lastDay && dates.length < limit;
        cursor = addDays(cursor, 1)
    ) {
        if (recurringMatches(rule, cursor)) dates.push(toLocalDateString(cursor));
    }

    return dates;
}

/** The first date after today on which the rule will run, or '' if it has ended or is paused. */
function nextRecurringDate(rule, todayKey) {
    if (!rule.active) return '';

    let cursor = addDays(parseLocalDate(todayKey), 1);

    if (parseLocalDate(rule.startDate) > cursor) cursor = parseLocalDate(rule.startDate);

    for (let step = 0; step < 400; step++, cursor = addDays(cursor, 1)) {
        const key = toLocalDateString(cursor);

        if (rule.endDate && key > rule.endDate) return '';

        if (recurringMatches(rule, cursor)) return key;
    }

    return '';
}

/** Same id on every device, so two devices generating the same occurrence merge into one. */
function recurringTransactionId(rule, dateKey) {
    return `TX_R${rule.id.replace(/\D/g, '')}_${dateKey.replace(/-/g, '')}`;
}

function describeRecurringSchedule(rule) {
    return rule.frequency === 'weekly'
        ? `Hằng tuần, ${WEEKDAY_LABELS[rule.day]}`
        : `Hằng tháng, ngày ${rule.day}`;
}

// --- DEBTS (loans owed to or by the user) ---

const DEBT_SOON_DAYS = 7;

/**
 * A debt: { id, party, direction: 'owe' (the user owes) | 'owed' (owed to the user), amount,
 * date, dueDate, note, payments: [{ id, date, amount }], updatedAt }. Null when unusable.
 */
function normalizeDebt(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const id = String(raw.id ?? '').trim();
    const party = String(raw.party ?? '').trim();
    const amount = parseAmount(raw.amount);

    if (!id || !party || !(amount > 0)) return null;

    const payments = (Array.isArray(raw.payments) ? raw.payments : [])
        .map((payment, index) => ({
            id: String(payment && payment.id ? payment.id : `${id}_P${index}`),
            date: normalizeDate(payment && payment.date),
            amount: parseAmount(payment && payment.amount),
            // The transaction this payment wrote into a money source, when it was asked to.
            ...(payment && payment.transactionId
                ? { transactionId: String(payment.transactionId) }
                : {}),
        }))
        .filter((payment) => payment.amount > 0);

    return {
        id,
        party,
        direction: raw.direction === 'owed' ? 'owed' : 'owe',
        amount,
        date: normalizeDate(raw.date),
        dueDate: normalizeDate(raw.dueDate),
        note: String(raw.note ?? ''),
        payments,
        updatedAt: String(raw.updatedAt ?? ''),
    };
}

function normalizeDebts(list) {
    if (!Array.isArray(list)) return null;

    const seen = new Set();
    const result = [];

    list.forEach((raw) => {
        const debt = normalizeDebt(raw);

        if (debt && !seen.has(debt.id)) {
            seen.add(debt.id);
            result.push(debt);
        }
    });

    return result;
}

function debtPaid(debt) {
    return debt.payments.reduce((total, payment) => total + payment.amount, 0);
}

function debtRemaining(debt) {
    return Math.max(0, debt.amount - debtPaid(debt));
}

/** 'settled', 'overdue' (past the due date), 'soon' (due within a week) or 'open'. */
function debtStatus(debt, todayKey) {
    if (debtRemaining(debt) === 0) return 'settled';

    if (!debt.dueDate) return 'open';

    if (debt.dueDate < todayKey) return 'overdue';

    const days = Math.round((parseLocalDate(debt.dueDate) - parseLocalDate(todayKey)) / 86400000);

    return days <= DEBT_SOON_DAYS ? 'soon' : 'open';
}

function summarizeDebts(list, todayKey) {
    const summary = { owe: 0, owed: 0, overdueCount: 0, overdueAmount: 0 };

    list.forEach((debt) => {
        summary[debt.direction] += debtRemaining(debt);

        if (debtStatus(debt, todayKey) === 'overdue') {
            summary.overdueCount++;
            summary.overdueAmount += debtRemaining(debt);
        }
    });

    return summary;
}

// --- DISPLAY FORMATS AND MONEY FIELDS ---

/** YYYY-MM-DD -> DD/MM/YYYY for display; anything else is returned unchanged. */
function formatDateDisplay(dateKey) {
    const text = String(dateKey ?? '');
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);

    return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}

/**
 * Group the digits typed in a money field: "1234567" -> "1.234.567". Everything that is not a
 * digit is dropped; a leading "-" is kept only when negative numbers are allowed.
 * Zeros in front ("007") are dropped too, unless keepLeadingZeros is set: deleting the first digit
 * of "20.000" leaves "0.000", and that must stay so a new first digit can be typed ("50.000")
 * instead of the three zeros vanishing.
 */
function formatMoneyDigits(text, allowNegative = false, { keepLeadingZeros = false } = {}) {
    const negative = allowNegative && /^\s*-/.test(String(text ?? ''));
    const typed = String(text ?? '').replace(/\D/g, '');
    const digits = (keepLeadingZeros ? typed : typed.replace(/^0+(?=\d)/, '')).slice(0, 15);

    if (!digits) return negative ? '-' : '';

    return (negative ? '-' : '') + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** The number in a money field ("1.500.000", "-20.000"); NaN when empty or not a number. */
function parseMoneyText(text) {
    const cleaned = String(text ?? '').replace(/[.,\s]/g, '');

    return /^-?\d+$/.test(cleaned) ? Number(cleaned) : NaN;
}
