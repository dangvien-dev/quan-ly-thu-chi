// Recurring transactions: the rules, their editor, and creating the transactions that are due.

let editingRecurringId = null;

// --- SOURCES HOOKS (called from js/sources.js) ---
function renameSourceInRecurring(oldName, newName) {
    let changed = false;

    recurring.forEach((rule) => {
        if (rule.source === oldName) {
            rule.source = newName;
            changed = true;
        }

        if (rule.targetSource === oldName) {
            rule.targetSource = newName;
            changed = true;
        }
    });

    if (changed) saveMeta('recurring');
}

function countRecurringUsingSource(name) {
    return recurring.filter((rule) => rule.source === name || rule.targetSource === name).length;
}

// --- GENERATION ---
/**
 * Create the transactions that came due since each rule last ran. Ids are derived from the rule
 * and the date, so running this twice (or on two devices) never creates a duplicate.
 */
function generateRecurringTransactions() {
    const today = toLocalDateString();
    const stamp = new Date().toISOString();
    const existingIds = new Set(transactions.map((transaction) => transaction.id));
    const created = [];
    let rulesChanged = false;

    recurring.forEach((rule) => {
        const dates = recurringDueDates(rule, today);

        if (dates.length === 0) return;

        dates.forEach((date) => {
            const id = recurringTransactionId(rule, date);

            if (existingIds.has(id)) return;

            existingIds.add(id);
            created.push({
                id,
                date,
                type: rule.type,
                source: rule.source,
                targetSource: rule.targetSource,
                category: rule.category,
                amount: rule.amount,
                note: rule.note || rule.name,
                updatedAt: stamp,
            });
        });

        rule.lastGenerated = dates[dates.length - 1];
        rule.updatedAt = stamp;
        rulesChanged = true;
    });

    if (created.length) {
        transactions = [...created, ...transactions];
        saveDataLocally();
        queueUpsert(created.map((transaction) => transaction.id));
    }

    if (rulesChanged) saveMeta('recurring');

    if (created.length || rulesChanged) {
        renderAll();
        syncToGoogleSheet();
    }

    if (created.length) {
        showToast(`Đã tạo ${created.length} giao dịch định kỳ.`, 'success');
    }

    return created.length;
}

// --- RENDERING ---
function recurringStatus(rule, today) {
    if (!rule.active) return { label: 'Tạm dừng', className: 'status-paused' };

    if (rule.endDate && rule.endDate < today) {
        return { label: 'Đã kết thúc', className: 'status-ended' };
    }

    return { label: 'Đang chạy', className: 'status-active' };
}

function renderRecurring() {
    const tbody = document.getElementById('recurring-table-body');

    if (!tbody) return;

    if (recurring.length === 0) {
        tbody.innerHTML =
            '<tr class="empty-row"><td colspan="8" style="text-align:center; color: var(--text-muted);">Chưa có giao dịch định kỳ</td></tr>';
        return;
    }

    const today = toLocalDateString();

    tbody.innerHTML = recurring
        .map((rule) => {
            const id = escapeHtml(rule.id);
            const status = recurringStatus(rule, today);
            const next = nextRecurringDate(rule, today);
            const color =
                rule.type === 'income'
                    ? 'var(--success)'
                    : rule.type === 'expense'
                      ? 'var(--danger)'
                      : 'var(--warning)';
            const typeLabel = { income: 'Thu', expense: 'Chi', transfer: 'Chuyển' }[rule.type];
            const sourceText =
                rule.type === 'transfer'
                    ? `${escapeHtml(rule.source)} ➔ ${escapeHtml(rule.targetSource)}`
                    : escapeHtml(rule.source);
            const period = `${escapeHtml(formatDateDisplay(rule.startDate))} → ${escapeHtml(rule.endDate ? formatDateDisplay(rule.endDate) : 'không giới hạn')}`;

            return `<tr>
            <td data-label="Tên"><b>${escapeHtml(rule.name)}</b>${rule.category && rule.type !== 'transfer' ? `<div class="source-meta">${escapeHtml(rule.category)}</div>` : ''}</td>
            <td data-label="Loại"><span style="color:${color}; font-weight:600;">${typeLabel}</span></td>
            <td data-label="Nguồn tiền">${sourceText}</td>
            <td data-label="Số tiền" style="font-weight:700; color:${color};">${formatMoney(rule.amount)}</td>
            <td data-label="Lịch">${escapeHtml(describeRecurringSchedule(rule))}${next ? `<div class="source-meta">Lần tới: ${escapeHtml(formatDateDisplay(next))}</div>` : ''}</td>
            <td data-label="Hiệu lực">${period}</td>
            <td data-label="Trạng thái"><span class="status-badge ${status.className}">${status.label}</span></td>
            <td class="row-actions" style="text-align:right; white-space:nowrap;">
                <button class="btn btn-outline btn-small" data-action="toggle" data-id="${id}" title="${rule.active ? 'Tạm dừng' : 'Tiếp tục (không tạo bù thời gian tạm dừng)'}" aria-label="${rule.active ? 'Tạm dừng' : 'Tiếp tục'} ${escapeHtml(rule.name)}">
                    <i class="fa-solid ${rule.active ? 'fa-pause' : 'fa-play'}"></i>
                </button>
                <button class="btn btn-outline btn-small" data-action="edit" data-id="${id}" title="Sửa" aria-label="Sửa ${escapeHtml(rule.name)}">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn btn-outline btn-small" data-action="delete" data-id="${id}" title="Xóa" aria-label="Xóa ${escapeHtml(rule.name)}">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`;
        })
        .join('');
}

function handleRecurringTableClick(event) {
    const button = event.target.closest('button[data-action]');

    if (!button) return;

    const actions = {
        toggle: toggleRecurring,
        edit: openRecurringModal,
        delete: deleteRecurring,
    };

    if (actions[button.dataset.action]) {
        actions[button.dataset.action](button.dataset.id);
    }
}

// --- EDITOR ---
function fillRecurringSelects() {
    const type = document.getElementById('rcType').value;
    const options = (names) =>
        names
            .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
            .join('');
    const lists = {
        rcSource: sourceNames(),
        rcTarget: sourceNames(),
        rcCategory: categories
            .filter((category) => category.type === type)
            .map((category) => category.name),
    };

    // Rebuilding the lists must not throw away what the user has already picked.
    Object.entries(lists).forEach(([id, names]) => {
        const select = document.getElementById(id);
        const previous = select.value;

        select.innerHTML = options(names);
        selectValue(id, previous);
    });
}

function updateRecurringFormVisibility() {
    const type = document.getElementById('rcType').value;
    const weekly = document.getElementById('rcFrequency').value === 'weekly';
    const category = document.getElementById('rcCategory');

    fillRecurringSelects();
    document.getElementById('rcTargetGroup').hidden = type !== 'transfer';
    document.getElementById('rcCategoryGroup').hidden = type === 'transfer';
    // A hidden required select would silently block the form, so disable it for transfers.
    category.disabled = type === 'transfer';
    document.getElementById('rcMonthDayGroup').hidden = weekly;
    document.getElementById('rcWeekDayGroup').hidden = !weekly;
}

function openRecurringModal(id = null) {
    const rule = id ? recurring.find((item) => item.id === id) : null;

    editingRecurringId = rule ? rule.id : null;
    document.getElementById('recurringModalTitle').innerText = rule
        ? 'Sửa Giao Dịch Định Kỳ'
        : 'Thêm Giao Dịch Định Kỳ';
    document.getElementById('rcName').value = rule ? rule.name : '';
    document.getElementById('rcType').value = rule ? rule.type : 'expense';
    document.getElementById('rcFrequency').value = rule ? rule.frequency : 'monthly';
    updateRecurringFormVisibility();

    if (rule) {
        selectValue('rcSource', rule.source, true);
        selectValue('rcTarget', rule.targetSource, true);
        selectValue('rcCategory', rule.category, true);
    }

    setMoneyInput('rcAmount', rule ? rule.amount : '');
    document.getElementById('rcMonthDay').value =
        rule && rule.frequency === 'monthly' ? rule.day : 1;
    document.getElementById('rcWeekDay').value = rule && rule.frequency === 'weekly' ? rule.day : 1;
    document.getElementById('rcStart').value = rule ? rule.startDate : toLocalDateString();
    document.getElementById('rcEnd').value = rule ? rule.endDate : '';
    document.getElementById('rcNote').value = rule ? rule.note : '';
    document.getElementById('rcActive').checked = rule ? rule.active : true;
    openDialog('recurringModal', 'rcName');
}

function closeRecurringModal() {
    editingRecurringId = null;
    closeDialog('recurringModal');
}

function handleRecurringSubmit(event) {
    event.preventDefault();

    const existing = editingRecurringId
        ? recurring.find((item) => item.id === editingRecurringId)
        : null;
    const type = document.getElementById('rcType').value;
    const weekly = document.getElementById('rcFrequency').value === 'weekly';
    const rule = normalizeRecurringRule({
        id: existing ? existing.id : `RC_${Date.now()}`,
        name: document.getElementById('rcName').value,
        type,
        source: document.getElementById('rcSource').value,
        targetSource: document.getElementById('rcTarget').value,
        category: document.getElementById('rcCategory').value,
        amount: readMoneyInput('rcAmount'),
        note: document.getElementById('rcNote').value.trim(),
        frequency: weekly ? 'weekly' : 'monthly',
        day: document.getElementById(weekly ? 'rcWeekDay' : 'rcMonthDay').value,
        startDate: document.getElementById('rcStart').value,
        endDate: document.getElementById('rcEnd').value,
        active: document.getElementById('rcActive').checked,
        lastGenerated: existing ? existing.lastGenerated : '',
        updatedAt: new Date().toISOString(),
    });

    if (!rule || !rule.name) {
        alert('Vui lòng nhập tên, số tiền và ngày bắt đầu hợp lệ!');
        return;
    }

    if (type === 'transfer' && rule.source === rule.targetSource) {
        alert('Nguồn chuyển và nguồn nhận phải khác nhau!');
        return;
    }

    if (rule.endDate && rule.endDate < rule.startDate) {
        alert('Ngày kết thúc phải sau ngày bắt đầu!');
        return;
    }

    const backfill = existing ? 0 : recurringDueDates(rule, toLocalDateString()).length;

    if (
        backfill > 0 &&
        !confirm(
            `Ngày bắt đầu nằm trong quá khứ: sẽ tạo ngay ${backfill} giao dịch bù từ ${formatDateDisplay(rule.startDate)} đến hôm nay. Tiếp tục?`,
        )
    ) {
        return;
    }

    if (existing) {
        recurring[recurring.indexOf(existing)] = rule;
    } else {
        recurring.push(rule);
    }

    saveMeta('recurring');
    closeRecurringModal();
    generateRecurringTransactions();
    renderAll();
    syncToGoogleSheet();
}

// --- RULE ACTIONS ---
function toggleRecurring(id) {
    const rule = recurring.find((item) => item.id === id);

    if (!rule) return;

    rule.active = !rule.active;
    rule.updatedAt = new Date().toISOString();

    // Resuming starts from today: the paused period is not made up.
    if (rule.active) {
        rule.lastGenerated = toLocalDateString(addDays(new Date(), -1));
    }

    saveMeta('recurring');
    generateRecurringTransactions();
    renderAll();
    syncToGoogleSheet();
}

function deleteRecurring(id) {
    const rule = recurring.find((item) => item.id === id);

    if (!rule) return;

    if (!confirm(`Xóa giao dịch định kỳ "${rule.name}"? Các giao dịch đã tạo vẫn được giữ lại.`)) {
        return;
    }

    recurring = recurring.filter((item) => item !== rule);
    saveMeta('recurring');
    renderAll();
    syncToGoogleSheet();
}

function initRecurring() {
    document
        .getElementById('recurring-table-body')
        .addEventListener('click', handleRecurringTableClick);
    document.getElementById('rcType').addEventListener('change', updateRecurringFormVisibility);
    document
        .getElementById('rcFrequency')
        .addEventListener('change', updateRecurringFormVisibility);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') generateRecurringTransactions();
    });
}
