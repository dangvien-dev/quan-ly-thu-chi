// Categories on a phone: one compact line each, same data and actions as the desktop table.

const { test, expect, goTab, scanA11y } = require('./helpers');

const NOW = '2026-10-30T03:00:00Z';
const LONG = 'Dụng cụ và thiết bị phục vụ công việc lắp đặt camera cho khách hàng';
const categories = [
    { id: 1, name: 'Ăn uống', type: 'expense', icon: 'fa-utensils' },
    { id: 2, name: 'Mua sắm', type: 'expense', icon: 'fa-cart-shopping' },
    { id: 3, name: LONG, type: 'expense', icon: 'fa-screwdriver-wrench' },
    { id: 4, name: 'Lương / Thưởng', type: 'income', icon: 'fa-money-bill-wave' },
];
const phone = {
    now: NOW,
    viewport: { width: 390, height: 844 },
    seed: {
        fm_categories: JSON.stringify(categories),
        fm_budgets: JSON.stringify({ 'Ăn uống': 3000000, [LONG]: 12000000 }),
    },
};
const rowFor = (page, name) => page.locator('#category-table-body tr', { hasText: name });
const openCategories = async (page) => {
    await page.evaluate(() => switchTab('categories'));
};

test.describe('Danh mục gọn trên điện thoại', () => {
    test('mỗi danh mục là một dòng thấp, không tràn ngang', async ({ app }) => {
        const { page } = await app(phone);

        await openCategories(page);

        for (const { name } of categories) {
            const box = await rowFor(page, name === LONG ? 'Dụng cụ và' : name).boundingBox();

            expect(box.height, name).toBeLessThan(64);
            expect(box.x + box.width, name).toBeLessThanOrEqual(390);
        }

        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);
    });

    test('hiện tên, ngân sách (nếu có) và hai nút; ẩn cột Loại và tên biểu tượng', async ({
        app,
    }) => {
        const { page } = await app(phone);

        await openCategories(page);

        const food = rowFor(page, 'Ăn uống');

        await expect(food.locator('.cat-name')).toHaveText('Ăn uống');
        await expect(food.locator('td[data-label="Ngân sách tháng"]')).toContainText('3.000.000 đ');
        await expect(food.locator('[data-action=budget]')).toBeVisible();
        await expect(food.locator('[data-action=delete]')).toBeVisible();
        await expect(food.locator('td[data-label="Loại"]')).toBeHidden();
        await expect(food.locator('td[data-label="Biểu tượng"]')).toBeHidden();
        await expect(
            rowFor(page, 'Mua sắm').locator('td[data-label="Ngân sách tháng"]'),
        ).toHaveText(/—/);
    });

    test('loại thể hiện bằng thanh màu bên trái và chữ "Thu" (chi tiêu là mặc định, chip chỉ để đọc to)', async ({
        app,
    }) => {
        const { page } = await app(phone);

        await openCategories(page);

        const colors = await page.evaluate(() => {
            const style = getComputedStyle(document.documentElement);
            const border = (name) =>
                getComputedStyle(
                    [...document.querySelectorAll('#category-table-body tr')].find((row) =>
                        row.textContent.includes(name),
                    ),
                ).borderLeftColor;
            const toRgb = (hex) => {
                const value = hex.trim().replace('#', '');

                return `rgb(${[0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)).join(', ')})`;
            };

            return {
                expense: [border('Ăn uống'), toRgb(style.getPropertyValue('--danger'))],
                income: [border('Lương'), toRgb(style.getPropertyValue('--success'))],
            };
        });

        expect(colors.expense[0]).toBe(colors.expense[1]);
        expect(colors.income[0]).toBe(colors.income[1]);

        // Income shows its chip; expense keeps it for screen readers only (1px, clipped).
        await expect(rowFor(page, 'Lương').locator('.cat-type')).toHaveText('Thu');
        expect(
            (await rowFor(page, 'Lương').locator('.cat-type').boundingBox()).width,
        ).toBeGreaterThan(20);
        await expect(rowFor(page, 'Ăn uống').locator('.cat-type')).toHaveText('Chi');
        expect(
            (await rowFor(page, 'Ăn uống').locator('.cat-type').boundingBox()).width,
        ).toBeLessThan(3);
    });

    test('danh mục thu nhập không có ô ngân sách, nút xóa vẫn nằm sát phải', async ({ app }) => {
        const { page } = await app(phone);

        await openCategories(page);

        const income = rowFor(page, 'Lương');

        await expect(income.locator('td[data-label="Ngân sách tháng"]')).toBeHidden();
        await expect(income.locator('[data-action=budget]')).toHaveCount(0);

        const row = await income.boundingBox();
        const button = await income.locator('[data-action=delete]').boundingBox();

        expect(row.x + row.width - (button.x + button.width)).toBeLessThan(16);
    });

    test('tên rất dài bị cắt bằng dấu ba chấm, dòng vẫn thấp và các nút vẫn trong màn hình', async ({
        app,
    }) => {
        const { page } = await app(phone);

        await openCategories(page);

        const row = rowFor(page, 'Dụng cụ và');
        const name = await row.locator('.cat-name').evaluate((node) => ({
            clipped: node.scrollWidth > node.clientWidth,
            overflow: getComputedStyle(node).textOverflow,
        }));
        const box = await row.boundingBox();
        const pencil = await row.locator('[data-action=budget]').boundingBox();

        expect(name).toEqual({ clipped: true, overflow: 'ellipsis' });
        expect(box.height).toBeLessThan(64);
        expect(pencil.x + pencil.width).toBeLessThanOrEqual(390);
    });

    test('các nút vẫn dùng được: đặt ngân sách và xóa danh mục', async ({ app }) => {
        const { page, state } = await app({ ...phone, promptValue: '2.500.000' });

        await openCategories(page);
        await rowFor(page, 'Mua sắm').locator('[data-action=budget]').click();

        expect(await page.evaluate(() => budgets['Mua sắm'])).toBe(2500000);
        await expect(
            rowFor(page, 'Mua sắm').locator('td[data-label="Ngân sách tháng"]'),
        ).toContainText('2.500.000 đ');

        await rowFor(page, 'Mua sắm').locator('[data-action=delete]').click();

        // The budget prompt is recorded as a dialog too; the last one is the delete confirmation.
        expect(state.confirms.at(-1)).toBe('Xóa danh mục "Mua sắm"?');
        await expect(page.locator('#category-table-body tr')).toHaveCount(3);
    });

    test('nút đủ lớn để chạm (≥ 36px) và có tên truy cập', async ({ app }) => {
        const { page } = await app(phone);

        await openCategories(page);

        for (const button of await page.locator('#category-table-body button').all()) {
            const box = await button.boundingBox();

            expect(box.width).toBeGreaterThanOrEqual(36);
            expect(box.height).toBeGreaterThanOrEqual(36);
            expect(await button.getAttribute('aria-label')).toBeTruthy();
        }
    });

    test('nút "Thêm Danh Mục" nằm trên một dòng và mở hộp thoại', async ({ app }) => {
        const { page } = await app(phone);

        await openCategories(page);

        const add = page.locator('#tab-categories .section-head .btn:not(.sort-btn)');

        expect((await add.boundingBox()).height).toBeLessThan(48);
        await add.click();
        await expect(page.locator('#categoryModal')).toHaveClass(/open/);
    });

    test('không có vi phạm axe', async ({ app }) => {
        const { page } = await app(phone);

        await openCategories(page);

        const results = await scanA11y(page);

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    test('mở trang bằng thanh dưới / menu vẫn hiện đúng danh sách', async ({ app }) => {
        const { page } = await app(phone);

        await page.click('#menu-toggle');
        await page.click('aside [data-tab="categories"] button');

        await expect(page.locator('#tab-categories')).toHaveClass(/active/);
        await expect(page.locator('#category-table-body tr')).toHaveCount(4);
    });
});

test.describe('Danh mục trên máy tính giữ nguyên dạng bảng', () => {
    test('đủ 5 cột, hiện tên loại và tên biểu tượng, chip ẩn', async ({ app }) => {
        const { page } = await app({
            now: NOW,
            seed: { fm_categories: JSON.stringify(categories) },
        });

        await goTab(page, 'categories');

        await expect(page.locator('#tab-categories thead th')).toHaveCount(5);
        await expect(rowFor(page, 'Ăn uống').locator('td[data-label="Loại"]')).toHaveText(
            'Chi Tiêu',
        );
        await expect(rowFor(page, 'Ăn uống').locator('td[data-label="Biểu tượng"]')).toHaveText(
            'fa-utensils',
        );
        await expect(rowFor(page, 'Ăn uống').locator('.cat-type')).toBeHidden();
        await expect(
            rowFor(page, 'Lương').locator('td[data-label="Ngân sách tháng"]'),
        ).toBeVisible();
    });
});
