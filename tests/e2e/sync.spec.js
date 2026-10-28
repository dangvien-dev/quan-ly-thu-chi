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

    test('script trả {"status":"error"} (HTTP 200) được coi là lỗi: giữ cờ chưa đồng bộ', async ({
        app,
    }) => {
        const { page } = await app({
            seed: syncedSeed([A]),
            remote: [A],
            postResponse: '{"status":"error","message":"boom"}',
        });

        await addExpense(page, 5000, 'x');
        await wait(200);

        expect(await page.evaluate(() => localStorage.getItem('fm_sync_dirty'))).toBe('merge');
        await expect(page.locator('#sync-status')).toContainText('Lỗi');
        await expect(page.locator('#sync-status')).toHaveAttribute('title', 'boom');
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

test.describe('Tương thích với script Apps Script hiện tại của chủ repo', () => {
    // The deployed script clears the whole sheet BEFORE it reads the request body, and only
    // understands {"transactions": [...]}. Any other body wipes the data and still answers 200.

    test('dò phiên bản bằng GET trước, rồi mới ghi đúng định dạng {transactions}, Sheet không bị xóa', async ({
        app,
    }) => {
        const { page, state } = await app({ seed: syncedSeed([A]), remote: [A] });

        await addExpense(page, 5000, 'moi');
        await wait(300);

        expect(state.getUrls[0]).toContain('v=2');
        expect(state.posts).toHaveLength(1);
        expect(Object.keys(state.posts[0].body)).toEqual(['transactions']);
        expect(state.remote.map((row) => row.id)).toHaveLength(2);
        expect(state.remote.map((row) => row.note)).toContain('moi');
    });

    test('ghi lên Sheet 7 cột vẫn giữ nguồn nhận của giao dịch chuyển tiền (mã hoá trong danh mục)', async ({
        app,
    }) => {
        const { page, state } = await app({ seed: syncedSeed([A]), remote: [A] });

        await page.click('header .btn');
        await page.click('#btnTypeTransfer');
        await page.fill('#txAmount', '30000');
        await page.selectOption('#txSource', 'Tiền Mặt');
        await page.selectOption('#txTargetSource', 'Thẻ Ngân Hàng');
        await page.click('#transactionForm button[type=submit]');
        await wait(300);

        const row = state.remote.find((item) => item.type === 'transfer');

        expect(row.category).toBe('Chuyển tiền nội bộ → Thẻ Ngân Hàng');
        expect(Object.keys(row)).not.toContain('targetSource');
    });

    test('đọc lại từ Sheet 7 cột khôi phục nguồn nhận và danh mục của chuyển tiền', async ({
        app,
    }) => {
        const { page } = await app({
            remote: [
                tx({
                    id: 'T1',
                    type: 'transfer',
                    source: 'Tiền Mặt',
                    category: 'Chuyển tiền nội bộ → Thẻ Ngân Hàng',
                    amount: 50000,
                }),
            ],
        });
        const saved = await page.evaluate(() => transactions[0]);

        expect(saved).toMatchObject({
            category: 'Chuyển tiền nội bộ',
            targetSource: 'Thẻ Ngân Hàng',
        });
        await expect(
            page.locator('#sources-grid .card', { hasText: 'Thẻ Ngân Hàng' }),
        ).toContainText('50.000');
    });

    test('POST bị chặn (CORS/mạng): dùng GET ?action=save dự phòng và dữ liệu vẫn lên Sheet', async ({
        app,
    }) => {
        const { page, state } = await app({ seed: syncedSeed([A]), remote: [A], postFails: true });

        await addExpense(page, 5000, 'du-phong');
        await wait(300);

        expect(state.getUrls.some((url) => url.includes('action=save'))).toBe(true);
        expect(state.remote.map((row) => row.note)).toEqual(expect.arrayContaining(['du-phong']));
        expect(state.remote).toHaveLength(2);
        await expect(page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('POST bị chặn và dữ liệu quá lớn cho GET: không gửi gì, Sheet nguyên vẹn, báo lỗi', async ({
        app,
    }) => {
        const many = Array.from({ length: 80 }, (_, index) =>
            tx({ id: `TX_${1000000000000 + index}`, note: `ghi chú số ${index} có tiếng Việt` }),
        );
        const { page, state } = await app({
            seed: syncedSeed(many),
            remote: many,
            postFails: true,
        });

        await addExpense(page, 5000, 'moi');
        await wait(300);

        expect(state.getUrls.some((url) => url.includes('action=save'))).toBe(false);
        expect(state.remote).toHaveLength(80);
        await expect(page.locator('#sync-status')).toContainText('Lỗi');
        expect(await page.evaluate(() => localStorage.getItem('fm_sync_dirty'))).toBe('merge');
    });

    test('mọi lần ghi trong một phiên dùng đầy đủ đều là {transactions} (không bao giờ làm script xóa Sheet)', async ({
        app,
    }) => {
        const { page, state } = await app({ seed: syncedSeed([A, B]), remote: [A, B] });

        await addExpense(page, 1000, 'a');
        await addExpense(page, 2000, 'b');
        await goTransactions(page);
        await page.click('#transaction-table-body button[data-action=delete] >> nth=0');
        await page.evaluate(() => resetAllData());
        await wait(500);

        expect(state.posts.length).toBeGreaterThan(0);

        for (const post of state.posts) {
            expect(Array.isArray(post.body.transactions)).toBe(true);
            expect(Object.keys(post.body)).toEqual(['transactions']);
        }
    });
});
