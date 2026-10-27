// Transaction creation, editing, deletion, and table rendering.

function handleFormSubmit(e) {
    e.preventDefault();

    const type = currentType;
    const dateInput = document.getElementById('txDate').value;
    const source = document.getElementById('txSource').value;
    const targetSource =
        type === 'transfer' ? document.getElementById('txTargetSource').value : null;
    const category =
        type === 'transfer'
            ? 'Chuyển tiền nội bộ'
            : document.getElementById('txCategory').value;
    const amount = parseFloat(document.getElementById('txAmount').value) || 0;
    const note = document.getElementById('txNote').value || '';

    if (!dateInput || amount <= 0) {
        alert('Vui lòng nhập ngày và số tiền hợp lệ!');
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
        editingId = null;

        const modalTitle = document.querySelector('#transactionModal .modal-header h3');

        if (modalTitle) {
            modalTitle.innerText = 'Thêm Giao Dịch';
        }
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

    const form = document.getElementById('transactionForm');

    if (form) {
        form.reset();
    }

    document.getElementById('txDate').value = new Date().toISOString().split('T')[0];
    syncToGoogleSheet();
}

function editTransaction(id) {
    const transaction = transactions.find((item) => item.id === id);

    if (!transaction) return;

    editingId = id;
    setTxType(transaction.type);
    document.getElementById('txDate').value = transaction.date
        ? transaction.date.split('T')[0]
        : '';
    document.getElementById('txSource').value = transaction.source;

    if (transaction.type === 'transfer' && transaction.targetSource) {
        const targetEl = document.getElementById('txTargetSource');

        if (targetEl) {
            targetEl.value = transaction.targetSource;
        }
    } else {
        document.getElementById('txCategory').value = transaction.category;
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
    saveDataLocally();
    renderAll();
    syncToGoogleSheet();
}

function renderTransactions() {
    const tbody = document.getElementById('transaction-table-body');
    const filterElement = document.getElementById('filter-type');

    if (!tbody || !filterElement) return;

    const filter = filterElement.value;
    tbody.innerHTML = '';

    const filtered = transactions.filter(
        (transaction) => filter === 'ALL' || transaction.type === filter,
    );

    if (filtered.length === 0) {
        tbody.innerHTML =
            '<tr><td colspan="7" style="text-align:center; color: var(--text-muted);">Chưa có giao dịch</td></tr>';
        return;
    }

    filtered.forEach((transaction) => {
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

        const cleanDate = transaction.date ? transaction.date.split('T')[0] : '';
        const sourceDisplay =
            transaction.type === 'transfer'
                ? `${transaction.source} ➔ ${transaction.targetSource}`
                : transaction.source;

        tbody.innerHTML += `<tr>
            <td>${cleanDate}</td>
            <td><b>${sourceDisplay}</b></td>
            <td>${transaction.category || ''}</td>
            <td><span style="color:${colorStyle}; font-weight:600;">${typeLabel}</span></td>
            <td style="font-weight:700; color:${colorStyle};">${sign}${transaction.amount.toLocaleString()} đ</td>
            <td>${transaction.note || ''}</td>
            <td style="text-align:right; white-space:nowrap;">
                <button class="btn btn-outline" style="padding:4px 8px; font-size:12px; margin-right:4px;" onclick="editTransaction('${transaction.id}')">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn btn-outline" style="padding:4px 8px; font-size:12px;" onclick="deleteTransaction('${transaction.id}')">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`;
    });
}
