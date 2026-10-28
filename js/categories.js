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
    saveMeta('categories');
    renderCategories();
    updateCategoriesDropdown();
    syncToGoogleSheet();
}

function handleCategoryTableClick(event) {
    const button = event.target.closest('button[data-action="delete"]');

    if (button) {
        deleteCategory(button.dataset.id);
    }
}

function renderCategories() {
    const tbody = document.getElementById('category-table-body');

    if (!tbody) return;

    tbody.innerHTML = categories
        .map(
            (category) => `<tr>
            <td><i class="fa-solid ${escapeHtml(category.icon)}" style="margin-right:8px; color:var(--primary);"></i>${escapeHtml(category.name)}</td>
            <td>${category.type === 'income' ? 'Thu Nhập' : 'Chi Tiêu'}</td>
            <td>${escapeHtml(category.icon)}</td>
            <td style="text-align:right;">
                <button class="btn btn-outline" style="padding:4px 8px; font-size:12px;" data-action="delete" data-id="${escapeHtml(category.id)}" title="Xóa">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`,
        )
        .join('');
}
