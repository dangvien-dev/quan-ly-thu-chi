// Debt ledger: money the user owes ("owe") and money owed to the user ("owed"), with part payments.

let editingDebtId = null;
const expandedDebtIds = new Set();
const DEBT_REMINDER_KEY = 'fm_debt_reminder_day';

const DEBT_DIRECTION_LABELS = { owe: 'Tôi nợ', owed: 'Họ nợ tôi' };

// --- RENDERING ---
function debtStatusBadge(debt, today) {
    const status = debtStatus(debt, today);

    if (status === 'settled') return '<span class="status-badge status-ended">Đã tất toán</span>';

    if (status === 'overdue') {
        const days = Math.round((parseLocalDate(today) - parseLocalDate(debt.dueDate)) / 86400000);

        return `<span class="status-badge status-overdue">Quá hạn ${days} ngày</span>`;
    }

    if (status === 'soon') return '<span class="status-badge status-paused">Sắp đến hạn</span>';

    return '<span class="status-badge status-active">Đang nợ</span>';
}

function renderDebtDetails(debt) {
    const id = escapeHtml(debt.id);
    const payments = debt.payments.length
        ? debt.payments
              .map(
                  (payment) => `<li>
                    <span>${escapeHtml(formatDateDisplay(payment.date))}</span>
                    <b>${formatMoney(payment.amount)}</b>
                    <button class="btn btn-outline btn-small" data-action="delete-payment" data-id="${id}" data-payment="${escapeHtml(payment.id)}" title="Xóa lần thanh toán này" aria-label="Xóa lần thanh toán ${formatMoney(payment.amount)}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </li>`,
              )
              .join('')
        : '<li class="source-meta">Chưa có lần thanh toán nào.</li>';

    return `<tr class="debt-details">
        <td colspan="8">
            <div class="source-meta">Ngày vay: ${escapeHtml(debt.date ? formatDateDisplay(debt.date) : '—')}${debt.note ? ` · ${escapeHtml(debt.note)}` : ''}</div>
            <ul class="payment-list">${payments}</ul>
        </td>
    </tr>`;
}

function renderDebts() {
    const tbody = document.getElementById('debt-table-body');

    if (!tbody) return;

    const today = toLocalDateString();
    const summary = summarizeDebts(debts, today);
    const hideSettled = document.getElementById('debt-hide-settled').checked;

    setMoneyLabel('lbl-debt-owe', summary.owe);
    setMoneyLabel('lbl-debt-owed', summary.owed);
    document.getElementById('lbl-debt-overdue').innerText =
        summary.overdueCount === 0
            ? 'Không có'
            : `${summary.overdueCount} khoản · ${formatMoney(summary.overdueAmount)}`;

    const visible = debts
        .filter((debt) => !hideSettled || debtStatus(debt, today) !== 'settled')
        .sort((a, b) => ((a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1));

    if (visible.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="8" style="text-align:center; color: var(--text-muted);">${debts.length ? 'Không có khoản nào đang nợ' : 'Chưa có khoản vay nợ'}</td></tr>`;
        return;
    }

    tbody.innerHTML = visible
        .map((debt) => {
            const id = escapeHtml(debt.id);
            const settled = debtRemaining(debt) === 0;
            const color = debt.direction === 'owe' ? 'var(--danger)' : 'var(--success)';
            const expanded = expandedDebtIds.has(debt.id);
            const payLabel = debt.direction === 'owe' ? 'Ghi khoản trả' : 'Ghi khoản thu';

            return `<tr>
            <td data-label="Đối tác"><b>${escapeHtml(debt.party)}</b></td>
            <td data-label="Loại"><span style="color:${color}; font-weight:600;">${DEBT_DIRECTION_LABELS[debt.direction]}</span></td>
            <td data-label="Số tiền gốc">${formatMoney(debt.amount)}</td>
            <td data-label="Đã thanh toán">${formatMoney(debtPaid(debt))}</td>
            <td data-label="Còn lại" style="font-weight:700; color:${color};">${formatMoney(debtRemaining(debt))}</td>
            <td data-label="Hạn">${escapeHtml(debt.dueDate ? formatDateDisplay(debt.dueDate) : '—')}</td>
            <td data-label="Trạng thái">${debtStatusBadge(debt, today)}</td>
            <td class="row-actions" style="text-align:right; white-space:nowrap;">
                ${settled ? '' : `<button class="btn btn-outline btn-small" data-action="pay" data-id="${id}" title="${payLabel}" aria-label="${payLabel} ${escapeHtml(debt.party)}"><i class="fa-solid fa-coins"></i></button>`}
                <button class="btn btn-outline btn-small" data-action="history" data-id="${id}" title="Lịch sử thanh toán" aria-label="Lịch sử thanh toán ${escapeHtml(debt.party)}" aria-expanded="${expanded}"><i class="fa-solid fa-list"></i></button>
                <button class="btn btn-outline btn-small" data-action="edit" data-id="${id}" title="Sửa" aria-label="Sửa khoản của ${escapeHtml(debt.party)}"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-outline btn-small" data-action="delete" data-id="${id}" title="Xóa" aria-label="Xóa khoản của ${escapeHtml(debt.party)}"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>${expanded ? renderDebtDetails(debt) : ''}`;
        })
        .join('');
}

function handleDebtTableClick(event) {
    const button = event.target.closest('button[data-action]');

    if (!button) return;

    const { action, id, payment } = button.dataset;
    const actions = {
        pay: () => addDebtPayment(id),
        history: () => toggleDebtHistory(id),
        edit: () => openDebtModal(id),
        delete: () => deleteDebt(id),
        'delete-payment': () => deleteDebtPayment(id, payment),
    };

    if (actions[action]) actions[action]();
}

function saveDebts() {
    saveMeta('debts');
    syncToGoogleSheet();
    renderAll();
}

// --- ACTIONS ---
function toggleDebtHistory(id) {
    if (expandedDebtIds.has(id)) expandedDebtIds.delete(id);
    else expandedDebtIds.add(id);

    renderDebts();
}

async function addDebtPayment(id) {
    const debt = debts.find((item) => item.id === id);

    if (!debt) return;

    const remaining = debtRemaining(debt);
    const amount = await askMoney({
        title: debt.direction === 'owe' ? 'Trả nợ' : 'Thu nợ',
        message: `${debt.direction === 'owe' ? 'Số tiền đã trả cho' : 'Số tiền đã thu từ'} [${debt.party}] (còn ${formatMoney(remaining)}):`,
        value: remaining,
    });

    if (amount === null) return;

    if (!(amount > 0)) {
        alert('Số tiền không hợp lệ!');
        return;
    }

    // A sync may have replaced the list while the question was open: work on what is there now.
    const current = debts.find((item) => item.id === id);

    if (!current) return;

    if (amount > debtRemaining(current)) {
        alert(`Số tiền vượt quá số còn lại (${formatMoney(debtRemaining(current))}).`);
        return;
    }

    current.payments.push({ id: `P_${Date.now()}`, date: toLocalDateString(), amount });
    current.updatedAt = new Date().toISOString();
    expandedDebtIds.add(id);
    saveDebts();
}

function deleteDebtPayment(debtId, paymentId) {
    const debt = debts.find((item) => item.id === debtId);

    if (!debt || !confirm('Xóa lần thanh toán này?')) return;

    debt.payments = debt.payments.filter((payment) => payment.id !== paymentId);
    debt.updatedAt = new Date().toISOString();
    saveDebts();
}

function deleteDebt(id) {
    const debt = debts.find((item) => item.id === id);

    if (!debt || !confirm(`Xóa khoản vay nợ với "${debt.party}"?`)) return;

    debts = debts.filter((item) => item !== debt);
    expandedDebtIds.delete(id);
    saveDebts();
}

// --- EDITOR ---
function openDebtModal(id = null) {
    const debt = id ? debts.find((item) => item.id === id) : null;

    editingDebtId = debt ? debt.id : null;
    document.getElementById('debtModalTitle').innerText = debt
        ? 'Sửa Khoản Vay Nợ'
        : 'Thêm Khoản Vay Nợ';
    document.getElementById('debtParty').value = debt ? debt.party : '';
    document.getElementById('debtDirection').value = debt ? debt.direction : 'owe';
    setMoneyInput('debtAmount', debt ? debt.amount : '');
    document.getElementById('debtDate').value = debt ? debt.date : toLocalDateString();
    document.getElementById('debtDue').value = debt ? debt.dueDate : '';
    document.getElementById('debtNote').value = debt ? debt.note : '';
    openDialog('debtModal', 'debtParty');
}

function closeDebtModal() {
    editingDebtId = null;
    closeDialog('debtModal');
}

function handleDebtSubmit(event) {
    event.preventDefault();

    const existing = editingDebtId ? debts.find((item) => item.id === editingDebtId) : null;
    const debt = normalizeDebt({
        id: existing ? existing.id : `DB_${Date.now()}`,
        party: document.getElementById('debtParty').value,
        direction: document.getElementById('debtDirection').value,
        amount: readMoneyInput('debtAmount'),
        date: document.getElementById('debtDate').value,
        dueDate: document.getElementById('debtDue').value,
        note: document.getElementById('debtNote').value.trim(),
        payments: existing ? existing.payments : [],
        updatedAt: new Date().toISOString(),
    });

    if (!debt) {
        alert('Vui lòng nhập đối tác và số tiền hợp lệ!');
        return;
    }

    if (existing && debt.amount < debtPaid(existing)) {
        alert(
            `Số tiền gốc không được nhỏ hơn số đã thanh toán (${formatMoney(debtPaid(existing))}).`,
        );
        return;
    }

    if (debt.dueDate && debt.date && debt.dueDate < debt.date) {
        alert('Hạn thanh toán phải sau ngày vay!');
        return;
    }

    if (existing) {
        debts[debts.indexOf(existing)] = debt;
    } else {
        debts.push(debt);
    }

    closeDebtModal();
    saveDebts();
}

/** Remind once a day when something is past its due date. */
function remindOverdueDebts() {
    const today = toLocalDateString();
    const { overdueCount, overdueAmount } = summarizeDebts(debts, today);

    if (overdueCount === 0 || readStoredText(DEBT_REMINDER_KEY) === today) return;

    try {
        localStorage.setItem(DEBT_REMINDER_KEY, today);
    } catch {
        // Not being able to remember the reminder is harmless.
    }

    showToast(
        `Có ${overdueCount} khoản vay nợ quá hạn (${formatMoney(overdueAmount)}). Xem tab Vay Nợ.`,
        'warning',
        10000,
    );
}

function initDebts() {
    document.getElementById('debt-table-body').addEventListener('click', handleDebtTableClick);
    document.getElementById('debt-hide-settled').addEventListener('change', renderDebts);
}
