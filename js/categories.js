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

function handleCategorySubmit(e) {
    e.preventDefault();

    const name = document.getElementById('catName').value;
    const type = document.getElementById('catType').value;

    categories.push({
        id: Date.now(),
        name,
        type,
        icon: 'fa-tag',
    });

    localStorage.setItem('fm_categories', JSON.stringify(categories));

    renderCategories();
    updateCategoriesDropdown();
    closeCategoryModal();

    document.getElementById('catName').value = '';
}

function deleteCategory(id) {
    categories = categories.filter((category) => category.id !== id);
    localStorage.setItem('fm_categories', JSON.stringify(categories));
    renderCategories();
}

function renderCategories() {
    const tbody = document.getElementById('category-table-body');

    if (!tbody) return;

    tbody.innerHTML = '';

    categories.forEach((category) => {
        tbody.innerHTML += `<tr>
            <td><i class="fa-solid ${category.icon}" style="margin-right:8px; color:var(--primary);"></i>${category.name}</td>
            <td>${category.type === 'income' ? 'Thu Nhập' : 'Chi Tiêu'}</td>
            <td>${category.icon}</td>
            <td style="text-align:right;">
                <button class="btn btn-outline" style="padding:4px 8px; font-size:12px;" onclick="deleteCategory(${category.id})">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`;
    });
}
