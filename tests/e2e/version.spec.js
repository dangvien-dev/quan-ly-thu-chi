// App version: shown in the menu and Settings, the "check for a newer version" button and the bar
// that appears when a new version took over while the page was open.

const fs = require('fs');
const path = require('path');
const { test, expect, openApp, wait, scanA11y } = require('./helpers');

const VERSION = fs
    .readFileSync(path.join(__dirname, '..', '..', 'js', 'version.js'), 'utf8')
    .match(/APP_VERSION = '([^']+)'/)[1];

const answer = (page, body) =>
    page.route('**/version.json*', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'cache-control': 'no-store' },
            body: JSON.stringify(body),
        }),
    );

async function openSettings(app, options = {}) {
    const result = await app(options);

    await result.page.evaluate(() => switchTab('settings'));

    return result;
}

test.describe('Phiên bản ứng dụng', () => {
    test('hiện đúng phiên bản đã đóng dấu ở menu và trang Cài đặt', async ({ app }) => {
        const { page } = await openSettings(app);

        expect(VERSION).toMatch(/^\d{4}\.\d{2}\.\d{2}-[0-9a-f]{7}$/);
        await expect(page.locator('#app-version')).toHaveText(VERSION);
        await expect(page.locator('#sidebar-version')).toHaveText(`Phiên bản ${VERSION}`);
        expect(await page.evaluate(() => APP_VERSION)).toBe(VERSION);
    });

    test('kiểm tra bản mới: cùng phiên bản thì báo đang dùng bản mới nhất', async ({ app }) => {
        const { page } = await openSettings(app);

        await answer(page, { version: VERSION, hash: 'x' });
        await page.click('button:has-text("Kiểm tra bản mới")');

        await expect(page.locator('#update-status')).toHaveText(
            'Bạn đang dùng phiên bản mới nhất.',
        );
        await expect(page.locator('#apply-update-btn')).toBeHidden();
    });

    test('kiểm tra bản mới: khác phiên bản thì nêu phiên bản mới và hiện nút Cập nhật ngay', async ({
        app,
    }) => {
        const { page } = await openSettings(app);

        await answer(page, { version: '2099.01.01-abcdef0', hash: 'y' });
        await page.click('button:has-text("Kiểm tra bản mới")');

        await expect(page.locator('#update-status')).toContainText(
            'Có phiên bản mới 2099.01.01-abcdef0',
        );
        await expect(page.locator('#apply-update-btn')).toBeVisible();
    });

    test('kiểm tra bản mới: mất mạng hoặc phản hồi hỏng thì báo không kiểm tra được', async ({
        app,
    }) => {
        const { page } = await openSettings(app);

        await page.route('**/version.json*', (route) => route.abort());
        await page.click('button:has-text("Kiểm tra bản mới")');
        await expect(page.locator('#update-status')).toContainText('Không kiểm tra được');

        await page.unroute('**/version.json*');
        await answer(page, { lạ: true });
        await page.click('button:has-text("Kiểm tra bản mới")');
        await expect(page.locator('#update-status')).toContainText('Không kiểm tra được');
        await expect(page.locator('#apply-update-btn')).toBeHidden();
    });

    test('Cập nhật ngay tải lại trang', async ({ app }) => {
        const { page } = await openSettings(app);

        await answer(page, { version: '2099.01.01-abcdef0', hash: 'y' });
        await page.click('button:has-text("Kiểm tra bản mới")');
        await expect(page.locator('#apply-update-btn')).toBeVisible();

        await Promise.all([
            page.waitForEvent('load', { timeout: 8000 }),
            page.click('#apply-update-btn'),
        ]);

        await expect(page.locator('#sidebar-version')).toHaveText(`Phiên bản ${VERSION}`);
    });

    test('dòng trạng thái không đè lên dòng "Đang chạy"; nút Tải lại không bị xuống dòng trên điện thoại', async ({
        app,
    }) => {
        const { page } = await openSettings(app, { viewport: { width: 390, height: 844 } });

        await answer(page, { version: '2099.01.01-abcdef0', hash: 'y' });
        await page.click('button:has-text("Kiểm tra bản mới")');
        await page.evaluate(() => showUpdateBanner());
        await expect(page.locator('#update-status')).toContainText('Có phiên bản mới');

        const running = await page.locator('#app-version').locator('xpath=..').boundingBox();
        const status = await page.locator('#update-status').boundingBox();
        const button = await page.locator('#update-banner button').boundingBox();

        expect(status.y).toBeGreaterThanOrEqual(running.y + running.height);
        // One line of text: the button is no taller than a single line plus its padding.
        expect(button.height).toBeLessThan(48);
    });

    test('thẻ phiên bản không vi phạm trợ năng (cả khi có thông báo cập nhật)', async ({ app }) => {
        const { page } = await openSettings(app);

        await answer(page, { version: '2099.01.01-abcdef0', hash: 'y' });
        await page.click('button:has-text("Kiểm tra bản mới")');
        await page.evaluate(() => showUpdateBanner());

        const results = await scanA11y(page);

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
});

test.describe('Service worker và thông báo có bản mới', () => {
    test('có bản mới tiếp quản khi trang đang mở thì hiện thanh "Tải lại"; lần cài đầu thì không', async ({
        browser,
    }) => {
        const { context, page } = await openApp(browser, { serviceWorkers: 'allow' });

        try {
            await page.evaluate(() => navigator.serviceWorker.ready);

            // First install: the worker only claims a page that had none; nothing to announce.
            await page.evaluate(() =>
                navigator.serviceWorker.dispatchEvent(new Event('controllerchange')),
            );
            await expect(page.locator('#update-banner')).toBeHidden();

            // From the next load the page is controlled, so a takeover means a newer version.
            await page.reload();
            await wait(300);
            expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(
                true,
            );

            await page.evaluate(() =>
                navigator.serviceWorker.dispatchEvent(new Event('controllerchange')),
            );
            await expect(page.locator('#update-banner')).toBeVisible();
            await expect(page.locator('#update-banner')).toContainText('Đã có phiên bản mới');

            await Promise.all([page.waitForEvent('load'), page.click('#update-banner button')]);
            await expect(page.locator('#update-banner')).toBeHidden();
        } finally {
            await context.close();
        }
    });

    test('version.json không bị service worker lưu lại: lần kiểm tra sau thấy bản mới hơn', async ({
        browser,
    }) => {
        const { context, page } = await openApp(browser, { serviceWorkers: 'allow' });
        let latest = VERSION;

        try {
            await page.evaluate(() => navigator.serviceWorker.ready);
            await page.reload();
            await wait(300);
            await page.evaluate(() => switchTab('settings'));
            await context.route('**/version.json*', (route) =>
                route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ version: latest, hash: 'z' }),
                }),
            );

            await page.click('button:has-text("Kiểm tra bản mới")');
            await expect(page.locator('#update-status')).toContainText('mới nhất');

            latest = '2099.12.31-fffffff';
            await page.click('button:has-text("Kiểm tra bản mới")');
            await expect(page.locator('#update-status')).toContainText('2099.12.31-fffffff');
        } finally {
            await context.close();
        }
    });
});
