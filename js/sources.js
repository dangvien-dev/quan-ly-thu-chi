// Source account balances and initial-balance editing.

function renderSources() {
    const grid = document.getElementById('sources-grid');

    if (!grid) return;

    grid.innerHTML = '';

    const initialBalances = JSON.parse(localStorage.getItem('fm_initial_balances')) || {};

    sources.forEach((source) => {
        let balance = initialBalances[source] || 0;

        transactions.forEach((transaction) => {
            if (transaction.type === 'income' && transaction.source === source) {
                balance += transaction.amount;
            } else if (transaction.type === 'expense' && transaction.source === source) {
                balance -= transaction.amount;
            } else if (transaction.type === 'transfer') {
                if (transaction.source === source) {
                    balance -= transaction.amount;
                }

                if (transaction.targetSource === source) {
                    balance += transaction.amount;
                }
            }
        });

        const div = document.createElement('div');
        div.className = 'card';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div class="card-title">${source}</div>
                <button class="btn btn-outline" style="padding:2px 6px; font-size:11px;" onclick="editInitialBalance('${source}')">
                    <i class="fa-solid fa-pen"></i> Sửa số dư
                </button>
            </div>
            <div class="card-value" style="color:${balance >= 0 ? 'var(--text-main)' : 'var(--danger)'}; margin-top:8px;">
                ${balance.toLocaleString()} đ
            </div>
        `;

        grid.appendChild(div);
    });
}

function editInitialBalance(sourceName) {
    const initialBalances = JSON.parse(localStorage.getItem('fm_initial_balances')) || {};
    const currentValue = initialBalances[sourceName] || 0;
    const newValue = prompt(`Nhập số dư ban đầu cho [${sourceName}]:`, currentValue);

    if (newValue !== null && !isNaN(newValue)) {
        initialBalances[sourceName] = parseFloat(newValue);
        localStorage.setItem('fm_initial_balances', JSON.stringify(initialBalances));
        renderAll();
    }
}
