// Synchronization protocol v2 against apps-script/Code.gs, including several "devices" (browser
// contexts) that share one server.

const {
    test,
    expect,
    newServer,
    serverRows,
    SCRIPT_URL,
    wait,
    tx,
    syncedSeed,
    goTab,
    goTransactions,
    addExpense,
} = require('./helpers');

const T0 = '2026-10-28T01:00:00.000Z';
const row = (id, overrides = {}) => tx({ id, updatedAt: T0, note: `ghi chu ${id}`, ...overrides });
const meta = (value, updatedAt = T0) => ({ value, updatedAt });
const lastBody = (state) => state.posts.at(-1).body;
const pending = (page) =>
    page.evaluate(() => ({
        upserts: JSON.parse(localStorage.getItem('fm_pending_upserts') || '[]'),
        deleted: JSON.parse(localStorage.getItem('fm_deleted_ids') || '[]'),
        meta: JSON.parse(localStorage.getItem('fm_pending_meta') || '[]'),
        dirty: localStorage.getItem('fm_sync_dirty'),
    }));

test.describe('Giao thức v2: đọc và ghi từng dòng', () => {
    test('nhận diện v2, tải giao dịch và các loại dữ liệu meta từ server', async ({ app }) => {
        const server = newServer('v2', { rows: [row('TX_1')] });

        server.post({
            action: 'sync',
            meta: {
                categories: meta([
                    { id: 1, name: 'Ăn uống', type: 'expense', icon: 'fa-utensils' },
                    { id: 99, name: 'Đồ nghề', type: 'expense', icon: 'fa-tag' },
                ]),
                budgets: meta({ 'Đồ nghề': 500000 }),
                initialBalances: meta({ 'Tiền Mặt': 250000 }),
            },
        });

        const { page } = await app({ server });

        expect(await page.evaluate(() => syncProtocol)).toBe('v2');
        expect(await page.evaluate(() => transactions.map((t) => t.id))).toEqual(['TX_1']);
        expect(await page.evaluate(() => categories.map((c) => c.name))).toContain('Đồ nghề');
        expect(await page.evaluate(() => budgets)).toEqual({ 'Đồ nghề': 500000 });
        await goTab(page, 'sources');
        await expect(
            page.locator('#sources-grid .card', { hasText: 'Tiền Mặt' }).locator('.card-value'),
        ).toHaveText('249.000 đ');
        await goTab(page, 'settings');
        await expect(page.locator('#sync-protocol-note')).toContainText('Apps Script v2');
        await expect(page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('thêm giao dịch chỉ gửi đúng dòng đó, không gửi cả danh sách', async ({ app }) => {
        const rows = [row('TX_1'), row('TX_2'), row('TX_3')];
        const server = newServer('v2', { rows });
        const { page, state } = await app({ server, seed: syncedSeed(rows) });

        await addExpense(page, 5000, 'moi');
        await wait(300);

        const body = lastBody(state);

        expect(body.action).toBe('sync');
        expect(body.replace).toBe(false);
        expect(body.upserts).toHaveLength(1);
        expect(body.upserts[0]).toMatchObject({ note: 'moi', amount: 5000 });
        expect(body.upserts[0].updatedAt).toBeTruthy();
        expect(body.deletes).toEqual([]);
        expect(body.meta).toEqual({});
        expect(serverRows(server)).toHaveLength(4);
        expect(await pending(page)).toEqual({ upserts: [], deleted: [], meta: [], dirty: null });
    });

    test('xóa giao dịch chỉ gửi id bị xóa', async ({ app }) => {
        const rows = [row('TX_1'), row('TX_2')];
        const server = newServer('v2', { rows });
        const { page, state } = await app({ server, seed: syncedSeed(rows) });

        await goTransactions(page);
        await page.click(
            '#transaction-table-body tr:has-text("ghi chu TX_1") [data-action=delete]',
        );
        await wait(300);

        expect(lastBody(state)).toMatchObject({ deletes: ['TX_1'], upserts: [] });
        expect(serverRows(server).map((item) => item.id)).toEqual(['TX_2']);
    });

    test('sửa một giao dịch cập nhật đúng dòng đó và đóng dấu updatedAt mới', async ({ app }) => {
        const rows = [row('TX_1', { amount: 1000 }), row('TX_2')];
        const server = newServer('v2', { rows });
        const { page } = await app({ server, seed: syncedSeed(rows), now: '2026-10-28T03:00:00Z' });

        await goTransactions(page);
        await page.click('#transaction-table-body tr:has-text("ghi chu TX_1") [data-action=edit]');
        await page.fill('#txAmount', '7000');
        await page.click('#transactionForm button[type=submit]');
        await wait(300);

        const saved = serverRows(server).find((item) => item.id === 'TX_1');

        expect(saved.amount).toBe(7000);
        expect(saved.updatedAt).toBe('2026-10-28T03:00:00.000Z');
        expect(serverRows(server).find((item) => item.id === 'TX_2').amount).toBe(1000);
    });

    test('thêm danh mục gửi lên Meta của server', async ({ app }) => {
        const server = newServer('v2');
        const { page, state } = await app({ server, seed: syncedSeed([]) });

        await goTab(page, 'categories');
        await page.evaluate(() => openCategoryModal());
        await page.fill('#catName', 'Đồ nghề');
        await page.click('#categoryModal button[type=submit]');
        await wait(300);

        expect(Object.keys(lastBody(state).meta)).toEqual(['categories']);
        expect(server.get({ v: '2' }).meta.categories.value.map((c) => c.name)).toContain(
            'Đồ nghề',
        );
        expect(await pending(page)).toMatchObject({ meta: [], dirty: null });
    });

    test('POST bị chặn: dùng GET ?action=sync dự phòng và dữ liệu vẫn lên server', async ({
        app,
    }) => {
        const server = newServer('v2');
        const { page, state } = await app({ server, seed: syncedSeed([]), postFails: true });

        await addExpense(page, 5000, 'du-phong');
        await wait(300);

        expect(state.getUrls.some((url) => url.includes('action=sync'))).toBe(true);
        expect(serverRows(server).map((item) => item.note)).toEqual(['du-phong']);
    });

    test('hai thay đổi liên tiếp khi đang đẩy: cả hai lên server, hàng chờ sạch, không lặp vô hạn', async ({
        app,
    }) => {
        const server = newServer('v2');
        const { page, state } = await app({ server, seed: syncedSeed([]) });

        await page.evaluate(() => {
            const original = window.fetch;

            window.fetch = (url, options) =>
                options && options.method === 'POST'
                    ? new Promise((resolve) => setTimeout(resolve, 400)).then(() =>
                          original(url, options),
                      )
                    : original(url, options);
        });
        await addExpense(page, 1000, 'mot');
        await addExpense(page, 2000, 'hai');
        await wait(1800);

        expect(
            serverRows(server)
                .map((item) => item.note)
                .sort(),
        ).toEqual(['hai', 'mot']);
        expect(state.posts.length).toBeLessThanOrEqual(3);
        expect(await pending(page)).toEqual({ upserts: [], deleted: [], meta: [], dirty: null });
    });

    test('mất mạng: giữ thay đổi và đẩy lên ở lần mở sau', async ({ app }) => {
        const server = newServer('v2');
        const opts = { server, seed: syncedSeed([]), getFails: true, postFails: true };
        const { page } = await app(opts);

        await addExpense(page, 5000, 'offline');
        await wait(200);

        expect(serverRows(server)).toEqual([]);
        expect((await pending(page)).upserts).toHaveLength(1);

        opts.getFails = false;
        opts.postFails = false;
        await page.reload();
        await wait(500);

        expect(serverRows(server).map((item) => item.note)).toEqual(['offline']);
        expect(await pending(page)).toEqual({ upserts: [], deleted: [], meta: [], dirty: null });
    });
});

test.describe('Giao thức v2: nhiều thiết bị', () => {
    test('máy B nhận nguồn tiền, ngân sách, danh mục, định kỳ và vay nợ do máy A tạo', async ({
        app,
    }) => {
        const server = newServer('v2');
        const a = await app({ server, now: '2026-10-28T03:00:00Z' });

        await a.page.evaluate(() => {
            sources.push(normalizeSource({ name: 'Momo', kind: 'ewallet' }));
            saveMeta('sources');
            budgets['Ăn uống'] = 1000000;
            saveMeta('budgets');
            categories.push({ id: 77, name: 'Đồ nghề', type: 'expense', icon: 'fa-tag' });
            saveMeta('categories');
            recurring.push(
                normalizeRecurringRule({
                    id: 'RC_1',
                    name: 'Tiền nhà',
                    type: 'expense',
                    source: 'Momo',
                    category: 'Đồ nghề',
                    amount: 100,
                    frequency: 'monthly',
                    day: 31,
                    startDate: '2026-12-01',
                }),
            );
            saveMeta('recurring');
            debts.push(
                normalizeDebt({ id: 'DB_1', party: 'Anh Nam', amount: 500, direction: 'owe' }),
            );
            saveMeta('debts');
            syncToGoogleSheet();
        });
        await wait(400);

        const b = await app({ server, now: '2026-10-28T05:00:00Z' });
        const seen = await b.page.evaluate(() => ({
            sources: sources.map((s) => s.name),
            budgets,
            categories: categories.map((c) => c.name),
            recurring: recurring.map((r) => r.name),
            debts: debts.map((d) => d.party),
        }));

        expect(seen.sources).toContain('Momo');
        expect(seen.budgets).toEqual({ 'Ăn uống': 1000000 });
        expect(seen.categories).toContain('Đồ nghề');
        expect(seen.recurring).toEqual(['Tiền nhà']);
        expect(seen.debts).toEqual(['Anh Nam']);
    });

    test('máy B xóa giao dịch: máy A đang sạch nhận được việc xóa khi mở lại', async ({ app }) => {
        const rows = [row('TX_1'), row('TX_2')];
        const server = newServer('v2', { rows });
        const a = await app({ server, seed: syncedSeed(rows) });
        const b = await app({ server, seed: syncedSeed(rows) });

        await goTransactions(b.page);
        await b.page.click(
            '#transaction-table-body tr:has-text("ghi chu TX_1") [data-action=delete]',
        );
        await wait(300);
        await a.page.reload();
        await wait(300);

        expect(await a.page.evaluate(() => transactions.map((t) => t.id))).toEqual(['TX_2']);
    });

    test('hai máy sửa cùng giao dịch: bản có updatedAt mới hơn thắng ở cả hai máy', async ({
        app,
    }) => {
        const rows = [row('TX_1', { amount: 1000 })];
        const server = newServer('v2', { rows });
        const edit = async (device, amount) => {
            await goTransactions(device.page);
            await device.page.click('#transaction-table-body [data-action=edit]');
            await device.page.fill('#txAmount', String(amount));
            await device.page.click('#transactionForm button[type=submit]');
            await wait(300);
        };
        const a = await app({ server, seed: syncedSeed(rows), now: '2026-10-28T03:00:00Z' });
        const b = await app({ server, seed: syncedSeed(rows), now: '2026-10-28T05:00:00Z' });

        await edit(a, 2000); // 03:00
        await edit(b, 3000); // 05:00, newer
        await a.page.reload();
        await wait(300);

        expect(serverRows(server)[0].amount).toBe(3000);
        expect(await a.page.evaluate(() => transactions[0].amount)).toBe(3000);
        expect(await b.page.evaluate(() => transactions[0].amount)).toBe(3000);
    });

    test('bản sửa cũ hơn đến sau không ghi đè bản mới, và máy gửi nhận lại bản mới', async ({
        app,
    }) => {
        const rows = [row('TX_1', { amount: 1000 })];
        const server = newServer('v2', { rows });
        const edit = async (device, amount) => {
            await goTransactions(device.page);
            await device.page.click('#transaction-table-body [data-action=edit]');
            await device.page.fill('#txAmount', String(amount));
            await device.page.click('#transactionForm button[type=submit]');
            await wait(300);
        };
        const a = await app({ server, seed: syncedSeed(rows), now: '2026-10-28T05:00:00Z' });
        const b = await app({ server, seed: syncedSeed(rows), now: '2026-10-28T02:00:00Z' });

        await edit(a, 2000); // 05:00 reaches the server first
        await edit(b, 9999); // 02:00, older, arrives later

        expect(serverRows(server)[0].amount).toBe(2000);
        expect(await b.page.evaluate(() => transactions[0].amount)).toBe(2000);
    });

    test('quy tắc định kỳ đồng bộ sang máy khác mà không tạo trùng giao dịch', async ({ app }) => {
        const server = newServer('v2');
        const a = await app({ server, now: '2026-10-28T03:00:00Z' });

        await a.page.evaluate(() => {
            recurring.push(
                normalizeRecurringRule({
                    id: 'RC_1730000000000',
                    name: 'Tiền nhà',
                    type: 'expense',
                    source: 'Tiền Mặt',
                    category: 'Hóa đơn & Tiện ích',
                    amount: 500000,
                    frequency: 'monthly',
                    day: 5,
                    startDate: '2026-08-05',
                }),
            );
            saveMeta('recurring');
            generateRecurringTransactions();
        });
        await wait(500);

        expect(serverRows(server)).toHaveLength(3);

        const b = await app({ server, now: '2026-10-28T05:00:00Z' });

        await wait(300);

        expect(await b.page.evaluate(() => transactions.length)).toBe(3);
        expect(await b.page.evaluate(() => recurring[0].lastGenerated)).toBe('2026-10-05');
        expect(serverRows(server)).toHaveLength(3);
    });
});

test.describe('Giao thức v2: lần đầu kết nối', () => {
    test('server trống, máy có dữ liệu: đẩy lên cả giao dịch lẫn danh mục tự tạo', async ({
        app,
    }) => {
        const server = newServer('v2');
        const { page } = await app({
            server,
            seed: {
                fm_transactions: JSON.stringify([row('TX_1'), row('TX_2')]),
                fm_categories: JSON.stringify([
                    { id: 1, name: 'Ăn uống', type: 'expense', icon: 'fa-utensils' },
                    { id: 9, name: 'Đồ nghề', type: 'expense', icon: 'fa-tag' },
                ]),
            },
        });

        await wait(400);

        expect(
            serverRows(server)
                .map((item) => item.id)
                .sort(),
        ).toEqual(['TX_1', 'TX_2']);
        expect(server.get({ v: '2' }).meta.categories.value.map((c) => c.name)).toContain(
            'Đồ nghề',
        );
        expect(await pending(page)).toEqual({ upserts: [], deleted: [], meta: [], dirty: null });
    });

    test('cả hai bên đều có danh mục riêng: gộp chứ không ghi đè', async ({ app }) => {
        const server = newServer('v2');

        server.post({
            action: 'sync',
            meta: {
                categories: meta([{ id: 5, name: 'Từ server', type: 'expense', icon: 'fa-tag' }]),
            },
        });

        const { page } = await app({
            server,
            seed: {
                fm_categories: JSON.stringify([
                    { id: 8, name: 'Từ máy', type: 'expense', icon: 'fa-tag' },
                ]),
            },
        });

        await wait(400);

        const names = await page.evaluate(() => categories.map((c) => c.name));

        expect(names).toEqual(expect.arrayContaining(['Từ server', 'Từ máy']));
        expect(server.get({ v: '2' }).meta.categories.value.map((c) => c.name)).toEqual(
            expect.arrayContaining(['Từ server', 'Từ máy']),
        );
    });

    test('nâng cấp từ script cũ: Sheet 7 cột có chuyển tiền mã hoá trong danh mục được đọc và ghi lại đúng', async ({
        app,
    }) => {
        const server = newServer('v2', {
            rows: [
                {
                    id: 'T1',
                    date: '2026-10-27',
                    type: 'transfer',
                    source: 'Tiền Mặt',
                    category: 'Chuyển tiền nội bộ → Thẻ Ngân Hàng',
                    amount: 50000,
                    note: '',
                },
                {
                    id: 'T2',
                    date: '2026-10-26',
                    type: 'expense',
                    source: 'Spaylater',
                    category: 'Ăn uống',
                    amount: 17000,
                    note: 'cafe',
                },
            ],
        });
        const { page } = await app({ server });

        expect(await page.evaluate(() => transactions.find((t) => t.id === 'T1'))).toMatchObject({
            category: 'Chuyển tiền nội bộ',
            targetSource: 'Thẻ Ngân Hàng',
        });

        await addExpense(page, 1000, 'moi');
        await wait(400);

        const migrated = serverRows(server).find((item) => item.id === 'T1');

        expect(migrated.category).toBe('Chuyển tiền nội bộ');
        expect(migrated.targetSource).toBe('Thẻ Ngân Hàng');
        expect(serverRows(server)).toHaveLength(3);
    });
});

test.describe('Giao thức v2: thay thế toàn bộ', () => {
    test('"Xóa toàn bộ dữ liệu" xóa giao dịch trên server, không lặp đẩy mãi', async ({ app }) => {
        const rows = [row('TX_1'), row('TX_2')];
        const server = newServer('v2', { rows });
        const { page, state } = await app({ server, seed: syncedSeed(rows) });

        await page.evaluate(() => resetAllData());
        await wait(800);

        expect(serverRows(server)).toEqual([]);
        expect(state.posts.length).toBeLessThanOrEqual(2);
        expect(await pending(page)).toEqual({ upserts: [], deleted: [], meta: [], dirty: null });
    });

    test('khôi phục sao lưu thay toàn bộ giao dịch và dữ liệu meta trên server', async ({
        app,
    }) => {
        const rows = [row('TX_1'), row('TX_2')];
        const server = newServer('v2', { rows });

        server.post({
            action: 'sync',
            meta: { budgets: meta({ 'Ăn uống': 1 }, '2026-10-28T23:00:00.000Z') },
        });

        const { page } = await app({ server, seed: syncedSeed(rows) });

        await goTab(page, 'settings');
        await page.setInputFiles('input[type=file]', {
            name: 'b.json',
            mimeType: 'application/json',
            buffer: Buffer.from(
                JSON.stringify({
                    format: 'finmanager-backup',
                    version: 1,
                    exportedAt: 'x',
                    data: {
                        transactions: [row('TX_9')],
                        categories: [
                            { id: 1, name: 'Ăn uống', type: 'expense', icon: 'fa-utensils' },
                        ],
                        initialBalances: {},
                        budgets: { 'Đi lại': 2 },
                        scriptUrl: SCRIPT_URL,
                    },
                }),
            ),
        });
        await wait(600);

        expect(serverRows(server).map((item) => item.id)).toEqual(['TX_9']);
        expect(server.get({ v: '2' }).meta.budgets.value).toEqual({ 'Đi lại': 2 });
    });
});

test.describe('Giao thức v2: mã bảo vệ (token)', () => {
    const rows = [row('TX_1')];

    test('thiếu token: hiện "Sai mã bảo vệ", không đọc không ghi', async ({ app }) => {
        const server = newServer('v2', { rows, properties: { FM_TOKEN: 'bi-mat' } });
        const { page, state } = await app({ server });

        await expect(page.locator('#sync-status')).toContainText('Sai mã bảo vệ');
        expect(await page.evaluate(() => transactions.length)).toBe(0);

        await addExpense(page, 5000, 'khoa');
        await wait(300);

        expect(state.posts).toHaveLength(0);
        expect(serverRows(server)).toHaveLength(1);
    });

    test('nhập token trong Cài đặt rồi lưu thì đồng bộ được, giữ cả dữ liệu đã nhập khi bị khóa', async ({
        app,
    }) => {
        const server = newServer('v2', { rows, properties: { FM_TOKEN: 'bi-mat' } });
        const { page } = await app({ server });

        await addExpense(page, 5000, 'khoa');
        await goTab(page, 'settings');
        await page.fill('#setting-script-token', 'bi-mat');
        await page.click('button:has-text("Lưu Cấu Hình")');
        await wait(600);

        await expect(page.locator('#sync-status')).toContainText('Đã lưu');
        expect(
            serverRows(server)
                .map((item) => item.note)
                .sort(),
        ).toEqual(['khoa', 'ghi chu TX_1'].sort());
        expect(await page.evaluate(() => localStorage.getItem('fm_script_token'))).toBe('bi-mat');

        await page.reload();
        await expect(page.locator('#setting-script-token')).toHaveValue('bi-mat');
    });

    test('token sai: bị từ chối và server không thay đổi', async ({ app }) => {
        const server = newServer('v2', { rows, properties: { FM_TOKEN: 'bi-mat' } });
        const { page } = await app({ server, seed: { fm_script_token: 'sai-roi' } });

        await expect(page.locator('#sync-status')).toContainText('Sai mã bảo vệ');
        await expect(page.locator('#sync-status')).toHaveAttribute('title', /mã bảo vệ/);
        expect(serverRows(server).map((item) => item.id)).toEqual(['TX_1']);
    });

    test('token không nằm trong file sao lưu', async ({ app }) => {
        const server = newServer('v2', { rows, properties: { FM_TOKEN: 'bi-mat' } });
        const { page } = await app({ server, seed: { fm_script_token: 'bi-mat' } });
        const backup = await page.evaluate(
            () =>
                new Promise((resolve) => {
                    const original = URL.createObjectURL;

                    URL.createObjectURL = (blob) => {
                        blob.text().then(resolve);

                        return original.call(URL, blob);
                    };
                    exportBackup();
                }),
        );

        expect(backup).not.toContain('bi-mat');
    });
});

test.describe('Script cũ vẫn dùng được', () => {
    test('với script cũ, đổi danh mục không kích hoạt ghi lên Sheet và ghi chú giải thích hiện ra', async ({
        app,
    }) => {
        const { page, state } = await app({
            remote: [row('TX_1')],
            seed: syncedSeed([row('TX_1')]),
        });

        await goTab(page, 'categories');
        await page.evaluate(() => openCategoryModal());
        await page.fill('#catName', 'Đồ nghề');
        await page.click('#categoryModal button[type=submit]');
        await wait(300);

        expect(state.posts).toHaveLength(0);
        await goTab(page, 'settings');
        await expect(page.locator('#sync-protocol-note')).toContainText('phiên bản cũ');
    });
});
