// Application startup, overview rendering, and the existing reset-data action.

function renderOverview() {
    let totalIncome = 0;
    let totalExpense = 0;

    transactions.forEach((transaction) => {
        if (transaction.type === 'income') {
            totalIncome += transaction.amount;
        } else if (transaction.type === 'expense') {
            totalExpense += transaction.amount;
        }
    });

    const incomeElement = document.getElementById('lbl-total-income');
    const expenseElement = document.getElementById('lbl-total-expense');
    const balanceElement = document.getElementById('lbl-total-balance');

    if (incomeElement) {
        incomeElement.innerText = totalIncome.toLocaleString() + ' đ';
    }

    if (expenseElement) {
        expenseElement.innerText = totalExpense.toLocaleString() + ' đ';
    }

    if (balanceElement) {
        balanceElement.innerText = (totalIncome - totalExpense).toLocaleString() + ' đ';
    }

    renderCharts();
}

function renderAll() {
    renderTransactions();
    renderOverview();
    renderSources();
    renderCategories();
}

function initializeApp() {
    const urlInput = document.getElementById('setting-script-url');

    if (urlInput && webAppUrl) {
        urlInput.value = webAppUrl;
    }

    const txDateEl = document.getElementById('txDate');

    if (txDateEl) {
        txDateEl.value = new Date().toISOString().split('T')[0];
    }

    updateCategoriesDropdown();
    renderAll();
    syncFromGoogleSheet();
    renderQuickChips();
}

function resetAllData() {
    if (!confirm('Xóa toàn bộ dữ liệu?')) return;

    transactions = [];
    saveDataLocally();
    renderAll();
    syncToGoogleSheet();
}

window.addEventListener('load', initializeApp);
