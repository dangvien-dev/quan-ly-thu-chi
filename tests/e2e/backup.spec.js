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
    test('khôi phục chuẩn hoá dữ liệu, đẩy lên Sheet của bản sao lưu và không đụng Sheet cũ', async ({
        app,
    }) => {
        const OLD = 'https://script.google.com/macros/s/OLD/exec';
        const { page, context, state } = await app({
            seed: {
                fm_script_url: OLD,
                fm_transactions: JSON.stringify([tx({ id: 'TX_1' })]),
                fm_sync_baseline: OLD,
            },
            remote: [tx({ id: 'R1' }), tx({ id: 'R2' })],
        });
        let oldHits = 0;

        await context.route('**/macros/s/OLD/**', (route) => {
            oldHits++;

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
                scriptUrl: SCRIPT_URL,
            }),
        );
        await wait(700);

        const local = await page.evaluate(() => ({
            list: transactions.map((t) => `${t.id}|${t.date}|${t.amount}`),
            categories: categories.length,
            url: webAppUrl,
            fileInput: document.querySelector('input[type=file]').value,
        }));

        expect(local.list).toEqual(['TX_9|2026-10-27|55000']);
        expect(local.categories).toBe(1);
        expect(local.url).toBe(SCRIPT_URL);
        expect(local.fileInput).toBe('');
        expect(state.remote.map((row) => row.id)).toEqual(['TX_9']);
        expect(oldHits).toBe(0);
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
