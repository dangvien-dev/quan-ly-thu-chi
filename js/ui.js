// UI navigation, modal controls, transaction type controls, and quick-entry chips.

const TAB_TITLES = {
    overview: 'Tổng Quan Dòng Tiền',
    transactions: 'Sổ Giao Dịch',
    sources: 'Nguồn Tiền & Tài Khoản',
    categories: 'Danh Mục Thu / Chi',
    recurring: 'Giao Dịch Định Kỳ',
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
            <button type="button" class="chip" onclick="quickFill('Cafe sáng', 20000, 'Ăn uống')">☕ Cafe sáng (20k)</button>
            <button type="button" class="chip" onclick="quickFill('Cơm trưa', 45000, 'Ăn uống')">🍛 Cơm trưa (45k)</button>
            <button type="button" class="chip" onclick="quickFill('Gửi xe', 5000, 'Đi lại')">🅿️ Gửi xe (5k)</button>
            <button type="button" class="chip" onclick="quickFill('Xăng xe', 50000, 'Đi lại')">⛽ Xăng xe (50k)</button>
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
        const active = item.dataset.tab === tabId;
        const control = item.matches('button') ? item : item.querySelector('button');

        item.classList.toggle('active', active);

        if (control) {
            if (active) control.setAttribute('aria-current', 'page');
            else control.removeAttribute('aria-current');
        }
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
            <label for="txTargetSource">Chuyển Đến Nguồn (Nhận)</label>
            <select id="txTargetSource" class="form-control"></select>
        `;

        const txSourceEl = document.getElementById('txSource');
        const sourceGroup = txSourceEl ? txSourceEl.closest('.form-group') : null;

        if (sourceGroup) {
            sourceGroup.after(targetGroup);
        }

        populateSourceOptions();
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

// --- SELECT OPTIONS ---
/**
 * Select `value` in a <select>. With keepMissing, a value that is not an option (an archived
 * source, a deleted category, a value synced from another device) is added as a temporary
 * option so editing a record does not silently change it.
 */
function selectValue(selectId, value, keepMissing = false) {
    const select = document.getElementById(selectId);

    if (!select || !value) return;

    const exists = Array.from(select.options).some((option) => option.value === value);

    if (!exists && keepMissing) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
    }

    if (exists || keepMissing) {
        select.value = value;
    }
}

/** Fill the transaction form's source dropdowns from the active sources. */
function populateSourceOptions() {
    ['txSource', 'txTargetSource'].forEach((id) => {
        const select = document.getElementById(id);

        if (!select) return;

        const previous = select.value;

        select.innerHTML = sourceNames()
            .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
            .join('');
        selectValue(id, previous, Boolean(previous && findSource(previous)));
    });
}

// --- DIALOGS ---
const dialogReturnFocus = new Map();

function openDialog(id, focusId) {
    const dialog = document.getElementById(id);

    dialogReturnFocus.set(id, document.activeElement);
    dialog.classList.add('open');

    const target = focusId && document.getElementById(focusId);

    if (target) target.focus();
}

function closeDialog(id) {
    document.getElementById(id).classList.remove('open');

    const previous = dialogReturnFocus.get(id);

    dialogReturnFocus.delete(id);

    if (previous && document.contains(previous) && typeof previous.focus === 'function') {
        previous.focus();
    }
}

// --- TRANSACTION MODAL ---
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

    populateSourceOptions();
    setTxType('expense');
}

function openModal() {
    if (!editingId) {
        document.getElementById('txDate').value = toLocalDateString();
    }

    openDialog('transactionModal', 'txAmount');
}

function closeModal() {
    closeDialog('transactionModal');
    resetTransactionForm();
    document.getElementById('txDate').value = toLocalDateString();
}

function openCategoryModal() {
    openDialog('categoryModal', 'catName');
}

function closeCategoryModal() {
    closeDialog('categoryModal');
    document.getElementById('catName').value = '';
}

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep Tab inside the open dialog (and bring focus in if it is outside). */
function trapDialogFocus(event) {
    const dialog = document.querySelector('.modal.open');

    if (!dialog) return;

    const items = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getClientRects().length > 0,
    );

    if (items.length === 0) return;

    const first = items[0];
    const last = items[items.length - 1];

    if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function initModalShortcuts() {
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') {
            trapDialogFocus(event);
        } else if (event.key === 'Escape') {
            const closeButton = document.querySelector('.modal.open .close-btn');

            if (closeButton) closeButton.click();
        }
    });
}

// --- FILES ---
function downloadTextFile(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
}

// --- TOASTS ---
const MAX_TOASTS = 4;

/** Short message in the corner; kind: info | success | warning | danger. */
function showToast(message, kind = 'info', durationMs = 7000) {
    let container = document.getElementById('toast-container');

    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');

    toast.className = `toast toast-${kind}`;
    toast.textContent = message;
    toast.addEventListener('click', () => toast.remove());
    container.appendChild(toast);

    while (container.children.length > MAX_TOASTS) {
        container.firstElementChild.remove();
    }

    setTimeout(() => toast.remove(), durationMs);
}
