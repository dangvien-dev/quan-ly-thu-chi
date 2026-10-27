// Shared application state and local persistence.

let currentType = 'expense';
let transactions = JSON.parse(localStorage.getItem('fm_transactions')) || [];
let categories = JSON.parse(localStorage.getItem('fm_categories')) || [
    { id: 1, name: 'Ăn uống', type: 'expense', icon: 'fa-utensils' },
    { id: 2, name: 'Mua sắm', type: 'expense', icon: 'fa-cart-shopping' },
    { id: 3, name: 'Đi lại', type: 'expense', icon: 'fa-gas-pump' },
    { id: 4, name: 'Hóa đơn & Tiện ích', type: 'expense', icon: 'fa-bolt' },
    { id: 5, name: 'Lương / Thưởng', type: 'income', icon: 'fa-money-bill-wave' },
    { id: 6, name: 'Thu nhập khác', type: 'income', icon: 'fa-circle-plus' },
];
let sources = ['Tiền Mặt', 'Thẻ Ngân Hàng', 'Thẻ Tín Dụng', 'Spaylater', 'Nợ Công Ty'];
let webAppUrl = localStorage.getItem('fm_script_url') || '';
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
