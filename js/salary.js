// Monthly salary and how much of it this month's spending has used: overview card, dialog, alerts.

function getSalaryStatus() {
    return computeSalaryStatus(transactions, salaryPlan, currentMonthKey());
}

function renderSalary() {
    const body = document.getElementById('salary-body');
    const editLabel = document.getElementById('salary-edit-label');

    if (!body) return;

    const status = getSalaryStatus();

    if (editLabel) editLabel.textContent = status ? 'Sửa' : 'Đặt mức lương';

    if (!status) {
        body.innerHTML = `<p class="salary-empty">Chưa đặt mức lương. Đặt lương hằng tháng để xem chi tiêu chiếm bao nhiêu % lương và nhận cảnh báo khi sắp hết.</p>`;
        return;
    }

    const bar = Math.min(status.percent, 100);
    let message = `Trong mức an toàn. Còn lại <b>${formatMoney(status.remaining)}</b>, sẽ cảnh báo khi đã chi ${status.warnPercent}% lương.`;

    if (status.level === 1) {
        message = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Sắp hết lương: đã chi ${status.percent}%, vượt mốc cảnh báo ${status.warnPercent}%. Còn lại <b>${formatMoney(status.remaining)}</b>.`;
    } else if (status.level === 2) {
        message =
            status.remaining === 0
                ? '<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> Đã chi hết lương tháng này.'
                : `<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> Đã chi vượt lương tháng này <b>${formatMoney(-status.remaining)}</b>.`;
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
        </div>`;
}

function openSalaryModal() {
    setMoneyInput('salaryAmount', salaryPlan.amount || '');
    document.getElementById('salaryWarn').value = salaryPlan.warnPercent;
    openDialog('salaryModal', 'salaryAmount');
}

function closeSalaryModal() {
    closeDialog('salaryModal');
}

function handleSalarySubmit(event) {
    event.preventDefault();

    const amount = readMoneyInput('salaryAmount');
    const warnPercent = Number(document.getElementById('salaryWarn').value);

    if (!Number.isInteger(warnPercent) || warnPercent < 1 || warnPercent > 100) {
        alert('Mức cảnh báo phải là số nguyên từ 1 đến 100 (% lương).');
        return;
    }

    // An empty or zero salary switches the feature off.
    salaryPlan = normalizeSalaryPlan({ amount: Number.isFinite(amount) ? amount : 0, warnPercent });
    saveMeta('salary');
    closeSalaryModal();
    renderAll();
    syncToGoogleSheet();
}

/**
 * After a new expense, warn if it pushed this month's spending past the warning percent or the
 * whole salary. Only a crossing triggers a message, so later expenses in the same band stay quiet.
 */
function notifySalary(transaction) {
    if (transaction.type !== 'expense' || !transaction.date.startsWith(currentMonthKey())) return;

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
