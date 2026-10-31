// UI navigation, modal controls, transaction type controls, and quick-entry chips.

const TAB_TITLES = {
    overview: 'Tổng Quan Dòng Tiền',
    transactions: 'Sổ Giao Dịch',
    sources: 'Nguồn Tiền & Tài Khoản',
    savings: 'Sổ Tiết Kiệm',
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
    setMoneyInput('txAmount', amount);
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

    rememberTab(tabId);

    // Choosing a page from the phone menu closes it and moves on to the page.
    closeMenu({ focusMain: true });
}

// --- CURRENT PAGE IN THE ADDRESS ---
// The page is kept in the address (#settings), so pulling down to refresh stays on it, while
// opening the app from scratch (no #) still starts on the overview. replaceState adds no history
// entries, so the back button is unaffected.
function tabFromAddress() {
    const tab = window.location.hash.slice(1);

    return Object.hasOwn(TAB_TITLES, tab) ? tab : null;
}

function rememberTab(tabId) {
    if (tabFromAddress() === tabId || (tabId === 'overview' && !window.location.hash)) return;

    try {
        const { pathname, search } = window.location;

        window.history.replaceState(
            null,
            '',
            tabId === 'overview' ? pathname + search : `#${tabId}`,
        );
    } catch {
        // For example a sandboxed frame: the app then simply reopens on the overview.
    }
}

/** Show the page named in the address, and follow it if it is changed by hand. */
function initTabFromAddress() {
    const show = () => {
        const tab = tabFromAddress();

        if (tab) switchTab(tab);
    };

    show();
    window.addEventListener('hashchange', show);
}

// --- PHONE MENU ---
// On a phone the sidebar is a drawer: the menu button in the header opens it, and Esc, the
// backdrop, the close button or choosing a page close it.
function isMenuOpen() {
    return document.body.classList.contains('menu-open');
}

function setMenuOpen(open) {
    document.body.classList.toggle('menu-open', open);

    const toggle = document.getElementById('menu-toggle');

    if (toggle) {
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Đóng menu' : 'Mở menu');
    }
}

function openMenu() {
    if (isMenuOpen()) return;

    setMenuOpen(true);

    const current = document.querySelector('aside .menu li.active .menu-link');

    (current || document.querySelector('aside .menu-link')).focus();
}

/** Close the menu; focus goes back to the menu button, or to the page after choosing one. */
function closeMenu({ focusMain = false } = {}) {
    if (!isMenuOpen()) return;

    setMenuOpen(false);

    const target = focusMain
        ? document.getElementById('main-content')
        : document.getElementById('menu-toggle');

    if (target) target.focus();
}

function toggleMenu() {
    if (isMenuOpen()) closeMenu();
    else openMenu();
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
    const dialog =
        document.querySelector('.modal.open') ||
        (isMenuOpen() ? document.getElementById('sidebar') : null);

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
            else closeMenu();
        }
    });

    // Growing past the phone width (rotating a tablet) must not leave the menu "open".
    window.matchMedia('(max-width: 768px)').addEventListener('change', (event) => {
        if (!event.matches) setMenuOpen(false);
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

// --- MONEY FIELDS ---
// Money inputs are text fields (data-money="positive" | "signed") that show thousands separators
// while typing: "1500000" becomes "1.500.000". Use setMoneyInput / readMoneyInput, never .value.

function setMoneyInput(id, value) {
    const input = document.getElementById(id);
    const number = Number(value);

    if (!input) return;

    input.value =
        value === '' || value === null || value === undefined || !Number.isFinite(number)
            ? ''
            : formatMoneyDigits(String(Math.round(number)), input.dataset.money === 'signed');
}

function readMoneyInput(id) {
    return parseMoneyText(document.getElementById(id).value);
}

/** Reformat on every keystroke and keep the caret after the same number of digits. */
function attachMoneyInput(input) {
    input.addEventListener('input', () => {
        const typed = input.value;
        const caret = input.selectionStart ?? typed.length;
        // Read on every keystroke: the field of askMoney() switches between the two modes.
        const formatted = formatMoneyDigits(typed, input.dataset.money === 'signed');

        if (formatted === typed) return;

        // Characters that count: digits, and the leading minus sign.
        let significantBeforeCaret = typed.slice(0, caret).replace(/[^\d-]/g, '').length;
        let position = 0;

        input.value = formatted;

        while (position < formatted.length && significantBeforeCaret > 0) {
            if (/[\d-]/.test(formatted[position])) significantBeforeCaret--;

            position++;
        }

        input.setSelectionRange(position, position);
    });
}

function initMoneyInputs() {
    document.querySelectorAll('input[data-money]').forEach(attachMoneyInput);
}

// --- REORDERING (sources, categories) ---
/** Say something to screen readers without showing it. */
function announce(message) {
    const region = document.getElementById('reorder-status');

    if (!region) return;

    region.textContent = '';
    setTimeout(() => {
        region.textContent = message;
    }, 50);
}

/**
 * Run `redraw` (which replaces the content of `container`) and keep the focus on the control that
 * had it, found again by its data-* values. A sync that redraws a list must not drop the focus.
 */
function keepFocus(container, redraw) {
    const active = document.activeElement;
    const selector = container.contains(active) ? controlSelector(active) : '';

    redraw();

    if (!selector) return;

    const again = container.querySelector(selector);

    if (again && !again.disabled) again.focus();
}

/**
 * After a list was redrawn, put the focus back on the control that had it. When that arrow is now
 * disabled (the item reached the top or the bottom) its twin gets the focus instead.
 */
function refocusControl(selector, fallbackSelector = '') {
    const usable = (element) => element && !element.disabled;
    const target = [selector, fallbackSelector]
        .filter(Boolean)
        .map((item) => document.querySelector(item))
        .find(usable);

    if (target) target.focus();
}

// --- ASK FOR AN AMOUNT ---
// window.prompt() cannot show thousands separators while typing, so amounts are asked in
// #moneyPromptModal, whose field is a data-money input like every other amount in the app.
let moneyPromptResolve = null;
let moneyPromptAllowEmpty = false;
let moneyPromptTrigger = '';

/** A selector that finds a control again after the page redrew it: tag plus its data-* values. */
function controlSelector(element) {
    if (!element || !element.attributes) return '';

    return (
        element.tagName.toLowerCase() +
        [...element.attributes]
            .filter((attribute) => attribute.name.startsWith('data-'))
            .map((attribute) => `[${attribute.name}="${CSS.escape(attribute.value)}"]`)
            .join('')
    );
}

/**
 * Ask for an amount. Resolves to null when the user cancels, otherwise to the number: NaN for an
 * empty or incomplete entry (a lone "-"), or 0 for an empty entry when allowEmpty is set.
 * options: { title, message, value, signed (a minus sign is allowed), allowEmpty, confirmLabel }.
 */
function askMoney({
    title,
    message = '',
    value = '',
    signed = false,
    allowEmpty = false,
    confirmLabel = 'Lưu',
}) {
    // A question that is somehow still open counts as cancelled before the next one starts.
    if (moneyPromptResolve) closeMoneyPrompt(null);

    return new Promise((resolve) => {
        const input = document.getElementById('moneyPromptInput');

        moneyPromptResolve = resolve;
        moneyPromptAllowEmpty = allowEmpty;
        moneyPromptTrigger = controlSelector(document.activeElement);
        document.getElementById('moneyPromptTitle').textContent = title;
        document.getElementById('moneyPromptMessage').textContent = message;
        document.getElementById('moneyPromptSubmit').textContent = confirmLabel;
        input.dataset.money = signed ? 'signed' : 'positive';
        // A numeric keypad has no minus sign.
        input.inputMode = signed ? 'text' : 'numeric';
        setMoneyInput('moneyPromptInput', value);
        openDialog('moneyPromptModal', 'moneyPromptInput');
        input.select();
    });
}

function closeMoneyPrompt(result) {
    const resolve = moneyPromptResolve;

    const trigger = moneyPromptTrigger;
    const previous = dialogReturnFocus.get('moneyPromptModal');

    moneyPromptResolve = null;
    closeDialog('moneyPromptModal');

    if (resolve) resolve(result);

    // Saving redraws the list the button was in: once that is done, focus its replacement.
    setTimeout(() => {
        if (previous && document.contains(previous)) return;

        const again = trigger && document.querySelector(trigger);

        if (again) again.focus();
    }, 0);
}

function submitMoneyPrompt(event) {
    event.preventDefault();

    const empty = document.getElementById('moneyPromptInput').value.trim() === '';

    closeMoneyPrompt(empty && moneyPromptAllowEmpty ? 0 : readMoneyInput('moneyPromptInput'));
}
