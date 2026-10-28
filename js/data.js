// Shared application state and local persistence.

const DEFAULT_CATEGORIES = [
    { id: 1, name: 'Ăn uống', type: 'expense', icon: 'fa-utensils' },
    { id: 2, name: 'Mua sắm', type: 'expense', icon: 'fa-cart-shopping' },
    { id: 3, name: 'Đi lại', type: 'expense', icon: 'fa-gas-pump' },
    { id: 4, name: 'Hóa đơn & Tiện ích', type: 'expense', icon: 'fa-bolt' },
    { id: 5, name: 'Lương / Thưởng', type: 'income', icon: 'fa-money-bill-wave' },
    { id: 6, name: 'Thu nhập khác', type: 'income', icon: 'fa-circle-plus' },
];

/**
 * Read JSON from local storage without letting a corrupted value stop the whole app.
 * A value that cannot be parsed is copied to "<key>.corrupt" so it can still be recovered.
 */
function readStoredJson(key, fallback) {
    let raw = null;

    try {
        raw = localStorage.getItem(key);

        return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
        console.warn(`Không đọc được "${key}" từ localStorage, dùng giá trị mặc định.`, error);

        try {
            if (raw !== null) localStorage.setItem(`${key}.corrupt`, raw);
        } catch {
            // Nothing else to do: storage is unavailable or full.
        }

        return fallback;
    }
}

function readStoredText(key) {
    try {
        return localStorage.getItem(key) || '';
    } catch {
        return '';
    }
}

const DEFAULT_SOURCES = [
    { name: 'Tiền Mặt', kind: 'cash' },
    { name: 'Thẻ Ngân Hàng', kind: 'bank' },
    { name: 'Thẻ Tín Dụng', kind: 'credit' },
    { name: 'Spaylater', kind: 'credit' },
    { name: 'Nợ Công Ty', kind: 'debt' },
];

/**
 * Data that is not a transaction ("meta"): stored under its own key, stamped with the time of
 * the last change, and synchronized as a whole by js/sync.js.
 *  - storage: localStorage key; fallback: value when nothing valid is stored;
 *  - normalize: returns the cleaned value, or null when the input is unusable.
 */
const META_DEFS = {
    categories: {
        storage: 'fm_categories',
        fallback: () => DEFAULT_CATEGORIES.map((category) => ({ ...category })),
        normalize: normalizeCategories,
    },
    sources: {
        storage: 'fm_sources',
        fallback: () => DEFAULT_SOURCES.map((source) => normalizeSource(source)),
        normalize: normalizeSources,
    },
    initialBalances: {
        storage: 'fm_initial_balances',
        fallback: () => ({}),
        normalize: normalizeBalances,
    },
    budgets: {
        storage: 'fm_budgets',
        fallback: () => ({}),
        normalize: normalizeBudgets,
    },
    recurring: {
        storage: 'fm_recurring',
        fallback: () => [],
        normalize: normalizeRecurringRules,
    },
    debts: {
        storage: 'fm_debts',
        fallback: () => [],
        normalize: normalizeDebts,
    },
};
const META_UPDATED_KEY = 'fm_meta_updated';

function loadMeta(key) {
    const definition = META_DEFS[key];
    const value = definition.normalize(readStoredJson(definition.storage, null));

    return value === null ? definition.fallback() : value;
}

let currentType = 'expense';
let transactions = normalizeTransactions(readStoredJson('fm_transactions', []));
let categories = loadMeta('categories');
let sources = loadMeta('sources');
let initialBalances = loadMeta('initialBalances');
let budgets = loadMeta('budgets');
let recurring = loadMeta('recurring');
let debts = loadMeta('debts');
let webAppUrl = readStoredText('fm_script_url');
let webAppToken = readStoredText('fm_script_token');
let expenseChart = null;
let monthlyChart = null;
let editingId = null;

const META_ACCESSORS = {
    categories: { get: () => categories, set: (value) => (categories = value) },
    sources: { get: () => sources, set: (value) => (sources = value) },
    initialBalances: { get: () => initialBalances, set: (value) => (initialBalances = value) },
    budgets: { get: () => budgets, set: (value) => (budgets = value) },
    recurring: { get: () => recurring, set: (value) => (recurring = value) },
    debts: { get: () => debts, set: (value) => (debts = value) },
};

function readMetaUpdated() {
    const stored = readStoredJson(META_UPDATED_KEY, {});

    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

/** Record when a meta value last changed (an ISO time; the sync keeps the newest). */
function stampMeta(key, isoTime = new Date().toISOString()) {
    const updated = readMetaUpdated();

    updated[key] = isoTime;
    localStorage.setItem(META_UPDATED_KEY, JSON.stringify(updated));
}

/** Persist one meta value after a local change and tell the sync layer about it. */
function saveMeta(key) {
    localStorage.setItem(META_DEFS[key].storage, JSON.stringify(META_ACCESSORS[key].get()));
    stampMeta(key);
    queueMeta(key);
}

/** Store a meta value that came from the server: not a local change, so nothing is queued. */
function storeMetaValue(key, value, isoTime) {
    META_ACCESSORS[key].set(value);
    localStorage.setItem(META_DEFS[key].storage, JSON.stringify(value));
    stampMeta(key, isoTime);
}

/**
 * Persist transactions to local storage.
 * Other application data is saved by the function that owns that data.
 */
function saveDataLocally() {
    localStorage.setItem('fm_transactions', JSON.stringify(transactions));
}
