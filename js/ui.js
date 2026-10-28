// UI navigation, modal controls, transaction type controls, and quick-entry chips.

const TAB_TITLES = {
    overview: 'Tổng Quan Dòng Tiền',
    transactions: 'Sổ Giao Dịch',
    sources: 'Nguồn Tiền & Tài Khoản',
    categories: 'Danh Mục Thu / Chi',
    debts: 'Vay Nợ & Công Ty',
    settings: 'Cài Đặt & Dữ Liệu',
};

// --- QUICK-ENTRY CHIPS ---
function renderQuickChips() {
    const formContainer = document.querySelector('#transactionForm');

    if (!document.getElementById('quick-chips-container') && formContainer) {
        const div = document.createElement('div');
        div.id = 'quick-chips-container';
        div.className = 'quick-chips';
        div.innerHTML = `
            <span style="font-size:12px; font-weight:600; width:100%; color:var(--text-muted); margin-bottom:4px;">
                Chọn nhanh chi thường xuyên:
            </span>
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
    selectCategory(category);
}

// --- TAB NAVIGATION ---
function switchTab(tabId) {
    const tab = document.getElementById('tab-' + tabId);

    if (!tab) {
        console.warn('Không tìm thấy tab:', tabId);
        return;
    }

    document.querySelectorAll('.view-section').forEach((section) => {
        section.classList.toggle('active', section === tab);
    });

    document.querySelectorAll('aside .menu li, .mobile-nav-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.tab === tabId);
    });

    const pageTitle = document.getElementById('page-title');

    if (pageTitle && TAB_TITLES[tabId]) {
        pageTitle.innerText = TAB_TITLES[tabId];
    }
}

// --- TRANSACTION TYPE AND TRANSFERS ---
function setTxType(type) {
    currentType = type;

    const btnExp = document.getElementById('btnTypeExpense');
    const btnInc = document.getElementById('btnTypeIncome');
    const btnTr = document.getElementById('btnTypeTransfer');

    if (btnExp) btnExp.classList.toggle('active', type === 'expense');
    if (btnInc) btnInc.classList.toggle('active', type === 'income');
    if (btnTr) btnTr.classList.toggle('active', type === 'transfer');

    updateCategoriesDropdown();

    // Show the destination source field only for transfers.
    let targetGroup = document.getElementById('targetSourceGroup');

    if (!targetGroup) {
        targetGroup = document.createElement('div');
        targetGroup.id = 'targetSourceGroup';
        targetGroup.className = 'form-group';
        targetGroup.style.display = 'none';
        targetGroup.innerHTML = `
            <label>Chuyển Đến Nguồn (Nhận)</label>
            <select id="txTargetSource" class="form-control">
                ${sources.map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join('')}
            </select>
        `;

        const txSourceEl = document.getElementById('txSource');
        const sourceGroup = txSourceEl ? txSourceEl.closest('.form-group') : null;

        if (sourceGroup) {
            sourceGroup.after(targetGroup);
        }
    }

    targetGroup.style.display = type === 'transfer' ? 'block' : 'none';

    // Transfers have no category. A hidden required select with no options would silently
    // block the form from submitting, so it must be disabled rather than just hidden.
    const categorySelect = document.getElementById('txCategory');
    const categoryGroup = categorySelect ? categorySelect.closest('.form-group') : null;

    if (categorySelect) {
        categorySelect.disabled = type === 'transfer';
    }

    if (categoryGroup) {
        categoryGroup.style.display = type === 'transfer' ? 'none' : 'block';
    }
}

// --- MODAL CONTROLS ---
function resetTransactionForm() {
    editingId = null;

    const form = document.getElementById('transactionForm');
    const modalTitle = document.querySelector('#transactionModal .modal-header h3');

    if (form) {
        form.reset();
    }

    if (modalTitle) {
        modalTitle.innerText = 'Thêm Giao Dịch';
    }

    setTxType('expense');
}

function openModal() {
    if (!editingId) {
        document.getElementById('txDate').value = toLocalDateString();
    }

    document.getElementById('transactionModal').classList.add('open');
}

function closeModal() {
    document.getElementById('transactionModal').classList.remove('open');
    resetTransactionForm();
    document.getElementById('txDate').value = toLocalDateString();
}

function openCategoryModal() {
    document.getElementById('categoryModal').classList.add('open');
}

function closeCategoryModal() {
    document.getElementById('categoryModal').classList.remove('open');
    document.getElementById('catName').value = '';
}

function initModalShortcuts() {
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

        if (document.getElementById('transactionModal').classList.contains('open')) {
            closeModal();
        }

        if (document.getElementById('categoryModal').classList.contains('open')) {
            closeCategoryModal();
        }
    });
}
