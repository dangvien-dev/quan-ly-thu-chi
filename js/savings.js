// Savings book: savings sources, the automatic monthly deposit made on payday, and the history.

const NEW_BOOK = '__new__';
const SAVINGS_PAGE_SIZE = 30;
let visibleSavingsMovements = SAVINGS_PAGE_SIZE;

const isSavingsKind = (source) => Boolean(SOURCE_KINDS[source.kind].saving);

function isSavingsSource(name) {
    const source = findSource(name);

    return Boolean(source && isSavingsKind(source));
}

// --- SOURCES HOOKS (called from js/sources.js) ---
function renameSourceInSavings(oldName, newName) {
    let changed = false;

    ['from', 'book'].forEach((key) => {
        if (savingsPlan[key] === oldName) {
            savingsPlan[key] = newName;
            changed = true;
        }
    });

    if (changed) saveMeta('savings');
}

/** Whether the automatic deposit relies on this source (so it must not be deleted or archived). */
function savingsPlanUsesSource(name) {
    return savingsPlan.enabled && (savingsPlan.from === name || savingsPlan.book === name);
}

// --- THE PLAN ---
/** Why the plan cannot make its deposits right now ('' = it can). */
function savingsPlanProblem(plan) {
    if (!plan.enabled) return '';

    const from = findSource(plan.from);
    const book = findSource(plan.book);

    if (!from || from.archived) return `Nguồn tiền "${plan.from}" không còn dùng được.`;

    if (!book || book.archived || !isSavingsKind(book)) {
        return `"${plan.book}" không còn là sổ tiết kiệm đang dùng.`;
    }

    if (plan.mode === 'percent' && !(salaryPlan.amount > 0)) {
        return 'Chưa đặt mức lương nên chưa tính được số tiền gửi (đặt lương ở Tổng quan, hoặc đổi sang số tiền cố định).';
    }

    return '';
}

/**
 * Make the deposits that came due since the last one (usually this month's, on payday). The id
 * depends only on the month, so running this again, or on another device, adds nothing twice.
 */
function generateSavingsDeposits() {
    if (savingsPlanProblem(savingsPlan)) return 0;

    const due = savingsDueDeposits(savingsPlan, toLocalDateString());

    if (due.length === 0) return 0;

    const amount = savingsDepositAmount(savingsPlan, salaryPlan);

    if (!(amount > 0)) return 0;

    const stamp = new Date().toISOString();
    const existingIds = new Set(transactions.map((transaction) => transaction.id));
    const created = due
        .filter((deposit) => !existingIds.has(savingsTransactionId(deposit.month)))
        .map((deposit) => ({
            id: savingsTransactionId(deposit.month),
            date: deposit.date,
            type: 'transfer',
            source: savingsPlan.from,
            targetSource: savingsPlan.book,
            category: TRANSFER_CATEGORY,
            amount,
            note: `Tự động gửi tiết kiệm tháng ${deposit.month.slice(5)}/${deposit.month.slice(0, 4)}`,
            updatedAt: stamp,
        }));

    savingsPlan.lastMonth = due[due.length - 1].month;
    saveMeta('savings');

    if (created.length) {
        transactions = [...created, ...transactions];
        saveDataLocally();
        queueUpsert(created.map((transaction) => transaction.id));
    }

    renderAll();
    syncToGoogleSheet();

    if (created.length) {
        showToast(
            created.length === 1
                ? `Đã tự gửi ${formatMoney(amount)} vào "${savingsPlan.book}".`
                : `Đã tự gửi tiết kiệm ${created.length} kỳ vào "${savingsPlan.book}".`,
            'success',
        );
    }

    return created.length;
}

// --- RENDERING ---
/** What was put into the savings books in a month (YYYY-MM): transfers in, not interest. */
function savingsDepositedInMonth(monthKey) {
    const names = sources.filter(isSavingsKind).map((source) => source.name);

    return savingsMovements(transactions, names)
        .filter((movement) => movement.kind === 'deposit' && movement.date.startsWith(monthKey))
        .reduce((sum, movement) => sum + movement.amount, 0);
}

function savingsTotals() {
    const balances = calculateSourceBalances();
    const books = sources.filter(isSavingsKind);

    return {
        books,
        balances,
        total: books.reduce((sum, source) => sum + balances[source.name], 0),
    };
}

function describeSavingsPlan() {
    const plan = savingsPlan;

    if (!plan.enabled) {
        return '<p class="salary-empty">Chưa bật. Đặt ngày lãnh lương để mỗi tháng ứng dụng tự chuyển một khoản từ nguồn tiền nhận lương vào sổ tiết kiệm.</p>';
    }

    const today = toLocalDateString();
    const amount = savingsDepositAmount(plan, salaryPlan);
    const amountText =
        plan.mode === 'fixed'
            ? formatMoney(plan.amount)
            : `${plan.percent}% lương${amount > 0 ? ` (≈ ${formatMoney(amount)})` : ''}`;
    const next = nextSavingsDeposit(plan, today);
    const problem = savingsPlanProblem(plan);
    const lines = [
        `<p class="savings-plan-line">Ngày <b>${plan.day}</b> hằng tháng: gửi <b>${escapeHtml(amountText)}</b> từ <b>${escapeHtml(plan.from)}</b> vào <b>${escapeHtml(plan.book)}</b>.</p>`,
    ];

    if (next && next.date >= today) {
        lines.push(
            `<p class="source-meta">Lần tới: ${escapeHtml(formatDateDisplay(next.date))}</p>`,
        );
    }

    if (problem) {
        lines.push(
            `<p class="savings-problem"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${escapeHtml(problem)}</p>`,
        );
    }

    return lines.join('');
}

function renderSavingsBook(source, balance) {
    const name = escapeHtml(source.name);

    return `<div class="card source-card">
            <div class="source-head">
                <div class="card-title">${name}</div>
                <span class="kind-badge">${escapeHtml(SOURCE_KINDS[source.kind].label)}</span>
            </div>
            <div class="card-value income">${formatMoney(balance)}</div>
            <div class="source-actions">
                <button class="btn btn-small" data-action="savings-deposit" data-source="${name}">
                    <i class="fa-solid fa-arrow-down" aria-hidden="true"></i> Gửi vào
                </button>
                <button class="btn btn-outline btn-small" data-action="savings-withdraw" data-source="${name}">
                    <i class="fa-solid fa-arrow-up" aria-hidden="true"></i> Rút ra
                </button>
                <button class="btn btn-outline btn-small" data-action="edit-source" data-source="${name}" title="Sửa sổ" aria-label="Sửa sổ ${name}">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
            </div>
        </div>`;
}

const MOVEMENT_SIGN = { deposit: 1, income: 1, withdraw: -1, spend: -1, move: 0 };

/** With a single book its name is left out of the title: it is the only one it can be. */
function describeMovement(movement, showBook) {
    const book = showBook ? ` ${escapeHtml(movement.book)}` : ' sổ';
    const other = escapeHtml(movement.other);
    // The "Tự động" tag comes first so that a long line is cut at the end, not through the tag.
    const extras = [
        movement.auto ? '<span class="savings-auto">Tự động</span>' : '',
        movement.note && !movement.auto ? escapeHtml(movement.note) : '',
    ];
    const titles = {
        deposit: [`Gửi vào${book}`, other ? `từ ${other}` : ''],
        withdraw: [`Rút từ${book}`, other ? `về ${other}` : ''],
        move: ['Chuyển giữa các sổ', `${other} ➔ ${escapeHtml(movement.book)}`],
        income: [`Thu vào${book}`, 'lãi hoặc thu nhập'],
        spend: [`Chi từ${book}`, ''],
    };
    const [title, detail] = titles[movement.kind];
    const small = [extras[0], detail, extras[1]].filter(Boolean).join(' · ');

    return `<span class="savings-text"><b>${title}</b><small>${small}</small></span>`;
}

function renderSavingsHistory(movements, showBook) {
    const list = document.getElementById('savings-history');
    const more = document.getElementById('savings-more');

    if (!list) return;

    const visible = movements.slice(0, visibleSavingsMovements);

    if (more) {
        more.hidden = visible.length >= movements.length;
        more.textContent = `Xem thêm (${movements.length - visible.length})`;
    }

    if (movements.length === 0) {
        list.innerHTML =
            '<li class="savings-empty">Chưa có khoản gửi hoặc rút nào. Các khoản tự động gửi hằng tháng sẽ hiện ở đây.</li>';
        return;
    }

    list.innerHTML = visible
        .map((movement) => {
            const sign = MOVEMENT_SIGN[movement.kind];
            const symbol = sign > 0 ? '+' : sign < 0 ? '−' : '⟷';

            return `<li class="savings-row savings-${movement.kind}">
                <span class="savings-date">${escapeHtml(formatDateDisplay(movement.date))}</span>
                ${describeMovement(movement, showBook)}
                <span class="savings-amount">${symbol}${formatMoney(movement.amount)}</span>
            </li>`;
        })
        .join('');
}

function renderSavings() {
    const totalLabel = document.getElementById('lbl-savings-total');

    if (!totalLabel) return;

    const { books, balances, total } = savingsTotals();
    const names = books.map((source) => source.name);
    const movements = savingsMovements(transactions, names);
    const deposited = savingsDepositedInMonth(currentMonthKey());

    totalLabel.textContent = formatMoney(total);
    document.getElementById('lbl-savings-month').textContent =
        `Tháng này đã gửi ${formatMoney(deposited)}`;
    document.getElementById('savings-auto-body').innerHTML = describeSavingsPlan();
    document.getElementById('savings-edit-label').textContent = savingsPlan.enabled
        ? 'Sửa'
        : 'Cài đặt';

    const active = books.filter((source) => !source.archived);

    document.getElementById('savings-books').innerHTML = active.length
        ? active.map((source) => renderSavingsBook(source, balances[source.name])).join('')
        : '<p class="salary-empty">Chưa có sổ tiết kiệm nào. Bấm "Thêm sổ" hoặc cài đặt tự động gửi (sổ sẽ được tạo cho bạn).</p>';

    renderSavingsHistory(movements, names.length > 1);
}

// --- MANUAL DEPOSIT / WITHDRAWAL ---
/** The transfer form, ready to put money into a book or take it out. */
function openSavingsTransfer(direction, book) {
    const spendable = sourceNames().filter((name) => {
        const source = findSource(name);

        return !SOURCE_KINDS[source.kind].debt && !isSavingsKind(source);
    });
    const main = spendable.includes(savingsPlan.from) ? savingsPlan.from : spendable[0];
    const deposit = direction === 'deposit';

    setTxType('transfer');
    selectValue('txSource', deposit ? main : book);
    selectValue('txTargetSource', deposit ? book : main);
    document.getElementById('txNote').value = deposit ? 'Gửi tiết kiệm' : 'Rút tiết kiệm';
    openModal();
}

function openSavingsBookModal() {
    openSourceModal();
    document.getElementById('srcKind').value = 'savings';
    updateSourceFormVisibility();
}

function handleSavingsBooksClick(event) {
    const button = event.target.closest('button[data-action]');

    if (!button) return;

    const name = button.dataset.source;

    if (button.dataset.action === 'savings-deposit') openSavingsTransfer('deposit', name);
    else if (button.dataset.action === 'savings-withdraw') openSavingsTransfer('withdraw', name);
    else handleSourceGridClick(event);
}

function showMoreSavingsMovements() {
    visibleSavingsMovements += SAVINGS_PAGE_SIZE;
    renderSavings();
}

// --- AUTOMATIC DEPOSIT DIALOG ---
const fillSavingsSelect = (id, items, selected) => {
    const select = document.getElementById(id);

    select.innerHTML = items
        .map(
            ({ value, label }) =>
                `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`,
        )
        .join('');
};

function updateSavingsForm() {
    const percent = document.getElementById('savMode').value === 'percent';
    const salary = salaryPlan.amount;
    const value = Number(document.getElementById('savPercent').value);

    document.getElementById('savPercentGroup').hidden = !percent;
    document.getElementById('savAmountGroup').hidden = percent;
    document.getElementById('savNewGroup').hidden =
        document.getElementById('savBook').value !== NEW_BOOK;
    document.getElementById('savPreview').textContent =
        salary > 0 && value >= 1 && value <= 100
            ? `≈ ${formatMoney(Math.round((salary * value) / 100))} mỗi tháng (lương ${formatMoney(salary)}).`
            : 'Chưa đặt mức lương: hãy đặt ở Tổng quan, hoặc chọn "Số tiền cố định".';
}

function openSavingsModal() {
    const plan = savingsPlan;
    const spendable = sources.filter(
        (source) => !source.archived && !SOURCE_KINDS[source.kind].debt && !isSavingsKind(source),
    );
    const books = sources.filter((source) => !source.archived && isSavingsKind(source));
    const savingGroup = salaryPlan.groups.find((group) => group.saving);
    const fromGuess = (spendable.find((source) => source.kind === 'bank') || spendable[0] || {})
        .name;

    fillSavingsSelect(
        'savFrom',
        spendable.map((source) => ({ value: source.name, label: source.name })),
        spendable.some((source) => source.name === plan.from) ? plan.from : fromGuess,
    );
    fillSavingsSelect(
        'savBook',
        [
            ...books.map((source) => ({ value: source.name, label: source.name })),
            { value: NEW_BOOK, label: 'Tạo sổ mới…' },
        ],
        books.some((source) => source.name === plan.book)
            ? plan.book
            : (books[0] || {}).name || NEW_BOOK,
    );
    document.getElementById('savNewName').value = 'Sổ tiết kiệm';
    document.getElementById('savDay').value = plan.day || '';
    document.getElementById('savMode').value = plan.enabled
        ? plan.mode
        : salaryPlan.amount > 0
          ? 'percent'
          : 'fixed';
    document.getElementById('savPercent').value =
        plan.enabled || !savingGroup ? plan.percent : savingGroup.percent;
    setMoneyInput('savAmount', plan.amount || '');
    document.getElementById('savDisable').hidden = !plan.enabled;
    updateSavingsForm();
    openDialog('savingsModal', 'savDay');
}

function closeSavingsModal() {
    closeDialog('savingsModal');
}

function handleSavingsSubmit(event) {
    event.preventDefault();

    const day = Number(document.getElementById('savDay').value);
    const mode = document.getElementById('savMode').value;
    const percent = Number(document.getElementById('savPercent').value);
    const amount = readMoneyInput('savAmount');
    const from = document.getElementById('savFrom').value;
    let book = document.getElementById('savBook').value;

    if (!Number.isInteger(day) || day < 1 || day > 31) {
        alert('Ngày lãnh lương phải là số nguyên từ 1 đến 31.');
        return;
    }

    if (!from) {
        alert('Vui lòng chọn nguồn tiền nhận lương.');
        return;
    }

    if (mode === 'percent') {
        if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
            alert('Phần trăm lương gửi tiết kiệm phải là số nguyên từ 1 đến 100.');
            return;
        }

        if (!(salaryPlan.amount > 0)) {
            alert('Hãy đặt mức lương ở Tổng quan trước, hoặc chọn "Số tiền cố định".');
            return;
        }
    } else if (!(amount > 0)) {
        alert('Vui lòng nhập số tiền gửi mỗi tháng.');
        return;
    }

    if (book === NEW_BOOK) {
        book = document.getElementById('savNewName').value.trim();

        if (!book) {
            alert('Vui lòng nhập tên sổ tiết kiệm.');
            return;
        }

        if (
            sources.some(
                (source) => source.name.toLocaleLowerCase('vi') === book.toLocaleLowerCase('vi'),
            )
        ) {
            alert(`Đã có nguồn tiền tên "${book}". Hãy chọn tên khác hoặc chọn sổ có sẵn.`);
            return;
        }

        sources.push(normalizeSource({ name: book, kind: 'savings' }));
        saveMeta('sources');
        populateSourceOptions();
    }

    // Deposits start from today: nothing is made up for earlier months.
    savingsPlan = normalizeSavingsPlan({
        enabled: true,
        day,
        from,
        book,
        mode,
        percent,
        amount: mode === 'fixed' ? amount : savingsPlan.amount,
        since: toLocalDateString(),
        lastMonth: savingsPlan.lastMonth,
    });
    saveMeta('savings');
    closeSavingsModal();
    renderAll();
    generateSavingsDeposits();
    syncToGoogleSheet();
}

function disableSavingsPlan() {
    savingsPlan = normalizeSavingsPlan({ ...savingsPlan, enabled: false });
    saveMeta('savings');
    closeSavingsModal();
    renderAll();
    syncToGoogleSheet();
}

function initSavings() {
    document.getElementById('savings-books').addEventListener('click', handleSavingsBooksClick);
    ['savMode', 'savBook', 'savPercent'].forEach((id) => {
        document.getElementById(id).addEventListener('input', updateSavingsForm);
        document.getElementById(id).addEventListener('change', updateSavingsForm);
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') generateSavingsDeposits();
    });
}
