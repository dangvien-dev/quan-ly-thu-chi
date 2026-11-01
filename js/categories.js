// Category creation, deletion, rendering, and transaction-form options.

function updateCategoriesDropdown() {
    const select = document.getElementById('txCategory');

    if (!select) return;

    select.innerHTML = '';

    categories
        .filter((category) => category.type === currentType)
        .forEach((category) => {
            const option = document.createElement('option');
            option.value = category.name;
            option.textContent = category.name;
            select.appendChild(option);
        });
}

function selectCategory(name, keepMissing = false) {
    selectValue('txCategory', name, keepMissing);
}

function handleCategorySubmit(e) {
    e.preventDefault();

    const name = document.getElementById('catName').value.trim();
    const type = document.getElementById('catType').value;

    if (!name) {
        alert('Vui lòng nhập tên danh mục!');
        return;
    }

    const duplicate = categories.some(
        (category) =>
            category.type === type &&
            category.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'),
    );

    if (duplicate) {
        alert(`Danh mục "${name}" đã tồn tại.`);
        return;
    }

    categories.push({
        id: Date.now(),
        name,
        type,
        icon: 'fa-tag',
    });

    saveMeta('categories');

    renderCategories();
    updateCategoriesDropdown();
    closeCategoryModal();
    syncToGoogleSheet();
}

function deleteCategory(id) {
    const category = categories.find((item) => String(item.id) === String(id));

    if (!category) return;

    const usedBy = transactions.filter(
        (transaction) => transaction.category === category.name,
    ).length;
    const warning = usedBy
        ? `\n\n${usedBy} giao dịch đang dùng danh mục này vẫn được giữ nguyên tên danh mục.`
        : '';

    if (!confirm(`Xóa danh mục "${category.name}"?${warning}`)) return;

    categories = categories.filter((item) => item !== category);

    if (Object.hasOwn(budgets, category.name)) {
        delete budgets[category.name];
        saveMeta('budgets');
    }

    if (Object.hasOwn(salaryPlan.assign, category.name)) {
        delete salaryPlan.assign[category.name];
        saveMeta('salary');
    }

    saveMeta('categories');
    renderCategories();
    updateCategoriesDropdown();
    syncToGoogleSheet();
}

function handleCategoryTableClick(event) {
    const button = event.target.closest('button[data-action]');

    if (!button) return;

    if (button.dataset.action === 'delete') {
        deleteCategory(button.dataset.id);
    } else if (button.dataset.action === 'budget') {
        editBudget(button.dataset.id);
    } else if (button.dataset.action === 'move-category-up') {
        moveCategory(button.dataset.id, -1);
    } else if (button.dataset.action === 'move-category-down') {
        moveCategory(button.dataset.id, 1);
    }
}

// While true the rows show only the up / down arrows (see toggleCategoryReorder).
let reorderingCategories = false;

/** Expenses first, then income; inside each group the order the user chose. */
function categoriesByType() {
    return [
        ...categories.filter((category) => category.type === 'expense'),
        ...categories.filter((category) => category.type !== 'expense'),
    ];
}

function renderCategoryReorderControls() {
    const button = document.getElementById('categories-sort-btn');
    const hint = document.getElementById('categories-sort-hint');

    if (hint) hint.hidden = !reorderingCategories;

    if (!button) return;

    button.classList.toggle('sorting', reorderingCategories);
    button.setAttribute('aria-label', reorderingCategories ? 'Xong sắp xếp' : 'Sắp xếp danh mục');
    button.querySelector('.sort-label').textContent = reorderingCategories ? 'Xong' : 'Sắp xếp';
    button.querySelector('i').className = reorderingCategories
        ? 'fa-solid fa-check'
        : 'fa-solid fa-up-down';
}

function toggleCategoryReorder() {
    reorderingCategories = !reorderingCategories;
    renderCategories();
}

/** Move a category one place up or down among the ones of its own type. */
function moveCategory(id, step) {
    const index = categories.findIndex((category) => String(category.id) === String(id));
    const next = moveInList(categories, index, step, (other, moving) => other.type === moving.type);

    if (next === categories) return;

    const moved = categories[index];
    const action = step < 0 ? 'move-category-up' : 'move-category-down';
    const twin = step < 0 ? 'move-category-down' : 'move-category-up';
    const selector = (kind) =>
        `#category-table-body button[data-action="${kind}"][data-id="${CSS.escape(String(id))}"]`;

    categories = next;
    saveMeta('categories');
    renderCategories();
    updateCategoriesDropdown();
    syncToGoogleSheet();
    refocusControl(selector(action), selector(twin));

    const group = categories.filter((category) => category.type === moved.type);

    announce(
        `${moved.name} đang ở vị trí ${group.findIndex((category) => category === moved) + 1} trên ${group.length}.`,
    );
}

function renderCategories() {
    const tbody = document.getElementById('category-table-body');

    if (!tbody) return;

    renderCategoryReorderControls();

    const rows = categoriesByType();

    keepFocus(tbody, () => {
        tbody.innerHTML = rows
            .map((category) => {
                const id = escapeHtml(category.id);
                const budget = budgets[category.name];
                const budgetText = budget ? formatMoney(budget) : '—';
                const budgetCell =
                    category.type !== 'expense'
                        ? '—'
                        : reorderingCategories
                          ? budgetText
                          : `${budgetText}
                <button class="btn btn-outline btn-small" data-action="budget" data-id="${id}" title="Đặt ngân sách tháng" aria-label="Đặt ngân sách tháng cho ${escapeHtml(category.name)}">
                    <i class="fa-solid fa-pen"></i>
                </button>`;

                const isIncome = category.type === 'income';
                const name = escapeHtml(category.name);
                const sameType = rows.filter((item) => item.type === category.type);
                const position = sameType.indexOf(category);
                const actions = reorderingCategories
                    ? `<button type="button" class="btn btn-outline btn-small" data-action="move-category-up" data-id="${id}" aria-label="Chuyển danh mục ${name} lên trên"${position === 0 ? ' disabled' : ''}>
                    <i class="fa-solid fa-arrow-up" aria-hidden="true"></i><span class="move-label"> Lên</span>
                </button>
                <button type="button" class="btn btn-outline btn-small" data-action="move-category-down" data-id="${id}" aria-label="Chuyển danh mục ${name} xuống dưới"${position === sameType.length - 1 ? ' disabled' : ''}>
                    <i class="fa-solid fa-arrow-down" aria-hidden="true"></i><span class="move-label"> Xuống</span>
                </button>`
                    : `<button class="btn btn-outline btn-small" data-action="delete" data-id="${id}" title="Xóa" aria-label="Xóa danh mục ${name}">
                    <i class="fa-solid fa-trash"></i>
                </button>`;

                return `<tr class="cat-row ${isIncome ? 'cat-income' : 'cat-expense'}">
            <td data-label="Tên danh mục"><i class="fa-solid ${escapeHtml(category.icon)} cat-icon"></i><span class="cat-name">${escapeHtml(category.name)}</span><small class="cat-type" title="${isIncome ? 'Thu nhập' : 'Chi tiêu'}">${isIncome ? 'Thu' : 'Chi'}</small></td>
            <td data-label="Loại">${isIncome ? 'Thu Nhập' : 'Chi Tiêu'}</td>
            <td data-label="Biểu tượng">${escapeHtml(category.icon)}</td>
            <td data-label="Ngân sách tháng"${isIncome ? ' class="cat-na"' : ''}>${budgetCell}</td>
            <td class="row-actions" style="text-align:right;">
                ${actions}
            </td>
        </tr>`;
            })
            .join('');
    });
}
