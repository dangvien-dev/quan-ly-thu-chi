// Money sources: list, balances, and the add / edit / archive / delete / rename actions.

let editingSourceName = null;

function findSource(name) {
    return sources.find((source) => source.name === name);
}

function sourceNames({ includeArchived = false } = {}) {
    return sources
        .filter((source) => includeArchived || !source.archived)
        .map((source) => source.name);
}

function isDebtSource(name) {
    const source = findSource(name);

    return Boolean(source && SOURCE_KINDS[source.kind].debt);
}

function getInitialBalances() {
    return initialBalances;
}

/** Balance of every source: initial balance plus income, minus expenses, adjusted by transfers. */
function calculateSourceBalances() {
    const balances = {};

    sources.forEach((source) => {
        balances[source.name] = Number(initialBalances[source.name]) || 0;
    });

    transactions.forEach((transaction) => {
        if (transaction.type === 'income' && Object.hasOwn(balances, transaction.source)) {
            balances[transaction.source] += transaction.amount;
        } else if (transaction.type === 'expense' && Object.hasOwn(balances, transaction.source)) {
            balances[transaction.source] -= transaction.amount;
        } else if (transaction.type === 'transfer') {
            if (Object.hasOwn(balances, transaction.source)) {
                balances[transaction.source] -= transaction.amount;
            }

            if (transaction.targetSource && Object.hasOwn(balances, transaction.targetSource)) {
                balances[transaction.targetSource] += transaction.amount;
            }
        }
    });

    return balances;
}

/**
 * Transactions synced from a Sheet or restored from a backup may name a source this device does
 * not know. Register it so its money is counted instead of silently ignored.
 */
function ensureSourcesForTransactions() {
    const known = new Set(sources.map((source) => source.name));
    let added = false;

    transactions.forEach((transaction) => {
        [transaction.source, transaction.targetSource].forEach((name) => {
            if (name && !known.has(name)) {
                known.add(name);
                sources.push(normalizeSource({ name, kind: 'other' }));
                added = true;
            }
        });
    });

    if (added) {
        saveMeta('sources');
    }

    return added;
}

// --- RENDERING ---
function describeCredit(source, balance) {
    const lines = [];

    if (source.creditLimit > 0) {
        lines.push(
            `Hạn mức ${formatMoney(source.creditLimit)} · Khả dụng ${formatMoney(source.creditLimit + balance)}`,
        );
    }

    [
        ['Chốt sao kê', source.statementDay],
        ['Hạn thanh toán', source.dueDay],
    ].forEach(([label, day]) => {
        if (day) {
            lines.push(
                `${label} ngày ${day} (${describeDaysUntil(daysUntil(nextDayOfMonth(day)))})`,
            );
        }
    });

    return lines.map((line) => `<div class="source-meta">${escapeHtml(line)}</div>`).join('');
}

/**
 * The opening balance is part of the balance but invisible on its own, so show it. A positive
 * one on a debt source (credit card, pay-later, loan) offsets spending and hides the debt: say so.
 */
function describeOpening(source) {
    const opening = Number(initialBalances[source.name]) || 0;

    if (!opening) return '';

    let html = `<div class="source-meta">Số dư ban đầu ${escapeHtml(formatMoney(opening))}</div>`;

    if (SOURCE_KINDS[source.kind].debt && opening > 0) {
        html += `<div class="source-meta source-warn">Số dư dương này bù vào các khoản chi nên chưa tính là dư nợ. Bấm "Khớp số dư" và nhập số thực tế, app sẽ tự tính lại.</div>`;
    }

    return html;
}

// While true the cards show only the up / down arrows (see toggleSourceReorder).
let reorderingSources = false;

/** A card of the reorder mode: name, balance and the two arrows, nothing else to press by mistake. */
function renderReorderCard(source, balance, { first, last }) {
    const name = escapeHtml(source.name);

    return `<div class="card source-card source-reorder">
            <div class="source-head">
                <div class="card-title">${name}</div>
                <span class="kind-badge">${escapeHtml(SOURCE_KINDS[source.kind].label)}</span>
            </div>
            <div class="card-value" style="color:${balance >= 0 ? 'var(--text-main)' : 'var(--danger)'};">
                ${formatMoney(balance)}
            </div>
            <div class="source-actions">
                <button type="button" class="btn btn-outline btn-small" data-action="move-source-up" data-source="${name}" aria-label="Chuyển nguồn ${name} lên trên"${first ? ' disabled' : ''}>
                    <i class="fa-solid fa-arrow-up" aria-hidden="true"></i> Lên
                </button>
                <button type="button" class="btn btn-outline btn-small" data-action="move-source-down" data-source="${name}" aria-label="Chuyển nguồn ${name} xuống dưới"${last ? ' disabled' : ''}>
                    <i class="fa-solid fa-arrow-down" aria-hidden="true"></i> Xuống
                </button>
            </div>
        </div>`;
}

function renderSourceCard(source, balance) {
    const name = escapeHtml(source.name);
    const kind = SOURCE_KINDS[source.kind];
    const actions = source.archived
        ? `<button class="btn btn-outline btn-small" data-action="restore-source" data-source="${name}">
                <i class="fa-solid fa-rotate-left"></i> Khôi phục
            </button>`
        : `<button class="btn btn-outline btn-small" data-action="edit-balance" data-source="${name}">
                <i class="fa-solid fa-pen"></i> Sửa số dư
            </button>
            <button class="btn btn-outline btn-small" data-action="match-balance" data-source="${name}" title="Nhập số dư thực tế, app tự tính số dư ban đầu cho khớp" aria-label="Khớp số dư thực tế của ${name}">
                <i class="fa-solid fa-scale-balanced"></i> Khớp số dư
            </button>
            <button class="btn btn-outline btn-small" data-action="edit-source" data-source="${name}" title="Sửa nguồn tiền" aria-label="Sửa nguồn ${name}">
                <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="btn btn-outline btn-small" data-action="archive-source" data-source="${name}" title="Lưu trữ" aria-label="Lưu trữ nguồn ${name}">
                <i class="fa-solid fa-box-archive"></i>
            </button>`;

    return `<div class="card source-card">
            <div class="source-head">
                <div class="card-title">${name}</div>
                <span class="kind-badge">${escapeHtml(kind.label)}</span>
            </div>
            <div class="card-value" style="color:${balance >= 0 ? 'var(--text-main)' : 'var(--danger)'};">
                ${formatMoney(balance)}
            </div>
            ${describeOpening(source)}
            ${source.kind === 'credit' ? describeCredit(source, balance) : ''}
            <div class="source-actions">
                ${actions}
                <button class="btn btn-outline btn-small" data-action="delete-source" data-source="${name}" title="Xóa" aria-label="Xóa nguồn ${name}">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>`;
}

function renderSources() {
    const grid = document.getElementById('sources-grid');
    const archivedSection = document.getElementById('sources-archived-section');
    const archivedGrid = document.getElementById('sources-archived');

    if (!grid) return;

    const balances = calculateSourceBalances();
    const active = sources.filter((source) => !source.archived);
    const archived = sources.filter((source) => source.archived);

    keepFocus(grid, () => {
        grid.innerHTML = active
            .map((source, index) =>
                reorderingSources
                    ? renderReorderCard(source, balances[source.name], {
                          first: index === 0,
                          last: index === active.length - 1,
                      })
                    : renderSourceCard(source, balances[source.name]),
            )
            .join('');
    });
    renderSourceReorderControls();

    if (archivedSection && archivedGrid) {
        archivedSection.hidden = archived.length === 0;
        archivedGrid.innerHTML = archived
            .map((source) => renderSourceCard(source, balances[source.name]))
            .join('');
    }

    populateSourceOptions();
}

function handleSourceGridClick(event) {
    const button = event.target.closest('button[data-action]');

    if (!button) return;

    const name = button.dataset.source;
    const actions = {
        'edit-balance': () => editInitialBalance(name),
        'match-balance': () => matchSourceBalance(name),
        'edit-source': () => openSourceModal(name),
        'archive-source': () => archiveSource(name, true),
        'restore-source': () => archiveSource(name, false),
        'delete-source': () => deleteSource(name),
        'move-source-up': () => moveSource(name, -1),
        'move-source-down': () => moveSource(name, 1),
    };

    if (actions[button.dataset.action]) {
        actions[button.dataset.action]();
    }
}

// --- REORDER ---
function renderSourceReorderControls() {
    const button = document.getElementById('sources-sort-btn');
    const hint = document.getElementById('sources-sort-hint');

    if (hint) hint.hidden = !reorderingSources;

    if (!button) return;

    button.classList.toggle('sorting', reorderingSources);
    button.setAttribute('aria-label', reorderingSources ? 'Xong sắp xếp' : 'Sắp xếp nguồn tiền');
    button.querySelector('.sort-label').textContent = reorderingSources ? 'Xong' : 'Sắp xếp';
    button.querySelector('i').className = reorderingSources
        ? 'fa-solid fa-check'
        : 'fa-solid fa-up-down';
}

function toggleSourceReorder() {
    reorderingSources = !reorderingSources;
    renderSources();
}

/** Move a source one place up or down among the ones shown (archived ones keep their place). */
function moveSource(name, step) {
    const index = sources.findIndex((source) => source.name === name);
    const next = moveInList(sources, index, step, (other) => !other.archived);

    if (next === sources) return;

    const action = step < 0 ? 'move-source-up' : 'move-source-down';
    const twin = step < 0 ? 'move-source-down' : 'move-source-up';
    const selector = (kind) =>
        `#sources-grid button[data-action="${kind}"][data-source="${CSS.escape(name)}"]`;

    sources = next;
    saveMeta('sources');
    renderAll();
    syncToGoogleSheet();
    refocusControl(selector(action), selector(twin));

    const shown = sources.filter((source) => !source.archived);

    announce(
        `${name} đang ở vị trí ${shown.findIndex((source) => source.name === name) + 1} trên ${shown.length}.`,
    );
}

// --- ACTIONS ---
async function editInitialBalance(sourceName) {
    const currentValue = Number(initialBalances[sourceName]) || 0;
    const debtHint = isDebtSource(sourceName)
        ? '\n(Thẻ tín dụng / trả sau / khoản nợ: nhập 0 nếu chưa nợ, số âm nếu đã nợ sẵn, ví dụ -500.000. Số dương sẽ bù vào các khoản chi nên không tính là nợ.)'
        : '';
    // A minus sign is allowed: an opening debt.
    const newValue = await askMoney({
        title: 'Số dư ban đầu',
        message: `Nhập số dư ban đầu cho [${sourceName}]:${debtHint}`,
        value: currentValue,
        signed: true,
    });

    if (newValue === null) return;

    if (!Number.isFinite(newValue)) {
        alert('Số tiền không hợp lệ!');
        return;
    }

    initialBalances[sourceName] = newValue;
    saveMeta('initialBalances');
    renderAll();
    syncToGoogleSheet();
}

/**
 * Make a source show the real balance (what the bank / wallet app says) without working out the
 * opening balance by hand. A credit line with a limit is asked for the amount still available.
 */
async function matchSourceBalance(sourceName) {
    const source = findSource(sourceName);

    if (!source) return;

    const byAvailable = source.kind === 'credit' && source.creditLimit > 0;
    const shown = byAvailable
        ? source.creditLimit + calculateSourceBalances()[source.name]
        : calculateSourceBalances()[source.name];
    const question = byAvailable
        ? `Nhập số dư KHẢ DỤNG hiện tại của [${source.name}] theo ứng dụng (hạn mức ${formatMoney(source.creditLimit)}):`
        : `Nhập số dư thực tế hiện tại của [${source.name}] (đang nợ thì nhập số âm, ví dụ -500.000):`;
    const typed = await askMoney({
        title: 'Khớp số dư',
        message: `${question}\n(App đang tính: ${formatMoney(shown)})`,
        value: shown,
        signed: true,
        confirmLabel: 'Khớp',
    });

    if (typed === null) return;

    if (!Number.isFinite(typed)) {
        alert('Số tiền không hợp lệ!');
        return;
    }

    // The data may have changed (a sync) while the question was open: work from what is true now.
    const balance = calculateSourceBalances()[source.name];
    const opening = Number(initialBalances[source.name]) || 0;
    const target = byAvailable ? balanceFromAvailable(source.creditLimit, typed) : typed;

    initialBalances[source.name] = openingBalanceToMatch({ target, balance, opening });
    saveMeta('initialBalances');
    renderAll();
    syncToGoogleSheet();
    showToast(
        `Đã khớp [${source.name}]: số dư ${formatMoney(target)}, số dư ban đầu ${formatMoney(initialBalances[source.name])}.`,
        'success',
    );
}

function updateSourceFormVisibility() {
    const isCredit = document.getElementById('srcKind').value === 'credit';

    document.getElementById('srcCreditFields').hidden = !isCredit;
}

function openSourceModal(name = null) {
    const source = name ? findSource(name) : null;

    editingSourceName = source ? source.name : null;
    document.getElementById('sourceModalTitle').innerText = source
        ? 'Sửa Nguồn Tiền'
        : 'Thêm Nguồn Tiền';
    document.getElementById('srcName').value = source ? source.name : '';
    document.getElementById('srcKind').value = source ? source.kind : 'bank';
    setMoneyInput('srcCreditLimit', source && source.creditLimit ? source.creditLimit : '');
    document.getElementById('srcStatementDay').value =
        source && source.statementDay ? source.statementDay : '';
    document.getElementById('srcDueDay').value = source && source.dueDay ? source.dueDay : '';
    setMoneyInput('srcInitialBalance', source ? Number(initialBalances[source.name]) || 0 : '');
    updateSourceFormVisibility();
    openDialog('sourceModal', 'srcName');
}

function closeSourceModal() {
    editingSourceName = null;
    closeDialog('sourceModal');
}

/** Rename a source everywhere it is referenced. */
function renameSource(oldName, newName) {
    const changedIds = [];

    transactions = transactions.map((transaction) => {
        if (transaction.source !== oldName && transaction.targetSource !== oldName) {
            return transaction;
        }

        changedIds.push(transaction.id);

        return {
            ...transaction,
            source: transaction.source === oldName ? newName : transaction.source,
            targetSource: transaction.targetSource === oldName ? newName : transaction.targetSource,
            updatedAt: new Date().toISOString(),
        };
    });

    if (Object.hasOwn(initialBalances, oldName)) {
        initialBalances[newName] = initialBalances[oldName];
        delete initialBalances[oldName];
    }

    if (typeof renameSourceInRecurring === 'function') {
        renameSourceInRecurring(oldName, newName);
    }

    renameSourceInSavings(oldName, newName);

    saveDataLocally();
    queueUpsert(changedIds);
}

function handleSourceSubmit(event) {
    event.preventDefault();

    const name = document.getElementById('srcName').value.trim();
    const kind = document.getElementById('srcKind').value;
    const openingBalance = readMoneyInput('srcInitialBalance');
    const existing = editingSourceName ? findSource(editingSourceName) : null;

    if (!name) {
        alert('Vui lòng nhập tên nguồn tiền!');
        return;
    }

    const duplicate = sources.some(
        (source) =>
            source !== existing &&
            source.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'),
    );

    if (duplicate) {
        alert(`Nguồn tiền "${name}" đã tồn tại.`);
        return;
    }

    const updated = normalizeSource({
        name,
        kind,
        creditLimit: readMoneyInput('srcCreditLimit'),
        statementDay: document.getElementById('srcStatementDay').value,
        dueDay: document.getElementById('srcDueDay').value,
        archived: existing ? existing.archived : false,
    });

    if (existing && existing.name !== name) {
        const usedBy = transactions.filter(
            (transaction) =>
                transaction.source === existing.name || transaction.targetSource === existing.name,
        ).length;

        if (
            usedBy &&
            !confirm(
                `Đổi tên sẽ cập nhật ${usedBy} giao dịch đang dùng nguồn "${existing.name}". Tiếp tục?`,
            )
        ) {
            return;
        }

        renameSource(existing.name, name);
    }

    if (existing) {
        sources[sources.indexOf(existing)] = updated;
    } else {
        sources.push(updated);
    }

    if (!Number.isNaN(openingBalance)) {
        initialBalances[name] = openingBalance;
    }

    saveMeta('sources');
    saveMeta('initialBalances');
    closeSourceModal();
    renderAll();
    syncToGoogleSheet();
}

function archiveSource(name, archive) {
    const source = findSource(name);

    if (!source) return;

    if (archive) {
        if (sourceNames().length <= 1) {
            alert('Phải còn ít nhất một nguồn tiền đang dùng.');
            return;
        }

        if (savingsPlanUsesSource(name)) {
            alert(
                `"${name}" đang nằm trong kế hoạch tự động gửi tiết kiệm. Hãy sửa hoặc tắt kế hoạch đó trước khi lưu trữ.`,
            );
            return;
        }

        if (Math.abs(calculateSourceBalances()[name]) >= 1) {
            alert(
                `Nguồn "${name}" còn số dư ${formatMoney(calculateSourceBalances()[name])}. Hãy chuyển hết tiền (hoặc tất toán) về 0 trước khi lưu trữ.`,
            );
            return;
        }
    }

    source.archived = archive;
    saveMeta('sources');
    renderAll();
    syncToGoogleSheet();
}

function deleteSource(name) {
    const source = findSource(name);

    if (!source) return;

    const usedByTransactions = transactions.filter(
        (transaction) => transaction.source === name || transaction.targetSource === name,
    ).length;
    const usedByRecurring =
        typeof countRecurringUsingSource === 'function' ? countRecurringUsingSource(name) : 0;

    if (usedByTransactions || usedByRecurring || savingsPlanUsesSource(name)) {
        alert(
            `Không thể xóa "${name}": đang được ${usedByTransactions} giao dịch và ${usedByRecurring} giao dịch định kỳ sử dụng${savingsPlanUsesSource(name) ? ', và nằm trong kế hoạch tự động gửi tiết kiệm' : ''}. Hãy dùng "Lưu trữ" để ẩn nguồn này.`,
        );
        return;
    }

    if (sources.length <= 1) {
        alert('Phải còn ít nhất một nguồn tiền.');
        return;
    }

    if (!confirm(`Xóa nguồn tiền "${name}"?`)) return;

    sources = sources.filter((item) => item !== source);
    delete initialBalances[name];
    saveMeta('sources');
    saveMeta('initialBalances');
    renderAll();
    syncToGoogleSheet();
}
