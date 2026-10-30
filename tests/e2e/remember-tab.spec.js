// Reloading (pull to refresh) keeps the current page; opening the app from scratch starts on the overview.

const { test, expect, tx, settle } = require('./helpers');

const NOW = '2026-10-30T03:00:00Z';
const PAGES = [
    ['overview', 'Tổng Quan Dòng Tiền'],
    ['transactions', 'Sổ Giao Dịch'],
    ['sources', 'Nguồn Tiền & Tài Khoản'],
    ['categories', 'Danh Mục Thu / Chi'],
    ['recurring', 'Giao Dịch Định Kỳ'],
    ['debts', 'Vay Nợ & Công Ty'],
    ['settings', 'Cài Đặt & Dữ Liệu'],
];
const phone = { now: NOW, viewport: { width: 390, height: 844 } };
const hashOf = (page) => page.evaluate(() => window.location.hash);
const activePage = (page) =>
    page.evaluate(() => document.querySelector('.view-section.active').id.replace('tab-', ''));

test.describe('Làm mới trang vẫn ở trang hiện tại', () => {
    for (const [tab, title] of PAGES) {
        test(`đang ở "${title}": tải lại vẫn ở đó`, async ({ app }) => {
            const { page } = await app({ now: NOW });

            await page.evaluate((name) => switchTab(name), tab);
            await page.reload();
            await page.waitForLoadState('load');

            await expect(page.locator(`#tab-${tab}`)).toHaveClass(/active/);
            await expect(page.locator('#page-title')).toHaveText(title);
            await expect(page.locator(`aside [data-tab="${tab}"] button`)).toHaveAttribute(
                'aria-current',
                'page',
            );
            expect(await page.locator('.view-section.active').count()).toBe(1);
        });
    }

    test('địa chỉ ghi trang hiện tại (#trang); Tổng quan thì không để lại #', async ({ app }) => {
        const { page } = await app({ now: NOW });

        expect(await hashOf(page)).toBe('');

        await page.evaluate(() => switchTab('debts'));
        expect(await hashOf(page)).toBe('#debts');

        await page.evaluate(() => switchTab('overview'));
        expect(await hashOf(page)).toBe('');
        expect(await page.evaluate(() => window.location.pathname)).toBe('/index.html');
    });

    test('mở ứng dụng từ đầu (không có #) thì vào Tổng quan', async ({ app }) => {
        const { page } = await app({ now: NOW });

        await page.evaluate(() => switchTab('settings'));
        await page.goto('/index.html');
        await page.waitForLoadState('load');

        expect(await activePage(page)).toBe('overview');
    });

    test('đổi trang không thêm lịch sử duyệt web (nút Back không phải bấm nhiều lần)', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });
        const before = await page.evaluate(() => history.length);

        for (const [tab] of PAGES) await page.evaluate((name) => switchTab(name), tab);

        expect(await page.evaluate(() => history.length)).toBe(before);
    });

    test('# lạ hoặc nguy hiểm thì bỏ qua và vào Tổng quan', async ({ app }) => {
        const { page, state } = await app({ now: NOW });

        for (const hash of [
            'nonsense',
            '__proto__',
            'constructor',
            'toString',
            '',
            'settings%20',
        ]) {
            await page.goto(`/index.html#${hash}`);
            await page.waitForLoadState('load');

            expect(await activePage(page), hash).toBe('overview');
        }

        expect(state.errors).toEqual([]);
    });

    test('mở thẳng địa chỉ có # (ví dụ #categories) thì vào đúng trang', async ({ app }) => {
        const { page } = await app({ now: NOW });

        await page.goto('/index.html#categories');
        await page.waitForLoadState('load');

        expect(await activePage(page)).toBe('categories');
        await expect(page.locator('#page-title')).toHaveText('Danh Mục Thu / Chi');
    });

    test('sửa # trong khi đang mở thì chuyển trang theo', async ({ app }) => {
        const { page } = await app({ now: NOW });

        await page.evaluate(() => {
            window.location.hash = 'sources';
        });

        await expect(page.locator('#tab-sources')).toHaveClass(/active/);
    });

    test('dữ liệu vẫn còn sau khi tải lại ở một trang khác Tổng quan', async ({ app }) => {
        const { page } = await app({
            now: NOW,
            seed: {
                fm_transactions: JSON.stringify([
                    tx({ id: 'TX_1', note: 'Cafe sáng', amount: 20000 }),
                ]),
            },
        });

        await page.evaluate(() => switchTab('transactions'));
        await page.reload();

        await expect(page.locator('#transaction-table-body')).toContainText('Cafe sáng');
    });

    test('mở ở trang khác rồi sang Tổng quan thì biểu đồ vẫn vẽ đúng (không bị 0px)', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            seed: {
                fm_transactions: JSON.stringify([
                    tx({ id: 'TX_1', date: '2026-10-05', amount: 40000 }),
                    tx({
                        id: 'TX_2',
                        date: '2026-10-06',
                        type: 'income',
                        category: 'Lương / Thưởng',
                        amount: 900000,
                    }),
                ]),
            },
        });

        await page.evaluate(() => switchTab('sources'));
        await page.reload();
        await page.waitForLoadState('load');
        await page.evaluate(() => switchTab('overview'));
        await settle(page);

        for (const id of ['expenseCategoryChart', 'monthlyChart']) {
            const box = await page.locator(`#${id}`).boundingBox();

            expect(box.width, id).toBeGreaterThan(150);
            expect(box.height, id).toBeGreaterThan(100);
        }
    });
});

test.describe('Trên điện thoại', () => {
    test('đang ở trang chọn từ menu trái (Cài đặt): tải lại vẫn ở đó, menu đóng, thanh dưới không đánh dấu', async ({
        app,
    }) => {
        const { page } = await app(phone);

        await page.click('#menu-toggle');
        await page.click('aside [data-tab="settings"] button');
        await page.reload();
        await page.waitForLoadState('load');

        await expect(page.locator('#tab-settings')).toHaveClass(/active/);
        await expect(page.locator('#page-title')).toHaveText('Cài Đặt & Dữ Liệu');
        await expect(page.locator('#sidebar')).toBeHidden();
        await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('.mobile-nav-item[aria-current]')).toHaveCount(0);
        expect(await page.evaluate(() => document.body.classList.contains('menu-open'))).toBe(
            false,
        );
    });

    test('đang ở trang trên thanh dưới (Sổ GD): tải lại vẫn ở đó và mục đó sáng lên', async ({
        app,
    }) => {
        const { page } = await app(phone);

        await page.click('.mobile-nav-item[data-tab="transactions"]');
        await page.reload();
        await page.waitForLoadState('load');

        await expect(page.locator('#tab-transactions')).toHaveClass(/active/);
        await expect(page.locator('.mobile-nav-item[data-tab="transactions"]')).toHaveAttribute(
            'aria-current',
            'page',
        );
        await expect(page.locator('.mobile-nav-item[aria-current]')).toHaveCount(1);
    });

    test('đầu trang vẫn cao 56px khi mở thẳng một trang có tiêu đề dài', async ({ app }) => {
        const { page } = await app(phone);

        await page.goto('/index.html#sources');
        await page.waitForLoadState('load');

        expect((await page.locator('header').boundingBox()).height).toBe(56);
    });
});
