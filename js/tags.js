// Tag report (page "Thẻ & Khách Hàng"): money in and out per tag, and renaming / merging tags.
// A tag is a "#word" in a transaction's note (see js/utils.js), so renaming one rewrites those notes.

let renamingTag = null;

/** The date prefix the chosen period selects: '' (all), the year, or the current month. */
function tagPeriodPrefix() {
    const select = document.getElementById('tags-period');
    const period = select ? select.value : 'all';

    if (period === 'month') return currentMonthKey();
    if (period === 'year') return currentMonthKey().slice(0, 4);

    return '';
}

function signedMoney(amount) {
    return `${amount > 0 ? '+' : ''}${formatMoney(amount)}`;
}

function renderTagRow(row) {
    const tag = escapeHtml(row.tag);
    const color = row.net > 0 ? 'var(--success)' : row.net < 0 ? 'var(--danger)' : 'inherit';
    const result = row.net > 0 ? 'Lãi' : row.net < 0 ? 'Lỗ' : 'Hòa vốn';

    return `<tr data-tag="${tag}">
            <td data-label="Thẻ"><b>#${tag}</b></td>
            <td data-label="Giao dịch">${row.count}</td>
            <td data-label="Thu" style="color:var(--success);">${formatMoney(row.income)}</td>
            <td data-label="Chi" style="color:var(--danger);">${formatMoney(row.expense)}</td>
            <td data-label="Lãi / Lỗ" style="font-weight:700; color:${color};">${signedMoney(row.net)} <span class="source-meta">${result}</span></td>
            <td data-label="Gần nhất">${escapeHtml(formatDateDisplay(row.last))}</td>
            <td class="row-actions" style="text-align:right; white-space:nowrap;">
                <button type="button" class="btn btn-outline btn-small" data-action="view-tag" data-tag="${tag}" title="Xem các giao dịch của thẻ này" aria-label="Xem giao dịch của thẻ ${tag}">
                    <i class="fa-solid fa-list-ul" aria-hidden="true"></i>
                </button>
                <button type="button" class="btn btn-outline btn-small" data-action="rename-tag" data-tag="${tag}" title="Đổi tên hoặc gộp thẻ" aria-label="Đổi tên hoặc gộp thẻ ${tag}">
                    <i class="fa-solid fa-pen" aria-hidden="true"></i>
                </button>
            </td>
        </tr>`;
}

function renderTagReport() {
    const tbody = document.getElementById('tag-table-body');

    if (!tbody) return;

    const rows = computeTagReport(transactions, tagPeriodPrefix());
    const summary = document.getElementById('tags-summary');
    const hasTags = collectTags(transactions).length > 0;

    summary.textContent = rows.length ? `${rows.length} thẻ` : '';

    keepFocus(tbody, () => {
        if (rows.length === 0) {
            const message = hasTags
                ? 'Không có giao dịch nào có thẻ trong khoảng thời gian này'
                : 'Chưa có thẻ nào. Gõ thẻ vào ô Thẻ khi nhập giao dịch, ví dụ tên khách hay mã đơn hàng.';

            tbody.innerHTML = `<tr class="empty-row"><td colspan="7" style="text-align:center; color: var(--text-muted);">${message}</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(renderTagRow).join('');
    });
}

function handleTagTableClick(event) {
    const button = event.target.closest('button[data-action]');

    if (!button) return;

    const { action, tag } = button.dataset;

    if (action === 'view-tag') showTransactionsFor({ tag });
    else if (action === 'rename-tag') openTagRenameModal(tag);
}

// --- RENAME / MERGE ---
function openTagRenameModal(tag) {
    renamingTag = tag;
    document.getElementById('tagRenameTitle').innerText = `Đổi tên thẻ #${tag}`;
    document.getElementById('tagRenameInput').value = tag;
    updateTagRenameHint();
    openDialog('tagRenameModal', 'tagRenameInput');
    document.getElementById('tagRenameInput').select();
}

function closeTagRenameModal() {
    renamingTag = null;
    closeDialog('tagRenameModal');
}

/** Tell, while typing, whether the new name is another tag already in use (then they are merged). */
function updateTagRenameHint() {
    const hint = document.getElementById('tagRenameHint');
    const submit = document.getElementById('tagRenameSubmit');
    const plan = planTagRename(
        transactions,
        renamingTag,
        document.getElementById('tagRenameInput').value,
    );

    if (plan.merge) {
        const count = collectTags(transactions).find((entry) => entry.tag === plan.tag).count;

        hint.textContent = `#${plan.tag} đã có (${count} giao dịch): các giao dịch của #${renamingTag} sẽ được gộp vào đó.`;
        submit.textContent = 'Gộp thẻ';
    } else {
        hint.textContent = '';
        submit.textContent = 'Đổi tên';
    }
}

/** Rewrite the notes that carry `from` so they carry `to`; returns how many transactions changed. */
function applyTagRename(from, to) {
    const stamp = new Date().toISOString();
    const changedIds = [];

    transactions = transactions.map((transaction) => {
        const note = renameTagInNote(transaction.note, from, to);

        if (note === transaction.note) return transaction;

        changedIds.push(transaction.id);

        return { ...transaction, note, updatedAt: stamp };
    });

    if (changedIds.length) {
        saveDataLocally();
        queueUpsert(changedIds);
    }

    return changedIds.length;
}

function handleTagRenameSubmit(event) {
    event.preventDefault();

    const from = renamingTag;
    const plan = planTagRename(transactions, from, document.getElementById('tagRenameInput').value);

    if (plan.error) {
        alert(plan.error);
        return;
    }

    const changed = applyTagRename(from, plan.tag);

    closeTagRenameModal();
    renderAll();
    // The row of the old name is gone (or renamed): put the focus on the button of the new one.
    refocusControl(`button[data-action="rename-tag"][data-tag="${plan.tag}"]`);
    syncToGoogleSheet();

    const message = plan.merge
        ? `Đã gộp #${from} vào #${plan.tag} (${changed} giao dịch).`
        : `Đã đổi #${from} thành #${plan.tag} (${changed} giao dịch).`;

    showToast(message, 'success');
    announce(message);
}

function initTagReport() {
    document.getElementById('tag-table-body').addEventListener('click', handleTagTableClick);
    document.getElementById('tags-period').addEventListener('change', renderTagReport);
    document.getElementById('tagRenameInput').addEventListener('input', updateTagRenameHint);
}
