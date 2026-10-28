// Google Sheets synchronization against the legacy (v1) Apps Script protocol: the whole list is
// read with GET and replaced with POST {action: 'save', data}.

const {
    test,
    expect,
    SCRIPT_URL,
    CORS,
    wait,
    tx,
    syncedSeed,
    goTransactions,
    addExpense,
} = require('./helpers');

const A = tx({ id: 'TX_1000000000001' });
const B = tx({ id: 'TX_1000000000002' });
const C = tx({ id: 'TX_1000000000003', note: 'tu may khac' });

test.describe('Đồng bộ Google Sheets (giao thức v1)', () => {
    test('POST dùng text/plain để không gây CORS preflight', async ({ app }) => {
        const { page, state } = await app({ seed: syncedSeed([A]), remote: [A] });

        await addExpense(page, 20000);
        await wait(300);

        expect(state.posts[0].contentType).toMatch(/^text\/plain/);
    });

    test('xóa giao dịch cuối cùng được đẩy lên Sheet', async ({ app }) => {
        const { page, state } = await app({ seed: syncedSeed([A]), remote: [A] });

        await goTransactions(page);
        await page.click('#transaction-table-body button[data-action=delete]');
        await wait(300);

        expect(state.remote).toEqual([]);
    });

    test('"Xóa toàn bộ dữ liệu" xóa cả trên Sheet', async ({ app }) => {
        const { page, state } = await app({ seed: syncedSeed([A]), remote: [A] });

        await page.evaluate(() => resetAllData());
        await wait(300);

        expect(state.remote).toEqual([]);
    });

    test('thiết bị mới: nhập giao dịch khi đang tải không ghi đè dữ liệu Sheet', async ({
        app,
    }) => {
        const remote = [tx({ id: 'R1' }), tx({ id: 'R2' }), tx({ id: 'R3' })];
        const { page, state } = await app({
            seed: { fm_script_url: SCRIPT_URL },
            remote,
            getDelay: 700,
            settle: 0,
        });

        await page.click('header .btn');
        await page.fill('#txAmount', '20000');
        await page.click('#transactionForm button[type=submit]');
        await wait(1800);

        const ids = state.remote.map((row) => row.id);

        expect(ids).toEqual(expect.arrayContaining(['R1', 'R2', 'R3']));
        expect(ids).toHaveLength(4);
    });

    test('mất mạng khi tải: không đẩy dữ liệu local lên đè Sheet', async ({ app }) => {
        const { page, state } = await app({
            seed: syncedSeed([tx({ id: 'L1' })]),
            remote: [tx({ id: 'R1' }), tx({ id: 'R2' })],
            getFails: true,
        });

        await addExpense(page, 20000);
        await wait(300);

        expect(state.posts).toHaveLength(0);
        expect(state.remote).toHaveLength(2);
    });

    test('thay đổi lúc offline được giữ và đẩy lên ở lần mở sau', async ({ app }) => {
        const opts = {
            seed: {
                fm_script_url: SCRIPT_URL,
                fm_transactions: JSON.stringify([tx({ id: 'L1' })]),
            },
            remote: [tx({ id: 'L1' })],
            getFails: true,
        };
        const { page, state } = await app(opts);

        await addExpense(page, 20000);
        opts.getFails = false;
        await page.reload();
        await wait(500);

        expect(state.remote).toHaveLength(2);
        expect(await page.evaluate(() => transactions.length)).toBe(2);
    });

    test('Sheet có dữ liệu, máy trống, đã có URL: tải về đầy đủ', async ({ app }) => {
        const { page } = await app({
            seed: { fm_script_url: SCRIPT_URL },
            remote: [tx({ id: 'R1' }), tx({ id: 'R2' })],
        });

        expect(await page.evaluate(() => transactions.length)).toBe(2);
    });

    test('hai thiết bị: xóa offline vẫn là đã xóa, giao dịch mới của máy khác được giữ', async ({
        app,
    }) => {
        const { page, state } = await app({
            seed: syncedSeed([B], {
                fm_sync_dirty: 'merge',
                fm_deleted_ids: JSON.stringify([A.id]),
            }),
            remote: [A, B, C],
        });

        await wait(300);

        const wanted = [B.id, C.id].sort();

        expect(state.remote.map((row) => row.id).sort()).toEqual(wanted);
        expect((await page.evaluate(() => transactions.map((t) => t.id))).sort()).toEqual(wanted);
    });

    test('đã đồng bộ sạch: sửa/xóa từ máy khác được áp dụng, không đẩy gì lên', async ({ app }) => {
        const { page, state } = await app({
            seed: syncedSeed([tx({ ...A, amount: 1000 }), tx({ ...B, amount: 2000 })]),
            remote: [{ ...B, amount: 7777 }],
        });

        await wait(300);

        expect(await page.evaluate(() => transactions.map((t) => `${t.id}:${t.amount}`))).toEqual([
            `${B.id}:7777`,
        ]);
        expect(state.posts).toHaveLength(0);
    });

    test('đẩy thành công thì dọn cờ chưa đồng bộ và danh sách đã xóa', async ({ app }) => {
        const { page } = await app({ seed: syncedSeed([A, B]), remote: [A, B] });

        await goTransactions(page);
        await page.click('#transaction-table-body button[data-action=delete] >> nth=0');
        await wait(300);

        const flags = await page.evaluate(() => ({
            dirty: localStorage.getItem('fm_sync_dirty'),
            deleted: localStorage.getItem('fm_deleted_ids'),
        }));

        expect(flags).toEqual({ dirty: null, deleted: null });
        await expect(page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('hai thay đổi liên tiếp khi đang đẩy: Sheet cuối cùng có đủ cả hai', async ({ app }) => {
        const { page, state } = await app({ seed: syncedSeed([A]), remote: [A] });

        await page.evaluate(() => {
            const original = window.fetch;

            window.fetch = (url, options) =>
                options && options.method === 'POST'
                    ? new Promise((resolve) => setTimeout(resolve, 400)).then(() =>
                          original(url, options),
                      )
                    : original(url, options);
        });
        await addExpense(page, 5000, 'mot');
        await addExpense(page, 6000, 'hai');
        await wait(1500);

        expect(state.remote).toHaveLength(3);
        expect(state.remote.map((row) => row.note)).toEqual(expect.arrayContaining(['mot', 'hai']));
    });

    test('đẩy thất bại: giữ cờ chưa đồng bộ và hiện "Lỗi kết nối"', async ({ app }) => {
        const { page } = await app({ seed: syncedSeed([A]), remote: [A], postFails: true });

        await addExpense(page, 5000, 'x');
        await wait(200);

        expect(await page.evaluate(() => localStorage.getItem('fm_sync_dirty'))).toBe('merge');
        await expect(page.locator('#sync-status')).toContainText('Lỗi');
        expect(await page.evaluate(() => transactions.length)).toBe(2);
    });

    test('lưu URL mới: đọc Sheet về trước, không đẩy dữ liệu máy đè lên', async ({ app }) => {
        const { page, state } = await app({
            seed: { fm_transactions: JSON.stringify([tx({ id: 'L1' })]) },
            remote: [tx({ id: 'R1' }), tx({ id: 'R2' })],
        });

        await page.click('aside .menu li[data-tab="settings"]');
        await page.fill('#setting-script-url', `  ${SCRIPT_URL}  `);
        await page.click('button:has-text("Lưu Cấu Hình")');
        await wait(500);

        expect(state.remote.map((row) => row.id).sort()).toEqual(['L1', 'R1', 'R2']);
        expect(await page.evaluate(() => webAppUrl)).toBe(SCRIPT_URL);
    });
});
