// Debt ledger: money the user owes ("owe") and money owed to the user ("owed"), with part payments.

let editingDebtId = null;
const expandedDebtIds = new Set();
const DEBT_REMINDER_KEY = 'fm_debt_reminder_day';
// The money source last chosen when paying a debt (on this device), offered again next time.
const DEBT_PAY_SOURCE_KEY = 'fm_debt_pay_source';
let payingDebtId = null;

// What a payment writes into the money sources: paying what I owe is an expense, collecting what
// is owed to me is income.
const DEBT_PAY_RULES = {
    owe: { type: 'expense', category: 'Trả nợ', verb: 'Trả nợ', icon: 'fa-hand-holding-dollar' },
    owed: { type: 'income', category: 'Thu nợ', verb: 'Thu nợ', icon: 'fa-hand-holding-dollar' },
};

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
              .map((payment) => {
                  const written = payment.transactionId
                      ? transactions.find((item) => item.id === payment.transactionId)
                      : null;
                  const where = written
                      ? `<span class="source-meta">đã ghi vào ${escapeHtml(written.source)}</span>`
                      : '';

                  return `<li>
                    <span>${escapeHtml(formatDateDisplay(payment.date))}</span>
                    <b>${formatMoney(payment.amount)}</b>
                    ${where}
                    <button class="btn btn-outline btn-small" data-action="delete-payment" data-id="${id}" data-payment="${escapeHtml(payment.id)}" title="Xóa lần thanh toán này" aria-label="Xóa lần thanh toán ${formatMoney(payment.amount)}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </li>`;
              })
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
        pay: () => openDebtPayModal(id),
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

// --- PAYMENT DIALOG ---
/** Sources a payment can be written into: any that is in use, except the savings books. */
function debtPaySources() {
    return sourceNames().filter((name) => !isSavingsKind(findSource(name)));
}

function openDebtPayModal(id) {
    const debt = debts.find((item) => item.id === id);

    if (!debt) return;

    const rule = DEBT_PAY_RULES[debt.direction];
    const remaining = debtRemaining(debt);
    const remembered = readStoredText(DEBT_PAY_SOURCE_KEY);
    const select = document.getElementById('debtPaySource');

    payingDebtId = id;
    document.getElementById('debtPayTitle').innerText = rule.verb;
    document.getElementById('debtPayMessage').innerText =
        `${debt.direction === 'owe' ? 'Số tiền đã trả cho' : 'Số tiền đã thu từ'} [${debt.party}] (còn ${formatMoney(remaining)}):`;
    setMoneyInput('debtPayAmount', remaining);
    document.getElementById('debtPayDate').value = toLocalDateString();
    select.innerHTML =
        '<option value="">Không ghi giao dịch</option>' +
        debtPaySources()
            .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
            .join('');
    select.value = debtPaySources().includes(remembered) ? remembered : '';
    updateDebtPayHint();
    openDialog('debtPayModal', 'debtPayAmount');
    document.getElementById('debtPayAmount').select();
}

function closeDebtPayModal() {
    payingDebtId = null;
    closeDialog('debtPayModal');
}

/** Say what choosing a source does, so the money is not written twice by mistake. */
function updateDebtPayHint() {
    const debt = debts.find((item) => item.id === payingDebtId);
    const source = document.getElementById('debtPaySource').value;
    const hint = document.getElementById('debtPaySourceHint');

    if (!debt) return;

    if (!source) {
        hint.textContent =
            'Chỉ ghi vào sổ vay nợ, không tạo giao dịch và không đổi số dư nguồn tiền.';
        return;
    }

    const rule = DEBT_PAY_RULES[debt.direction];

    hint.textContent =
        debt.direction === 'owe'
            ? `Tạo giao dịch Chi "${rule.category}" từ ${source}: số dư ${source} giảm tương ứng.`
            : `Tạo giao dịch Thu "${rule.category}" vào ${source}: số dư ${source} tăng tương ứng.`;
}

/** The category a payment is filed under; added to the list the first time it is needed. */
function ensureDebtCategory(rule) {
    ensureCategory(rule.category, rule.type, rule.icon);
}

/**
 * `P_<ms>` for a new payment. The id of the transaction it writes is derived from it, so a counter
 * is added when that id is already taken (two payments in the same millisecond must not share one).
 */
function newDebtPaymentId(debt) {
    const taken = new Set(debt.payments.map((payment) => payment.id));
    const base = `P_${Date.now()}`;
    let id = base;
    let counter = 1;

    while (taken.has(id) || transactions.some((item) => item.id === `TX_DEBT_${id}`)) {
        id = `${base}_${counter++}`;
    }

    return id;
}

/** Write a payment into a money source as a transaction; returns its id. */
function recordDebtTransaction(debt, payment, sourceName) {
    const rule = DEBT_PAY_RULES[debt.direction];
    const id = `TX_DEBT_${payment.id}`;

    ensureDebtCategory(rule);
    transactions.unshift({
        id,
        date: payment.date,
        type: rule.type,
        source: sourceName,
        targetSource: null,
        category: rule.category,
        amount: payment.amount,
        note: `${rule.verb} ${debt.party}`,
        updatedAt: new Date().toISOString(),
    });
    saveDataLocally();
    queueUpsert([id]);

    return id;
}

function handleDebtPaySubmit(event) {
    event.preventDefault();

    // A sync may have replaced the list while the dialog was open: work on what is there now.
    const debt = debts.find((item) => item.id === payingDebtId);

    if (!debt) {
        closeDebtPayModal();
        return;
    }

    const amount = readMoneyInput('debtPayAmount');
    const date = normalizeDate(document.getElementById('debtPayDate').value);
    const sourceName = document.getElementById('debtPaySource').value;

    if (!(amount > 0)) {
        alert('Số tiền không hợp lệ!');
        return;
    }

    if (amount > debtRemaining(debt)) {
        alert(`Số tiền vượt quá số còn lại (${formatMoney(debtRemaining(debt))}).`);
        return;
    }

    if (!date) {
        alert('Vui lòng chọn ngày hợp lệ!');
        return;
    }

    if (sourceName && !debtPaySources().includes(sourceName)) {
        alert('Nguồn tiền này không còn dùng được. Hãy chọn nguồn khác.');
        return;
    }

    const payment = { id: newDebtPaymentId(debt), date, amount };

    if (sourceName) payment.transactionId = recordDebtTransaction(debt, payment, sourceName);

    try {
        localStorage.setItem(DEBT_PAY_SOURCE_KEY, sourceName);
    } catch {
        // Not being able to remember the choice is harmless.
    }

    debt.payments.push(payment);
    debt.updatedAt = new Date().toISOString();
    expandedDebtIds.add(debt.id);
    closeDebtPayModal();
    saveDebts();

    if (sourceName) {
        showToast(
            `Đã ghi giao dịch ${DEBT_PAY_RULES[debt.direction].type === 'expense' ? 'Chi' : 'Thu'} ${formatMoney(amount)} ${debt.direction === 'owe' ? 'từ' : 'vào'} ${sourceName}.`,
            'success',
        );
    }
}

function deleteDebtPayment(debtId, paymentId) {
    const debt = debts.find((item) => item.id === debtId);
    const payment = debt && debt.payments.find((item) => item.id === paymentId);

    if (!payment) return;

    const written =
        payment.transactionId && transactions.some((item) => item.id === payment.transactionId);
    const question = written
        ? 'Xóa lần thanh toán này? Giao dịch đã ghi từ lần này cũng sẽ bị xóa.'
        : 'Xóa lần thanh toán này?';

    if (!confirm(question)) return;

    if (written) {
        transactions = transactions.filter((item) => item.id !== payment.transactionId);
        queueDelete([payment.transactionId]);
        saveDataLocally();
    }

    debt.payments = debt.payments.filter((item) => item.id !== paymentId);
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
    document.getElementById('debtPaySource').addEventListener('change', updateDebtPayHint);
}
