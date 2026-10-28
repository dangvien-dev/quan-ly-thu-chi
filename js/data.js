// Shared application state and local persistence.

const DEFAULT_CATEGORIES = [
    { id: 1, name: 'Ăn uống', type: 'expense', icon: 'fa-utensils' },
    { id: 2, name: 'Mua sắm', type: 'expense', icon: 'fa-cart-shopping' },
    { id: 3, name: 'Đi lại', type: 'expense', icon: 'fa-gas-pump' },
    { id: 4, name: 'Hóa đơn & Tiện ích', type: 'expense', icon: 'fa-bolt' },
    { id: 5, name: 'Lương / Thưởng', type: 'income', icon: 'fa-money-bill-wave' },
    { id: 6, name: 'Thu nhập khác', type: 'income', icon: 'fa-circle-plus' },
];

// Sources whose negative balance is money owed. They are excluded from the available balance.
const DEBT_SOURCES = ['Thẻ Tín Dụng', 'Spaylater', 'Nợ Công Ty'];

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

function readStoredCategories() {
    const stored = readStoredJson('fm_categories', null);

    if (!Array.isArray(stored)) {
        return DEFAULT_CATEGORIES.map((category) => ({ ...category }));
    }

    return stored.filter(
        (category) =>
            category &&
            category.name &&
            (category.type === 'income' || category.type === 'expense'),
    );
}

let currentType = 'expense';
let transactions = normalizeTransactions(readStoredJson('fm_transactions', []));
let categories = readStoredCategories();
let sources = ['Tiền Mặt', 'Thẻ Ngân Hàng', 'Thẻ Tín Dụng', 'Spaylater', 'Nợ Công Ty'];
let webAppUrl = readStoredText('fm_script_url');
let expenseChart = null;
let monthlyChart = null;
let editingId = null;

/**
 * Persist transactions to local storage.
 * Other application data is saved by the function that owns that data.
 */
function saveDataLocally() {
    localStorage.setItem('fm_transactions', JSON.stringify(transactions));
}
