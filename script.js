// ======================
// GLOBAL VARIABLES
// ======================

let currentType = 'expense';
let editingId = null;

let transactions =
    JSON.parse(localStorage.getItem('fm_transactions')) || [];

let categories =
    JSON.parse(localStorage.getItem('fm_categories')) || [
        { id: 1, name: 'Ăn uống', type: 'expense', icon: 'fa-utensils' },
        { id: 2, name: 'Mua sắm', type: 'expense', icon: 'fa-cart-shopping' },
        { id: 3, name: 'Đi lại', type: 'expense', icon: 'fa-gas-pump' },
        { id: 4, name: 'Hóa đơn & Tiện ích', type: 'expense', icon: 'fa-bolt' },
        { id: 5, name: 'Lương / Thưởng', type: 'income', icon: 'fa-money-bill-wave' },
        { id: 6, name: 'Thu nhập khác', type: 'income', icon: 'fa-circle-plus' }
    ];

let sources = [
    'Tiền Mặt',
    'Thẻ Ngân Hàng',
    'Thẻ Tín Dụng',
    'Spaylater',
    'Nợ Công Ty'
];

let webAppUrl =
    localStorage.getItem('fm_script_url') || '';

let expenseChart = null;
let monthlyChart = null;

// ======================
// INIT
// ======================

window.addEventListener('load', () => {

    if(document.getElementById('setting-script-url')){
        document.getElementById('setting-script-url').value = webAppUrl;
    }

    document.getElementById('txDate').value =
        new Date().toISOString().split('T')[0];

    updateCategoriesDropdown();

    renderQuickChips();

    renderAll();

    syncFromGoogleSheet();
});

// ======================
// QUICK CHIPS
// ======================

function renderQuickChips() {

    const formContainer =
        document.querySelector('#transactionForm');

    if (
        !formContainer ||
        document.getElementById('quick-chips-container')
    ) return;

    const div = document.createElement('div');

    div.id = 'quick-chips-container';
    div.className = 'quick-chips';

    div.innerHTML = `
        <span style="
            width:100%;
            font-size:12px;
            font-weight:600;
            color:var(--text-muted);
        ">
            Chọn nhanh:
        </span>

        <div class="chip"
            onclick="quickFill('Cafe sáng',20000,'Ăn uống')">
            ☕ Cafe sáng (20k)
        </div>

        <div class="chip"
            onclick="quickFill('Cơm trưa',45000,'Ăn uống')">
            🍛 Cơm trưa (45k)
        </div>

        <div class="chip"
            onclick="quickFill('Gửi xe',5000,'Đi lại')">
            🅿️ Gửi xe (5k)
        </div>

        <div class="chip"
            onclick="quickFill('Xăng xe',50000,'Đi lại')">
            ⛽ Xăng xe (50k)
        </div>
    `;

    formContainer.insertBefore(
        div,
        formContainer.firstChild
    );
}

function quickFill(note, amount, category) {

    setTxType('expense');

    document.getElementById('txAmount').value = amount;
    document.getElementById('txNote').value = note;
    document.getElementById('txCategory').value = category;
}

// ======================
// TAB
// ======================

function switchTab(tabId, e) {

    document
        .querySelectorAll('.view-section')
        .forEach(el => el.classList.remove('active'));

    document
        .getElementById('tab-' + tabId)
        .classList.add('active');

    document
        .querySelectorAll('aside .menu li')
        .forEach(el => el.classList.remove('active'));

    if(e){
        e.currentTarget.classList.add('active');
    }
}

// ======================
// MODAL
// ======================

function openModal() {
    document.getElementById('transactionModal')
        .classList.add('open');
}

function closeModal() {
    document.getElementById('transactionModal')
        .classList.remove('open');
}

function openCategoryModal() {
    document.getElementById('categoryModal')
        .classList.add('open');
}

function closeCategoryModal() {
    document.getElementById('categoryModal')
        .classList.remove('open');
}

// ======================
// TRANSACTION TYPE
// ======================

function setTxType(type) {

    currentType = type;

    document.getElementById('btnTypeExpense')
        .classList.toggle('active', type === 'expense');

    document.getElementById('btnTypeIncome')
        .classList.toggle('active', type === 'income');

    const btnTransfer =
        document.getElementById('btnTypeTransfer');

    if(btnTransfer){
        btnTransfer.classList.toggle(
            'active',
            type === 'transfer'
        );
    }

    updateCategoriesDropdown();

    let targetGroup =
        document.getElementById('targetSourceGroup');

    if(!targetGroup){

        targetGroup = document.createElement('div');

        targetGroup.id = 'targetSourceGroup';
        targetGroup.className = 'form-group';

        targetGroup.innerHTML = `
            <label>Chuyển đến</label>

            <select
                id="txTargetSource"
                class="form-control">

                ${sources.map(src =>
                    `<option value="${src}">
                        ${src}
                    </option>`
                ).join('')}
            </select>
        `;

        document
            .getElementById('txSource')
            .closest('.form-group')
            .after(targetGroup);
    }

    targetGroup.style.display =
        type === 'transfer'
        ? 'block'
        : 'none';

    const catGroup =
        document.getElementById('txCategory')
            .closest('.form-group');

    if(catGroup){
        catGroup.style.display =
            type === 'transfer'
            ? 'none'
            : 'block';
    }
}

// ======================
// CATEGORY
// ======================

function updateCategoriesDropdown() {

    const select =
        document.getElementById('txCategory');

    if(!select) return;

    select.innerHTML = '';

    categories
    .filter(c => c.type === currentType)
    .forEach(c => {

        const opt = document.createElement('option');

        opt.value = c.name;
        opt.textContent = c.name;

        select.appendChild(opt);
    });
}

// ======================
// ADD / EDIT TRANSACTION
// ======================

function handleFormSubmit(e) {

    e.preventDefault();

    const type = currentType;

    const dateInput =
        document.getElementById('txDate').value;

    const source =
        document.getElementById('txSource').value;

    const targetSource =
        type === 'transfer'
        ? document.getElementById('txTargetSource').value
        : null;

    const category =
        type === 'transfer'
        ? 'Chuyển tiền nội bộ'
        : document.getElementById('txCategory').value;

    const amount =
        parseFloat(
            document.getElementById('txAmount').value
        ) || 0;

    const note =
        document.getElementById('txNote').value || '';

    if(!dateInput || amount <= 0){

        alert('Vui lòng nhập số tiền hợp lệ!');
        return;
    }

    if(
        type === 'transfer' &&
        source === targetSource
    ){
        alert(
            'Nguồn gửi và nguồn nhận không được giống nhau!'
        );
        return;
    }

    if(editingId){

        transactions = transactions.map(t =>

            t.id === editingId
                ? {
                    ...t,
                    date: dateInput,
                    type,
                    source,
                    targetSource,
                    category,
                    amount,
                    note
                }
                : t
        );

        editingId = null;

        document.querySelector(
            '#transactionModal .modal-header h3'
        ).innerText =
            'Thêm Giao Dịch Mới';

    } else {

        transactions.unshift({
            id: 'TX_' + Date.now(),
            date: dateInput,
            type,
            source,
            targetSource,
            category,
            amount,
            note
        });
    }

    saveDataLocally();

    renderAll();

    closeModal();

    document
        .getElementById('transactionForm')
        .reset();

    document.getElementById('txDate').value =
        new Date().toISOString().split('T')[0];

    syncToGoogleSheet();
}

// ======================
// EDIT
// ======================

function editTransaction(id) {

    const t =
        transactions.find(x => x.id === id);

    if(!t) return;

    editingId = id;

    setTxType(t.type);

    document.getElementById('txDate').value =
        t.date;

    document.getElementById('txSource').value =
        t.source;

    if(t.type === 'transfer'){

        document.getElementById(
            'txTargetSource'
        ).value = t.targetSource;
    }
    else{

        document.getElementById(
            'txCategory'
        ).value = t.category;
    }

    document.getElementById('txAmount').value =
        t.amount;

    document.getElementById('txNote').value =
        t.note || '';

    document.querySelector(
        '#transactionModal .modal-header h3'
    ).innerText =
        'Cập Nhật Giao Dịch';

    openModal();
}
