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
let webAppUrl = localStorage.getItem('fm_script_url') || '';
let expenseChart = null, monthlyChart = null;
let editingId = null;

// --- KHỞI TẠO KHI TẢI TRANG ---
window.onload = function() {
    const urlInput = document.getElementById('setting-script-url');
    if(urlInput && webAppUrl) urlInput.value = webAppUrl;

    const txDateEl = document.getElementById('txDate');
    if(txDateEl) txDateEl.value = new Date().toISOString().split('T')[0];

    updateCategoriesDropdown();
    renderAll();
    syncFromGoogleSheet();
    renderQuickChips();
};

// --- MẪU CHI THƯỜNG XUYÊN (QUICK CHIPS) ---
function renderQuickChips() {
    const formContainer = document.querySelector('#transactionForm');
    if(!document.getElementById('quick-chips-container') && formContainer) {
        const div = document.createElement('div');
        div.id = 'quick-chips-container';
        div.className = 'quick-chips';
        div.innerHTML = `
            <span style="font-size:12px; font-weight:600; width:100%; color:var(--text-muted); margin-bottom:4px;">Chọn nhanh chi thường xuyên:</span>
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
    setTimeout(() => {
    const cat = document.getElementById('txCategory');

    if(cat){
        cat.value = category;
    }
}, 10);
}

// --- ĐIỀU HƯỚNG TAB ---
function switchTab(tabId, e) {

    document.querySelectorAll('.view-section')
        .forEach(el => el.classList.remove('active'));

    document.getElementById('tab-' + tabId)
        .classList.add('active');

    document.querySelectorAll('aside .menu li')
        .forEach(el => el.classList.remove('active'));

    if (e?.currentTarget) {
        e.currentTarget.classList.add('active');
    }
}

// --- LOẠI GIAO DỊCH & CHUYỂN TIỀN ---
function setTxType(type) {
    currentType = type;
    const btnExp = document.getElementById('btnTypeExpense');
    const btnInc = document.getElementById('btnTypeIncome');
    const btnTr = document.getElementById('btnTypeTransfer');

    if(btnExp) btnExp.classList.toggle('active', type === 'expense');
    if(btnInc) btnInc.classList.toggle('active', type === 'income');
    if(btnTr) btnTr.classList.toggle('active', type === 'transfer');

    updateCategoriesDropdown();
    
    // Xử lý ẩn/hiện ô chọn nguồn nhận khi chuyển tiền
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
        const txSourceEl = document.getElementById('txSource');
        if(txSourceEl) txSourceEl.closest('.form-group').after(targetGroup);
    }
    targetGroup.style.display = (type === 'transfer') ? 'block' : 'none';

    // Ẩn/hiện danh mục
    const catGroup = document.getElementById('txCategconst txCategory = document.getElementById('txCategory');

const catGroup =
    txCategory
        ? txCategory.closest('.form-group')
        : null;ory').closest('.form-group');
    if(catGroup) catGroup.style.display = (type === 'transfer') ? 'none' : 'block';
}

function updateCategoriesDropdown() {
    const select = document.getElementById('txCategory');
    if(!select) return;
    select.innerHTML = '';
    categories.filter(c => c.type === currentType).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name; opt.textContent = c.name;
        select.appendChild(opt);
    });
}

// --- MODAL CONTROL ---
function openModal() { document.getElementById('transactionModal').classList.add('open'); }
function closeModal() { document.getElementById('transactionModal').classList.remove('open'); editingId = null; }
function openCategoryModal() { document.getElementById('categoryModal').classList.add('open'); }
function closeCategoryModal() { document.getElementById('categoryModal').classList.remove('open'); }

// --- XỬ LÝ FORM LƯU GIAO DỊCH (CHUẨN KHÔNG BỊ KẸT) ---
function handleFormSubmit(e) {
    e.preventDefault();
    const type = currentType;
    const dateInput = document.getElementById('txDate').value;
    const source = document.getElementById('txSource').value;
    const targetSource = type === 'transfer' ? document.getElementById('txTargetSource').value : null;
    const category = type === 'transfer' ? 'Chuyển tiền nội bộ' : document.getElementById('txCategory').value;
    const amount = parseFloat(document.getElementById('txAmount').value) || 0;
    const note = document.getElementById('txNote').value || '';
    const amount = Math.round(
        parseFloat(
        document.getElementById('txAmount').value
        ) || 0
    );


    if (!dateInput || amount <= 0) {
        alert('Vui lòng nhập ngày và số tiền hợp lệ!');
        return;
    }
    if(!source){
    alert('Vui lòng chọn nguồn tiền');
    return;
}

    if (
    type === 'transfer' &&
    source === targetSource
){
    alert('Nguồn gửi và nguồn nhận phải khác nhau!');
    return;
}

    if (editingId) {
        transactions = transactions.map(t => t.id === editingId ? { ...t, type, date: dateInput, source, targetSource, category, amount, note } : t);
        editingId = null;
        const modalTitle = document.querySelector('#transactionModal .modal-header h3');
        if(modalTitle) modalTitle.innerText = 'Thêm Giao Dịch';
    } else {
        const newTx = { id: 'TX_' + Date.now(), date: dateInput, type, source, targetSource, category, amount, note };
        transactions.unshift(newTx);
    }

    saveDataLocally();
    renderAll();
    closeModal();
    
    const form = document.getElementById('transactionForm');
    if(form) form.reset();
    setTxType('expense');
    document.getElementById('txDate').value = new Date().toISOString().split('T')[0];
    syncToGoogleSheet();
}

// --- SỬA GIAO DỊCH ---
function editTransaction(id) {
    const t = transactions.find(item => item.id === id);
    if(!t) return;
    
    editingId = id;
    setTxType(t.type);
    document.getElementById('txDate').value = t.date ? t.date.split('T')[0] : '';
    document.getElementById('txSource').value = t.source;
    if(t.type === 'transfer' && t.targetSource) {
        const targetEl = document.getElementById('txTargetSource');
        if(targetEl) targetEl.value = t.targetSource;
    } else {
        document.getElementById('txCategory').value = t.category;
    }
    document.getElementById('txAmount').value = t.amount;
    document.getElementById('txNote').value = t.note || '';
    
    const modalTitle = document.querySelector('#transactionModal .modal-header h3');
    if(modalTitle) modalTitle.innerText = 'Cập Nhật Giao Dịch';
    openModal();
}

// --- QUẢN LÝ DANH MỤC ---
function handleCategorySubmit(e) {
    e.preventDefault();
    const name = document.getElementById('catName').value;
    const type = document.getElementById('catType').value;
    const exists = categories.some(
    c => c.name.trim().toLowerCase() === name.trim().toLowerCase()
);

if(exists){
    alert('Danh mục đã tồn tại!');
    return;
}
    if(!name.trim()){
    alert('Vui lòng nhập tên danh mục');
    return;
}

    categories.push({ id: Date.now(), name, type, icon: 'fa-tag' });
    localStorage.setItem('fm_categories', JSON.stringify(categories));
    
    renderCategories();
    updateCategoriesDropdown(); // Cập nhật ngay dropdown không cần F5
    closeCategoryModal();
    
    document.getElementById('catName').value = '';
}

function deleteTransaction(id) {
    if(confirm('Xóa giao dịch này?')) {
        transactions = transactions.filter(t => t.id !== id);
        saveDataLocally(); renderAll(); syncToGoogleSheet();
    }
}

function deleteCategory(id) {

    const category = categories.find(c => c.id === id);

    const used = transactions.some(
        t => t.category === category?.name
    );

    if (used) {
        alert('Danh mục đang được sử dụng, không thể xóa!');
        return;
    }

    categories = categories.filter(c => c.id !== id);

    localStorage.setItem(
        'fm_categories',
        JSON.stringify(categories)
    );

    renderCategories();
    updateCategoriesDropdown();
}

function saveDataLocally() { localStorage.setItem('fm_transactions', JSON.stringify(transactions)); }

// --- RENDER GIAO DIỆN & BẢNG ---
function renderAll() { renderTransactions(); renderOverview(); renderSources(); renderCategories(); }

function renderTransactions() {
    const tbody = document.getElementById('transaction-table-body');
    const filterEl = document.getElementById('filter-type');
    const filter = filterEl ? filterEl.value : 'ALL';
    if(!tbody) return;
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

        let cleanDate = t.date ? t.date.split('T')[0] : '';
        let sourceDisplay = t.type === 'transfer' ? `${t.source} ➔ ${t.targetSource}` : t.source;

        tbody.innerHTML += `<tr>
            <td>${cleanDate}</td>
            <td><b>${sourceDisplay}</b></td>
            <td>${t.category || ''}</td>
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
    transactions.forEach(t => {
        if(t.type === 'income') totInc += t.amount;
        else if(t.type === 'expense') totExp += t.amount;
    });
    
    const incEl = document.getElementById('lbl-total-income');
    const expEl = document.getElementById('lbl-total-expense');
    const balEl = document.getElementById('lbl-total-balance');

    if(incEl) incEl.innerText = totInc.toLocaleString() + ' đ';
    if(expEl) expEl.innerText = totExp.toLocaleString() + ' đ';
    if(balEl) balEl.innerText = (totInc - totExp).toLocaleString() + ' đ';
    
    renderCharts();
}

function renderSources() {
    const grid = document.getElementById('sources-grid');
    if(!grid) return;
    grid.innerHTML = '';
    
    let initialBalances = JSON.parse(localStorage.getItem('fm_initial_balances')) || {};

    sources.forEach(src => {
        let bal = initialBalances[src] || 0;
        transactions.forEach(t => {
            if(t.type === 'income' && t.source === src) bal += t.amount;
            else if(t.type === 'expense' && t.source === src) bal -= t.amount;
            else if(t.type === 'transfer') {
                if(t.source === src) bal -= t.amount;
                if(t.targetSource === src) bal += t.amount;
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
    if(!tbody) return;
    tbody.innerHTML = '';
    categories.forEach(c => {
        tbody.innerHTML += `<tr>
            <td><i class="fa-solid ${c.icon}" style="margin-right:8px; color:var(--primary);"></i>${c.name}</td>
            <td>${c.type==='income'?'Thu Nhập':'Chi Tiêu'}</td>
            <td>${c.icon}</td>
            <td style="text-align:right;"><button class="btn btn-outline" style="padding:4px 8px; font-size:12px;" onclick="deleteCategory(${c.id})"><i class="fa-solid fa-trash"></i></button></td>
        </tr>`;
    });
}

function renderCharts() {
    const catMap = {};
    transactions.filter(t => t.type === 'expense').forEach(t => catMap[t.category] = (catMap[t.category] || 0) + t.amount);
    
    const expCanvas = document.getElementById('expenseCategoryChart');
    if(expCanvas) {
        if(expenseChart) expenseChart.destroy();
        expenseChart = new Chart(expCanvas.getContext('2d'), {
            type: 'doughnut',
            data: { labels: Object.keys(catMap), datasets: [{ data: Object.values(catMap), backgroundColor: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'] }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    const monthCanvas = document.getElementById('monthlyChart');
    if(monthCanvas) {
        if(monthlyChart) monthlyChart.destroy();
        monthlyChart = new Chart(monthCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Tổng Thu', 'Tổng Chi'],
                datasets: [{ label: 'VNĐ', data: [transactions.filter(t=>t.type==='income').reduce((a,b)=>a+b.amount,0), transactions.filter(t=>t.type==='expense').reduce((a,b)=>a+b.amount,0)], backgroundColor: ['#10b981', '#ef4444'] }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }
}

// --- ĐỒNG BỘ GOOGLE SHEETS ---
function saveScriptUrl() {
    const urlInput = document.getElementById('setting-script-url');
    if(urlInput) {
        webAppUrl = urlInput.value;
        localStorage.setItem('fm_script_url', webAppUrl);
        alert('Đã lưu URL thành công!');
        syncToGoogleSheet();
    }
}

function resetAllData() {
    if(confirm('Xóa toàn bộ dữ liệu?')) {
        transactions = [];
        saveDataLocally();
        renderAll();
        syncToGoogleSheet();
    }
}

function syncToGoogleSheet() {
    if(!webAppUrl) return;
    const badge = document.getElementById('sync-status');
    if(badge) badge.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang đồng bộ...`;
    fetch(webAppUrl,{
    method:'POST',
    headers:{
        'Content-Type':'application/json'
    },
    body:JSON.stringify({
        action:'save',
        data:transactions
    })
})
        .then(res => {

    if(!res.ok){
        throw new Error('Server Error');
    }

    return res.json();

})
        .then(res => { if(badge) badge.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Đã lưu Google Drive`; })
        .catch(err => { if(badge) badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i> Lỗi kết nối`; });
}

function syncFromGoogleSheet() {
    if(!webAppUrl) return;
    const badge = document.getElementById('sync-status');
    if(badge) badge.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang tải...`;
    fetch(webAppUrl)
        .then(res => {

    if(!res.ok){
        throw new Error('Server Error');
    }

    return res.json();

})
        .then(data => {
            if(Array.isArray(data) && data.length > 0) {
                transactions = data;
                saveDataLocally();
                renderAll();
            }
            if(badge) badge.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Đã lưu Google Drive`;
        })
        .catch(err => { if(badge) badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i> Dùng bản offline`; });
}

function exportBackup() {

    const blob = new Blob(
        [JSON.stringify(transactions, null, 2)],
        { type: 'application/json' }
    );

    const a = document.createElement('a');

    a.href = URL.creatconst url = URL.createObjectURL(blob);

a.href = url;

a.click();

URL.revokeObjectURL(url);
    eObjectURL(blob);

    a.download =
        'backup-thu-chi-' +
        new Date().toISOString().split('T')[0] +
        '.json';

    a.click();
}

function importBackup(file){

    const reader = new FileReader();

    reader.onload = function(e){

        try{

            const data =
                JSON.parse(e.target.result);

            if(Array.isArray(data)){

                transactions = data;

                saveDataLocally();

                renderAll();

                alert(
                    'Khôi phục dữ liệu thành công'
                );

            }

        }catch{

            alert(
                'File không hợp lệ'
            );

        }

    };

    reader.readAsText(file);
}
