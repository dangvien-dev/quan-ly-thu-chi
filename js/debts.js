// Debt ledger: money the user owes ("owe") and money owed to the user ("owed"), with part payments.

let editingDebtId = null;
const expandedDebtIds = new Set();
const DEBT_REMINDER_KEY = 'fm_debt_reminder_day';
// The money source last chosen when paying a debt (on this device), offered again next time.
const DEBT_PAY_SOURCE_KEY = 'fm_debt_pay_source';
let payingDebtId = null;
// The payment being edited in the same dialog; null while a new one is added.
let editingPaymentId = null;

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

/** The transaction a payment wrote into a money source, if it is still in the book. */
function debtPaymentTransaction(payment) {
    return payment.transactionId
        ? transactions.find((item) => item.id === payment.transactionId)
        : undefined;
}

function renderDebtDetails(debt) {
    const id = escapeHtml(debt.id);
    const payments = debt.payments.length
        ? debt.payments
              .map((payment) => {
                  const paymentId = escapeHtml(payment.id);
                  const written = debtPaymentTransaction(payment);
                  const amount = formatMoney(payment.amount);
                  // Written once, then deleted from the transaction book: say so, and offer to write it again.
                  const lost = payment.transactionId && !written;
                  let where = '';

                  if (written) {
                      where = `<span class="source-meta">đã ghi vào ${escapeHtml(written.source)}</span>`;
                  } else if (lost) {
                      where = `<span class="source-meta source-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Giao dịch đã ghi đã bị xóa</span>
                    <button class="btn btn-outline btn-small" data-action="rewrite-payment" data-id="${id}" data-payment="${paymentId}" aria-label="Ghi lại giao dịch của lần thanh toán ${amount}">Ghi lại</button>`;
                  }

                  return `<li>
                    <span>${escapeHtml(formatDateDisplay(payment.date))}</span>
                    <b>${amount}</b>
                    ${where}
                    <button class="btn btn-outline btn-small" data-action="edit-payment" data-id="${id}" data-payment="${paymentId}" title="Sửa lần thanh toán này" aria-label="Sửa lần thanh toán ${amount}">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn btn-outline btn-small" data-action="delete-payment" data-id="${id}" data-payment="${paymentId}" title="Xóa lần thanh toán này" aria-label="Xóa lần thanh toán ${amount}">
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
        'edit-payment': () => openDebtPayModal(id, payment),
        'rewrite-payment': () => openDebtPayModal(id, payment),
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

/**
 * Open the payment dialog: to add a payment, or (with `paymentId`) to edit one. Editing starts from
 * the payment and the transaction it wrote; the amount may be anything up to what is still owed
 * plus the payment's own amount.
 */
function openDebtPayModal(id, paymentId = null) {
    const debt = debts.find((item) => item.id === id);
    const payment = paymentId ? debt && debt.payments.find((item) => item.id === paymentId) : null;

    if (!debt || (paymentId && !payment)) return;

    const rule = DEBT_PAY_RULES[debt.direction];
    const remembered = readStoredText(DEBT_PAY_SOURCE_KEY);
    const names = debtPaySources();
    const linked = payment ? debtPaymentTransaction(payment) : null;
    // The source a payment was written to stays choosable even if it can no longer be picked anew.
    const kept = linked && !names.includes(linked.source) ? linked.source : '';
    const select = document.getElementById('debtPaySource');
    const who = `${debt.direction === 'owe' ? 'số tiền đã trả cho' : 'số tiền đã thu từ'} [${debt.party}]`;

    payingDebtId = id;
    editingPaymentId = payment ? payment.id : null;
    document.getElementById('debtPayTitle').innerText = payment
        ? `Sửa lần ${rule.verb.toLowerCase()}`
        : rule.verb;
    document.getElementById('debtPayMessage').innerText = payment
        ? `Sửa ${who} (tối đa ${formatMoney(debtRemaining(debt) + payment.amount)}, gồm lần này):`
        : `${who.charAt(0).toUpperCase()}${who.slice(1)} (còn ${formatMoney(debtRemaining(debt))}):`;
    setMoneyInput('debtPayAmount', payment ? payment.amount : debtRemaining(debt));
    document.getElementById('debtPayDate').value = (payment && payment.date) || toLocalDateString();
    select.innerHTML =
        '<option value="">Không ghi giao dịch</option>' +
        (kept
            ? `<option value="${escapeHtml(kept)}">${escapeHtml(kept)} (không còn dùng)</option>`
            : '') +
        names
            .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
            .join('');

    if (!payment) {
        select.value = names.includes(remembered) ? remembered : '';
    } else if (linked) {
        select.value = linked.source;
    } else {
        // Written once and deleted since: offer the source last used. Never written: keep it so.
        select.value = payment.transactionId && names.includes(remembered) ? remembered : '';
    }

    updateDebtPayHint();
    openDialog('debtPayModal', 'debtPayAmount');
    document.getElementById('debtPayAmount').select();
}

function closeDebtPayModal() {
    payingDebtId = null;
    editingPaymentId = null;
    closeDialog('debtPayModal');
}

/** Say what choosing a source does, so the money is not written twice by mistake. */
function updateDebtPayHint() {
    const debt = debts.find((item) => item.id === payingDebtId);
    const source = document.getElementById('debtPaySource').value;
    const hint = document.getElementById('debtPaySourceHint');

    if (!debt) return;

    const payment = editingPaymentId
        ? debt.payments.find((item) => item.id === editingPaymentId)
        : null;
    const linked = payment ? debtPaymentTransaction(payment) : null;

    if (!source) {
        hint.textContent = linked
            ? `Bỏ ghi giao dịch: giao dịch đã ghi vào ${linked.source} sẽ bị xóa, số dư ${linked.source} đổi lại.`
            : 'Chỉ ghi vào sổ vay nợ, không tạo giao dịch và không đổi số dư nguồn tiền.';
        return;
    }

    if (linked) {
        hint.textContent =
            source === linked.source
                ? `Cập nhật giao dịch đã ghi vào ${source}: số tiền và ngày đổi theo, số dư ${source} đổi tương ứng.`
                : `Cập nhật giao dịch đã ghi: chuyển từ ${linked.source} sang ${source}, số tiền và ngày đổi theo. Số dư cả hai nguồn đổi tương ứng.`;
        return;
    }

    const rule = DEBT_PAY_RULES[debt.direction];
    const lost =
        payment && payment.transactionId
            ? 'Giao dịch đã ghi từ lần này đã bị xóa; lưu sẽ ghi lại. '
            : '';

    hint.textContent =
        lost +
        (debt.direction === 'owe'
            ? `Tạo giao dịch Chi "${rule.category}" từ ${source}: số dư ${source} giảm tương ứng.`
            : `Tạo giao dịch Thu "${rule.category}" vào ${source}: số dư ${source} tăng tương ứng.`);
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
    // Writing a payment again after its transaction was deleted gives the same id back.
    transactions = transactions.filter((item) => item.id !== id);
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

    const existing = editingPaymentId
        ? debt.payments.find((item) => item.id === editingPaymentId)
        : null;

    if (editingPaymentId && !existing) {
        alert('Lần thanh toán này không còn nữa (có thể đã bị xóa ở máy khác).');
        closeDebtPayModal();
        return;
    }

    const linked = existing ? debtPaymentTransaction(existing) : null;
    const limit = debtRemaining(debt) + (existing ? existing.amount : 0);
    const amount = readMoneyInput('debtPayAmount');
    const date = normalizeDate(document.getElementById('debtPayDate').value);
    const sourceName = document.getElementById('debtPaySource').value;

    if (!(amount > 0)) {
        alert('Số tiền không hợp lệ!');
        return;
    }

    if (amount > limit) {
        alert(
            existing
                ? `Số tiền vượt quá số còn lại (${formatMoney(limit)}, tính cả lần này).`
                : `Số tiền vượt quá số còn lại (${formatMoney(limit)}).`,
        );
        return;
    }

    if (!date) {
        alert('Vui lòng chọn ngày hợp lệ!');
        return;
    }

    // The source an edited payment already sits in is kept even when it can no longer be picked anew.
    if (
        sourceName &&
        !debtPaySources().includes(sourceName) &&
        !(linked && linked.source === sourceName)
    ) {
        alert('Nguồn tiền này không còn dùng được. Hãy chọn nguồn khác.');
        return;
    }

    if (
        linked &&
        !sourceName &&
        !confirm(
            `Bỏ ghi giao dịch? Giao dịch ${linked.type === 'expense' ? 'Chi' : 'Thu'} ${formatMoney(linked.amount)} đã ghi vào ${linked.source} sẽ bị xóa.`,
        )
    ) {
        return;
    }

    const payment = existing || { id: newDebtPaymentId(debt) };

    if (existing) {
        applyDebtPaymentEdit(debt, existing, linked, { amount, date, sourceName });
    } else {
        Object.assign(payment, { date, amount });

        if (sourceName) payment.transactionId = recordDebtTransaction(debt, payment, sourceName);

        debt.payments.push(payment);
    }

    try {
        localStorage.setItem(DEBT_PAY_SOURCE_KEY, sourceName);
    } catch {
        // Not being able to remember the choice is harmless.
    }

    debt.updatedAt = new Date().toISOString();
    expandedDebtIds.add(debt.id);
    closeDebtPayModal();
    saveDebts();

    if (existing) {
        // The list was drawn again: put the focus back on the payment that was edited.
        const edited = document.querySelector(
            `#debt-table-body [data-action="edit-payment"][data-id="${CSS.escape(debt.id)}"][data-payment="${CSS.escape(payment.id)}"]`,
        );

        if (edited) edited.focus();
    }

    const direction = debt.direction === 'owe' ? 'từ' : 'vào';
    const kind = DEBT_PAY_RULES[debt.direction].type === 'expense' ? 'Chi' : 'Thu';

    if (sourceName) {
        showToast(
            `${existing ? 'Đã cập nhật lần thanh toán và giao dịch' : 'Đã ghi giao dịch'} ${kind} ${formatMoney(amount)} ${direction} ${sourceName}.`,
            'success',
        );
    } else if (existing) {
        showToast('Đã cập nhật lần thanh toán.', 'success');
    }
}

/**
 * Change a payment and, with it, the transaction it wrote: the amount, the date and the source
 * follow (the id stays, so a sync updates the same row); choosing no source removes the
 * transaction; choosing one for a payment without a transaction (never written, or deleted since)
 * writes it, under the id derived from the payment.
 */
function applyDebtPaymentEdit(debt, payment, linked, { amount, date, sourceName }) {
    const stamp = new Date().toISOString();

    if (linked && sourceName) {
        transactions = transactions.map((item) =>
            item === linked
                ? { ...item, amount, date, source: sourceName, updatedAt: stamp }
                : item,
        );
        saveDataLocally();
        queueUpsert([linked.id]);
    } else if (linked) {
        transactions = transactions.filter((item) => item !== linked);
        saveDataLocally();
        queueDelete([linked.id]);
        delete payment.transactionId;
    } else if (sourceName) {
        payment.transactionId = recordDebtTransaction(
            debt,
            { id: payment.id, date, amount },
            sourceName,
        );
    } else {
        // Not recording it: forget a transaction that was deleted, so it is not reported as lost.
        delete payment.transactionId;
    }

    payment.amount = amount;
    payment.date = date;
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
