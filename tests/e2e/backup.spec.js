// Backup export / restore.

const { test, expect, SCRIPT_URL, CORS, wait, tx, goTab } = require('./helpers');

const backupFile = (data) => ({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
        JSON.stringify({ format: 'finmanager-backup', version: 1, exportedAt: 'x', data }),
    ),
});

test.describe('Sao lưu và khôi phục', () => {
    test('khôi phục chuẩn hoá dữ liệu và đẩy lên Sheet máy này đang dùng, không chuyển sang URL trong file', async ({
        app,
    }) => {
        const IN_FILE = 'https://script.google.com/macros/s/IN_FILE/exec';
        const { page, context, state } = await app({
            seed: {
                fm_script_url: SCRIPT_URL,
                fm_transactions: JSON.stringify([tx({ id: 'TX_1' })]),
                fm_sync_baseline: SCRIPT_URL,
            },
            remote: [tx({ id: 'R1' }), tx({ id: 'R2' })],
        });
        let fileUrlHits = 0;

        await context.route('**/macros/s/IN_FILE/**', (route) => {
            fileUrlHits++;

            return route.fulfill({
                status: 200,
                headers: CORS,
                contentType: 'application/json',
                body: '[]',
            });
        });

        await goTab(page, 'settings');
        await page.setInputFiles(
            'input[type=file]',
            backupFile({
                transactions: [
                    tx({ id: 'TX_9', date: '2026-10-26T17:00:00.000Z', amount: '55000' }),
                    { junk: true },
                ],
                categories: [
                    { id: 1, name: 'Ăn uống', type: 'expense', icon: 'fa-utensils' },
                    { bad: 1 },
                ],
                initialBalances: { 'Tiền Mặt': 5 },
                scriptUrl: IN_FILE,
            }),
        );
        await wait(700);

        const local = await page.evaluate(() => ({
            list: transactions.map((t) => `${t.id}|${t.date}|${t.amount}`),
            categories: categories.length,
            url: webAppUrl,
            urlField: document.getElementById('setting-script-url').value,
            fileInput: document.querySelector('input[type=file]').value,
        }));

        expect(local.list).toEqual(['TX_9|2026-10-27|55000']);
        expect(local.categories).toBe(1);
        // The URL of the file is old news: the device keeps the deployment it already uses.
        expect(local.url).toBe(SCRIPT_URL);
        expect(local.urlField).toBe(SCRIPT_URL);
        expect(local.fileInput).toBe('');
        expect(state.remote.map((row) => row.id)).toEqual(['TX_9']);
        expect(fileUrlHits).toBe(0);
    });

    test('máy chưa có URL thì lấy URL trong file và đẩy dữ liệu lên Sheet đó', async ({ app }) => {
        const { page, state } = await app();

        expect(await page.evaluate(() => webAppUrl)).toBe('');

        await goTab(page, 'settings');
        await page.setInputFiles(
            'input[type=file]',
            backupFile({
                transactions: [tx({ id: 'TX_9' })],
                categories: [{ id: 1, name: 'Ăn uống', type: 'expense', icon: 'fa-utensils' }],
                initialBalances: {},
                scriptUrl: SCRIPT_URL,
            }),
        );
        await wait(700);

        expect(await page.evaluate(() => webAppUrl)).toBe(SCRIPT_URL);
        expect(state.remote.map((row) => row.id)).toEqual(['TX_9']);
    });

    test('máy đã có URL mà file sao lưu không có URL: giữ URL máy và vẫn thay Sheet bằng bản sao lưu', async ({
        app,
    }) => {
        const { page, state } = await app({
            seed: {
                fm_script_url: SCRIPT_URL,
                fm_transactions: JSON.stringify([tx({ id: 'TX_1' })]),
                fm_sync_baseline: SCRIPT_URL,
            },
            remote: [tx({ id: 'R1' })],
        });

        await goTab(page, 'settings');
        await page.setInputFiles(
            'input[type=file]',
            backupFile({
                transactions: [tx({ id: 'TX_9' })],
                categories: [],
                initialBalances: {},
                scriptUrl: '',
            }),
        );
        await wait(700);

        expect(await page.evaluate(() => webAppUrl)).toBe(SCRIPT_URL);
        expect(state.remote.map((row) => row.id)).toEqual(['TX_9']);
    });

    test('khôi phục bản sao lưu không có URL thì không đánh dấu thay thế Sheet', async ({
        app,
    }) => {
        const { page } = await app();

        await goTab(page, 'settings');
        await page.setInputFiles(
            'input[type=file]',
            backupFile({
                transactions: [tx({ id: 'TX_9' })],
                categories: [],
                initialBalances: {},
                scriptUrl: '',
            }),
        );
        await wait(300);

        expect(await page.evaluate(() => localStorage.getItem('fm_sync_dirty'))).toBeNull();
    });
});
