// Monthly budgets per expense category: editing, overview progress bars, and threshold alerts.

function getBudgetStatus() {
    return computeBudgetStatus(transactions, budgets, currentMonthKey());
}

function renderBudgets() {
    const section = document.getElementById('budget-section');
    const list = document.getElementById('budget-list');

    if (!section || !list) return;

    const status = getBudgetStatus();

    section.hidden = status.length === 0;
    list.innerHTML = status
        .map((item) => {
            const level = budgetLevel(item.ratio);
            const percent = Math.round(item.ratio * 100);

            return `<div class="budget-item level-${level}">
                <div class="budget-head">
                    <span class="budget-name">${escapeHtml(item.category)}</span>
                    <span class="budget-amount">${formatMoney(item.spent)} / ${formatMoney(item.limit)} · <b>${percent}%</b></span>
                </div>
                <div class="progress" role="progressbar" aria-label="Ngân sách ${escapeHtml(item.category)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(percent, 100)}">
                    <div class="progress-bar" style="width:${Math.min(percent, 100)}%"></div>
                </div>
            </div>`;
        })
        .join('');
}

async function editBudget(categoryId) {
    const category = categories.find((item) => String(item.id) === String(categoryId));

    if (!category || category.type !== 'expense') return;

    const limit = await askMoney({
        title: 'Ngân sách tháng',
        message: `Nhập ngân sách tháng cho [${category.name}] (để trống hoặc 0 để bỏ):`,
        value: budgets[category.name] || '',
        allowEmpty: true,
    });

    if (limit === null) return;

    if (!Number.isFinite(limit) || limit < 0) {
        alert('Số tiền không hợp lệ!');
        return;
    }

    if (limit > 0) {
        budgets[category.name] = Math.round(limit);
    } else {
        delete budgets[category.name];
    }

    saveMeta('budgets');
    syncToGoogleSheet();
    renderAll();
}

/**
 * After a new expense, warn if it pushed its category over 80% or 100% of this month's budget.
 * Only a crossing triggers a message, so later expenses in the same band stay quiet.
 */
function notifyBudget(transaction) {
    const limit = budgets[transaction.category];

    if (
        !limit ||
        transaction.type !== 'expense' ||
        !transaction.date.startsWith(currentMonthKey())
    ) {
        return;
    }

    const item = getBudgetStatus().find((status) => status.category === transaction.category);
    const before = budgetLevel((item.spent - transaction.amount) / limit);
    const after = budgetLevel(item.ratio);

    if (after <= before) return;

    const detail = `${formatMoney(item.spent)} / ${formatMoney(limit)} (${Math.round(item.ratio * 100)}%)`;

    if (after === 2) {
        showToast(`Đã vượt ngân sách "${item.category}": ${detail}`, 'danger');
    } else {
        showToast(`Sắp hết ngân sách "${item.category}": ${detail}`, 'warning');
    }
}
