// Robustness against hostile or corrupted data.

const { test, expect, tx, goTransactions, wait } = require('./helpers');

test.describe('Dữ liệu độc hại hoặc hỏng', () => {
    test('ghi chú và danh mục chứa HTML không bị thực thi (XSS)', async ({ app }) => {
        const evil = tx({
            note: '<img src=x onerror="window.__xss=1">',
            category: '<b id="pwn">x</b>',
        });
        const { page } = await app({ seed: { fm_transactions: JSON.stringify([evil]) } });

        await wait(200);

        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
        await expect(page.locator('#pwn')).toHaveCount(0);
    });

    test('id chứa dấu nháy không phá nút sửa (injection)', async ({ app }) => {
        const evil = tx({ id: "a');window.__idxss=1;('" });
        const { page } = await app({ seed: { fm_transactions: JSON.stringify([evil]) } });

        await goTransactions(page);
        await page.click('#transaction-table-body button[data-action=edit]');

        expect(await page.evaluate(() => window.__idxss)).toBeUndefined();
        await expect(page.locator('#transactionModal')).toHaveClass(/open/);
    });

    test('localStorage hỏng JSON không làm app chết, bản hỏng được giữ lại', async ({ app }) => {
        const { page, state } = await app({
            seed: { fm_transactions: '{bad json', fm_categories: 'nope' },
        });

        await expect(page.locator('#category-table-body tr')).toHaveCount(6);
        expect(state.errors).toEqual([]);
        expect(await page.evaluate(() => localStorage.getItem('fm_transactions.corrupt'))).toBe(
            '{bad json',
        );
    });

    test('URL Apps Script không phải https bị từ chối', async ({ app }) => {
        const { page, state } = await app();

        await page.click('aside .menu li[data-tab="settings"]');
        await page.fill('#setting-script-url', 'javascript:alert(1)');
        await page.click('button:has-text("Lưu Cấu Hình")');

        expect(await page.evaluate(() => webAppUrl)).toBe('');
        expect(state.alerts).toHaveLength(1);
    });

    test('app không cần tài nguyên bên ngoài nào (chạy hoàn toàn offline được)', async ({
        app,
    }) => {
        const { state } = await app();

        expect(state.external).toEqual([]);
    });
});
