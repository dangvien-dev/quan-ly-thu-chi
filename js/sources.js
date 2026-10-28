// Source account balances and initial-balance editing.

function getInitialBalances() {
    const stored = readStoredJson('fm_initial_balances', {});

    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

/** Balance of every source: initial balance plus income, minus expenses, adjusted by transfers. */
function calculateSourceBalances() {
    const initialBalances = getInitialBalances();
    const balances = {};

    sources.forEach((source) => {
        balances[source] = Number(initialBalances[source]) || 0;
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

function renderSources() {
    const grid = document.getElementById('sources-grid');

    if (!grid) return;

    const balances = calculateSourceBalances();

    grid.innerHTML = sources
        .map((source) => {
            const balance = balances[source];

            return `<div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div class="card-title">${escapeHtml(source)}</div>
                <button class="btn btn-outline" style="padding:2px 6px; font-size:11px;" data-action="edit-balance" data-source="${escapeHtml(source)}">
                    <i class="fa-solid fa-pen"></i> Sửa số dư
                </button>
            </div>
            <div class="card-value" style="color:${balance >= 0 ? 'var(--text-main)' : 'var(--danger)'}; margin-top:8px;">
                ${formatMoney(balance)}
            </div>
        </div>`;
        })
        .join('');
}

function handleSourceGridClick(event) {
    const button = event.target.closest('button[data-action="edit-balance"]');

    if (button) {
        editInitialBalance(button.dataset.source);
    }
}

function editInitialBalance(sourceName) {
    const initialBalances = getInitialBalances();
    const currentValue = Number(initialBalances[sourceName]) || 0;
    const input = prompt(`Nhập số dư ban đầu cho [${sourceName}]:`, currentValue);

    if (input === null) return;

    // Accept Vietnamese-style input such as "1.500.000"; a leading minus is allowed (opening debt).
    const newValue = Number(input.replace(/[.,\s]/g, ''));

    if (input.trim() === '' || !Number.isFinite(newValue)) {
        alert('Số tiền không hợp lệ!');
        return;
    }

    initialBalances[sourceName] = newValue;
    localStorage.setItem('fm_initial_balances', JSON.stringify(initialBalances));
    renderAll();
}
