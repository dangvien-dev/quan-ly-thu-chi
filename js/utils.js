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
 * filters: { month: 'YYYY-MM', type, category, source, sources, tag, search }; empty or 'ALL' means
 * no filter. tag keeps the transactions that carry that tag (spelling and case do not matter). source matches either side of a transfer; sources (a list of names) keeps transactions
 * that touch any of them on either side; every word of search must match.
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

    if (source.statementDay) {
        const statement = previousDayOfMonth(source.statementDay, today);

        statementKey = toLocalDateString(statement);
        due = nextDayOfMonth(source.dueDay, addDays(statement, 1));

        const paidSince = list.reduce((total, transaction) => {
            if (transaction.date <= statementKey || transaction.date > todayKey) return total;

            return total + Math.max(0, sourceEffect(transaction, source.name));
        }, 0);

        amount = Math.max(0, -balanceUpTo(statementKey) - paidSince);
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
    };
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
