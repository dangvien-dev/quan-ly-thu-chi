// Transaction creation, editing, deletion, and table rendering.

function handleFormSubmit(e) {
    e.preventDefault();

    const type = currentType;
    const dateInput = document.getElementById('txDate').value;
    const source = document.getElementById('txSource').value;
    const targetSource =
        type === 'transfer' ? document.getElementById('txTargetSource').value : null;
    const category =
        type === 'transfer' ? TRANSFER_CATEGORY : document.getElementById('txCategory').value;
    const amount = readMoneyInput('txAmount') || 0;
    const note = document.getElementById('txNote').value.trim();

    if (!dateInput || amount <= 0) {
        alert('Vui lòng nhập ngày và số tiền hợp lệ!');
        return;
    }

    if (type === 'transfer' && source === targetSource) {
        alert('Nguồn chuyển và nguồn nhận phải khác nhau!');
        return;
    }

    const stamp = new Date().toISOString();
    const wasEditing = Boolean(editingId);
    const savedId = editingId || 'TX_' + Date.now();

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
                      updatedAt: stamp,
                  }
                : transaction,
        );
    } else {
        const newTransaction = {
            id: savedId,
            date: dateInput,
            type,
            source,
            targetSource,
            category,
            amount,
            note,
            updatedAt: stamp,
        };

        transactions.unshift(newTransaction);
    }

    saveDataLocally();
    queueUpsert([savedId]);
    renderAll();
    closeModal();
    syncToGoogleSheet();

    if (!wasEditing) {
        const saved = transactions.find((transaction) => transaction.id === savedId);

        notifyBudget(saved);
        notifySalary(saved);
    }
}

function editTransaction(id) {
    const transaction = transactions.find((item) => item.id === id);

    if (!transaction) return;

    editingId = id;
    setTxType(transaction.type);
    document.getElementById('txDate').value = transaction.date;
    selectValue('txSource', transaction.source, true);

    if (transaction.type === 'transfer') {
        selectValue('txTargetSource', transaction.targetSource, true);
    } else {
        selectCategory(transaction.category, true);
    }

    setMoneyInput('txAmount', transaction.amount);
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
    queueDelete([id]);
    saveDataLocally();
    renderAll();
    syncToGoogleSheet();
}

// On phones a transaction is one line; tapping it opens its details (and the edit / delete buttons).
const expandedTransactionIds = new Set();

function isPhoneLayout() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function toggleTransactionDetails(row) {
    const id = row.dataset.id;
    const expanded = !expandedTransactionIds.has(id);

    if (expanded) expandedTransactionIds.add(id);
    else expandedTransactionIds.delete(id);

    row.classList.toggle('expanded', expanded);
    row.querySelector('.row-toggle').setAttribute('aria-expanded', String(expanded));
}

function handleTransactionTableClick(event) {
    const button = event.target.closest('button[data-action]');

    if (!button) {
        // Anywhere else on a phone row works as a bigger tap target for the toggle button.
        const row = event.target.closest('tr[data-id]');

        if (row && isPhoneLayout()) toggleTransactionDetails(row);

        return;
    }

    if (button.dataset.action === 'toggle') {
        toggleTransactionDetails(button.closest('tr'));
    } else if (button.dataset.action === 'edit') {
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
    const sourceText =
        transaction.type === 'transfer' ? `${transaction.source} ➔ ${target}` : transaction.source;
    const id = escapeHtml(transaction.id);
    const date = escapeHtml(formatDateDisplay(transaction.date));
    const expanded = expandedTransactionIds.has(transaction.id);
    // The one-line phone row shows the note, or what the money was for when there is none.
    const title =
        transaction.type === 'transfer' ? sourceText : transaction.note || transaction.category;

    return `<tr data-id="${id}" class="${expanded ? 'expanded' : ''}" style="--row-color:${colorStyle}">
            <td data-label="Ngày">${date}</td>
            <td class="cell-title"><button type="button" class="row-toggle" data-action="toggle" data-id="${id}" aria-expanded="${expanded}"><span class="row-title-text">${escapeHtml(title)}</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button></td>
            <td data-label="Nguồn tiền"><b>${escapeHtml(sourceText)}</b></td>
            <td data-label="Danh mục">${escapeHtml(transaction.category)}</td>
            <td data-label="Loại"><span style="color:${colorStyle}; font-weight:600;">${typeLabel}</span></td>
            <td data-label="Số tiền" style="font-weight:700; color:${colorStyle};">${sign}${formatMoney(transaction.amount)}</td>
            <td data-label="Mô tả">${escapeHtml(transaction.note)}</td>
            <td class="row-actions" style="text-align:right; white-space:nowrap;">
                <button class="btn btn-outline" style="padding:4px 8px; font-size:12px; margin-right:4px;" data-action="edit" data-id="${id}" title="Sửa" aria-label="Sửa giao dịch ${date} ${formatMoney(transaction.amount)}">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn btn-outline" style="padding:4px 8px; font-size:12px;" data-action="delete" data-id="${id}" title="Xóa" aria-label="Xóa giao dịch ${date} ${formatMoney(transaction.amount)}">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`;
}

// --- FILTERS, PAGING AND EXPORT ---
const TRANSACTION_PAGE_SIZE = 50;
let visibleTransactionCount = TRANSACTION_PAGE_SIZE;

function readTransactionFilters() {
    const value = (id) => {
        const element = document.getElementById(id);

        return element ? element.value : '';
    };

    return {
        month: value('filter-month'),
        type: value('filter-type'),
        category: value('filter-category'),
        source: value('filter-source'),
        search: value('filter-search'),
    };
}

function getFilteredTransactions() {
    return filterTransactions(transactions, readTransactionFilters()).sort(compareNewestFirst);
}

/** Rebuild the category and source filter lists, keeping the current choice when it still exists. */
function renderTransactionFilterOptions() {
    const lists = {
        'filter-category': {
            all: 'Tất cả danh mục',
            values: [
                ...categories.map((category) => category.name),
                TRANSFER_CATEGORY,
                ...transactions.map((transaction) => transaction.category),
            ],
        },
        'filter-source': { all: 'Tất cả nguồn', values: sources.map((source) => source.name) },
    };

    Object.entries(lists).forEach(([id, { all, values }]) => {
        const select = document.getElementById(id);

        if (!select) return;

        const previous = select.value || 'ALL';
        const unique = Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
            a.localeCompare(b, 'vi'),
        );

        select.innerHTML =
            `<option value="ALL">${all}</option>` +
            unique
                .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
                .join('');
        select.value = unique.includes(previous) ? previous : 'ALL';
    });
}

function renderTransactionSummary(filtered, shown) {
    const summary = document.getElementById('transaction-summary');

    if (!summary) return;

    const total = filtered.reduce(
        (sum, transaction) => {
            if (transaction.type === 'income') sum.income += transaction.amount;
            else if (transaction.type === 'expense') sum.expense += transaction.amount;

            return sum;
        },
        { income: 0, expense: 0 },
    );
    const difference = total.income - total.expense;
    const count =
        shown < filtered.length
            ? `Hiển thị <b>${shown}</b> / <b>${filtered.length}</b> giao dịch`
            : `<b>${filtered.length}</b> giao dịch`;

    summary.innerHTML = `${count} · Thu <b>${formatMoney(total.income)}</b> · Chi <b>${formatMoney(total.expense)}</b> · Chênh lệch <b>${difference > 0 ? '+' : ''}${formatMoney(difference)}</b>`;
}

function renderTransactions() {
    const tbody = document.getElementById('transaction-table-body');

    if (!tbody) return;

    renderTransactionFilterOptions();

    const filtered = getFilteredTransactions();
    const visible = filtered.slice(0, visibleTransactionCount);
    const loadMore = document.getElementById('load-more-btn');

    renderTransactionSummary(filtered, visible.length);

    if (loadMore) {
        loadMore.hidden = visible.length >= filtered.length;
        loadMore.textContent = `Xem thêm (${filtered.length - visible.length})`;
    }

    if (filtered.length === 0) {
        const message = transactions.length
            ? 'Không có giao dịch phù hợp bộ lọc'
            : 'Chưa có giao dịch';

        tbody.innerHTML = `<tr class="empty-row"><td colspan="7" style="text-align:center; color: var(--text-muted);">${message}</td></tr>`;
        return;
    }

    tbody.innerHTML = visible.map(renderTransactionRow).join('');
}

function handleTransactionFilterChange() {
    visibleTransactionCount = TRANSACTION_PAGE_SIZE;
    renderTransactions();
}

function showMoreTransactions() {
    visibleTransactionCount += TRANSACTION_PAGE_SIZE;
    renderTransactions();
}

function resetTransactionFilters() {
    ['filter-month', 'filter-search'].forEach((id) => {
        document.getElementById(id).value = '';
    });
    ['filter-type', 'filter-category', 'filter-source'].forEach((id) => {
        document.getElementById(id).value = 'ALL';
    });
    handleTransactionFilterChange();
}

/** Move the month filter by `step` months (starting from the current month when unset). */
function shiftFilterMonth(step) {
    const input = document.getElementById('filter-month');

    input.value = shiftMonthKey(input.value || currentMonthKey(), step);
    handleTransactionFilterChange();
}

/** Export from Cài đặt: every transaction, or only those the Sổ Giao Dịch filters show. */
function exportTransactionsCsv() {
    const scope = document.getElementById('csv-scope');
    const list =
        scope && scope.value === 'filtered'
            ? getFilteredTransactions()
            : [...transactions].sort(compareNewestFirst);

    if (list.length === 0) {
        alert('Không có giao dịch nào để xuất.');
        return;
    }

    downloadTextFile(
        `finmanager-giao-dich-${toLocalDateString()}.csv`,
        buildTransactionsCsv(list),
        'text/csv;charset=utf-8',
    );
}

function initTransactionFilters() {
    ['filter-month', 'filter-type', 'filter-category', 'filter-source'].forEach((id) => {
        document.getElementById(id).addEventListener('change', handleTransactionFilterChange);
    });
    document
        .getElementById('filter-search')
        .addEventListener('input', handleTransactionFilterChange);
}
