// Settings warns when the app is served from a host that other sites share (GitHub Pages:
// <account>.github.io), because localStorage belongs to the origin, not to a folder.

const { test, expect, goTab, scanA11y } = require('./helpers');

test.describe('Cách ly dữ liệu theo origin', () => {
    test('chạy trên máy cục bộ: không có cảnh báo', async ({ app }) => {
        const { page } = await app({});

        await goTab(page, 'settings');
        await expect(page.locator('#origin-note')).toBeHidden();
    });

    test('chạy trên <tài khoản>.github.io: Cài đặt cảnh báo và chỉ tới README, không lộ gì khác', async ({
        app,
    }) => {
        const { page } = await app({});

        await goTab(page, 'settings');
        await page.evaluate(() => {
            currentHostname = () => 'ten-tai-khoan.github.io';
            updateSyncNote();
        });

        const note = page.locator('#origin-note');

        await expect(note).toBeVisible();
        await expect(note).toContainText('ten-tai-khoan.github.io');
        await expect(note).toContainText('tên miền riêng');
        await expect(note).toContainText('Triển khai và cách ly dữ liệu');

        // The warning goes away on an address of its own.
        await page.evaluate(() => {
            currentHostname = () => 'thuchi.example.com';
            updateSyncNote();
        });
        await expect(note).toBeHidden();
    });

    test('cảnh báo hiện lên đạt kiểm tra trợ năng', async ({ app }) => {
        const { page } = await app({});

        await goTab(page, 'settings');
        await page.evaluate(() => {
            currentHostname = () => 'ten-tai-khoan.github.io';
            updateSyncNote();
        });
        await expect(page.locator('#origin-note')).toBeVisible();

        const results = await scanA11y(page, '#tab-settings');

        expect(results.violations).toEqual([]);
    });
});
