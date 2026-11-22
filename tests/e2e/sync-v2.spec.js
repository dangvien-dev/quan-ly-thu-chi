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
const TOKEN = 'bi-mat';
const inflight = (page) => page.evaluate(() => localStorage.getItem('fm_sync_inflight'));
const replaces = (state) => state.posts.filter((post) => post.body.replace === true).length;
const notesOf = (rows) => rows.map((item) => item.note).sort();

const URL_B = 'https://script.google.com/macros/s/OTHER/exec';
const idsOf = (rows) => rows.map((item) => item.id).sort();

/** The warning is on the page now, and still there after a reload (it is not just a toast). */
async function expectReviewKept(page, text) {
    await expect(page.locator('#sync-review')).toBeVisible();
    await expect(page.locator('#sync-review-list')).toContainText(text);
    await page.reload();
    await expect(page.locator('#sync-review')).toBeVisible();
    await expect(page.locator('#sync-review-list')).toContainText(text);
}

/** Restores a backup holding `rows` on a device: the app sends a replace of everything. */
async function restoreBackup(page, rows) {
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
                    transactions: rows,
                    categories: [{ id: 1, name: 'Ăn uống', type: 'expense', icon: 'fa-utensils' }],
                    initialBalances: {},
                    scriptUrl: SCRIPT_URL,
                },
            }),
        ),
    });
    await wait(600);
}

/**
 * The next `method` ('setItem' | 'removeItem') of this key on localStorage throws, once: a crash or a
 * full disk at that very step. A reload then plays "the app was opened again".
 */
function failStorageOnce(page, method, key) {
    return page.evaluate(
        ([which, name]) => {
            const original = Storage.prototype[which];
            let thrown = false;

            Storage.prototype[which] = function (entry, ...rest) {
                if (!thrown && entry === name) {
                    thrown = true;
                    throw new Error('QuotaExceededError (test)');
                }

                return original.call(this, entry, ...rest);
            };
        },
        [method, key],
    );
}

/** Behaves like a Code.gs that predates request ids: replies carry neither applied nor revision. */
function withoutRequestIds(server) {
    const postText = server.postText;

    server.postText = (...args) => {
        const reply = JSON.parse(postText(...args));

        delete reply.applied;
        delete reply.revision;

        return JSON.stringify(reply);
    };
}
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
    test('SEC-001: Sheet bị làm trống thì máy đã đồng bộ hỏi, mặc định giữ dữ liệu và đưa lại lên Sheet', async ({
        app,
    }) => {
        const rows = [row('TX_1'), row('TX_2'), row('TX_3')];
        const server = newServer('v2', { rows });
        const { page, state } = await app({ server, seed: syncedSeed(rows) });

        server.post({ action: 'sync', replace: true, upserts: [], meta: {}, confirmWipe: true });
        await page.reload();
        await wait(600);

        expect(state.confirms.some((text) => text.includes('thiếu 3 giao dịch'))).toBe(true);
        expect(await page.evaluate(() => transactions.map((t) => t.id).sort())).toEqual([
            'TX_1',
            'TX_2',
            'TX_3',
        ]);
        expect(
            serverRows(server)
                .map((item) => item.id)
                .sort(),
        ).toEqual(['TX_1', 'TX_2', 'TX_3']);
    });

    test('SEC-001: chỉ xóa trên máy khi bấm OK ở câu hỏi "Xóa"', async ({ app }) => {
        const rows = [row('TX_1'), row('TX_2')];
        const server = newServer('v2', { rows });
        const { page, state } = await app({ server, seed: syncedSeed(rows) });
        const answers = [false, true]; // Hủy "Khôi phục", rồi OK "Xóa trên máy này"

        server.post({ action: 'sync', replace: true, upserts: [], meta: {}, confirmWipe: true });
        page.removeAllListeners('dialog');
        page.on('dialog', (dialog) => {
            state.confirms.push(dialog.message());
            return answers.shift() ? dialog.accept() : dialog.dismiss();
        });
        await page.reload();
        await wait(600);

        expect(state.confirms.at(-1)).toContain('Xóa 2 giao dịch này khỏi máy này');
        expect(await page.evaluate(() => transactions.length)).toBe(0);
        expect(serverRows(server)).toEqual([]);
    });

    test('SEC-001: đóng / hủy cả hai hộp thoại thì "Để sau": giữ trên máy, không gửi, không hỏi lại trong phiên', async ({
        app,
    }) => {
        const rows = [row('TX_1'), row('TX_2'), row('TX_3')];
        const server = newServer('v2', { rows });
        const { page, state } = await app({ server, seed: syncedSeed(rows) });

        server.post({ action: 'sync', replace: true, upserts: [], meta: {}, confirmWipe: true });
        page.removeAllListeners('dialog');
        page.on('dialog', (dialog) => {
            state.confirms.push(dialog.message());
            return dialog.dismiss(); // Esc / Hủy
        });
        await page.reload();
        await wait(600);

        const asked = state.confirms.length;

        expect(asked).toBe(2);
        expect(await page.evaluate(() => transactions.length)).toBe(3);
        expect(serverRows(server)).toEqual([]);
        // Review round 2: not "Đã lưu" while rows exist only on this device.
        await expect(page.locator('#sync-status')).toContainText('Chờ xử lý (3)');
        await expect(page.locator('#sync-status')).not.toContainText('Đã lưu');

        // A later sync in the same session (a new transaction) neither asks again nor uploads them.
        await addExpense(page, 5000, 'moi');
        await wait(600);

        expect(state.confirms.length).toBe(asked);
        expect(serverRows(server).map((item) => item.note)).toEqual(['moi']);
        expect(await page.evaluate(() => transactions.length)).toBe(4);
        await expect(page.locator('#sync-status')).toContainText('Chờ xử lý (3)');

        // Opening the app again asks again.
        await page.reload();
        await wait(600);

        expect(state.confirms.length).toBeGreaterThan(asked);
    });

    test('review vòng 2: xóa giao dịch cuối cùng vẫn lên Sheet (gửi kèm confirmWipe)', async ({
        app,
    }) => {
        const rows = [row('TX_1')];
        const server = newServer('v2', { rows });
        const { page, state } = await app({ server, seed: syncedSeed(rows) });

        await goTransactions(page);
        await page.click('#transaction-table-body [data-action=delete]');
        await wait(500);

        expect(serverRows(server)).toEqual([]);
        expect(lastBody(state).confirmWipe).toBe(true);
        await expect(page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('review vòng 2: xóa một trong nhiều giao dịch không gửi confirmWipe', async ({ app }) => {
        const rows = [row('TX_1'), row('TX_2')];
        const server = newServer('v2', { rows });
        const { page, state } = await app({ server, seed: syncedSeed(rows) });

        await goTransactions(page);
        await page.click(
            '#transaction-table-body tr:has-text("ghi chu TX_1") [data-action=delete]',
        );
        await wait(500);

        expect(serverRows(server).map((item) => item.id)).toEqual(['TX_2']);
        expect(lastBody(state).confirmWipe).toBe(false);
    });

    test('review vòng 4: replace đã áp dụng nhưng mất phản hồi, máy khác ghi xen giữa: gửi lại không xóa dòng của máy kia', async ({
        app,
    }) => {
        const rows = [row('TX_1'), row('TX_2')];
        const properties = { FM_TOKEN: 'bi-mat' };
        const server = newServer('v2', { rows, properties });
        const seed = syncedSeed(rows, { fm_script_token: 'bi-mat' });
        const a = await app({ server, seed });
        const b = await app({ server, seed });

        // Device A restores a backup: the server applies the replace, the reply is lost.
        a.state.loseReplies = 1;
        await goTab(a.page, 'settings');
        await a.page.setInputFiles('input[type=file]', {
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
                        scriptUrl: SCRIPT_URL,
                    },
                }),
            ),
        });
        await wait(600);

        expect(serverRows(server).map((item) => item.id)).toEqual(['TX_9']);
        expect(await a.page.evaluate(() => localStorage.getItem('fm_sync_inflight'))).toBeTruthy();

        // Device B adds a transaction in between. It notices the restore as "the Sheet lost
        // TX_1 and TX_2" and, since the restore was on purpose, the user picks "Xóa trên máy".
        const answers = [false, true];

        b.page.removeAllListeners('dialog');
        b.page.on('dialog', (dialog) => (answers.shift() ? dialog.accept() : dialog.dismiss()));
        await b.page.reload();
        await wait(400);
        await addExpense(b.page, 7000, 'tu-may-B');
        await wait(400);

        // Device A opens again: it asks first, sees its replace went through, and keeps B's row.
        const replacesBefore = a.state.posts.filter((post) => post.body.replace === true).length;

        await a.page.reload();
        await wait(800);

        const notes = serverRows(server)
            .map((item) => item.note)
            .sort();

        expect(notes).toEqual(['ghi chu TX_9', 'tu-may-B']);
        expect(a.state.posts.filter((post) => post.body.replace === true).length).toBe(
            replacesBefore,
        );
        expect(a.state.posts.some((post) => post.body.appliedCheck)).toBe(true);
        expect((await a.page.evaluate(() => transactions.map((t) => t.note))).sort()).toEqual([
            'ghi chu TX_9',
            'tu-may-B',
        ]);
        expect(await a.page.evaluate(() => localStorage.getItem('fm_sync_inflight'))).toBeNull();
    });

    test('review vòng 4: mất phản hồi của một lần xóa: không gửi lại lệnh xóa đã áp dụng', async ({
        app,
    }) => {
        const rows = [row('TX_1'), row('TX_2'), row('TX_3')];
        const server = newServer('v2', { rows, properties: { FM_TOKEN: 'bi-mat' } });
        const { page, state } = await app({
            server,
            seed: syncedSeed(rows, { fm_script_token: 'bi-mat' }),
        });

        state.loseReplies = 1;
        await goTransactions(page);
        await page.click(
            '#transaction-table-body tr:has-text("ghi chu TX_1") [data-action=delete]',
        );
        await wait(500);

        // Another device re-creates the row with a newer edit.
        server.post({
            action: 'sync',
            token: 'bi-mat',
            upserts: [row('TX_1', { updatedAt: '2026-11-22T09:00:00.000Z', note: 'tao lai' })],
        });

        await page.evaluate(() => resumeSync());
        await wait(600);

        expect(serverRows(server).map((item) => item.id)).toContain('TX_1');
        expect(
            state.posts.filter((post) => (post.body.deletes || []).includes('TX_1')).length,
        ).toBe(1);
    });

    test('review vòng 5: server đã quên request (100+ lần ghi sau đó): replace không bị gửi lại, dòng máy khác còn nguyên, có thông báo', async ({
        app,
    }) => {
        const rows = [row('TX_1'), row('TX_2')];
        const server = newServer('v2', { rows, properties: { FM_TOKEN: TOKEN } });
        const a = await app({ server, seed: syncedSeed(rows, { fm_script_token: TOKEN }) });

        // Device A restores a backup: the server applies the replace, the reply is lost.
        a.state.loseReplies = 1;
        await restoreBackup(a.page, [row('TX_9')]);

        expect(serverRows(server).map((item) => item.id)).toEqual(['TX_9']);
        expect(await inflight(a.page)).toBeTruthy();

        // Device B adds a row, then more writes follow than the server's request log keeps.
        server.post({
            action: 'sync',
            token: TOKEN,
            upserts: [row('TX_B', { note: 'tu-may-B' })],
            requestId: 'B-1',
        });

        for (let i = 0; i < 110; i++) {
            server.post({
                action: 'sync',
                token: TOKEN,
                // Newer than what A wrote, so every one of them really changes the sheet.
                meta: { budgets: meta({ lan: i }, '2099-01-01T00:00:00.000Z') },
                requestId: `pad-${i}`,
            });
        }

        const replacesBefore = replaces(a.state);

        await a.page.reload();
        await wait(1000);

        // The server cannot say what became of A's request, so it is not sent again.
        const check = a.state.posts.find((post) => post.body.appliedCheck);

        expect(check.body.appliedAfter).toEqual(expect.any(Number));
        expect(replaces(a.state)).toBe(replacesBefore);
        expect(notesOf(serverRows(server))).toEqual(['ghi chu TX_9', 'tu-may-B']);
        expect(notesOf(await a.page.evaluate(() => transactions))).toEqual([
            'ghi chu TX_9',
            'tu-may-B',
        ]);
        expect(await inflight(a.page)).toBeNull();
        await expect(a.page.locator('#toast-container')).toContainText(
            'Lần thay toàn bộ dữ liệu trên Sheet đã được đổi thành gộp',
        );
        await expectReviewKept(a.page, 'Lần thay toàn bộ dữ liệu trên Sheet đã được đổi thành gộp');
        await expect(a.page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('review vòng 5: server ghi xong nhưng flush lỗi (báo lỗi dù dữ liệu đã vào Sheet): máy khác ghi xen giữa, replace không bị gửi lại', async ({
        app,
    }) => {
        const rows = [row('TX_1'), row('TX_2')];
        const server = newServer('v2', { rows, properties: { FM_TOKEN: TOKEN } });
        const a = await app({ server, seed: syncedSeed(rows, { fm_script_token: TOKEN }) });

        // The flush right after the replace was written throws (arm it when the replace arrives:
        // restoring a backup reads the Sheet first).
        const postText = server.postText;

        server.postText = (raw, ...rest) => {
            if (JSON.parse(raw).replace === true) server.faults.flush = 1;

            return postText(raw, ...rest);
        };
        await restoreBackup(a.page, [row('TX_9')]);

        expect(serverRows(server).map((item) => item.id)).toEqual(['TX_9']); // it did arrive
        expect(await inflight(a.page)).toBeTruthy();
        await expect(a.page.locator('#sync-status')).not.toContainText('Đã lưu');

        server.post({
            action: 'sync',
            token: TOKEN,
            upserts: [row('TX_B', { note: 'tu-may-B' })],
            requestId: 'B-1',
        });

        const replacesBefore = replaces(a.state);

        await a.page.evaluate(() => resumeSync());
        await wait(800);

        expect(replaces(a.state)).toBe(replacesBefore);
        expect(notesOf(serverRows(server))).toEqual(['ghi chu TX_9', 'tu-may-B']);
        await expect(a.page.locator('#toast-container')).toContainText(
            'Lần thay toàn bộ dữ liệu trên Sheet đã được đổi thành gộp',
        );
        await expectReviewKept(a.page, 'Lần thay toàn bộ dữ liệu trên Sheet đã được đổi thành gộp');
    });

    test('review vòng 5: request chưa từng tới server (mất kết nối) được chứng minh là false nên replace vẫn được gửi, không thông báo', async ({
        app,
    }) => {
        const rows = [row('TX_1'), row('TX_2')];
        const server = newServer('v2', { rows, properties: { FM_TOKEN: TOKEN } });
        const a = await app({ server, seed: syncedSeed(rows, { fm_script_token: TOKEN }) });

        a.state.dropRequests = 1;
        await restoreBackup(a.page, [row('TX_9')]);
        expect(serverRows(server).map((item) => item.id)).toEqual(['TX_1', 'TX_2']);
        expect(await inflight(a.page)).toBeTruthy();

        server.post({
            action: 'sync',
            token: TOKEN,
            upserts: [row('TX_B', { note: 'tu-may-B' })],
            requestId: 'B-1',
        });

        const replacesBefore = replaces(a.state);

        await a.page.evaluate(() => resumeSync());
        await wait(800);

        // The restore the user asked for completes: it replaces the server's content, as always.
        expect(a.state.posts.find((post) => post.body.appliedCheck)).toBeTruthy();
        expect(replaces(a.state)).toBe(replacesBefore + 1);
        expect(notesOf(serverRows(server))).toEqual(['ghi chu TX_9']);
        expect(await inflight(a.page)).toBeNull();
        await expect(a.page.locator('#toast-container .toast')).toHaveCount(0);
        await expect(a.page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('review vòng 5: Code.gs cũ không trả applied: lệnh xóa mất phản hồi không được gửi lại, dòng máy khác tạo lại còn nguyên', async ({
        app,
    }) => {
        const rows = [row('TX_1'), row('TX_2'), row('TX_3')];
        const server = newServer('v2', { rows, properties: { FM_TOKEN: TOKEN } });

        withoutRequestIds(server);

        const { page, state } = await app({
            server,
            seed: syncedSeed(rows, { fm_script_token: TOKEN }),
        });

        state.loseReplies = 1;
        await goTransactions(page);
        await page.click(
            '#transaction-table-body tr:has-text("ghi chu TX_1") [data-action=delete]',
        );
        await wait(500);

        // Another device re-creates the row with a newer edit.
        server.post({
            action: 'sync',
            token: TOKEN,
            upserts: [row('TX_1', { updatedAt: '2026-11-22T09:00:00.000Z', note: 'tao lai' })],
        });

        await page.evaluate(() => resumeSync());
        await wait(800);

        const deletesOfTx1 = state.posts.filter((post) =>
            (post.body.deletes || []).includes('TX_1'),
        );

        expect(deletesOfTx1).toHaveLength(1);
        expect(notesOf(serverRows(server))).toEqual(['ghi chu TX_2', 'ghi chu TX_3', 'tao lai']);
        expect(notesOf(await page.evaluate(() => transactions))).toEqual([
            'ghi chu TX_2',
            'ghi chu TX_3',
            'tao lai',
        ]);
        await expect(page.locator('#toast-container')).toContainText(
            'Lệnh xóa 1 giao dịch không được gửi lại',
        );
        await expectReviewKept(page, 'Lệnh xóa 1 giao dịch không được gửi lại');
        expect(await inflight(page)).toBeNull();
    });

    test('review vòng 5: Code.gs cũ: một lần thêm giao dịch mất phản hồi vẫn được gửi lại (upsert an toàn khi lặp), không thông báo', async ({
        app,
    }) => {
        const server = newServer('v2', { rows: [row('TX_1')], properties: { FM_TOKEN: TOKEN } });

        withoutRequestIds(server);

        const { page, state } = await app({
            server,
            seed: syncedSeed([row('TX_1')], { fm_script_token: TOKEN }),
        });

        state.loseReplies = 1;
        await addExpense(page, 7000, 'them-moi');
        await wait(500);
        await page.evaluate(() => resumeSync());
        await wait(800);

        expect(notesOf(serverRows(server)).filter((note) => note === 'them-moi')).toHaveLength(1);
        await expect(page.locator('#toast-container .toast')).toHaveCount(0);
        await expect(page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('review vòng 6: sổ yêu cầu của server bị xóa (epoch mới): replace không bị gửi lại dù appliedAfter = 0, dòng máy khác còn nguyên', async ({
        app,
    }) => {
        const rows = [row('TX_1'), row('TX_2')];
        const server = newServer('v2', { rows, properties: { FM_TOKEN: TOKEN } });
        const a = await app({ server, seed: syncedSeed(rows, { fm_script_token: TOKEN }) });

        a.state.loseReplies = 1;
        await restoreBackup(a.page, [row('TX_9')]); // applied, reply lost (A had seen revision 0)

        expect(serverRows(server).map((item) => item.id)).toEqual(['TX_9']);
        server.post({
            action: 'sync',
            token: TOKEN,
            upserts: [row('TX_B', { note: 'tu-may-B' })],
            requestId: 'B-1',
        });

        // The script's properties are reset: the log starts again at revision 0.
        delete server.properties.FM_REQUEST_LOG;

        const replacesBefore = replaces(a.state);

        await a.page.reload();
        await wait(1000);

        const check = a.state.posts.find((post) => post.body.appliedCheck);

        expect(check.body.appliedAfter).toBe(0);
        expect(check.body.appliedEpoch).toEqual(expect.any(String));
        expect(replaces(a.state)).toBe(replacesBefore);
        expect(notesOf(serverRows(server))).toEqual(['ghi chu TX_9', 'tu-may-B']);
        expect(await inflight(a.page)).toBeNull();
        await expectReviewKept(a.page, 'Lần thay toàn bộ dữ liệu trên Sheet đã được đổi thành gộp');
    });

    test('review vòng 6: đổi URL khi replace chưa được xác nhận: replace không bao giờ tới Sheet mới, dữ liệu Sheet mới còn nguyên; chuyển về Sheet cũ cũng không gửi replace', async ({
        app,
    }) => {
        const rows = [row('TX_1'), row('TX_2')];
        const serverA = newServer('v2', { rows, properties: { FM_TOKEN: TOKEN } });
        const serverB = newServer('v2', {
            rows: [row('TX_B1', { note: 'rieng-cua-B' })],
            properties: { FM_TOKEN: TOKEN },
        });
        const a = await app({
            server: serverA,
            servers: { [URL_B]: serverB },
            seed: syncedSeed(rows, { fm_script_token: TOKEN }),
        });
        const replacesTo = (url) =>
            a.state.posts.filter((post) => post.url.startsWith(url) && post.body.replace === true)
                .length;

        // A restores a backup: the replace reaches the first Sheet, the reply is lost.
        a.state.loseReplies = 1;
        await restoreBackup(a.page, [row('TX_9')]);
        expect(idsOf(serverRows(serverA))).toEqual(['TX_9']);
        expect(await inflight(a.page)).toBeTruthy();
        expect(await a.page.evaluate(() => localStorage.getItem('fm_sync_dirty'))).toBe('replace');

        // The user points the app at another Sheet that has data of its own.
        await a.page.evaluate((url) => setScriptUrl(url), URL_B);
        await wait(900);

        expect(replacesTo(URL_B)).toBe(0);
        expect(notesOf(serverRows(serverB))).toContain('rieng-cua-B');
        expect(await inflight(a.page)).toBeNull();
        expect(await a.page.evaluate(() => localStorage.getItem('fm_sync_dirty'))).not.toBe(
            'replace',
        );
        await expectReviewKept(a.page, 'Bạn vừa đổi Google Sheet');

        // And back to the first one: still no replace is sent anywhere.
        const replacesToA = replacesTo(SCRIPT_URL);

        await a.page.evaluate((url) => setScriptUrl(url), SCRIPT_URL);
        await wait(900);

        expect(replacesTo(SCRIPT_URL)).toBe(replacesToA);
        expect(replacesTo(URL_B)).toBe(0);
        expect(notesOf(serverRows(serverA))).toContain('ghi chu TX_9');
        expect(notesOf(serverRows(serverB))).toContain('rieng-cua-B');
    });

    test('review vòng 6: đổi URL khi lệnh xóa chưa được xác nhận: lệnh xóa không tới Sheet mới, giao dịch quay về máy, có cảnh báo', async ({
        app,
    }) => {
        const rows = [row('TX_1'), row('TX_2'), row('TX_3')];
        const serverA = newServer('v2', { rows, properties: { FM_TOKEN: TOKEN } });
        const serverB = newServer('v2', { rows, properties: { FM_TOKEN: TOKEN } });
        const a = await app({
            server: serverA,
            servers: { [URL_B]: serverB },
            seed: syncedSeed(rows, { fm_script_token: TOKEN }),
        });

        a.state.loseReplies = 1;
        await goTransactions(a.page);
        await a.page.click(
            '#transaction-table-body tr:has-text("ghi chu TX_1") [data-action=delete]',
        );
        await wait(500);
        expect(idsOf(serverRows(serverA))).toEqual(['TX_2', 'TX_3']);

        await a.page.evaluate((url) => setScriptUrl(url), URL_B);
        await wait(900);

        const deletesToB = a.state.posts.filter(
            (post) => post.url.startsWith(URL_B) && (post.body.deletes || []).length > 0,
        );

        expect(deletesToB).toHaveLength(0);
        expect(idsOf(serverRows(serverB))).toEqual(['TX_1', 'TX_2', 'TX_3']);
        expect(idsOf(await a.page.evaluate(() => transactions))).toEqual(['TX_1', 'TX_2', 'TX_3']);
        await expectReviewKept(a.page, 'Lệnh xóa 1 giao dịch không được gửi lại');
    });

    test('review vòng 6: replace và lệnh xóa đang chờ (Sheet cũ không với tới, chưa có request nào) không bị gửi sang Sheet mới khi đổi URL', async ({
        app,
    }) => {
        const rows = [row('TX_1'), row('TX_2')];
        const serverA = newServer('v2', { rows, properties: { FM_TOKEN: TOKEN } });
        const serverB = newServer('v2', {
            rows: [row('TX_B1', { note: 'rieng-cua-B' })],
            properties: { FM_TOKEN: TOKEN },
        });
        const a = await app({
            server: serverA,
            servers: { [URL_B]: serverB },
            getFails: true, // the first Sheet cannot be read, so nothing was ever sent to it
            seed: syncedSeed(rows, {
                fm_script_token: TOKEN,
                fm_sync_dirty: 'replace',
                fm_deleted_ids: JSON.stringify(['TX_1']),
            }),
        });

        expect(a.state.posts).toHaveLength(0);
        expect(await inflight(a.page)).toBeNull();

        await a.page.evaluate((url) => setScriptUrl(url), URL_B);
        await wait(900);

        const toB = a.state.posts.filter((post) => post.url.startsWith(URL_B));

        expect(toB.length).toBeGreaterThan(0);
        expect(toB.some((post) => post.body.replace === true)).toBe(false);
        expect(toB.some((post) => (post.body.deletes || []).length > 0)).toBe(false);
        expect(notesOf(serverRows(serverB))).toContain('rieng-cua-B');
        expect(await a.page.evaluate(() => localStorage.getItem('fm_sync_dirty'))).not.toBe(
            'replace',
        );
        await expectReviewKept(a.page, 'Bạn vừa đổi Google Sheet');
    });

    test('review vòng 6: bật Sheet lần đầu khi còn replace chưa gửi (đã xóa hết dữ liệu lúc chưa có Sheet): replace và lệnh xóa đều không tới Sheet', async ({
        app,
    }) => {
        const server = newServer('v2', {
            rows: [row('TX_1', { note: 'co-san-tren-Sheet' })],
            properties: { FM_TOKEN: TOKEN },
        });
        const { page, state } = await app({
            server,
            seed: {
                fm_script_url: '', // no Sheet yet
                fm_script_token: TOKEN,
                fm_transactions: JSON.stringify([row('TX_2')]),
                fm_sync_dirty: 'replace', // "Xóa toàn bộ dữ liệu" was used while no Sheet was set
                fm_deleted_ids: JSON.stringify(['TX_X']),
            },
        });

        expect(state.posts).toHaveLength(0);

        await page.evaluate((url) => setScriptUrl(url), SCRIPT_URL);
        await wait(900);

        expect(state.posts.some((post) => post.body.replace === true)).toBe(false);
        // Deletions made while no Sheet was set have no authority over the Sheet that is connected.
        expect(state.posts.some((post) => (post.body.deletes || []).length > 0)).toBe(false);
        expect(await page.evaluate(() => localStorage.getItem('fm_deleted_ids'))).toBeNull();
        expect(notesOf(serverRows(server))).toContain('co-san-tren-Sheet');
        await expectReviewKept(page, 'Bạn vừa bật Google Sheet');
    });

    test('review vòng 7: kết nối Sheet lần đầu khi máy còn lệnh xóa từ lúc chưa có Sheet: Sheet không bị xóa, không có POST deletes / confirmWipe, có cảnh báo', async ({
        app,
    }) => {
        const server = newServer('v2', {
            rows: [row('TX_1', { note: 'co-san-tren-Sheet' })], // the only row of the Sheet
            properties: { FM_TOKEN: TOKEN },
        });
        const { page, state } = await app({
            server,
            seed: {
                fm_script_url: '', // no Sheet yet
                fm_script_token: TOKEN,
                fm_transactions: '[]', // TX_1 was deleted here
                fm_deleted_ids: JSON.stringify(['TX_1']),
            },
        });

        await page.evaluate((url) => setScriptUrl(url), SCRIPT_URL);
        await wait(900);

        expect(state.posts.some((post) => (post.body.deletes || []).length > 0)).toBe(false);
        expect(state.posts.some((post) => post.body.confirmWipe === true)).toBe(false);
        expect(idsOf(serverRows(server))).toEqual(['TX_1']);
        // The row is back on this device, and the user is told why it was not deleted.
        expect(idsOf(await page.evaluate(() => transactions))).toEqual(['TX_1']);
        expect(await page.evaluate(() => localStorage.getItem('fm_deleted_ids'))).toBeNull();
        await expectReviewKept(page, 'Google Sheet vừa kết nối đã có 1 giao dịch');
        await expect(page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('review vòng 7: phản hồi muộn của Sheet cũ (đổi URL lúc POST replace còn đang chạy) không đụng baseline, hàng chờ hay dữ liệu của Sheet mới', async ({
        app,
    }) => {
        const rows = [row('TX_1'), row('TX_2')];
        const serverA = newServer('v2', { rows, properties: { FM_TOKEN: TOKEN } });
        const serverB = newServer('v2', {
            rows: [row('TX_B1', { note: 'rieng-cua-B' })],
            properties: { FM_TOKEN: TOKEN },
        });
        const a = await app({
            server: serverA,
            servers: { [URL_B]: serverB },
            seed: syncedSeed(rows, { fm_script_token: TOKEN }),
        });
        const view = () =>
            a.page.evaluate(() => ({
                ids: transactions.map((item) => item.id).sort(),
                baseline: localStorage.getItem('fm_sync_baseline'),
                revision: JSON.parse(localStorage.getItem('fm_sync_revision') || 'null'),
                dirty: localStorage.getItem('fm_sync_dirty'),
                upserts: localStorage.getItem('fm_pending_upserts'),
                inflight: localStorage.getItem('fm_sync_inflight'),
                badge: document.getElementById('sync-status').textContent.trim(),
            }));

        // The replace of a restored backup is slow: it is still on its way to the first Sheet.
        a.state.holdWrites = 1;
        await restoreBackup(a.page, [row('TX_9')]);
        expect(idsOf(serverRows(serverA))).toEqual(['TX_1', 'TX_2']);

        // The user switches to the second Sheet, which reads and syncs normally.
        await a.page.evaluate((url) => setScriptUrl(url), URL_B);
        await wait(900);

        const before = await view();
        const serverBBefore = idsOf(serverRows(serverB));

        expect(before.baseline).toBe(URL_B);
        expect(before.revision.url).toBe(URL_B);
        expect(before.badge).toContain('Đã lưu');

        // Now the old request reaches the first Sheet and its reply arrives.
        a.state.releaseHeld();
        await wait(700);

        expect(idsOf(serverRows(serverA))).toEqual(['TX_9']); // it was sent before the switch
        expect(await view()).toEqual(before);
        expect(idsOf(serverRows(serverB))).toEqual(serverBBefore);
        expect(
            a.state.posts.filter(
                (post) => post.url.startsWith(URL_B) && post.body.replace === true,
            ),
        ).toHaveLength(0);
        expect(await a.page.evaluate(() => transactions.map((t) => t.note))).toContain(
            'rieng-cua-B',
        );
    });

    test('review vòng 7: phản hồi muộn của Sheet cũ cho một lần thêm giao dịch không kéo dòng của Sheet cũ vào máy đã nối Sheet mới', async ({
        app,
    }) => {
        const rows = [row('TX_1')];
        const serverA = newServer('v2', { rows, properties: { FM_TOKEN: TOKEN } });
        const serverB = newServer('v2', {
            rows: [row('TX_B1', { note: 'rieng-cua-B' })],
            properties: { FM_TOKEN: TOKEN },
        });
        const a = await app({
            server: serverA,
            servers: { [URL_B]: serverB },
            seed: syncedSeed(rows, { fm_script_token: TOKEN }),
        });

        a.state.holdWrites = 1;
        await addExpense(a.page, 7000, 'them-moi'); // its upsert is still on its way to Sheet A
        await a.page.evaluate((url) => setScriptUrl(url), URL_B);
        await wait(900);

        // Another device adds a row to Sheet A; the late reply of the old request carries it.
        serverA.post({
            action: 'sync',
            token: TOKEN,
            upserts: [row('TX_ONLYA', { note: 'chi-co-o-A' })],
        });

        const before = await a.page.evaluate(() => ({
            ids: transactions.map((item) => item.id).sort(),
            baseline: localStorage.getItem('fm_sync_baseline'),
            dirty: localStorage.getItem('fm_sync_dirty'),
        }));

        // The request that is still on its way must not hold the new connection back: Sheet B has
        // the new expense already, before the old reply is released.
        expect(notesOf(serverRows(serverB))).toContain('them-moi');

        a.state.releaseHeld();
        await wait(700);

        const after = await a.page.evaluate(() => ({
            ids: transactions.map((item) => item.id).sort(),
            baseline: localStorage.getItem('fm_sync_baseline'),
            dirty: localStorage.getItem('fm_sync_dirty'),
        }));

        expect(after).toEqual(before);
        expect(after.ids).not.toContain('TX_ONLYA');
        expect(after.baseline).toBe(URL_B);
        expect(notesOf(serverRows(serverB))).toEqual(
            expect.arrayContaining(['rieng-cua-B', 'them-moi']),
        );
        expect(notesOf(serverRows(serverB))).not.toContain('chi-co-o-A');
        await expect(a.page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('review vòng 7: push cũ quay về không đặt lại cờ của push đang chạy ở Sheet mới (không có hai push đồng thời)', async ({
        app,
    }) => {
        const rows = [row('TX_1')];
        const serverA = newServer('v2', { rows, properties: { FM_TOKEN: TOKEN } });
        const serverB = newServer('v2', {
            rows: [row('TX_B1', { note: 'rieng-cua-B' })],
            properties: { FM_TOKEN: TOKEN },
        });
        const a = await app({
            server: serverA,
            servers: { [URL_B]: serverB },
            seed: syncedSeed(rows, { fm_script_token: TOKEN }),
        });
        const writesToB = () =>
            a.state.posts.filter(
                (post) =>
                    post.url.startsWith(URL_B) &&
                    ((post.body.upserts || []).length > 0 || (post.body.deletes || []).length > 0),
            ).length;

        // Two writes are slow: the first to Sheet A, then the first one to Sheet B.
        a.state.holdWrites = 2;
        await addExpense(a.page, 7000, 'a-1');
        await a.page.evaluate((url) => setScriptUrl(url), URL_B);
        await wait(900);
        expect(a.state.held).toHaveLength(2);
        expect(writesToB()).toBe(1);

        // The old request is answered while the push to B is still on its way.
        a.state.releaseHeld(0);
        await wait(500);

        // A new change must wait for that push (queued), not start a second one beside it.
        await addExpense(a.page, 8000, 'b-2');
        await wait(500);
        expect(writesToB()).toBe(1);

        a.state.releaseHeld(1);
        await wait(900);

        expect(writesToB()).toBe(2); // the queued change went out afterwards
        expect(notesOf(serverRows(serverB))).toEqual(
            expect.arrayContaining(['rieng-cua-B', 'a-1', 'b-2']),
        );
        await expect(a.page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('review vòng 7: Sheet cũ dùng script cũ (legacy): phản hồi muộn của nó không đánh dấu Sheet mới là đã đồng bộ', async ({
        app,
    }) => {
        const rows = [row('TX_1')];
        const legacy = newServer('legacy', { rows });
        const serverB = newServer('v2', {
            rows: [row('TX_B1', { note: 'rieng-cua-B' })],
            properties: { FM_TOKEN: TOKEN },
        });
        const a = await app({
            server: legacy,
            servers: { [URL_B]: serverB },
            seed: syncedSeed(rows, { fm_script_token: TOKEN }),
        });
        const stored = () =>
            a.page.evaluate(() => ({
                baseline: localStorage.getItem('fm_sync_baseline'),
                dirty: localStorage.getItem('fm_sync_dirty'),
            }));

        // The save to the legacy Sheet and then the first push to Sheet B are both slow.
        a.state.holdWrites = 2;
        await addExpense(a.page, 7000, 'them-moi');
        await a.page.evaluate((url) => setScriptUrl(url), URL_B);
        await wait(900);
        expect(a.state.held).toHaveLength(2);

        // The legacy save is answered first: Sheet B has confirmed nothing yet.
        a.state.releaseHeld(0);
        await wait(600);
        expect(await stored()).toEqual({ baseline: SCRIPT_URL, dirty: 'merge' });
        expect(notesOf(serverRows(serverB))).not.toContain('them-moi'); // still on its way

        a.state.releaseHeld(1);
        await wait(900);
        expect(await stored()).toEqual({ baseline: URL_B, dirty: null });
        expect(notesOf(serverRows(serverB))).toEqual(
            expect.arrayContaining(['rieng-cua-B', 'them-moi']),
        );
        await expect(a.page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('review vòng 10: một lần đọc đang chờ trả lời thì giao dịch và meta mới chờ sau nó rồi mới được gửi: không có snapshot cũ nào chen vào', async ({
        app,
    }) => {
        const rows = [row('TX_A'), row('TX_B'), row('TX_C')];
        const server = newServer('v2', { rows });

        server.post({ action: 'sync', meta: { budgets: meta({ 'Ăn uống': 1 }) } });

        const a = await app({ server, seed: syncedSeed(rows) });
        const view = () =>
            a.page.evaluate(() => ({
                notes: transactions.map((item) => item.note).sort(),
                budget: budgets['Ăn uống'],
                dirty: localStorage.getItem('fm_sync_dirty'),
                upserts: localStorage.getItem('fm_pending_upserts'),
                metaPending: localStorage.getItem('fm_pending_meta'),
            }));

        // A background read takes its snapshot now (A, B, C, budget 1); its answer is slow.
        a.state.holdReads = 1;
        await a.page.evaluate(() => {
            syncFromGoogleSheet({ quiet: true });
        });
        await wait(150);
        expect(a.state.heldReads).toHaveLength(1);

        // Meanwhile D is added and a budget is changed. They wait for the read: no write goes to
        // the Sheet beside it, so no reply can come back out of order.
        await addExpense(a.page, 7000, 'tx-D');
        await a.page.evaluate(() => {
            META_ACCESSORS.budgets.set({ 'Ăn uống': 123456 });
            saveMeta('budgets');
            syncToGoogleSheet();
        });
        await wait(600);
        expect(a.state.posts).toHaveLength(0);
        expect(notesOf(serverRows(server))).not.toContain('tx-D');

        // The read is answered; only then are the changes sent.
        a.state.releaseRead(0);
        await wait(900);

        const after = await view();

        expect(after.notes).toContain('tx-D');
        expect(after.budget).toBe(123456);
        expect(after.dirty).toBeNull();
        expect(after.upserts).toBeNull();
        expect(after.metaPending).toBeNull();
        expect(notesOf(serverRows(server))).toContain('tx-D');
        expect(server.get({ v: '2' }).meta.budgets.value).toEqual({ 'Ăn uống': 123456 });
        await expect(a.page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('review vòng 10: hai lần đọc gần nhau: lần sau chỉ được gửi khi lần trước đã trả lời, nên thấy cả dòng của máy khác', async ({
        app,
    }) => {
        const rows = [row('TX_A'), row('TX_B'), row('TX_C')];
        const server = newServer('v2', { rows });
        const a = await app({ server, seed: syncedSeed(rows) });
        const notes = () => a.page.evaluate(() => transactions.map((item) => item.note).sort());

        a.state.holdReads = 1;
        await a.page.evaluate(() => {
            syncFromGoogleSheet({ quiet: true }); // snapshot 1: A, B, C
        });
        await wait(150);
        expect(a.state.heldReads).toHaveLength(1);

        const getsWhileWaiting = a.state.gets;

        server.post({ action: 'sync', upserts: [row('TX_E', { note: 'tu-may-khac' })] });
        await a.page.evaluate(() => {
            syncFromGoogleSheet({ quiet: true }); // must wait for the first one
        });
        await wait(400);
        expect(a.state.gets).toBe(getsWhileWaiting); // not sent yet

        a.state.releaseRead(0);
        await wait(700);

        expect(a.state.gets).toBe(getsWhileWaiting + 1); // sent after the first was answered
        expect(await notes()).toContain('tu-may-khac');
        expect(await notes()).toHaveLength(4);
    });

    test('review vòng 10: phản hồi của một lần đẩy còn chưa về thì lần đọc chờ sau nó: phản hồi xác nhận giao dịch, rồi lần đọc mới đem dòng của máy khác về', async ({
        app,
    }) => {
        const rows = [row('TX_A'), row('TX_B'), row('TX_C')];
        const server = newServer('v2', { rows });
        const a = await app({ server, seed: syncedSeed(rows) });
        const view = () =>
            a.page.evaluate(() => ({
                notes: transactions.map((item) => item.note).sort(),
                dirty: localStorage.getItem('fm_sync_dirty'),
                upserts: localStorage.getItem('fm_pending_upserts'),
            }));

        // D is applied on the Sheet at once, but the reply of its push is slow.
        a.state.holdReplies = 1;
        await addExpense(a.page, 7000, 'tx-D');
        await wait(300);
        expect(notesOf(serverRows(server))).toContain('tx-D');
        expect(a.state.heldReplies).toHaveLength(1);

        // Another device adds E and a read is asked for: it waits for the push to be answered.
        server.post({ action: 'sync', upserts: [row('TX_E', { note: 'tu-may-khac' })] });

        const getsWhileWaiting = a.state.gets;

        await a.page.evaluate(() => {
            syncFromGoogleSheet({ quiet: true });
        });
        await wait(400);
        expect(a.state.gets).toBe(getsWhileWaiting);
        expect((await view()).notes).not.toContain('tu-may-khac');

        a.state.releaseReply(0);
        await wait(800);

        const after = await view();

        expect(after.notes).toEqual(expect.arrayContaining(['tx-D', 'tu-may-khac']));
        expect(after.notes).toHaveLength(5);
        expect(after.dirty).toBeNull();
        expect(after.upserts).toBeNull();
        await expect(a.page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('review vòng 8: khôi phục sao lưu trên cùng URL khi một lần đẩy cũ còn đang chạy: ack của lần cũ không xóa ý định replace, Sheet cuối cùng chỉ có bản sao lưu', async ({
        app,
    }) => {
        const server = newServer('v2', { rows: [row('TX_OLD')] });
        const a = await app({ server, seed: syncedSeed([row('TX_OLD')]) });
        const dirty = () => a.page.evaluate(() => localStorage.getItem('fm_sync_dirty'));

        // An upsert is on its way to the Sheet when the backup is restored (same URL).
        a.state.holdWrites = 1;
        await addExpense(a.page, 7000, 'tx-NEW');
        await restoreBackup(a.page, [row('TX_BACKUP')]);
        expect(await dirty()).toBe('replace');

        a.state.releaseHeld(0); // the old request reaches the Sheet and is answered
        await wait(1000);

        expect(idsOf(serverRows(server))).toEqual(['TX_BACKUP']);
        expect(idsOf(await a.page.evaluate(() => transactions))).toEqual(['TX_BACKUP']);
        expect(await dirty()).toBeNull();
        await expect(a.page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('review vòng 8: "Xóa toàn bộ dữ liệu" khi một lần đẩy cũ còn đang chạy: Sheet cuối cùng trống, replace có confirmWipe', async ({
        app,
    }) => {
        const server = newServer('v2', { rows: [row('TX_OLD')] });
        const a = await app({ server, seed: syncedSeed([row('TX_OLD')]) });

        a.state.holdWrites = 1;
        await addExpense(a.page, 7000, 'tx-NEW');
        await a.page.evaluate(() => {
            resetAllData();
        });
        expect(await a.page.evaluate(() => localStorage.getItem('fm_sync_dirty'))).toBe('replace');

        a.state.releaseHeld(0);
        await wait(1000);

        expect(serverRows(server)).toEqual([]);
        expect(await a.page.evaluate(() => transactions.length)).toBe(0);
        expect(await a.page.evaluate(() => localStorage.getItem('fm_sync_dirty'))).toBeNull();
        expect(
            a.state.posts.some(
                (post) => post.body.replace === true && post.body.confirmWipe === true,
            ),
        ).toBe(true);
    });

    test('review vòng 8: khôi phục sao lưu lần hai khi lần một đã áp dụng nhưng mất phản hồi: lần kiểm tra appliedCheck của lần một không xóa ý định replace của lần hai', async ({
        app,
    }) => {
        // With a token a lost reply cannot be answered through the GET fallback.
        const server = newServer('v2', {
            rows: [row('TX_OLD')],
            properties: { FM_TOKEN: TOKEN },
        });
        const a = await app({
            server,
            seed: syncedSeed([row('TX_OLD')], { fm_script_token: TOKEN }),
        });

        a.state.loseReplies = 1;
        await restoreBackup(a.page, [row('TX_1')]); // applied on the Sheet, the reply is lost
        expect(idsOf(serverRows(server))).toEqual(['TX_1']);
        expect(await a.page.evaluate(() => localStorage.getItem('fm_sync_inflight'))).toBeTruthy();

        await restoreBackup(a.page, [row('TX_2')]); // another backup is restored on top of it
        await wait(800);

        expect(idsOf(serverRows(server))).toEqual(['TX_2']);
        expect(idsOf(await a.page.evaluate(() => transactions))).toEqual(['TX_2']);
        expect(await a.page.evaluate(() => localStorage.getItem('fm_sync_dirty'))).toBeNull();
    });

    test('review vòng 8: khôi phục sao lưu lần hai khi lần một không rõ kết quả: chỉ bỏ lần một, replace của lần hai vẫn được gửi', async ({
        app,
    }) => {
        const server = newServer('v2', {
            rows: [row('TX_OLD')],
            properties: { FM_TOKEN: TOKEN },
        });
        const a = await app({
            server,
            seed: syncedSeed([row('TX_OLD')], { fm_script_token: TOKEN }),
        });

        a.state.loseReplies = 1;
        await restoreBackup(a.page, [row('TX_1')]);
        expect(idsOf(serverRows(server))).toEqual(['TX_1']);
        expect(await a.page.evaluate(() => localStorage.getItem('fm_sync_inflight'))).toBeTruthy();

        // The Sheet forgets the request (more writes than its log keeps).
        for (let i = 0; i < 110; i++) {
            server.post({
                action: 'sync',
                token: TOKEN,
                meta: { budgets: meta({ lan: i }, '2099-01-01T00:00:00.000Z') },
                requestId: `pad-${i}`,
            });
        }

        await restoreBackup(a.page, [row('TX_2')]);
        await wait(800);

        // The second backup is the user's current intent: it replaces the Sheet as asked.
        expect(idsOf(serverRows(server))).toEqual(['TX_2']);
        expect(idsOf(await a.page.evaluate(() => transactions))).toEqual(['TX_2']);
    });

    test('review vòng 9: replace đã áp dụng, rồi lỗi ghi localStorage ngay sau ACK (trước khi dọn hàng chờ): mở lại thì hỏi về requestId cũ, không gửi replace mới, dòng của máy khác còn nguyên', async ({
        app,
    }) => {
        const server = newServer('v2', {
            rows: [row('TX_OLD')],
            properties: { FM_TOKEN: TOKEN },
        });
        const a = await app({
            server,
            seed: syncedSeed([row('TX_OLD')], { fm_script_token: TOKEN }),
        });
        const stored = (key) => a.page.evaluate((name) => localStorage.getItem(name), key);

        await failStorageOnce(a.page, 'setItem', 'fm_sync_baseline'); // the first step after the ACK
        await restoreBackup(a.page, [row('TX_BACKUP')]);

        // The Sheet applied it; this device never finished noting that down.
        expect(idsOf(serverRows(server))).toEqual(['TX_BACKUP']);
        expect(await stored('fm_sync_inflight')).toBeTruthy(); // the way back to the request
        expect(await stored('fm_sync_dirty')).toBe('replace');

        server.post({
            action: 'sync',
            token: TOKEN,
            upserts: [row('TX_B', { note: 'tu-may-B' })],
            requestId: 'B-1',
        });

        const replacesBefore = replaces(a.state);

        await a.page.reload();
        await wait(1000);

        expect(a.state.posts.some((post) => post.body.appliedCheck)).toBe(true);
        expect(replaces(a.state)).toBe(replacesBefore);
        expect(notesOf(serverRows(server))).toEqual(['ghi chu TX_BACKUP', 'tu-may-B']);
        expect(idsOf(await a.page.evaluate(() => transactions))).toEqual(['TX_B', 'TX_BACKUP']);
        expect(await stored('fm_sync_inflight')).toBeNull();
        expect(await stored('fm_sync_dirty')).toBeNull();
    });

    test('review vòng 9: lỗi ghi localStorage khi xóa bản ghi inflight (sau khi đã dọn hàng chờ): mở lại thì hỏi lại và dọn lại được, không gửi lại gì', async ({
        app,
    }) => {
        const server = newServer('v2', {
            rows: [row('TX_OLD')],
            properties: { FM_TOKEN: TOKEN },
        });
        const a = await app({
            server,
            seed: syncedSeed([row('TX_OLD')], { fm_script_token: TOKEN }),
        });
        const stored = (key) => a.page.evaluate((name) => localStorage.getItem(name), key);

        await failStorageOnce(a.page, 'removeItem', 'fm_sync_inflight');
        await restoreBackup(a.page, [row('TX_BACKUP')]);

        expect(await stored('fm_sync_dirty')).toBeNull(); // settled already
        expect(await stored('fm_sync_inflight')).toBeTruthy(); // but the record is still there

        server.post({
            action: 'sync',
            token: TOKEN,
            upserts: [row('TX_B', { note: 'tu-may-B' })],
            requestId: 'B-1',
        });

        const replacesBefore = replaces(a.state);

        await a.page.reload();
        await wait(1000);

        // Settling again changes nothing that was settled, and brings B's row.
        expect(replaces(a.state)).toBe(replacesBefore);
        expect(notesOf(serverRows(server))).toEqual(['ghi chu TX_BACKUP', 'tu-may-B']);
        expect(idsOf(await a.page.evaluate(() => transactions))).toEqual(['TX_B', 'TX_BACKUP']);
        expect(await stored('fm_sync_inflight')).toBeNull();
        expect(await stored('fm_sync_dirty')).toBeNull();
    });

    test('review vòng 9: lệnh xóa đã áp dụng, rồi lỗi ghi localStorage ngay sau ACK, máy khác tạo lại dòng đó: mở lại thì không xóa lại dòng vừa tạo', async ({
        app,
    }) => {
        const rows = [row('TX_1'), row('TX_2'), row('TX_3')];
        const server = newServer('v2', { rows, properties: { FM_TOKEN: TOKEN } });
        const a = await app({ server, seed: syncedSeed(rows, { fm_script_token: TOKEN }) });
        const deletesOfTx1 = () =>
            a.state.posts.filter((post) => (post.body.deletes || []).includes('TX_1')).length;

        await failStorageOnce(a.page, 'setItem', 'fm_sync_baseline');
        await goTransactions(a.page);
        await a.page.click(
            '#transaction-table-body tr:has-text("ghi chu TX_1") [data-action=delete]',
        );
        await wait(600);

        expect(idsOf(serverRows(server))).toEqual(['TX_2', 'TX_3']); // applied
        expect(deletesOfTx1()).toBe(1);

        // Another device creates the row again, newer.
        server.post({
            action: 'sync',
            token: TOKEN,
            upserts: [row('TX_1', { updatedAt: '2026-11-22T09:00:00.000Z', note: 'tao lai' })],
            requestId: 'B-1',
        });

        await a.page.reload();
        await wait(1000);

        expect(deletesOfTx1()).toBe(1); // the deletion is not sent a second time
        expect(notesOf(serverRows(server))).toContain('tao lai');
        expect(await a.page.evaluate(() => transactions.map((item) => item.note))).toContain(
            'tao lai',
        );
        expect(await a.page.evaluate(() => localStorage.getItem('fm_deleted_ids'))).toBeNull();
    });

    test('review vòng 9: đổi URL mà lỗi ghi localStorage khi xóa inflight: replace đang chờ đã được hạ về gộp trước đó, bản ghi inflight còn nguyên', async ({
        app,
    }) => {
        const serverA = newServer('v2', {
            rows: [row('TX_OLD')],
            properties: { FM_TOKEN: TOKEN },
        });
        const serverB = newServer('v2', {
            rows: [row('TX_B1', { note: 'rieng-cua-B' })],
            properties: { FM_TOKEN: TOKEN },
        });
        const a = await app({
            server: serverA,
            servers: { [URL_B]: serverB },
            seed: syncedSeed([row('TX_OLD')], { fm_script_token: TOKEN }),
        });
        const stored = (key) => a.page.evaluate((name) => localStorage.getItem(name), key);

        a.state.loseReplies = 1;
        await restoreBackup(a.page, [row('TX_BACKUP')]);
        expect(await stored('fm_sync_dirty')).toBe('replace');

        await failStorageOnce(a.page, 'removeItem', 'fm_sync_inflight');
        await a.page.evaluate((url) => {
            try {
                setScriptUrl(url);
            } catch {
                // the storage failure surfaces here
            }
        }, URL_B);

        // The pending replace was given up BEFORE the record could not be removed.
        expect(await stored('fm_sync_dirty')).not.toBe('replace');
        expect(await stored('fm_sync_inflight')).toBeTruthy();
        expect(a.state.posts.filter((post) => post.url.startsWith(URL_B))).toHaveLength(0);
    });

    test('review vòng 9: server mở (GET v2 không token): bản ghi inflight có baseRevision và baseEpoch, replace chưa từng tới server được chứng minh là false và vẫn được gửi', async ({
        app,
    }) => {
        const server = newServer('v2', { rows: [row('TX_OLD')] }); // open: no token
        const a = await app({ server, seed: syncedSeed([row('TX_OLD')]) });

        // Neither the POST nor its GET fallback reaches the Sheet.
        a.state.dropRequests = 2;
        await restoreBackup(a.page, [row('TX_BACKUP')]);
        expect(idsOf(serverRows(server))).toEqual(['TX_OLD']);

        const record = JSON.parse(
            await a.page.evaluate(() => localStorage.getItem('fm_sync_inflight')),
        );

        expect(record.baseRevision).toEqual(expect.any(Number));
        expect(record.baseEpoch).toEqual(expect.any(String));

        await a.page.evaluate(() => resumeSync());
        await wait(1000);

        const check = a.state.posts.find((post) => post.body.appliedCheck);

        expect(check.body.appliedAfter).toEqual(expect.any(Number));
        expect(check.body.appliedEpoch).toEqual(expect.any(String));
        expect(idsOf(serverRows(server))).toEqual(['TX_BACKUP']); // the restore the user asked for
        await expect(a.page.locator('#sync-review')).toBeHidden();
    });

    test('review vòng 10: revision và epoch nhớ theo đúng thứ tự các snapshot được áp dụng: sau phản hồi của lần đẩy là sổ mới của server', async ({
        app,
    }) => {
        const rows = [row('TX_A'), row('TX_B'), row('TX_C')];
        const server = newServer('v2', { rows });
        const a = await app({ server, seed: syncedSeed(rows) });
        const stored = () =>
            a.page.evaluate(() => JSON.parse(localStorage.getItem('fm_sync_revision')));
        const first = await stored();

        // D is applied on the Sheet (log 1, revision 1) but the reply is slow.
        a.state.holdReplies = 1;
        await addExpense(a.page, 7000, 'tx-D');
        await wait(300);

        // The Sheet's request log is lost: from now on another epoch. A read is asked for; it
        // waits behind the push.
        delete server.properties.FM_REQUEST_LOG;
        await a.page.evaluate(() => {
            syncFromGoogleSheet({ quiet: true });
        });
        await wait(300);
        expect(await stored()).toEqual(first); // nothing was applied yet

        a.state.releaseReply(0); // the push reply (the old log) first, then the read (the new log)
        await wait(900);

        const fresh = await stored();

        expect(fresh.epoch).not.toBe(first.epoch);
        expect(fresh.epoch).toBe(server.get({ v: '2' }).epoch);
    });

    for (const backend of ['v2', 'legacy']) {
        test(`review vòng 10: ${backend}: khôi phục sao lưu khi một lần ghi cũ còn đang chạy: lần đọc của thao tác khôi phục chờ lần ghi cũ, ack của lần cũ không xóa ý định replace, bản sao lưu không bị ghi đè`, async ({
            app,
        }) => {
            const server = newServer(backend, { rows: [row('TX_OLD')] });
            const a = await app({ server, seed: syncedSeed([row('TX_OLD')]) });

            a.state.holdWrites = 1;
            await addExpense(a.page, 7000, 'tx-NEW'); // the old write is on its way

            a.state.holdReads = 1; // the read that restoring a backup starts is slow too
            await restoreBackup(a.page, [row('TX_BACKUP')]);
            // It waits for the old write: nothing else is on its way to the Sheet beside it.
            expect(a.state.heldReads).toHaveLength(0);

            a.state.releaseHeld(0); // the old write is answered first
            await wait(500);
            expect(await a.page.evaluate(() => localStorage.getItem('fm_sync_dirty'))).toBe(
                'replace',
            );
            expect(a.state.heldReads).toHaveLength(1); // now the read goes out

            a.state.releaseRead(0); // its snapshot is from before the backup: it does not win
            await wait(1000);

            expect(idsOf(serverRows(server))).toEqual(['TX_BACKUP']);
            expect(idsOf(await a.page.evaluate(() => transactions))).toEqual(['TX_BACKUP']);
            expect(await a.page.evaluate(() => localStorage.getItem('fm_sync_dirty'))).toBeNull();
        });
    }

    test('review vòng 8: script cũ (legacy): khôi phục sao lưu khi một lần ghi cũ còn đang chạy không bị ack của lần cũ xóa mất', async ({
        app,
    }) => {
        const server = newServer('legacy', { rows: [row('TX_OLD')] });
        const a = await app({ server, seed: syncedSeed([row('TX_OLD')]) });

        a.state.holdWrites = 1;
        await addExpense(a.page, 7000, 'tx-NEW');
        await restoreBackup(a.page, [row('TX_BACKUP')]);

        a.state.releaseHeld(0);
        await wait(1000);

        expect(idsOf(serverRows(server))).toEqual(['TX_BACKUP']);
        expect(idsOf(await a.page.evaluate(() => transactions))).toEqual(['TX_BACKUP']);
        expect(await a.page.evaluate(() => localStorage.getItem('fm_sync_dirty'))).toBeNull();
    });

    test('review vòng 10: script cũ (legacy): một lần đọc đang chờ trả lời thì lần ghi chờ sau nó rồi mới đi, giao dịch vừa thêm không bị mất', async ({
        app,
    }) => {
        const rows = [row('TX_A'), row('TX_B'), row('TX_C')];
        const server = newServer('legacy', { rows });
        const a = await app({ server, seed: syncedSeed(rows) });

        a.state.holdReads = 1;
        await a.page.evaluate(() => {
            syncFromGoogleSheet({ quiet: true });
        });
        await wait(150);
        expect(a.state.heldReads).toHaveLength(1);

        await addExpense(a.page, 7000, 'tx-D');
        await wait(500);
        expect(a.state.posts).toHaveLength(0); // the save waits for the read
        expect(notesOf(serverRows(server))).not.toContain('tx-D');

        a.state.releaseRead(0);
        await wait(900);

        expect(notesOf(serverRows(server))).toContain('tx-D');
        expect(await a.page.evaluate(() => transactions.map((item) => item.note))).toContain(
            'tx-D',
        );
        await expect(a.page.locator('#sync-status')).toContainText('Đã lưu');
    });

    for (const backend of ['v2', 'legacy']) {
        test(`review vòng 10: ${backend}: server xử lý hai lần đọc đảo thứ tự (lần đọc đầu bị chậm TRƯỚC khi server làm việc): lần đọc sau không được gửi chồng lên, dòng mới của máy khác không bị xóa khỏi máy`, async ({
            app,
        }) => {
            const rows = [row('TX_A'), row('TX_B'), row('TX_C')];
            const server = newServer(backend, { rows });
            const a = await app({ server, seed: syncedSeed(rows) });
            const notes = () => a.page.evaluate(() => transactions.map((item) => item.note).sort());
            const readAgain = () =>
                a.page.evaluate(() => {
                    syncFromGoogleSheet({ quiet: true });
                });
            // Another device adds D.
            const otherDeviceAddsD = () =>
                backend === 'v2'
                    ? server.post({ action: 'sync', upserts: [row('TX_D', { note: 'tx-D' })] })
                    : server.post({ transactions: [...rows, row('TX_D', { note: 'tx-D' })] });

            // Read A has not reached the Sheet's script yet (the lock wait, the network).
            a.state.deferReads = 1;
            await readAgain();
            await wait(150);
            expect(a.state.deferred).toHaveLength(1);

            // Whichever read the script works on next answers slowly.
            a.state.holdReads = 1;

            const getsWithA = a.state.gets;

            // Read B is asked for: it must not be sent beside A (the script could work on it first
            // and answer with a snapshot older than A's).
            await readAgain();
            await wait(300);
            expect(a.state.gets).toBe(getsWithA);

            otherDeviceAddsD();
            a.state.releaseDeferred(0); // the script now works on A: its snapshot has D
            await wait(400);
            a.state.releaseRead(0); // the slow answer arrives
            await wait(800);

            expect(await notes()).toContain('tx-D');
            expect(await notes()).toHaveLength(4);
            expect(a.state.gets).toBe(getsWithA + 1); // B went out after A was answered
            await expect(a.page.locator('#sync-status')).toContainText('Đã lưu');
        });

        test(`review vòng 10: ${backend}: lần đọc chưa được server xử lý thì lần ghi (thêm giao dịch) chờ sau nó, không đi trước`, async ({
            app,
        }) => {
            const rows = [row('TX_A'), row('TX_B'), row('TX_C')];
            const server = newServer(backend, { rows });
            const a = await app({ server, seed: syncedSeed(rows) });

            a.state.deferReads = 1;
            await a.page.evaluate(() => {
                syncFromGoogleSheet({ quiet: true });
            });
            await wait(150);
            expect(a.state.deferred).toHaveLength(1);

            await addExpense(a.page, 7000, 'tx-D');
            await wait(500);
            expect(a.state.posts).toHaveLength(0);
            expect(notesOf(serverRows(server))).not.toContain('tx-D');

            a.state.releaseDeferred(0);
            await wait(1000);

            expect(notesOf(serverRows(server))).toContain('tx-D');
            expect(await a.page.evaluate(() => transactions.length)).toBe(4);
            await expect(a.page.locator('#sync-status')).toContainText('Đã lưu');
        });
    }

    test('review vòng 10: lần đọc của Sheet cũ không bao giờ trả lời không giữ chân kết nối mới: đổi URL thì Sheet mới đọc và ghi bình thường, câu trả lời muộn của Sheet cũ bị bỏ', async ({
        app,
    }) => {
        const rows = [row('TX_1')];
        const serverA = newServer('v2', { rows });
        const serverB = newServer('v2', { rows: [row('TX_B1', { note: 'rieng-cua-B' })] });
        const a = await app({
            server: serverA,
            servers: { [URL_B]: serverB },
            seed: syncedSeed(rows),
        });
        const view = () =>
            a.page.evaluate(() => ({
                ids: transactions.map((item) => item.id).sort(),
                baseline: localStorage.getItem('fm_sync_baseline'),
            }));

        // A read of the first Sheet is stuck.
        a.state.deferReads = 1;
        await a.page.evaluate(() => {
            syncFromGoogleSheet({ quiet: true });
        });
        await wait(150);
        expect(a.state.deferred).toHaveLength(1);

        // The user switches to the second Sheet: it is not queued behind the stuck read.
        await a.page.evaluate((url) => setScriptUrl(url), URL_B);
        await wait(900);
        await expect(a.page.locator('#sync-status')).toContainText('Đã lưu');
        expect((await view()).baseline).toBe(URL_B);

        await addExpense(a.page, 7000, 'sang-B');
        await wait(600);
        expect(notesOf(serverRows(serverB))).toEqual(
            expect.arrayContaining(['rieng-cua-B', 'sang-B']),
        );

        // The first Sheet finally answers: what it says is not about the connected Sheet any more.
        serverA.post({ action: 'sync', upserts: [row('TX_ONLYA', { note: 'chi-co-o-A' })] });

        const before = await view();

        a.state.releaseDeferred(0);
        await wait(600);

        expect(await view()).toEqual(before);
        expect(before.ids).not.toContain('TX_ONLYA');
        await expect(a.page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('review vòng 10: lần đẩy xếp hàng sau một lần đọc của Sheet cũ không chạy sau khi đã đổi sang Sheet mới (không chồng lên các request của kết nối mới)', async ({
        app,
    }) => {
        const rows = [row('TX_1')];
        const serverA = newServer('v2', { rows });
        const serverB = newServer('v2', { rows: [row('TX_B1', { note: 'rieng-cua-B' })] });
        const a = await app({
            server: serverA,
            servers: { [URL_B]: serverB },
            seed: syncedSeed(rows),
        });
        const postsToB = () => a.state.posts.filter((post) => post.url.startsWith(URL_B)).length;

        // A read of the first Sheet is stuck, and a new expense queues its push behind it.
        a.state.deferReads = 1;
        await a.page.evaluate(() => {
            syncFromGoogleSheet({ quiet: true });
        });
        await wait(150);
        await addExpense(a.page, 7000, 'dang-cho');
        await wait(300);
        expect(a.state.deferred).toHaveLength(1);
        expect(a.state.posts).toHaveLength(0);

        // The user switches to the second Sheet; its first push is slow, so it is still on its way.
        a.state.holdWrites = 1;
        await a.page.evaluate((url) => setScriptUrl(url), URL_B);
        await wait(900);
        expect(a.state.held).toHaveLength(1);
        expect(postsToB()).toBe(1);

        // The stuck read of the first Sheet is answered at last, so the push queued behind it comes
        // up. It belongs to a connection that is gone: it must not send anything beside the push
        // that is on its way to the second Sheet.
        a.state.releaseDeferred(0);
        await wait(700);
        expect(postsToB()).toBe(1);

        a.state.releaseHeld(0);
        await wait(900);
        expect(notesOf(serverRows(serverB))).toEqual(
            expect.arrayContaining(['rieng-cua-B', 'dang-cho']),
        );
        expect(notesOf(serverRows(serverA))).not.toContain('dang-cho');
        await expect(a.page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('review vòng 6: khôi phục sao lưu trên máy chưa có URL: lấy URL trong file và vẫn thay toàn bộ Sheet (không bị coi là đổi URL)', async ({
        app,
    }) => {
        const server = newServer('v2', {
            rows: [row('TX_OLD')],
            properties: { FM_TOKEN: TOKEN },
        });
        const { page, state } = await app({ server, seed: { fm_script_token: TOKEN } });

        // No URL on this device yet: the file's URL is adopted (the user agrees in the dialog).
        await page.evaluate(() => localStorage.removeItem('fm_script_url'));
        await page.reload();
        await wait(300);
        await restoreBackup(page, [row('TX_9')]);
        await wait(600);

        expect(state.posts.some((post) => post.body.replace === true)).toBe(true);
        expect(serverRows(server).map((item) => item.id)).toEqual(['TX_9']);
        await expect(page.locator('#sync-review')).toBeHidden();
    });

    test('review vòng 6: cảnh báo đồng bộ nằm lại qua lần tải lại cho tới khi bấm "Đã xem"', async ({
        app,
    }) => {
        const { page } = await app({
            server: newServer('v2', { rows: [row('TX_1')], properties: { FM_TOKEN: TOKEN } }),
            seed: syncedSeed([row('TX_1')], {
                fm_script_token: TOKEN,
                fm_sync_review: JSON.stringify(['Bạn vừa đổi Google Sheet (thử)']),
            }),
        });

        await expect(page.locator('#sync-review')).toBeVisible();
        await expect(page.locator('#sync-review-list')).toContainText('Bạn vừa đổi Google Sheet');
        await page.reload();
        await expect(page.locator('#sync-review')).toBeVisible();

        await page.getByRole('button', { name: 'Đã xem' }).click();
        await expect(page.locator('#sync-review')).toBeHidden();
        await page.reload();
        await expect(page.locator('#sync-review')).toBeHidden();
        expect(await page.evaluate(() => localStorage.getItem('fm_sync_review'))).toBeNull();
    });

    test('SEC-001: tập nhỏ mất quá nửa (6 → 1) cũng hỏi', async ({ app }) => {
        const rows = Array.from({ length: 6 }, (_, i) => row(`TX_${i + 1}`));
        const server = newServer('v2', { rows });
        const { page, state } = await app({ server, seed: syncedSeed(rows) });

        server.post({ action: 'sync', deletes: ['TX_2', 'TX_3', 'TX_4', 'TX_5', 'TX_6'] });
        await page.reload();
        await wait(600);

        expect(state.confirms.some((text) => text.includes('thiếu 5 giao dịch'))).toBe(true);
        expect(await page.evaluate(() => transactions.length)).toBe(6);
    });

    test('SEC-001: máy khác xóa vài giao dịch thì vẫn nhận việc xóa mà không hỏi', async ({
        app,
    }) => {
        const rows = Array.from({ length: 12 }, (_, i) => row(`TX_${i + 1}`));
        const server = newServer('v2', { rows });
        const { page, state } = await app({ server, seed: syncedSeed(rows) });

        server.post({ action: 'sync', deletes: ['TX_1', 'TX_2', 'TX_3'] });
        await page.reload();
        await wait(600);

        expect(state.confirms).toEqual([]);
        expect(await page.evaluate(() => transactions.length)).toBe(9);
    });

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

    test('token không bao giờ nằm trong URL: đọc bằng GET không token rồi POST có token', async ({
        app,
    }) => {
        const server = newServer('v2', { rows, properties: { FM_TOKEN: 'bi-mat' } });
        const { page, state } = await app({ server, seed: { fm_script_token: 'bi-mat' } });

        await expect(page.locator('#sync-status')).toContainText('Đã lưu');
        expect(await page.evaluate(() => transactions.map((t) => t.id))).toEqual(['TX_1']);

        await addExpense(page, 5000, 'moi');
        await wait(600);

        expect(state.getUrls.length).toBeGreaterThan(0);
        state.getUrls.forEach((url) => expect(url).not.toContain('bi-mat'));
        expect(state.posts.length).toBeGreaterThan(0);
        state.posts.forEach((post) => expect(post.body.token).toBe('bi-mat'));
        // The read POST is empty: it changes nothing on the server.
        expect(state.posts[0].body).toMatchObject({ upserts: [], deletes: [], meta: {} });
        expect(serverRows(server)).toHaveLength(2);
    });

    test('server v2 chưa có mã bảo vệ: ghi chú trong Cài đặt cảnh báo, có token thì hết', async ({
        app,
    }) => {
        const open = await app({ backend: 'v2', remote: rows });

        await goTab(open.page, 'settings');
        await expect(open.page.locator('#sync-protocol-note')).toContainText('chưa có mã bảo vệ');

        const server = newServer('v2', { rows, properties: { FM_TOKEN: 'bi-mat' } });
        const locked = await app({ server, seed: { fm_script_token: 'bi-mat' } });

        await goTab(locked.page, 'settings');
        await expect(locked.page.locator('#sync-protocol-note')).toContainText('Apps Script v2');
        await expect(locked.page.locator('#sync-protocol-note')).not.toContainText(
            'chưa có mã bảo vệ',
        );
    });

    test('Code.gs chưa đặt FM_TOKEN (không FM_ALLOW_OPEN): từ chối, không đọc không ghi', async ({
        app,
    }) => {
        const server = newServer('v2', { rows, properties: {} });
        const { page, state } = await app({ server, seed: { fm_script_token: 'gi-cung-duoc' } });

        await expect(page.locator('#sync-status')).toContainText('Sai mã bảo vệ');
        expect(await page.evaluate(() => transactions.length)).toBe(0);
        // One empty read POST was refused; nothing was written.
        expect(state.posts).toHaveLength(1);
        expect(server.get({ v: '2' }).error).toBe('unauthorized');
    });

    test('SEC-002: POST lỗi mạng khi có token thì không dùng GET dự phòng, thay đổi vẫn chờ gửi', async ({
        app,
    }) => {
        const server = newServer('v2', { properties: { FM_TOKEN: 'bi-mat' } });
        const { page, state } = await app({
            server,
            seed: syncedSeed([], { fm_script_token: 'bi-mat' }),
            postFails: true,
        });

        await addExpense(page, 5000, 'cho-gui');
        await wait(400);

        expect(state.getUrls.length).toBeGreaterThan(0);
        state.getUrls.forEach((url) => {
            expect(url).not.toContain('bi-mat');
            expect(url).not.toContain('action=sync');
        });
        expect((await pending(page)).upserts).toHaveLength(1);
        expect(serverRows(server)).toEqual([]);
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

test.describe('Số dư ban đầu và quay lại cửa sổ (nhiều thiết bị)', () => {
    const NOW = '2026-10-30T03:00:00Z';
    const spay = [tx({ id: 'S1', date: '2026-10-05', source: 'Spaylater', amount: 464140 })];
    const sourcesWithLimit = JSON.stringify([
        { name: 'Tiền Mặt', kind: 'cash' },
        { name: 'Thẻ Ngân Hàng', kind: 'bank' },
        { name: 'Thẻ Tín Dụng', kind: 'credit' },
        { name: 'Spaylater', kind: 'credit', creditLimit: 30000000 },
        { name: 'Nợ Công Ty', kind: 'debt' },
    ]);
    const seed = {
        fm_transactions: JSON.stringify(spay),
        fm_sources: sourcesWithLimit,
    };
    const serverBalances = (server) => server.get({ v: '2' }).meta.initialBalances.value;
    const card = (page, name) => page.locator('#sources-grid .card', { hasText: name });

    test('Khớp số dư đẩy lên server ngay, máy khác mở lên thấy đúng dư nợ', async ({ app }) => {
        const server = newServer('v2');
        const a = await app({ server, now: NOW, seed, promptValue: '28.656.419' });

        await goTab(a.page, 'sources');
        await card(a.page, 'Spaylater').locator('button[data-action=match-balance]').click();
        await wait(500);

        // Nothing else was done on this device: the change must not wait for the next sync.
        expect(serverBalances(server).Spaylater).toBe(-879441);
        expect(await pending(a.page)).toMatchObject({ meta: [] });

        const b = await app({ server, now: NOW });

        await expect(b.page.locator('#lbl-total-debt')).toHaveText('1.343.581 đ');
    });

    test('Sửa số dư cũng đẩy lên server ngay', async ({ app }) => {
        const server = newServer('v2');
        const a = await app({ server, now: NOW, promptValue: '500.000' });

        await goTab(a.page, 'sources');
        await card(a.page, 'Tiền Mặt').locator('button[data-action=edit-balance]').click();
        await wait(500);

        expect(serverBalances(server)['Tiền Mặt']).toBe(500000);
        expect(await pending(a.page)).toMatchObject({ meta: [] });
    });

    test('lưu trữ và xóa nguồn đẩy lên server ngay', async ({ app }) => {
        const server = newServer('v2');
        const a = await app({
            server,
            now: NOW,
            seed: {
                fm_sources: JSON.stringify([
                    { name: 'Tiền Mặt', kind: 'cash' },
                    { name: 'Ví cũ', kind: 'ewallet' },
                    { name: 'Ví thừa', kind: 'ewallet' },
                ]),
            },
        });

        await goTab(a.page, 'sources');
        await card(a.page, 'Ví cũ').locator('button[data-action=archive-source]').click();
        await wait(400);

        const archived = server.get({ v: '2' }).meta.sources.value.find((s) => s.name === 'Ví cũ');

        expect(archived.archived).toBe(true);

        await card(a.page, 'Ví thừa').locator('button[data-action=delete-source]').click();
        await wait(400);

        expect(
            server.get({ v: '2' }).meta.sources.value.map((source) => source.name),
        ).not.toContain('Ví thừa');
        expect(await pending(a.page)).toMatchObject({ meta: [] });
    });

    test('máy đang mở nhận thay đổi của máy khác khi người dùng quay lại cửa sổ', async ({
        app,
    }) => {
        const server = newServer('v2');
        const a = await app({ server, now: NOW, seed });
        const b = await app({ server, now: NOW, promptValue: '28.656.419' });

        await expect(a.page.locator('#lbl-total-debt')).toHaveText('464.140 đ');

        await goTab(b.page, 'sources');
        await card(b.page, 'Spaylater').locator('button[data-action=match-balance]').click();
        await wait(500);

        // Just opened: the 30 s guard has not passed, so coming back does not read again yet.
        const before = a.state.gets;

        await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await wait(300);
        expect(a.state.gets).toBe(before);

        await a.page.evaluate(() => {
            lastPullAt = 0;
            window.dispatchEvent(new Event('focus'));
        });
        await wait(500);

        expect(a.state.gets).toBe(before + 1);
        await expect(a.page.locator('#lbl-total-debt')).toHaveText('1.343.581 đ');
        // The badge was not switched to "Đang tải..." for a background refresh that succeeded.
        await expect(a.page.locator('#sync-status')).toContainText('Đã lưu');
    });

    test('quay lại khi chưa có URL Web App hoặc chưa đọc xong thì không gọi mạng', async ({
        app,
    }) => {
        const { page, state } = await app({ now: NOW });

        await page.evaluate(() => {
            lastPullAt = 0;
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await wait(300);

        expect(state.gets).toBe(0);
    });
});
