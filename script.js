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
    const today = new Date().toISOString().split('T')[0];
document.getElementById('txDate').value = today;
    updateCategoriesDropdown();
    renderAll();
    syncFromGoogleSheet();

    // --- BỔ SUNG: MẪU CHI THƯỜNG XUYÊN (QUICK CHIPS) ---
// Thêm đoạn này vào hàm window.onload hoặc gọi khởi tạo
function renderQuickChips() {
    const formContainer = document.querySelector('#transactionForm');
    if(!document.getElementById('quick-chips-container') && formContainer) {
        const div = document.createElement('div');
        div.id = 'quick-chips-container';
        div.className = 'quick-chips';
        div.innerHTML = `
            <span style="font-size:12px; font-weight:600; width:100%; color:var(--text-muted); margin-bottom:2px;">Chọn nhanh chi thường xuyên:</span>
            <div class="chip" onclick="quickFill('Cafe sáng', 20000, 'Ăn uống')">☕ Cafe sáng (20k)</div>
            <div class="chip" onclick="quickFill('Cơm trưa', 45000, 'Ăn uống')">🍛 Cơm trưa (45k)</div>
            <div class="chip" onclick="quickFill('Gửi xe', 5000, 'Đi lại')">🅿️ Gửi xe (5k)</div>
            <div class="chip" onclick="quickFill('Xăng xe', 50000, 'Đi lại')">⛽ Xăng xe (50k)</div>
        `;
        formContainer.insertBefore(div, formContainer.firstChild);
    }
}

function quickFill(note, amount, category) {
    setTxType('expense');
    document.getElementById('txAmount').value = amount;
    document.getElementById('txNote').value = note;
    document.getElementById('txCategory').value = category;
}

// Gọi renderQuickChips trong window.onload
const oldOnload = window.onload;
window.onload = function() {
    if(oldOnload) oldOnload();
    renderQuickChips();
};


// --- BỔ SUNG: TÍNH NĂNG SỬA GIAO DỊCH (EDIT TRANSACTION) ---
let editingId = null;

function editTransaction(id) {
    const t = transactions.find(item => item.id === id);
    if(!t) return;
    
    editingId = id;
    setTxType(t.type);
    document.getElementById('txDate').value = t.date;
    document.getElementById('txSource').value = t.source;
    document.getElementById('txCategory').value = t.category;
    document.getElementById('txAmount').value = t.amount;
    document.getElementById('txNote').value = t.note || '';
    
    // Đổi tiêu đề modal thành Cập nhật
    document.querySelector('#transactionModal .modal-header h3').innerText = 'Cập Nhật Giao Dịch';
    openModal();
}

// Cập nhật lại hàm handleFormSubmit để hỗ trợ cả Thêm mới và Sửa
function handleFormSubmit(e) {
    e.preventDefault();
    try {
        const type = currentType;
        const dateInput = document.getElementById('txDate').value;
        const source = document.getElementById('txSource').value;
        const targetSource = type === 'transfer' ? document.getElementById('txTargetSource').value : null;
        const category = type === 'transfer' ? 'Chuyển tiền nội bộ' : document.getElementById('txCategory').value;
        const amount = parseFloat(document.getElementById('txAmount').value) || 0;
        const note = document.getElementById('txNote').value || '';

        if (!dateInput || amount <= 0) {
            alert('Vui lòng nhập ngày và số tiền hợp lệ!');
            return;
        }

        if (window.editingId) {
            // Cập nhật giao dịch cũ
            transactions = transactions.map(t => t.id === window.editingId ? { ...t, type, date: dateInput, source, targetSource, category, amount, note } : t);
            window.editingId = null;
            const headerTitle = document.querySelector('#transactionModal .modal-header h3');
            if(headerTitle) headerTitle.innerText = 'Thêm Giao Dịch Mới';
        } else {
            // Thêm giao dịch mới
            const newTx = { id: 'TX_' + Date.now(), date: dateInput, type, source, targetSource, category, amount, note };
            transactions.unshift(newTx);
        }

        saveDataLocally();
        renderAll();
        closeModal();
        
        const form = document.getElementById('transactionForm');
        if(form) form.reset();
        
        // Gán lại ngày hôm nay chuẩn định dạng
        document.getElementById('txDate').value = new Date().toISOString().split('T')[0];
        
        // Đồng bộ lên Google Sheets
        syncToGoogleSheet();
    } catch (err) {
        console.error("Lỗi khi lưu giao dịch: ", err);
        alert("Có lỗi xảy ra, vui lòng kiểm tra lại console!");
    }
}

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
        let typeLabel = 'Chi';
        let colorStyle = 'var(--danger)';
        let sign = '-';
        if(t.type === 'income') { typeLabel = 'Thu'; colorStyle = 'var(--success)'; sign = '+'; }
        else if(t.type === 'transfer') { typeLabel = 'Chuyển'; colorStyle = 'var(--warning)'; sign = '⟷'; }

        // Cắt bỏ chuỗi T...Z để ngày hiển thị sạch đẹp dạng YYYY-MM-DD
        let cleanDate = t.date ? t.date.split('T')[0] : '';
        let sourceDisplay = t.type === 'transfer' ? `${t.source} ➔ ${t.targetSource}` : t.source;

        tbody.innerHTML += `<tr>
            <td>${cleanDate}</td>
            <td><b>${sourceDisplay}</b></td>
            <td>${t.category || (t.type === 'transfer' ? 'Chuyển khoản nội bộ' : '')}</td>
            <td><span style="color:${colorStyle}; font-weight:600;">${typeLabel}</span></td>
            <td style="font-weight:700; color:${colorStyle};">${sign}${t.amount.toLocaleString()} đ</td>
            <td>${t.note || ''}</td>
            <td style="text-align:right; white-space:nowrap;">
                <button class="btn btn-outline" style="padding:4px 8px; font-size:12px; margin-right:4px;" onclick="editTransaction('${t.id}')"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-outline" style="padding:4px 8px; font-size:12px;" onclick="deleteTransaction('${t.id}')"><i class="fa-solid fa-trash"></i></button>
            </td>
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
    
    // Lấy số dư ban đầu từ localStorage (nếu có)
    let initialBalances = JSON.parse(localStorage.getItem('fm_initial_balances')) || {};

    sources.forEach(src => {
        let bal = initialBalances[src] || 0;
        transactions.forEach(t => {
            if(t.type === 'income' && t.source === src) bal += t.amount;
            else if(t.type === 'expense' && t.source === src) bal -= t.amount;
            else if(t.type === 'transfer') {
                if(t.source === src) bal -= t.amount; // Nguồn gửi bị trừ
                if(t.targetSource === src) bal += t.amount; // Nguồn nhận được cộng
            }
        });

        const div = document.createElement('div');
        div.className = 'card';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div class="card-title">${src}</div>
                <button class="btn btn-outline" style="padding:2px 6px; font-size:11px;" onclick="editInitialBalance('${src}')"><i class="fa-solid fa-pen"></i> Sửa số dư</button>
            </div>
            <div class="card-value" style="color:${bal>=0?'var(--text-main)':'var(--danger)'}; margin-top:8px;">${bal.toLocaleString()} đ</div>
        `;
        grid.appendChild(div);
    });
}

function editInitialBalance(sourceName) {
    let initialBalances = JSON.parse(localStorage.getItem('fm_initial_balances')) || {};
    let currentVal = initialBalances[sourceName] || 0;
    let newVal = prompt(`Nhập số dư ban đầu cho [${sourceName}]:`, currentVal);
    if(newVal !== null && !isNaN(newVal)) {
        initialBalances[sourceName] = parseFloat(newVal);
        localStorage.setItem('fm_initial_balances', JSON.stringify(initialBalances));
        renderAll();
    }
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

// Thêm 1 hàm kiểm tra nếu chọn loại chuyển tiền thì hiện ô "Nguồn nhận"
function setTxType(type) {
    currentType = type;
    document.getElementById('btnTypeExpense').classList.toggle('active', type === 'expense');
    document.getElementById('btnTypeIncome').classList.toggle('active', type === 'income');
    const btnTr = document.getElementById('btnTypeTransfer');
    if(btnTr) btnTr.classList.toggle('active', type === 'transfer');

    updateCategoriesDropdown();
    
    // Tạo hoặc hiện ô chọn nguồn nhận khi là Chuyển tiền
    let targetGroup = document.getElementById('targetSourceGroup');
    if(!targetGroup) {
        targetGroup = document.createElement('div');
        targetGroup.id = 'targetSourceGroup';
        targetGroup.className = 'form-group';
        targetGroup.style.display = 'none';
        targetGroup.innerHTML = `
            <label>Chuyển Đến Nguồn (Nhận)</label>
            <select id="txTargetSource" class="form-control">
                ${sources.map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>
        `;
        document.getElementById('txSource').closest('.form-group').after(targetGroup);
    }
    targetGroup.style.display = (type === 'transfer') ? 'block' : 'none';
    
    // Ẩn bớt danh mục khi chuyển tiền vì không cần thiết
    const catGroup = document.getElementById('txCategory').closest('.form-group');
    if(catGroup) catGroup.style.display = (type === 'transfer') ? 'none' : 'block';
}

function handleFormSubmit(e) {
    e.preventDefault();
    const type = currentType;
    const date = document.getElementById('txDate').value;
    const source = document.getElementById('txSource').value;
    const targetSource = type === 'transfer' ? document.getElementById('txTargetSource').value : null;
    const category = type === 'transfer' ? 'Chuyển tiền nội bộ' : document.getElementById('txCategory').value;
    const amount = parseFloat(document.getElementById('txAmount').value);
    const note = document.getElementById('txNote').value;

    if (editingId) {
        transactions = transactions.map(t => t.id === editingId ? { ...t, type, date, source, targetSource, category, amount, note } : t);
        editingId = null;
        document.querySelector('#transactionModal .modal-header h3').innerText = 'Thêm Giao Dịch Mới';
    } else {
        const newTx = { id: 'TX_' + Date.now(), date, type, source, targetSource, category, amount, note };
        transactions.unshift(newTx);
    }

    saveDataLocally();
    renderAll();
    closeModal();
    document.getElementById('transactionForm').reset();
    document.getElementById('txDate').valueAsDate = new Date();
    syncToGoogleSheet();
}
