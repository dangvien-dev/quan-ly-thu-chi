// Putting sources and categories in the order the user wants.

const { test, expect, newServer, tx, wait, scanA11y } = require('./helpers');

const NOW = '2026-10-31T03:00:00Z';
const SOURCES = [
    { name: 'Tiền Mặt', kind: 'cash' },
    { name: 'Thẻ NH Kiên Long', kind: 'bank' },
    { name: 'Spaylater', kind: 'credit' },
    { name: 'Ví cũ', kind: 'ewallet', archived: true },
    { name: 'Thẻ Tín Dụng', kind: 'credit' },
];
const names = (page, selector) =>
    page.locator(selector).evaluateAll((items) => items.map((item) => item.textContent.trim()));
const sourceOrder = (page) => names(page, '#sources-grid .card .card-title');
const storedSources = (page) =>
    page.evaluate(() => JSON.parse(localStorage.getItem('fm_sources')).map((s) => s.name));
const card = (page, name) =>
    page.locator('#sources-grid .card', {
        has: page.locator(`[data-source="${name}"]`),
    });
const arrow = (page, name, direction) =>
    page.locator(
        `#sources-grid button[data-action="move-source-${direction}"][data-source="${name}"]`,
    );
const open = (page, tab) => page.evaluate((key) => switchTab(key), tab);

async function openSources(app, extra = {}) {
    const result = await app({
        now: NOW,
        seed: { fm_sources: JSON.stringify(SOURCES) },
        ...extra,
    });

    await open(result.page, 'sources');

    return result;
}

test.describe('Sắp xếp nguồn tiền', () => {
    test('nút Sắp xếp chuyển thẻ sang chế độ chỉ có Lên / Xuống, bấm Xong để quay lại', async ({
        app,
    }) => {
        const { page } = await openSources(app);

        await expect(page.locator('#sources-sort-hint')).toBeHidden();
        await expect(card(page, 'Tiền Mặt').locator('[data-action=edit-balance]')).toBeVisible();

        await page.click('#sources-sort-btn');

        await expect(page.locator('#sources-sort-btn')).toContainText('Xong');
        await expect(page.locator('#sources-sort-hint')).toBeVisible();
        await expect(card(page, 'Tiền Mặt').locator('[data-action=edit-balance]')).toHaveCount(0);
        await expect(card(page, 'Tiền Mặt').locator('[data-action=delete-source]')).toHaveCount(0);
        await expect(arrow(page, 'Tiền Mặt', 'up')).toBeVisible();

        await page.click('#sources-sort-btn');

        await expect(page.locator('#sources-sort-btn')).toContainText('Sắp xếp');
        await expect(page.locator('#sources-sort-hint')).toBeHidden();
        await expect(card(page, 'Tiền Mặt').locator('[data-action=edit-balance]')).toBeVisible();
    });

    test('đưa lên / xuống đổi thứ tự thẻ; thẻ đầu không lên được, thẻ cuối không xuống được', async ({
        app,
    }) => {
        const { page } = await openSources(app);

        await page.click('#sources-sort-btn');
        expect(await sourceOrder(page)).toEqual([
            'Tiền Mặt',
            'Thẻ NH Kiên Long',
            'Spaylater',
            'Thẻ Tín Dụng',
        ]);
        await expect(arrow(page, 'Tiền Mặt', 'up')).toBeDisabled();
        await expect(arrow(page, 'Thẻ Tín Dụng', 'down')).toBeDisabled();

        await arrow(page, 'Thẻ Tín Dụng', 'up').click();
        await arrow(page, 'Thẻ Tín Dụng', 'up').click();
        await arrow(page, 'Thẻ Tín Dụng', 'up').click();

        expect(await sourceOrder(page)).toEqual([
            'Thẻ Tín Dụng',
            'Tiền Mặt',
            'Thẻ NH Kiên Long',
            'Spaylater',
        ]);
        await expect(arrow(page, 'Thẻ Tín Dụng', 'up')).toBeDisabled();

        await arrow(page, 'Tiền Mặt', 'down').click();
        expect(await sourceOrder(page)).toEqual([
            'Thẻ Tín Dụng',
            'Thẻ NH Kiên Long',
            'Tiền Mặt',
            'Spaylater',
        ]);
    });

    test('nguồn đã lưu trữ giữ chỗ; thứ tự được lưu, còn sau khi tải lại và dùng ở ô chọn nguồn', async ({
        app,
    }) => {
        const { page } = await openSources(app);

        await page.click('#sources-sort-btn');
        await arrow(page, 'Thẻ Tín Dụng', 'up').click(); // jumps over the archived "Ví cũ"

        expect(await storedSources(page)).toEqual([
            'Tiền Mặt',
            'Thẻ NH Kiên Long',
            'Thẻ Tín Dụng',
            'Ví cũ',
            'Spaylater',
        ]);

        await page.reload();
        await open(page, 'sources');

        expect(await sourceOrder(page)).toEqual([
            'Tiền Mặt',
            'Thẻ NH Kiên Long',
            'Thẻ Tín Dụng',
            'Spaylater',
        ]);

        // The transaction form and the filter follow the same order (the archived one is left out).
        await page.click('header .btn');
        expect(await names(page, '#txSource option')).toEqual([
            'Tiền Mặt',
            'Thẻ NH Kiên Long',
            'Thẻ Tín Dụng',
            'Spaylater',
        ]);
        await page.click('#transactionModal .close-btn');
        await page.evaluate(() => switchTab('transactions'));
        expect((await names(page, '#filter-source option')).slice(0, 5)).toEqual([
            'Tất cả nguồn',
            'Mọi thẻ tín dụng / trả sau / nợ',
            'Tiền Mặt',
            'Thẻ NH Kiên Long',
            'Thẻ Tín Dụng',
        ]);
    });

    test('bàn phím: focus ở lại đúng nút sau khi đổi chỗ; hết đường thì sang nút còn lại; có thông báo cho trình đọc màn hình', async ({
        app,
    }) => {
        const { page } = await openSources(app);

        await page.click('#sources-sort-btn');
        await arrow(page, 'Spaylater', 'up').focus();
        await page.keyboard.press('Enter');

        await expect(arrow(page, 'Spaylater', 'up')).toBeFocused();
        await expect(page.locator('#reorder-status')).toHaveText(
            'Spaylater đang ở vị trí 2 trên 4.',
        );

        await page.keyboard.press('Enter'); // now first: the Up arrow is disabled
        await expect(arrow(page, 'Spaylater', 'down')).toBeFocused();
        await expect(page.locator('#reorder-status')).toHaveText(
            'Spaylater đang ở vị trí 1 trên 4.',
        );
    });

    test('đổi thứ tự được đẩy lên Sheet v2 và máy khác mở lên thấy đúng thứ tự', async ({
        app,
    }) => {
        const server = newServer('v2');
        const a = await app({
            server,
            now: NOW,
            seed: { fm_sources: JSON.stringify(SOURCES) },
        });

        await open(a.page, 'sources');
        await a.page.click('#sources-sort-btn');
        await arrow(a.page, 'Spaylater', 'up').click();
        await wait(500);

        expect(server.get({ v: '2' }).meta.sources.value.map((source) => source.name)).toEqual([
            'Tiền Mặt',
            'Spaylater',
            'Thẻ NH Kiên Long',
            'Ví cũ',
            'Thẻ Tín Dụng',
        ]);

        const b = await app({ server, now: NOW });

        await open(b.page, 'sources');
        // The first contact keeps the server's order and appends what only this device had.
        expect((await sourceOrder(b.page)).slice(0, 4)).toEqual([
            'Tiền Mặt',
            'Spaylater',
            'Thẻ NH Kiên Long',
            'Thẻ Tín Dụng',
        ]);
    });

    test('điện thoại: tiêu đề một dòng riêng, hai nút nằm cạnh nhau bên dưới, chữ Xong khi đang sắp xếp; không tràn ngang; trợ năng ổn', async ({
        app,
    }) => {
        const { page } = await openSources(app, { viewport: { width: 390, height: 844 } });
        const heading = () => page.locator('#tab-sources .section-head h3').boundingBox();
        const sort = await page.locator('#sources-sort-btn').boundingBox();
        const add = await page
            .locator('#tab-sources .section-head .btn:not(.sort-btn)')
            .boundingBox();
        const title = await heading();

        // The heading has its own line; the two buttons share the line under it.
        expect(title.y + title.height).toBeLessThanOrEqual(sort.y);
        expect(Math.abs(sort.y - add.y)).toBeLessThan(2);
        expect(sort.x + sort.width).toBeLessThanOrEqual(add.x);
        expect(add.x + add.width).toBeLessThanOrEqual(390);
        // Two lines of heading at most, also while sorting (the label changes to "Xong").
        expect(title.height).toBeLessThan(60);

        await page.click('#sources-sort-btn');
        await expect(page.locator('#sources-sort-btn .sort-label')).toHaveText('Xong');
        expect((await heading()).height).toBeLessThan(60);

        const results = await scanA11y(page, '#tab-sources');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);
    });
});

const CATEGORIES = [
    { id: 1, name: 'Ăn uống', type: 'expense', icon: 'fa-utensils' },
    { id: 2, name: 'Mua sắm', type: 'expense', icon: 'fa-cart-shopping' },
    { id: 5, name: 'Lương / Thưởng', type: 'income', icon: 'fa-money-bill-wave' },
    { id: 6, name: 'Thu nhập khác', type: 'income', icon: 'fa-circle-plus' },
    { id: 7, name: 'Đồ nghề', type: 'expense', icon: 'fa-tag' },
];
const categoryOrder = (page) => names(page, '#category-table-body .cat-name');
const catArrow = (page, id, direction) =>
    page.locator(
        `#category-table-body button[data-action="move-category-${direction}"][data-id="${id}"]`,
    );

async function openCategories(app, extra = {}) {
    const result = await app({
        now: NOW,
        seed: { fm_categories: JSON.stringify(CATEGORIES) },
        ...extra,
    });

    await open(result.page, 'categories');

    return result;
}

test.describe('Sắp xếp danh mục', () => {
    test('bảng hiện danh mục Chi trước, Thu sau, mỗi nhóm theo thứ tự đã chọn', async ({ app }) => {
        const { page } = await openCategories(app);

        // "Đồ nghề" was added last, but it is an expense: it sits with the expenses.
        expect(await categoryOrder(page)).toEqual([
            'Ăn uống',
            'Mua sắm',
            'Đồ nghề',
            'Lương / Thưởng',
            'Thu nhập khác',
        ]);
    });

    test('chế độ sắp xếp: chỉ có Lên / Xuống, đổi chỗ trong nhóm, hai đầu mỗi nhóm bị khóa', async ({
        app,
    }) => {
        const { page } = await openCategories(app);

        await page.click('#categories-sort-btn');

        await expect(page.locator('#categories-sort-btn')).toContainText('Xong');
        await expect(page.locator('#category-table-body [data-action=delete]')).toHaveCount(0);
        await expect(page.locator('#category-table-body [data-action=budget]')).toHaveCount(0);
        // The first income cannot climb into the expenses.
        await expect(catArrow(page, 5, 'up')).toBeDisabled();
        await expect(catArrow(page, 1, 'up')).toBeDisabled();
        await expect(catArrow(page, 7, 'down')).toBeDisabled();
        await expect(catArrow(page, 6, 'down')).toBeDisabled();

        await catArrow(page, 7, 'up').click();
        await catArrow(page, 7, 'up').click();
        expect(await categoryOrder(page)).toEqual([
            'Đồ nghề',
            'Ăn uống',
            'Mua sắm',
            'Lương / Thưởng',
            'Thu nhập khác',
        ]);

        await catArrow(page, 5, 'down').click();
        expect(await categoryOrder(page)).toEqual([
            'Đồ nghề',
            'Ăn uống',
            'Mua sắm',
            'Thu nhập khác',
            'Lương / Thưởng',
        ]);

        await page.click('#categories-sort-btn');
        await expect(
            page.locator('#category-table-body [data-action=delete]').first(),
        ).toBeVisible();
    });

    test('thứ tự được lưu và dùng ở ô chọn danh mục của giao dịch (chi và thu) và bộ lọc', async ({
        app,
    }) => {
        const { page } = await openCategories(app);

        await page.click('#categories-sort-btn');
        await catArrow(page, 7, 'up').click();
        await catArrow(page, 7, 'up').click();
        await catArrow(page, 6, 'up').click();

        expect(
            await page.evaluate(() =>
                JSON.parse(localStorage.getItem('fm_categories')).map((c) => c.id),
            ),
        ).toEqual([7, 1, 6, 5, 2]);

        await page.reload();
        await open(page, 'categories');
        expect(await categoryOrder(page)).toEqual([
            'Đồ nghề',
            'Ăn uống',
            'Mua sắm',
            'Thu nhập khác',
            'Lương / Thưởng',
        ]);

        await page.click('header .btn');
        expect(await names(page, '#txCategory option')).toEqual(['Đồ nghề', 'Ăn uống', 'Mua sắm']);
        await page.click('#btnTypeIncome');
        expect(await names(page, '#txCategory option')).toEqual([
            'Thu nhập khác',
            'Lương / Thưởng',
        ]);
        await page.click('#transactionModal .close-btn');

        await page.evaluate(() => switchTab('transactions'));
        expect((await names(page, '#filter-category option')).slice(0, 6)).toEqual([
            'Tất cả danh mục',
            'Đồ nghề',
            'Ăn uống',
            'Mua sắm',
            'Thu nhập khác',
            'Lương / Thưởng',
        ]);
    });

    test('danh mục mà chỉ giao dịch cũ nhắc tới xếp sau cùng trong bộ lọc, theo chữ cái', async ({
        app,
    }) => {
        const { page } = await openCategories(app, {
            seed: {
                fm_categories: JSON.stringify(CATEGORIES),
                fm_transactions: JSON.stringify([
                    tx({ id: 'T1', category: 'Zebra cũ' }),
                    tx({ id: 'T2', category: 'An cũ' }),
                ]),
            },
        });

        await page.evaluate(() => switchTab('transactions'));

        const options = await names(page, '#filter-category option');

        expect(options.slice(-2)).toEqual(['An cũ', 'Zebra cũ']);
        expect(options.indexOf('Ăn uống')).toBeLessThan(options.indexOf('An cũ'));
    });

    test('đổi thứ tự được đẩy lên Sheet v2 và có thông báo cho trình đọc màn hình', async ({
        app,
    }) => {
        const server = newServer('v2');
        const { page } = await app({
            server,
            now: NOW,
            seed: { fm_categories: JSON.stringify(CATEGORIES) },
        });

        await open(page, 'categories');
        await page.click('#categories-sort-btn');
        await catArrow(page, 2, 'up').click();
        await wait(500);

        expect(server.get({ v: '2' }).meta.categories.value.map((c) => c.id)).toEqual([
            2, 1, 5, 6, 7,
        ]);
        await expect(catArrow(page, 2, 'up')).toBeDisabled();
        await expect(catArrow(page, 2, 'down')).toBeFocused();
        await expect(page.locator('#reorder-status')).toHaveText('Mua sắm đang ở vị trí 1 trên 3.');
    });

    test('điện thoại: bảng gọn không tràn ngang khi sắp xếp, nút hiện Xong; trợ năng ổn', async ({
        app,
    }) => {
        const { page } = await openCategories(app, { viewport: { width: 390, height: 844 } });

        await page.click('#categories-sort-btn');
        await expect(page.locator('#categories-sort-btn .sort-label')).toHaveText('Xong');

        for (const row of await page.locator('#category-table-body tr').all()) {
            const box = await row.boundingBox();

            expect(box.x + box.width).toBeLessThanOrEqual(390);
            expect(box.height).toBeLessThan(70);
        }

        const results = await scanA11y(page, '#tab-categories');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);
    });
});
