// Application startup, overview rendering, and the existing reset-data action.

/** Total income and expense of transactions dated in the given month (YYYY-MM). */
function summarizeMonth(monthKey) {
    const summary = { income: 0, expense: 0 };

    transactions.forEach((transaction) => {
        if (!transaction.date.startsWith(monthKey)) return;

        if (transaction.type === 'income') {
            summary.income += transaction.amount;
        } else if (transaction.type === 'expense') {
            summary.expense += transaction.amount;
        }
    });

    return summary;
}

function setMoneyLabel(elementId, amount) {
    const element = document.getElementById(elementId);

    if (element) {
        element.innerText = formatMoney(amount);
    }
}

function renderOverview() {
    const thisMonth = summarizeMonth(currentMonthKey());
    const balances = calculateSourceBalances();

    const isDebt = (source) => SOURCE_KINDS[source.kind].debt;
    const availableBalance = sources
        .filter((source) => !isDebt(source))
        .reduce((total, source) => total + balances[source.name], 0);
    const totalDebt = sources
        .filter(isDebt)
        .reduce((total, source) => total + Math.max(0, -balances[source.name]), 0);

    setMoneyLabel('lbl-total-income', thisMonth.income);
    setMoneyLabel('lbl-total-expense', thisMonth.expense);
    setMoneyLabel('lbl-total-balance', availableBalance);
    setMoneyLabel('lbl-total-debt', totalDebt);

    renderCharts();
}

function renderAll() {
    ensureSourcesForTransactions();

    // A failure in one view (for example the charts) must not stop the others from rendering.
    [renderTransactions, renderOverview, renderSources, renderCategories].forEach((render) => {
        try {
            render();
        } catch (error) {
            console.error(`Lỗi khi hiển thị (${render.name}):`, error);
        }
    });
}

function initializeApp() {
    const urlInput = document.getElementById('setting-script-url');

    if (urlInput && webAppUrl) {
        urlInput.value = webAppUrl;
    }

    document
        .getElementById('transaction-table-body')
        .addEventListener('click', handleTransactionTableClick);
    document
        .getElementById('category-table-body')
        .addEventListener('click', handleCategoryTableClick);
    document.getElementById('sources-grid').addEventListener('click', handleSourceGridClick);
    document.getElementById('sources-archived').addEventListener('click', handleSourceGridClick);
    document.getElementById('srcKind').innerHTML = Object.entries(SOURCE_KINDS)
        .map(([kind, { label }]) => `<option value="${kind}">${label}</option>`)
        .join('');

    initTransactionFilters();
    initModalShortcuts();
    window.addEventListener('online', resumeSync);

    document.getElementById('txDate').value = toLocalDateString();

    updateCategoriesDropdown();
    renderAll();
    renderQuickChips();
    syncFromGoogleSheet();
}

function resetAllData() {
    const confirmed = confirm(
        'Xóa toàn bộ giao dịch? Nếu đã bật đồng bộ, dữ liệu trên Google Sheets cũng bị xóa. Hãy "Sao lưu dữ liệu" trước nếu cần giữ lại.',
    );

    if (!confirmed) return;

    transactions = [];
    saveDataLocally();
    renderAll();
    syncToGoogleSheet('replace');
}

window.addEventListener('load', initializeApp);
