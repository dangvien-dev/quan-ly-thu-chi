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
const SOURCE_KINDS = {
    cash: { label: 'Tiền mặt', debt: false },
    bank: { label: 'Ngân hàng', debt: false },
    ewallet: { label: 'Ví điện tử', debt: false },
    credit: { label: 'Thẻ tín dụng / Trả sau', debt: true },
    debt: { label: 'Khoản nợ', debt: true },
    other: { label: 'Khác', debt: false },
};

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

    return {
        name,
        kind,
        creditLimit: kind === 'credit' ? Math.max(0, Number(source.creditLimit) || 0) : 0,
        statementDay: kind === 'credit' ? dayOfMonthOrNull(source.statementDay) : null,
        dueDay: kind === 'credit' ? dayOfMonthOrNull(source.dueDay) : null,
        archived: Boolean(source.archived),
    };
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
 * filters: { month: 'YYYY-MM', type, category, source, search }; empty or 'ALL' means no filter.
 * source matches either side of a transfer; every word of search must match.
 */
function filterTransactions(list, filters = {}) {
    const words = normalizeSearchText(filters.search).split(' ').filter(Boolean);
    const active = (value) => value && value !== 'ALL';

    return list.filter((transaction) => {
        if (filters.month && !transaction.date.startsWith(filters.month)) return false;
        if (active(filters.type) && transaction.type !== filters.type) return false;
        if (active(filters.category) && transaction.category !== filters.category) return false;

        if (
            active(filters.source) &&
            transaction.source !== filters.source &&
            transaction.targetSource !== filters.source
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

const CSV_HEADER = ['Ngày', 'Loại', 'Nguồn tiền', 'Nguồn nhận', 'Danh mục', 'Số tiền', 'Ghi chú'];
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
            csvCell(transaction.note),
        ]),
    );

    return '\uFEFF' + lines.map((line) => line.join(',')).join('\r\n') + '\r\n';
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
 */
function formatMoneyDigits(text, allowNegative = false) {
    const negative = allowNegative && /^\s*-/.test(String(text ?? ''));
    const digits = String(text ?? '')
        .replace(/\D/g, '')
        .replace(/^0+(?=\d)/, '')
        .slice(0, 15);

    if (!digits) return negative ? '-' : '';

    return (negative ? '-' : '') + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** The number in a money field ("1.500.000", "-20.000"); NaN when empty or not a number. */
function parseMoneyText(text) {
    const cleaned = String(text ?? '').replace(/[.,\s]/g, '');

    return /^-?\d+$/.test(cleaned) ? Number(cleaned) : NaN;
}
