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
    const noteInput = document.getElementById('txNote').value;
    const typedTags = parseTagInput(document.getElementById('txTags').value);

    if (!dateInput || amount <= 0) {
        alert('Vui lòng nhập ngày và số tiền hợp lệ!');
        return;
    }

    if (typedTags.invalid.length) {
        alert(
            `Thẻ không hợp lệ: ${typedTags.invalid.join(', ')}.\nThẻ bắt đầu bằng chữ, chỉ gồm chữ, số, "_" hoặc "-", tối đa 30 ký tự.`,
        );
        return;
    }

    // "#tag" words typed straight into the note count too; all tags end up at the end of the note.
    const inline = extractTags(noteInput);
    const tags = uniqueTags([...typedTags.tags, ...inline.tags]);

    if (tags.length > MAX_TAGS) {
        alert(`Mỗi giao dịch tối đa ${MAX_TAGS} thẻ.`);
        return;
    }

    const note = tags.length ? composeNote(inline.text, tags) : noteInput.trim();

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
        notifyCardSpend(saved);
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

    const { text, tags } = extractTags(transaction.note);

    document.getElementById('txNote').value = tags.length ? text : transaction.note || '';
    document.getElementById('txTags').value = tags.map((tag) => `#${tag}`).join(' ');

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
    } else if (button.dataset.action === 'tag') {
        filterByTag(button.dataset.tag);
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
    const { text: noteText, tags } = extractTags(transaction.note);
    const tagChips = tags
        .map(
            (tag) =>
                `<button type="button" class="tag-chip" data-action="tag" data-tag="${escapeHtml(tag)}" aria-label="Lọc theo thẻ #${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`,
        )
        .join('');
    // The one-line phone row shows the note, or what the money was for when there is none.
    const title = transaction.type === 'transfer' ? sourceText : noteText || transaction.category;

    return `<tr data-id="${id}" class="${expanded ? 'expanded' : ''}" style="--row-color:${colorStyle}">
            <td data-label="Ngày">${date}</td>
            <td class="cell-title"><button type="button" class="row-toggle" data-action="toggle" data-id="${id}" aria-expanded="${expanded}"><span class="row-title-text">${escapeHtml(title)}</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button></td>
            <td data-label="Nguồn tiền"><b>${escapeHtml(sourceText)}</b></td>
            <td data-label="Danh mục">${escapeHtml(transaction.category)}</td>
            <td data-label="Loại"><span style="color:${colorStyle}; font-weight:600;">${typeLabel}</span></td>
            <td data-label="Số tiền" style="font-weight:700; color:${colorStyle};">${sign}${formatMoney(transaction.amount)}</td>
            <td data-label="Mô tả"><span class="note-cell">${escapeHtml(tags.length ? noteText : transaction.note)}${tagChips}</span></td>
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

// A choice of the source filter that stands for every credit card, pay-later and loan source.
const DEBT_SOURCES_FILTER = '__debt__';

const debtSourceNames = () =>
    sources.filter((source) => SOURCE_KINDS[source.kind].debt).map((source) => source.name);

// --- STATEMENT CYCLE FILTER ---
// For a single credit card with a statement day, the source filter is joined by "Kỳ sao kê": the
// transactions between two statement days, which is how the bank groups them.
const STATEMENT_CYCLE_COUNT = 12;

/** The card whose cycles the filter offers: the chosen source, if a credit card with a statement day. */
function cycleSource() {
    const select = document.getElementById('filter-source');
    const name = select ? select.value : '';
    const source = name && name !== 'ALL' && name !== DEBT_SOURCES_FILTER ? findSource(name) : null;

    return source && source.kind === 'credit' && source.statementDay ? source : null;
}

/** [from, to] of the chosen cycle, or ['', ''] when none is chosen. */
function selectedCycleRange() {
    const select = document.getElementById('filter-cycle');
    const value = select && cycleSource() ? select.value : '';

    return value.includes('|') ? value.split('|') : ['', ''];
}

function cycleLabel(cycle, index) {
    const start = formatDateDisplay(cycle.start).slice(0, 5);
    const name = cycle.open ? 'Kỳ này' : index === 1 ? 'Kỳ trước' : 'Kỳ';

    return `${name}: ${start} – ${formatDateDisplay(cycle.end)}`;
}

/** Fill the cycle list for the chosen card (and hide it for anything else), keeping the choice. */
function renderCycleFilterOptions() {
    const item = document.getElementById('filter-cycle-item');
    const select = document.getElementById('filter-cycle');

    if (!item || !select) return;

    const source = cycleSource();

    item.hidden = !source;

    if (!source) {
        select.innerHTML = '';
        return;
    }

    const previous = select.value;
    const cycles = statementCycles(source.statementDay, toLocalDateString(), STATEMENT_CYCLE_COUNT);

    select.innerHTML =
        '<option value="ALL">Tất cả các kỳ</option>' +
        cycles
            .map(
                (cycle, index) =>
                    `<option value="${cycle.start}|${cycle.end}">${escapeHtml(cycleLabel(cycle, index))}</option>`,
            )
            .join('');
    select.value = [...select.options].some((option) => option.value === previous)
        ? previous
        : 'ALL';
}

/** What happened on the card in the chosen cycle, in the words of the statement's summary. */
function renderCycleSummary() {
    const box = document.getElementById('cycle-summary');
    const source = cycleSource();
    const [from, to] = selectedCycleRange();

    if (!box) return;

    if (!source || !from) {
        box.hidden = true;
        box.textContent = '';
        return;
    }

    const totals = computeCardCycleTotals(transactions, source.name, from, to);
    const open = to > toLocalDateString() ? ' (kỳ chưa chốt)' : '';

    box.hidden = false;
    box.innerHTML = `Sao kê ${escapeHtml(source.name)} ${formatDateDisplay(from)} – ${formatDateDisplay(to)}${open}: phát sinh <b>${formatMoney(totals.charges)}</b> · đã thanh toán <b>${formatMoney(totals.payments)}</b> · ${totals.count} giao dịch. Đối chiếu với "Nợ phát sinh trong kỳ" và "Đã thanh toán" trên sao kê.`;
}

function readTransactionFilters() {
    const value = (id) => {
        const element = document.getElementById(id);

        return element ? element.value : '';
    };
    const source = value('filter-source');
    const byDebt = source === DEBT_SOURCES_FILTER;
    const [from, to] = selectedCycleRange();

    return {
        month: value('filter-month'),
        from,
        to,
        type: value('filter-type'),
        category: value('filter-category'),
        source: byDebt ? 'ALL' : source,
        sources: byDebt ? debtSourceNames() : null,
        tag: value('filter-tag'),
        search: value('filter-search'),
    };
}

function getFilteredTransactions() {
    return filterTransactions(transactions, readTransactionFilters()).sort(compareNewestFirst);
}

/** Rebuild the category and source filter lists, keeping the current choice when it still exists. */
function renderTransactionFilterOptions() {
    // Known categories and sources come in the order the user chose; names that only old
    // transactions mention follow, alphabetically.
    const lists = {
        'filter-category': {
            all: 'Tất cả danh mục',
            ordered: [...categoriesByType().map((category) => category.name), TRANSFER_CATEGORY],
            others: transactions.map((transaction) => transaction.category),
        },
        'filter-source': {
            all: 'Tất cả nguồn',
            ordered: sources.map((source) => source.name),
            others: [],
        },
    };

    Object.entries(lists).forEach(([id, { all, ordered, others }]) => {
        const select = document.getElementById(id);

        if (!select) return;

        const previous = select.value || 'ALL';
        const known = new Set(ordered.filter(Boolean));
        const unique = [
            ...known,
            ...Array.from(new Set(others.filter(Boolean)))
                .filter((name) => !known.has(name))
                .sort((a, b) => a.localeCompare(b, 'vi')),
        ];

        const groups =
            id === 'filter-source' && debtSourceNames().length
                ? [[DEBT_SOURCES_FILTER, 'Mọi thẻ tín dụng / trả sau / nợ']]
                : [];

        select.innerHTML =
            `<option value="ALL">${all}</option>` +
            groups.map(([key, label]) => `<option value="${key}">${label}</option>`).join('') +
            unique
                .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
                .join('');
        select.value =
            unique.includes(previous) || groups.some(([key]) => key === previous)
                ? previous
                : 'ALL';
    });
}

/** The tag filter lists the tags in use (and hides itself while there are none). */
function renderTagFilterOptions() {
    const select = document.getElementById('filter-tag');
    const item = document.getElementById('filter-tag-item');

    if (!select || !item) return;

    const previous = select.value || 'ALL';
    const tags = collectTags(transactions).sort((a, b) => a.tag.localeCompare(b.tag, 'vi'));
    const same = tags.find((entry) => tagKey(entry.tag) === tagKey(previous));

    item.hidden = tags.length === 0;
    select.innerHTML =
        '<option value="ALL">Tất cả thẻ</option>' +
        tags
            .map(
                ({ tag, count }) =>
                    `<option value="${escapeHtml(tag)}">#${escapeHtml(tag)} (${count})</option>`,
            )
            .join('');
    select.value = same ? same.tag : 'ALL';
}

/** Show only the transactions with this tag (the other filters stay as they are). */
function filterByTag(tag) {
    renderTagFilterOptions();

    const select = document.getElementById('filter-tag');
    const match = [...select.options].find((option) => tagKey(option.value) === tagKey(tag));

    if (!match) return;

    select.value = match.value;
    handleTransactionFilterChange();
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
    renderCycleFilterOptions();
    renderTagFilterOptions();

    const filtered = getFilteredTransactions();
    const visible = filtered.slice(0, visibleTransactionCount);
    const loadMore = document.getElementById('load-more-btn');

    renderTransactionSummary(filtered, visible.length);
    renderCycleSummary();

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

/**
 * Open Sổ Giao Dịch already filtered, e.g. from a card of the overview. Every filter not given is
 * cleared, so what is listed is exactly what was asked for.
 */
function showTransactionsFor({
    month = '',
    type = 'ALL',
    category = 'ALL',
    source = 'ALL',
    tag = 'ALL',
    cycle = 'ALL',
} = {}) {
    renderTransactionFilterOptions();
    renderTagFilterOptions();
    document.getElementById('filter-month').value = month;
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-type').value = type;
    document.getElementById('filter-category').value = category;
    document.getElementById('filter-source').value = source;
    document.getElementById('filter-tag').value = tag;

    // A card's statement cycle: 'current' (not closed yet) or 'closed' (the latest statement).
    const cycleSelect = document.getElementById('filter-cycle');

    cycleSelect.innerHTML = '';
    renderCycleFilterOptions();

    if (cycle !== 'ALL' && cycleSelect.options.length > 2) {
        cycleSelect.selectedIndex = cycle === 'current' ? 1 : 2;
    }

    handleTransactionFilterChange();
    switchTab('transactions');
}

function resetTransactionFilters() {
    ['filter-month', 'filter-search'].forEach((id) => {
        document.getElementById(id).value = '';
    });
    ['filter-type', 'filter-category', 'filter-source', 'filter-tag'].forEach((id) => {
        document.getElementById(id).value = 'ALL';
    });
    document.getElementById('filter-cycle').value = 'ALL';
    handleTransactionFilterChange();
}

/** Move the month filter by `step` months (starting from the current month when unset). */
function shiftFilterMonth(step) {
    const input = document.getElementById('filter-month');

    input.value = shiftMonthKey(input.value || currentMonthKey(), step);
    document.getElementById('filter-cycle').value = 'ALL';
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
    ['filter-type', 'filter-category', 'filter-tag'].forEach((id) => {
        document.getElementById(id).addEventListener('change', handleTransactionFilterChange);
    });

    // A month and a statement cycle are two ways to cut time: choosing one lets go of the other.
    // Another card has other cycles, so changing the source starts over with all of them.
    ['filter-month', 'filter-source'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => {
            document.getElementById('filter-cycle').value = 'ALL';
            handleTransactionFilterChange();
        });
    });
    document.getElementById('filter-cycle').addEventListener('change', (event) => {
        if (event.target.value !== 'ALL') document.getElementById('filter-month').value = '';

        handleTransactionFilterChange();
    });
    document
        .getElementById('filter-search')
        .addEventListener('input', handleTransactionFilterChange);
}

// --- TAGS FIELD OF THE FORM ---
/** Buttons for the tags used most, so a tag is a tap instead of typing it again. */
function renderTagSuggestions() {
    const box = document.getElementById('tx-tag-suggestions');

    if (!box) return;

    const chosen = new Set(parseTagInput(document.getElementById('txTags').value).tags.map(tagKey));
    const popular = collectTags(transactions).slice(0, 10);

    box.hidden = popular.length === 0;
    box.innerHTML = popular
        .map(({ tag, count }) => {
            const selected = chosen.has(tagKey(tag));

            return `<button type="button" class="tag-chip tag-toggle${selected ? ' selected' : ''}" data-tag="${escapeHtml(tag)}" aria-pressed="${selected}" title="Đã dùng ${count} lần">#${escapeHtml(tag)}</button>`;
        })
        .join('');
}

function toggleFormTag(tag) {
    const input = document.getElementById('txTags');
    const { tags } = parseTagInput(input.value);
    const key = tagKey(tag);
    const next = tags.some((item) => tagKey(item) === key)
        ? tags.filter((item) => tagKey(item) !== key)
        : [...tags, tag];

    input.value = next.map((item) => `#${item}`).join(' ');
    renderTagSuggestions();
    input.focus();
}

function initTags() {
    const box = document.getElementById('tx-tag-suggestions');

    box.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-tag]');

        if (button) toggleFormTag(button.dataset.tag);
    });
    document.getElementById('txTags').addEventListener('input', renderTagSuggestions);
}
