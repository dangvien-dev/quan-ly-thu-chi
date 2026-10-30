// Monthly salary and how much of it this month's spending has used: overview card, salary groups
// (for example personal, work, saving), dialogs, and alerts.

function getSalaryStatus() {
    return computeSalaryStatus(transactions, salaryPlan, currentMonthKey());
}

function getSalaryAllocation() {
    return computeSalaryAllocation(transactions, salaryPlan, currentMonthKey());
}

const WARNING_ICON = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>';
const DANGER_ICON = '<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>';

// --- OVERVIEW CARD ---
function renderSalaryGroup(group) {
    const name = escapeHtml(group.name);
    let bar;
    let amountText;
    let note;
    let status = '';

    if (group.saving) {
        bar = group.cap > 0 ? Math.min(Math.floor((group.kept * 100) / group.cap), 100) : 100;
        amountText = `${formatMoney(group.kept)} / mục tiêu ${formatMoney(group.cap)}`;
        note = `Mục tiêu ${group.percent}% lương · đang giữ ${group.percentOfSalary}% lương (phần còn lại sau chi tiêu)`;

        const deposited = savingsDepositedInMonth(currentMonthKey());

        if (deposited > 0) note += ` · đã gửi vào sổ tiết kiệm ${formatMoney(deposited)}`;

        if (group.level === 1) {
            status = `${WARNING_ICON} Sắp chạm mức tiết kiệm mục tiêu`;
        } else if (group.level === 2) {
            status = `${DANGER_ICON} Chưa đạt mục tiêu, thiếu ${formatMoney(group.cap - group.kept)}`;
        }
    } else {
        bar = Math.min(group.usedPercent, 100);
        amountText = `${formatMoney(group.spent)} / ${formatMoney(group.cap)}`;
        note = `Hạn mức ${group.percent}% lương · đã chi ${group.percentOfSalary}% lương`;

        if (group.level === 0) {
            status = `Còn ${formatMoney(group.remaining)}`;
        } else if (group.level === 1) {
            status = `${WARNING_ICON} Sắp hết hạn mức, còn ${formatMoney(group.remaining)}`;
        } else {
            status =
                group.remaining === 0
                    ? `${DANGER_ICON} Đã hết hạn mức`
                    : `${DANGER_ICON} Vượt hạn mức ${formatMoney(-group.remaining)}`;
        }
    }

    return `<div class="salary-group level-${group.level}">
            <div class="salary-group-head">
                <span class="salary-group-name">${name}</span>
                <span class="salary-group-amount">${amountText}</span>
            </div>
            <div class="progress" role="progressbar" aria-label="Nhóm ${name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${bar}">
                <div class="progress-bar" style="width:${bar}%"></div>
            </div>
            <p class="salary-group-note">${note}${status ? ` · <span class="salary-group-status">${status}</span>` : ''}</p>
        </div>`;
}

function renderSalaryGroups() {
    const allocation = getSalaryAllocation();
    const header = (label) => `<div class="salary-groups-head">
            <h4>Chia lương theo nhóm</h4>
            <button type="button" class="btn btn-outline" onclick="openAllocationModal()">${label}</button>
        </div>`;

    if (!allocation) {
        return `<div class="salary-groups">${header('Chia lương')}<p class="salary-empty">Chưa chia lương thành các nhóm (ví dụ tiêu dùng cá nhân, công việc, tiết kiệm).</p></div>`;
    }

    return `<div class="salary-groups">${header('Sửa nhóm')}${allocation.groups.map(renderSalaryGroup).join('')}</div>`;
}

function renderSalary() {
    const body = document.getElementById('salary-body');
    const editLabel = document.getElementById('salary-edit-label');

    if (!body) return;

    const status = getSalaryStatus();

    if (editLabel) editLabel.textContent = status ? 'Sửa' : 'Đặt mức lương';

    if (!status) {
        body.innerHTML = `<p class="salary-empty">Chưa đặt mức lương. Đặt lương hằng tháng để xem chi tiêu chiếm bao nhiêu % lương, chia lương theo nhóm và nhận cảnh báo khi sắp hết.</p>`;
        return;
    }

    const bar = Math.min(status.percent, 100);
    let message = `Trong mức an toàn. Còn lại <b>${formatMoney(status.remaining)}</b>, sẽ cảnh báo khi đã chi ${status.warnPercent}% lương.`;

    if (status.level === 1) {
        message = `${WARNING_ICON} Sắp hết lương: đã chi ${status.percent}%, vượt mốc cảnh báo ${status.warnPercent}%. Còn lại <b>${formatMoney(status.remaining)}</b>.`;
    } else if (status.level === 2) {
        message =
            status.remaining === 0
                ? `${DANGER_ICON} Đã chi hết lương tháng này.`
                : `${DANGER_ICON} Đã chi vượt lương tháng này <b>${formatMoney(-status.remaining)}</b>.`;
    }

    body.innerHTML = `<div class="salary-status level-${status.level}">
            <div class="salary-percent"><b>${status.percent}%</b> lương đã chi</div>
            <div class="salary-track">
                <div class="progress" role="progressbar" aria-label="Chi tiêu trên lương tháng này" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${bar}">
                    <div class="progress-bar" style="width:${bar}%"></div>
                </div>
                <span class="salary-marker" style="left:${status.warnPercent}%" aria-hidden="true"></span>
            </div>
            <div class="salary-detail">Đã chi ${formatMoney(status.spent)} / lương ${formatMoney(status.salary)}</div>
            <p class="salary-message">${message}</p>
        </div>${renderSalaryGroups()}`;
}

/** Overview debt card: the debt as a share of the salary, turning red from the warning percent. */
function renderDebtVsSalary(totalDebt) {
    const element = document.getElementById('lbl-debt-salary');

    if (!element) return;

    const status = computeDebtStatus(totalDebt, salaryPlan);

    element.hidden = !(totalDebt > 0);
    element.classList.toggle('source-warn', Boolean(status && status.level === 1));
    element.dataset.level = status ? String(status.level) : '';

    if (!status) {
        element.textContent = 'Chưa đặt mức lương nên chưa so được dư nợ với lương.';
    } else if (status.level === 1) {
        element.innerHTML = `${WARNING_ICON} Dư nợ bằng <b>${status.percent}%</b> lương, đã chạm mốc ${status.warnPercent}% (${escapeHtml(formatMoney(status.limit))}). Nên trả bớt trước khi mua trả sau thêm.`;
    } else {
        element.textContent = `Bằng ${status.percent}% lương · cảnh báo từ ${status.warnPercent}% (${formatMoney(status.limit)})`;
    }
}

// --- SALARY DIALOG ---
function openSalaryModal() {
    setMoneyInput('salaryAmount', salaryPlan.amount || '');
    document.getElementById('salaryWarn').value = salaryPlan.warnPercent;
    document.getElementById('salaryDebtWarn').value = salaryPlan.debtWarnPercent;
    openDialog('salaryModal', 'salaryAmount');
}

function closeSalaryModal() {
    closeDialog('salaryModal');
}

function handleSalarySubmit(event) {
    event.preventDefault();

    const amount = readMoneyInput('salaryAmount');
    const warnPercent = Number(document.getElementById('salaryWarn').value);
    const debtWarnPercent = Number(document.getElementById('salaryDebtWarn').value);

    if (!Number.isInteger(warnPercent) || warnPercent < 1 || warnPercent > 100) {
        alert('Mức cảnh báo phải là số nguyên từ 1 đến 100 (% lương).');
        return;
    }

    if (!Number.isInteger(debtWarnPercent) || debtWarnPercent < 1 || debtWarnPercent > 100) {
        alert('Mức cảnh báo dư nợ phải là số nguyên từ 1 đến 100 (% lương).');
        return;
    }

    // An empty or zero salary switches the feature off. The groups are kept for next time.
    salaryPlan = normalizeSalaryPlan({
        ...salaryPlan,
        amount: Number.isFinite(amount) ? amount : 0,
        warnPercent,
        debtWarnPercent,
    });
    saveMeta('salary');
    closeSalaryModal();
    renderAll();
    syncToGoogleSheet();
}

// --- GROUPS DIALOG ---
// The form is rebuilt from a "draft" ({ groups, assign }) read back from the fields, so adding,
// removing and renaming groups never loses what has been typed or chosen elsewhere in the form.
let allocationCounter = 0;

function readAllocationDraft() {
    const form = document.getElementById('allocationForm');
    const assign = {};

    form.querySelectorAll('select[data-category]').forEach((select) => {
        assign[select.dataset.category] = select.value;
    });

    return {
        groups: Array.from(form.querySelectorAll('.allocation-group')).map((row) => ({
            id: row.dataset.id,
            name: row.querySelector('[data-field=name]').value,
            percent: row.querySelector('[data-field=percent]').value,
            saving: row.querySelector('[data-field=saving]').checked,
        })),
        assign,
    };
}

function renderAllocationCategories(draft) {
    const container = document.getElementById('allocationCategories');
    const spending = draft.groups.filter((group) => !group.saving);
    const expenseCategories = categories.filter((category) => category.type === 'expense');

    if (spending.length === 0 || expenseCategories.length === 0) {
        container.innerHTML = '<p class="hint">Chưa có nhóm chi hoặc danh mục chi nào.</p>';
        return;
    }

    container.innerHTML = expenseCategories
        .map((category, index) => {
            const chosen = spending.some((group) => group.id === draft.assign[category.name])
                ? draft.assign[category.name]
                : spending[0].id;
            const options = spending
                .map(
                    (group) =>
                        `<option value="${escapeHtml(group.id)}"${group.id === chosen ? ' selected' : ''}>${escapeHtml(group.name.trim() || 'Nhóm chưa đặt tên')}</option>`,
                )
                .join('');

            return `<div class="form-group allocation-category">
                <label for="allocCat${index}">${escapeHtml(category.name)}</label>
                <select id="allocCat${index}" class="form-control" data-category="${escapeHtml(category.name)}">${options}</select>
            </div>`;
        })
        .join('');
}

function updateAllocationTotal() {
    const total = Array.from(document.querySelectorAll('#allocationGroups [data-field=percent]'))
        .map((input) => Number(input.value) || 0)
        .reduce((sum, percent) => sum + percent, 0);
    const element = document.getElementById('allocationTotal');

    element.classList.toggle('over', total > 100);
    element.textContent =
        total > 100
            ? `Tổng ${total}%: vượt 100%, hãy giảm bớt.`
            : total < 100
              ? `Tổng ${total}% (còn ${100 - total}% lương chưa chia).`
              : 'Tổng 100%.';
}

function renderAllocationForm(draft) {
    document.getElementById('allocationGroups').innerHTML = draft.groups
        .map(
            (group, index) => `<div class="allocation-group" data-id="${escapeHtml(group.id)}">
                <div class="form-row">
                    <div class="form-group">
                        <label for="allocName${index}">Tên nhóm</label>
                        <input type="text" id="allocName${index}" class="form-control" maxlength="40" required data-field="name" value="${escapeHtml(group.name)}" />
                    </div>
                    <div class="form-group">
                        <label for="allocPercent${index}">% lương</label>
                        <input type="number" id="allocPercent${index}" class="form-control" min="0" max="100" step="1" required inputmode="numeric" data-field="percent" value="${escapeHtml(group.percent)}" />
                    </div>
                </div>
                <div class="allocation-group-actions">
                    <label class="check-label"><input type="checkbox" data-field="saving"${group.saving ? ' checked' : ''} /> Là phần tiết kiệm</label>
                    <button type="button" class="btn btn-outline" data-action="remove-group" aria-label="Xóa nhóm ${escapeHtml(group.name.trim() || index + 1)}">Xóa</button>
                </div>
            </div>`,
        )
        .join('');
    renderAllocationCategories(draft);
    updateAllocationTotal();
}

function openAllocationModal() {
    renderAllocationForm({
        groups: salaryPlan.groups.map((group) => ({ ...group })),
        assign: { ...salaryPlan.assign },
    });
    openDialog('allocationModal', salaryPlan.groups.length ? 'allocName0' : 'allocationAdd');
}

function closeAllocationModal() {
    closeDialog('allocationModal');
}

function handleAllocationClick(event) {
    const button = event.target.closest('button[data-action]');

    if (!button) return;

    const draft = readAllocationDraft();

    if (button.dataset.action === 'add-group') {
        if (draft.groups.length >= MAX_SALARY_GROUPS) {
            alert(`Tối đa ${MAX_SALARY_GROUPS} nhóm.`);
            return;
        }

        draft.groups.push({
            id: `G_${Date.now()}_${allocationCounter++}`,
            name: '',
            percent: 0,
            saving: false,
        });
        renderAllocationForm(draft);
        document.getElementById(`allocName${draft.groups.length - 1}`).focus();
    } else if (button.dataset.action === 'remove-group') {
        const id = button.closest('.allocation-group').dataset.id;

        draft.groups = draft.groups.filter((group) => group.id !== id);
        renderAllocationForm(draft);
        document.getElementById('allocationAdd').focus();
    } else if (button.dataset.action === 'reset-groups') {
        renderAllocationForm({
            groups: DEFAULT_SALARY_GROUPS.map((group) => ({ ...group })),
            assign: draft.assign,
        });
    }
}

function handleAllocationInput(event) {
    const field = event.target.dataset.field;

    if (field === 'percent') {
        updateAllocationTotal();
    } else if (field === 'name') {
        renderAllocationCategories(readAllocationDraft());
    }
}

function handleAllocationChange(event) {
    if (event.target.dataset.field !== 'saving') return;

    // Only one group can be the saving part.
    if (event.target.checked) {
        document.querySelectorAll('#allocationGroups [data-field=saving]').forEach((box) => {
            if (box !== event.target) box.checked = false;
        });
    }

    renderAllocationCategories(readAllocationDraft());
}

function handleAllocationSubmit(event) {
    event.preventDefault();

    const draft = readAllocationDraft();
    const groups = draft.groups.map((group) => ({
        id: group.id,
        name: group.name.trim(),
        percent: Number(group.percent),
        saving: group.saving,
    }));
    const names = groups.map((group) => group.name.toLocaleLowerCase('vi'));
    const total = groups.reduce((sum, group) => sum + group.percent, 0);

    if (groups.some((group) => !group.name || !Number.isInteger(group.percent))) {
        alert('Mỗi nhóm cần có tên và số phần trăm là số nguyên.');
        return;
    }

    if (groups.some((group) => group.percent < 0 || group.percent > 100) || total > 100) {
        alert('Tổng phần trăm các nhóm không được vượt quá 100%.');
        return;
    }

    if (new Set(names).size !== names.length) {
        alert('Tên các nhóm không được trùng nhau.');
        return;
    }

    // Only exceptions are stored: a category left on the first spending group needs no entry.
    const defaultId = (groups.find((group) => !group.saving) || {}).id;
    const assign = Object.fromEntries(
        Object.entries(draft.assign).filter(([, groupId]) => groupId !== defaultId),
    );

    salaryPlan = normalizeSalaryPlan({ ...salaryPlan, groups, assign });
    saveMeta('salary');
    closeAllocationModal();
    renderAll();
    syncToGoogleSheet();

    // The card was rebuilt, so the button that opened the dialog is gone: put focus on its successor.
    const opener = document.querySelector('.salary-groups-head button');

    if (opener) opener.focus();
}

function initSalary() {
    const form = document.getElementById('allocationForm');

    form.addEventListener('click', handleAllocationClick);
    form.addEventListener('input', handleAllocationInput);
    form.addEventListener('change', handleAllocationChange);
}

// --- ALERTS ---
/**
 * After a new expense, warn if it pushed this month's spending past the warning percent or the
 * whole salary. Only a crossing triggers a message, so later expenses in the same band stay quiet.
 */
function notifySalaryTotal(transaction) {
    const status = getSalaryStatus();

    if (!status) return;

    const before = salaryLevel(
        (status.spent - transaction.amount) / status.salary,
        status.warnPercent,
    );

    if (status.level <= before) return;

    const detail = `${formatMoney(status.spent)} / ${formatMoney(status.salary)} (${status.percent}%)`;

    if (status.level === 2) {
        showToast(`Đã chi hết lương tháng này: ${detail}`, 'danger');
    } else {
        showToast(`Sắp hết lương tháng này (mốc ${status.warnPercent}%): ${detail}`, 'warning');
    }
}

/** The same for the group the expense counts toward and for the saving target. */
function notifySalaryGroups(transaction) {
    const after = getSalaryAllocation();

    if (!after) return;

    // By identity, not id: the new transaction is the one object in the list that we skip.
    const before = computeSalaryAllocation(
        transactions.filter((item) => item !== transaction),
        salaryPlan,
        currentMonthKey(),
    );
    const target = salaryGroupFor(salaryPlan, transaction.category);

    after.groups.forEach((group, index) => {
        if (group.level <= before.groups[index].level) return;
        if (!group.saving && !(target && group.id === target.id)) return;

        const kind = group.level === 2 ? 'danger' : 'warning';
        const name = `"${group.name}"`;

        if (group.saving) {
            showToast(
                group.level === 2
                    ? `Chưa đạt mục tiêu tiết kiệm ${name}: đang giữ ${formatMoney(group.kept)} / ${formatMoney(group.cap)}`
                    : `Sắp chạm mức tiết kiệm mục tiêu ${name}: đang giữ ${formatMoney(group.kept)} / ${formatMoney(group.cap)}`,
                kind,
            );
        } else {
            const detail = `${formatMoney(group.spent)} / ${formatMoney(group.cap)} (${group.usedPercent}%)`;

            showToast(
                group.level === 2
                    ? `Nhóm ${name} đã hết hạn mức: ${detail}`
                    : `Nhóm ${name} sắp hết hạn mức: ${detail}`,
                kind,
            );
        }
    });
}

function notifySalary(transaction) {
    if (transaction.type !== 'expense' || !transaction.date.startsWith(currentMonthKey())) return;

    notifySalaryTotal(transaction);
    notifySalaryGroups(transaction);
}
