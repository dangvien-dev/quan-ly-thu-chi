let currentType = 'expense';
let transactions = JSON.parse(localStorage.getItem('fm_transactions')) || [];
let categories = JSON.parse(localStorage.getItem('fm_categories')) || [
    { id: 1, name: 'Ăn uống', type: 'expense', icon: 'fa-utensils' },
    { id: 2, name: 'Mua sắm', type: 'expense', icon: 'fa-cart-shopping' },
    { id: 3, name: 'Đi lại', type: 'expense', icon: 'fa-gas-pump' },
    { id: 4, name: 'Hóa đơn & Tiện ích', type: 'expense', icon: 'fa-bolt' },
    { id: 5, name: 'Lương / Thưởng', type: 'income', icon: 'fa-money-bill-wave' },
    { id: 6, name: 'Thu nhập khác', type: 'income', icon: 'fa-circle-plus' }
];
let sources = ['Tiền Mặt', 'Thẻ Ngân Hàng', 'Thẻ Tín Dụng', 'Spaylater', 'Nợ Công Ty'];
let webAppUrl = localStorage.getItem('fm_script_url') || document.getElementById('setting-script-url').value;
document.getElementById('setting-script-url').value = webAppUrl;

let expenseChart = null, monthlyChart = null;

window.onload = function() {
    document.getElementById('txDate').valueAsDate = new Date();
    updateCategoriesDropdown();
    renderAll();
    syncFromGoogleSheet();
};

function switchTab(tabId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');
    document.querySelectorAll('aside .menu li').forEach(el => el.classList.remove('active'));
    event && event.currentTarget && event.currentTarget.classList.add('active');
}

function setTxType(type) {
    currentType = type;
    document.getElementById('btnTypeExpense').classList.toggle('active', type === 'expense');
    document.getElementById('btnTypeIncome').classList.toggle('active', type === 'income');
    updateCategoriesDropdown();
}

function updateCategoriesDropdown() {
    const select = document.getElementById('txCategory');
    select.innerHTML = '';
    categories.filter(c => c.type === currentType).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name; opt.textContent = c.name;
        select.appendChild(opt);
    });
}

function openModal() { document.getElementById('transactionModal').classList.add('open'); }
function closeModal() { document.getElementById('transactionModal').classList.remove('open'); }
function openCategoryModal() { document.getElementById('categoryModal').classList.add('open'); }
function closeCategoryModal() { document.getElementById('categoryModal').classList.remove('open'); }

function handleFormSubmit(e) {
    e.preventDefault();
    const newTx = {
        id: 'TX_' + Date.now(),
        date: document.getElementById('txDate').value,
        type: currentType,
        source: document.getElementById('txSource').value,
        category: document.getElementById('txCategory').value,
        amount: parseFloat(document.getElementById('txAmount').value),
        note: document.getElementById('txNote').value
    };
    transactions.unshift(newTx);
    saveDataLocally(); renderAll(); closeModal();
    document.getElementById('transactionForm').reset();
    document.getElementById('txDate').valueAsDate = new Date();
    syncToGoogleSheet();
}

function handleCategorySubmit(e) {
    e.preventDefault();
    categories.push({ id: Date.now(), name: document.getElementById('catName').value, type: document.getElementById('catType').value, icon: 'fa-tag' });
    localStorage.setItem('fm_categories', JSON.stringify(categories));
    renderCategories(); closeCategoryModal();
    document.getElementById('catName').value = '';
}

function deleteTransaction(id) {
    if(confirm('Xóa giao dịch này?')) {
        transactions = transactions.filter(t => t.id !== id);
        saveDataLocally(); renderAll(); syncToGoogleSheet();
    }
}

function deleteCategory(id) {
    categories = categories.filter(c => c.id !== id);
    localStorage.setItem('fm_categories', JSON.stringify(categories));
    renderCategories();
}

function saveDataLocally() { localStorage.setItem('fm_transactions', JSON.stringify(transactions)); }

function renderAll() { renderTransactions(); renderOverview(); renderSources(); renderCategories(); }

function renderTransactions() {
    const tbody = document.getElementById('transaction-table-body');
    const filter = document.getElementById('filter-type').value;
    tbody.innerHTML = '';
    const filtered = transactions.filter(t => filter === 'ALL' || t.type === filter);
    if(filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-muted);">Chưa có giao dịch</td></tr>`;
        return;
    }
    filtered.forEach(t => {
        const isInc = t.type === 'income';
        tbody.innerHTML += `<tr>
            <td>${t.date}</td><td><b>${t.source}</b></td><td>${t.category}</td>
            <td><span style="color:${isInc?'var(--success)':'var(--danger)'}; font-weight:600;">${isInc?'Thu':'Chi'}</span></td>
            <td style="font-weight:700; color:${isInc?'var(--success)':'var(--danger)'};">${isInc?'+':'-'}${t.amount.toLocaleString()} đ</td>
            <td>${t.note || ''}</td>
            <td style="text-align:right;"><button class="btn btn-outline" style="padding:4px 8px; font-size:12px;" onclick="deleteTransaction('${t.id}')"><i class="fa-solid fa-trash"></i></button></td>
        </tr>`;
    });
}

function renderOverview() {
    let totInc = 0, totExp = 0;
    transactions.forEach(t => t.type === 'income' ? totInc += t.amount : totExp += t.amount);
    document.getElementById('lbl-total-income').innerText = totInc.toLocaleString() + ' đ';
    document.getElementById('lbl-total-expense').innerText = totExp.toLocaleString() + ' đ';
    document.getElementById('lbl-total-balance').innerText = (totInc - totExp).toLocaleString() + ' đ';
    renderCharts();
}

function renderSources() {
    const grid = document.getElementById('sources-grid');
    grid.innerHTML = '';
    sources.forEach(src => {
        let bal = 0;
        transactions.forEach(t => { if(t.source === src) t.type === 'income' ? bal += t.amount : bal -= t.amount; });
        grid.innerHTML += `<div class="card"><div class="card-title">${src}</div><div class="card-value" style="color:${bal>=0?'var(--text-main)':'var(--danger)'};">${bal.toLocaleString()} đ</div></div>`;
    });
}

function renderCategories() {
    const tbody = document.getElementById('category-table-body');
    tbody.innerHTML = '';
    categories.forEach(c => {
        tbody.innerHTML += `<tr><td><i class="fa-solid ${c.icon}" style="margin-right:8px; color:var(--primary);"></i>${c.name}</td><td>${c.type==='income'?'Thu Nhập':'Chi Tiêu'}</td><td>${c.icon}</td><td style="text-align:right;"><button class="btn btn-outline" style="padding:4px 8px; font-size:12px;" onclick="deleteCategory(${c.id})"><i class="fa-solid fa-trash"></i></button></td></tr>`;
    });
}

function renderCharts() {
    const catMap = {};
    transactions.filter(t => t.type === 'expense').forEach(t => catMap[t.category] = (catMap[t.category] || 0) + t.amount);
    if(expenseChart) expenseChart.destroy();
    expenseChart = new Chart(document.getElementById('expenseCategoryChart').getContext('2d'), {
        type: 'doughnut',
        data: { labels: Object.keys(catMap), datasets: [{ data: Object.values(catMap), backgroundColor: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'] }] },
        options: { responsive: true, maintainAspectRatio: false }
    });

    if(monthlyChart) monthlyChart.destroy();
    monthlyChart = new Chart(document.getElementById('monthlyChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Tổng Thu', 'Tổng Chi'],
            datasets: [{ label: 'VNĐ', data: [transactions.filter(t=>t.type==='income').reduce((a,b)=>a+b.amount,0), transactions.filter(t=>t.type==='expense').reduce((a,b)=>a+b.amount,0)], backgroundColor: ['#10b981', '#ef4444'] }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function saveScriptUrl() {
    webAppUrl = document.getElementById('setting-script-url').value;
    localStorage.setItem('fm_script_url', webAppUrl);
    alert('Đã lưu URL thành công!'); syncToGoogleSheet();
}

function resetAllData() {
    if(confirm('Xóa toàn bộ dữ liệu?')) { transactions = []; saveDataLocally(); renderAll(); syncToGoogleSheet(); }
}

function syncToGoogleSheet() {
    if(!webAppUrl) return;
    const badge = document.getElementById('sync-status');
    badge.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang đồng bộ...`;
    fetch(`${webAppUrl}?action=save&data=${encodeURIComponent(JSON.stringify(transactions))}`)
        .then(res => res.json())
        .then(res => badge.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Đã lưu Google Drive`)
        .catch(err => badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i> Lỗi kết nối`);
}

function syncFromGoogleSheet() {
    if(!webAppUrl) return;
    const badge = document.getElementById('sync-status');
    badge.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang tải...`;
    fetch(webAppUrl)
        .then(res => res.json())
        .then(data => {
            if(Array.isArray(data) && data.length > 0) { transactions = data; saveDataLocally(); renderAll(); }
            badge.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Đã lưu Google Drive`;
        })
        .catch(err => badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i> Dùng bản offline`);
}
