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
    }
}

function renderCategories() {
    const tbody = document.getElementById('category-table-body');

    if (!tbody) return;

    tbody.innerHTML = categories
        .map((category) => {
            const id = escapeHtml(category.id);
            const budget = budgets[category.name];
            const budgetCell =
                category.type === 'expense'
                    ? `${budget ? formatMoney(budget) : '—'}
                <button class="btn btn-outline btn-small" data-action="budget" data-id="${id}" title="Đặt ngân sách tháng" aria-label="Đặt ngân sách tháng cho ${escapeHtml(category.name)}">
                    <i class="fa-solid fa-pen"></i>
                </button>`
                    : '—';

            const isIncome = category.type === 'income';

            return `<tr class="cat-row ${isIncome ? 'cat-income' : 'cat-expense'}">
            <td data-label="Tên danh mục"><i class="fa-solid ${escapeHtml(category.icon)} cat-icon"></i><span class="cat-name">${escapeHtml(category.name)}</span><small class="cat-type" title="${isIncome ? 'Thu nhập' : 'Chi tiêu'}">${isIncome ? 'Thu' : 'Chi'}</small></td>
            <td data-label="Loại">${isIncome ? 'Thu Nhập' : 'Chi Tiêu'}</td>
            <td data-label="Biểu tượng">${escapeHtml(category.icon)}</td>
            <td data-label="Ngân sách tháng"${isIncome ? ' class="cat-na"' : ''}>${budgetCell}</td>
            <td class="row-actions" style="text-align:right;">
                <button class="btn btn-outline btn-small" data-action="delete" data-id="${id}" title="Xóa" aria-label="Xóa danh mục ${escapeHtml(category.name)}">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`;
        })
        .join('');
}
