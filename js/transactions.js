// Transaction creation, editing, deletion, and table rendering.

function handleFormSubmit(e) {
    e.preventDefault();

    const type = currentType;
    const dateInput = document.getElementById('txDate').value;
    const source = document.getElementById('txSource').value;
    const targetSource =
        type === 'transfer' ? document.getElementById('txTargetSource').value : null;
    const category =
        type === 'transfer' ? 'Chuyển tiền nội bộ' : document.getElementById('txCategory').value;
    const amount = Math.round(parseFloat(document.getElementById('txAmount').value)) || 0;
    const note = document.getElementById('txNote').value.trim();

    if (!dateInput || amount <= 0) {
        alert('Vui lòng nhập ngày và số tiền hợp lệ!');
        return;
    }

    if (type === 'transfer' && source === targetSource) {
        alert('Nguồn chuyển và nguồn nhận phải khác nhau!');
        return;
    }

    if (editingId) {
        transactions = transactions.map((transaction) =>
            transaction.id === editingId
                ? {
                      ...transaction,
                      type,
                      date: dateInput,
                      source,
                      targetSource,
                      category,
                      amount,
                      note,
                  }
                : transaction,
        );
    } else {
        const newTransaction = {
            id: 'TX_' + Date.now(),
            date: dateInput,
            type,
            source,
            targetSource,
            category,
            amount,
            note,
        };

        transactions.unshift(newTransaction);
    }

    saveDataLocally();
    renderAll();
    closeModal();
    syncToGoogleSheet();
}

function editTransaction(id) {
    const transaction = transactions.find((item) => item.id === id);

    if (!transaction) return;

    editingId = id;
    setTxType(transaction.type);
    document.getElementById('txDate').value = transaction.date;
    document.getElementById('txSource').value = transaction.source;

    if (transaction.type === 'transfer') {
        const targetEl = document.getElementById('txTargetSource');

        if (targetEl && transaction.targetSource) {
            targetEl.value = transaction.targetSource;
        }
    } else {
        selectCategory(transaction.category, true);
    }

    document.getElementById('txAmount').value = transaction.amount;
    document.getElementById('txNote').value = transaction.note || '';

    const modalTitle = document.querySelector('#transactionModal .modal-header h3');

    if (modalTitle) {
        modalTitle.innerText = 'Cập Nhật Giao Dịch';
    }

    openModal();
}

function deleteTransaction(id) {
    if (!confirm('Xóa giao dịch này?')) return;

    transactions = transactions.filter((transaction) => transaction.id !== id);
    rememberDeletedIds([id]);
    saveDataLocally();
    renderAll();
    syncToGoogleSheet();
}

function handleTransactionTableClick(event) {
    const button = event.target.closest('button[data-action]');

    if (!button) return;

    if (button.dataset.action === 'edit') {
        editTransaction(button.dataset.id);
    } else if (button.dataset.action === 'delete') {
        deleteTransaction(button.dataset.id);
    }
}

function renderTransactionRow(transaction) {
    let typeLabel = 'Chi';
    let colorStyle = 'var(--danger)';
    let sign = '-';

    if (transaction.type === 'income') {
        typeLabel = 'Thu';
        colorStyle = 'var(--success)';
        sign = '+';
    } else if (transaction.type === 'transfer') {
        typeLabel = 'Chuyển';
        colorStyle = 'var(--warning)';
        sign = '⟷';
    }

    // Rows synced from a Sheet without a "targetSource" column cannot say where a transfer went.
    const target = transaction.targetSource || '⚠ chưa rõ nguồn nhận';
    const sourceDisplay =
        transaction.type === 'transfer'
            ? `${escapeHtml(transaction.source)} ➔ ${escapeHtml(target)}`
            : escapeHtml(transaction.source);
    const id = escapeHtml(transaction.id);

    return `<tr>
            <td>${escapeHtml(transaction.date)}</td>
            <td><b>${sourceDisplay}</b></td>
            <td>${escapeHtml(transaction.category)}</td>
            <td><span style="color:${colorStyle}; font-weight:600;">${typeLabel}</span></td>
            <td style="font-weight:700; color:${colorStyle};">${sign}${formatMoney(transaction.amount)}</td>
            <td>${escapeHtml(transaction.note)}</td>
            <td style="text-align:right; white-space:nowrap;">
                <button class="btn btn-outline" style="padding:4px 8px; font-size:12px; margin-right:4px;" data-action="edit" data-id="${id}" title="Sửa">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn btn-outline" style="padding:4px 8px; font-size:12px;" data-action="delete" data-id="${id}" title="Xóa">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`;
}

function renderTransactions() {
    const tbody = document.getElementById('transaction-table-body');
    const filterElement = document.getElementById('filter-type');

    if (!tbody || !filterElement) return;

    const filter = filterElement.value;
    const filtered = transactions
        .filter((transaction) => filter === 'ALL' || transaction.type === filter)
        .sort(compareNewestFirst);

    if (filtered.length === 0) {
        tbody.innerHTML =
            '<tr><td colspan="7" style="text-align:center; color: var(--text-muted);">Chưa có giao dịch</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(renderTransactionRow).join('');
}
