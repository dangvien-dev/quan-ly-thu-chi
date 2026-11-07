// Paying (or collecting) a debt can also write the money into a source as a transaction.

const { test, expect, newServer, syncedSeed, goTab, scanA11y, wait, settle } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z';
const debt = (overrides = {}) => ({
    id: 'DB_1',
    party: 'Anh Nam',
    direction: 'owe',
    amount: 1000000,
    date: '2026-10-01',
    dueDate: '',
    note: '',
    payments: [],
    ...overrides,
});
const owed = debt({ id: 'DB_2', party: 'Công ty ABC', direction: 'owed', amount: 5000000 });
const open = (app, list = [debt()], extra = {}) =>
    app({ now: NOW, seed: { fm_debts: JSON.stringify(list), ...extra.seed }, ...extra.options });
const row = (page, party) => page.locator('#debt-table-body tr', { hasText: party }).first();
const SUBMIT = '#debtPayForm button[type=submit]';
const balance = (page, source) => page.evaluate((name) => calculateSourceBalances()[name], source);
const txs = (page) => page.evaluate(() => transactions);

async function openPay(page, party = 'Anh Nam') {
    await goTab(page, 'debts');
    await row(page, party).locator('[data-action=pay]').click();
}

async function pay(page, party, amount, { date, source } = {}) {
    await openPay(page, party);
    await page.fill('#debtPayAmount', String(amount));
    if (date) await page.fill('#debtPayDate', date);
    if (source !== undefined) await page.selectOption('#debtPaySource', source);
    await page.click(SUBMIT);
}

test.describe('Hộp thoại trả nợ', () => {
    test('mở sẵn số còn lại, ngày hôm nay, không ghi giao dịch; Esc đóng mà không đổi gì', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openPay(page);

        await expect(page.locator('#debtPayModal')).toHaveClass(/open/);
        await expect(page.locator('#debtPayTitle')).toHaveText('Trả nợ');
        await expect(page.locator('#debtPayMessage')).toContainText(
            'Số tiền đã trả cho [Anh Nam] (còn 1.000.000 đ)',
        );
        await expect(page.locator('#debtPayAmount')).toHaveValue('1.000.000');
        await expect(page.locator('#debtPayAmount')).toBeFocused();
        await expect(page.locator('#debtPayDate')).toHaveValue('2026-10-28');
        await expect(page.locator('#debtPaySource')).toHaveValue('');
        await expect(page.locator('#debtPaySourceHint')).toContainText(
            'không tạo giao dịch và không đổi số dư',
        );

        await page.keyboard.press('Escape');

        await expect(page.locator('#debtPayModal')).not.toHaveClass(/open/);
        await expect(page.locator('[data-action=pay]').first()).toBeFocused();
        expect(await page.evaluate(() => debts[0].payments.length)).toBe(0);
    });

    test('khoản họ nợ mình là "Thu nợ"', async ({ app }) => {
        const { page } = await open(app, [owed]);

        await openPay(page, 'Công ty ABC');

        await expect(page.locator('#debtPayTitle')).toHaveText('Thu nợ');
        await expect(page.locator('#debtPayMessage')).toContainText(
            'Số tiền đã thu từ [Công ty ABC] (còn 5.000.000 đ)',
        );
    });

    test('ô chọn nguồn không có nguồn lưu trữ và sổ tiết kiệm', async ({ app }) => {
        const { page } = await open(app, [debt()], {
            seed: {
                fm_sources: JSON.stringify([
                    { name: 'Tiền Mặt', kind: 'cash' },
                    { name: 'Vietcombank', kind: 'bank' },
                    { name: 'Sổ 6 tháng', kind: 'savings' },
                    { name: 'Ví cũ', kind: 'cash', archived: true },
                ]),
            },
        });

        await openPay(page);

        expect(await page.locator('#debtPaySource option').allInnerTexts()).toEqual([
            'Không ghi giao dịch',
            'Tiền Mặt',
            'Vietcombank',
        ]);
    });

    test('không vi phạm trợ năng và vừa màn hình điện thoại', async ({ app }) => {
        const { page } = await open(app, [debt()], {
            options: { viewport: { width: 390, height: 844 } },
        });

        await page.evaluate(() => switchTab('debts'));
        await settle(page);
        await page.locator('[data-action=pay]').first().click();
        await page.selectOption('#debtPaySource', 'Thẻ Ngân Hàng');
        await settle(page);

        const results = await scanA11y(page, '#debtPayModal');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);

        const box = await page.locator('#debtPayModal .modal-content').boundingBox();

        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);
    });
});

test.describe('Ghi vào nguồn tiền', () => {
    test('trả nợ từ một nguồn: tạo giao dịch Chi "Trả nợ", số dư nguồn giảm, danh mục được thêm', async ({
        app,
    }) => {
        const { page } = await open(app);

        await pay(page, 'Anh Nam', 400000, { date: '2026-10-27', source: 'Thẻ Ngân Hàng' });

        const [created] = await txs(page);

        expect(created).toMatchObject({
            type: 'expense',
            date: '2026-10-27',
            source: 'Thẻ Ngân Hàng',
            targetSource: null,
            category: 'Trả nợ',
            amount: 400000,
            note: 'Trả nợ Anh Nam',
        });
        expect(created.id).toMatch(/^TX_DEBT_P_\d+$/);
        expect(created.updatedAt).toBeTruthy();
        expect(await balance(page, 'Thẻ Ngân Hàng')).toBe(-400000);

        // The payment points at the transaction, and the history says where the money went.
        expect(await page.evaluate(() => debts[0].payments[0].transactionId)).toBe(created.id);
        await expect(page.locator('.debt-details')).toContainText('400.000 đ');
        await expect(page.locator('.debt-details')).toContainText('đã ghi vào Thẻ Ngân Hàng');
        await expect(page.locator('#lbl-debt-owe')).toHaveText('600.000 đ');
        await expect(page.locator('#toast-container')).toContainText(
            'Đã ghi giao dịch Chi 400.000 đ từ Thẻ Ngân Hàng.',
        );

        // The category the payments are filed under now exists, once.
        expect(
            await page.evaluate(() => categories.filter((category) => category.name === 'Trả nợ')),
        ).toMatchObject([{ type: 'expense' }]);
    });

    test('thu nợ vào một nguồn: tạo giao dịch Thu "Thu nợ", số dư nguồn tăng', async ({ app }) => {
        const { page } = await open(app, [owed]);

        await openPay(page, 'Công ty ABC');
        await page.selectOption('#debtPaySource', 'Tiền Mặt');
        await expect(page.locator('#debtPaySourceHint')).toHaveText(
            'Tạo giao dịch Thu "Thu nợ" vào Tiền Mặt: số dư Tiền Mặt tăng tương ứng.',
        );
        await page.fill('#debtPayAmount', '2000000');
        await page.click(SUBMIT);

        expect((await txs(page))[0]).toMatchObject({
            type: 'income',
            source: 'Tiền Mặt',
            category: 'Thu nợ',
            amount: 2000000,
            note: 'Thu nợ Công ty ABC',
        });
        expect(await balance(page, 'Tiền Mặt')).toBe(2000000);
        expect(await page.evaluate(() => categories.find((c) => c.name === 'Thu nợ').type)).toBe(
            'income',
        );
    });

    test('lời giải thích đổi theo nguồn đang chọn', async ({ app }) => {
        const { page } = await open(app);

        await openPay(page);
        await page.selectOption('#debtPaySource', 'Tiền Mặt');
        await expect(page.locator('#debtPaySourceHint')).toHaveText(
            'Tạo giao dịch Chi "Trả nợ" từ Tiền Mặt: số dư Tiền Mặt giảm tương ứng.',
        );
        await page.selectOption('#debtPaySource', '');
        await expect(page.locator('#debtPaySourceHint')).toContainText('Chỉ ghi vào sổ vay nợ');
    });

    test('không chọn nguồn thì không tạo giao dịch, không thêm danh mục, không đổi số dư', async ({
        app,
    }) => {
        const { page } = await open(app);
        const before = await page.evaluate(() => categories.length);

        await pay(page, 'Anh Nam', 400000);

        expect(await txs(page)).toHaveLength(0);
        expect(await page.evaluate(() => categories.length)).toBe(before);
        expect(await balance(page, 'Thẻ Ngân Hàng')).toBe(0);
        expect(await page.evaluate(() => debts[0].payments[0].transactionId)).toBeUndefined();
        await expect(page.locator('.debt-details')).not.toContainText('đã ghi vào');
    });

    test('lần sau nguồn đã chọn được chọn sẵn (kể cả sau khi tải lại); chọn "không ghi" cũng được nhớ', async ({
        app,
    }) => {
        const { page } = await open(app);

        await pay(page, 'Anh Nam', 100000, { source: 'Thẻ Ngân Hàng' });
        await row(page, 'Anh Nam').locator('[data-action=pay]').click();
        await expect(page.locator('#debtPaySource')).toHaveValue('Thẻ Ngân Hàng');
        await expect(page.locator('#debtPaySourceHint')).toContainText('từ Thẻ Ngân Hàng');

        await page.reload();
        await openPay(page);
        await expect(page.locator('#debtPaySource')).toHaveValue('Thẻ Ngân Hàng');

        await page.fill('#debtPayAmount', '50000');
        await page.selectOption('#debtPaySource', '');
        await page.click(SUBMIT);

        await row(page, 'Anh Nam').locator('[data-action=pay]').click();
        await expect(page.locator('#debtPaySource')).toHaveValue('');
    });

    test('danh mục "Trả nợ" đã có thì dùng lại, không tạo thêm', async ({ app }) => {
        const { page } = await open(app, [debt()], {
            seed: {
                fm_categories: JSON.stringify([
                    { id: 1, name: 'Ăn uống', type: 'expense', icon: 'fa-utensils' },
                    { id: 77, name: 'Trả nợ', type: 'expense', icon: 'fa-tag' },
                ]),
            },
        });

        await pay(page, 'Anh Nam', 100000, { source: 'Tiền Mặt' });
        await pay(page, 'Anh Nam', 100000, { source: 'Tiền Mặt' });

        expect(
            await page.evaluate(() => categories.filter((c) => c.name === 'Trả nợ').length),
        ).toBe(1);
        expect(await txs(page)).toHaveLength(2);
        expect(new Set((await txs(page)).map((t) => t.id)).size).toBe(2);
    });

    test('nguồn bị xóa hoặc lưu trữ trong lúc hộp thoại mở thì báo, chưa ghi gì', async ({
        app,
    }) => {
        const { page, state } = await open(app);

        await openPay(page);
        await page.selectOption('#debtPaySource', 'Tiền Mặt');
        await page.evaluate(() => {
            sources.find((source) => source.name === 'Tiền Mặt').archived = true;
        });
        await page.click(SUBMIT);

        expect(state.alerts.at(-1)).toContain('không còn dùng được');
        expect(await txs(page)).toHaveLength(0);
        expect(await page.evaluate(() => debts[0].payments.length)).toBe(0);
        await expect(page.locator('#debtPayModal')).toHaveClass(/open/);
    });
});

test.describe('Xóa lần thanh toán đã ghi giao dịch', () => {
    test('xóa lần thanh toán thì xóa luôn giao dịch của nó, số dư nguồn về như cũ', async ({
        app,
    }) => {
        const { page, state } = await open(app);

        await pay(page, 'Anh Nam', 400000, { source: 'Thẻ Ngân Hàng' });
        expect(await balance(page, 'Thẻ Ngân Hàng')).toBe(-400000);

        await page.click('.debt-details [data-action=delete-payment]');

        expect(state.confirms.at(-1)).toContain('Giao dịch đã ghi từ lần này cũng sẽ bị xóa');
        expect(await txs(page)).toHaveLength(0);
        expect(await balance(page, 'Thẻ Ngân Hàng')).toBe(0);
        await expect(page.locator('#lbl-debt-owe')).toHaveText('1.000.000 đ');
    });

    test('lần thanh toán không ghi giao dịch: hỏi như cũ, không đụng giao dịch nào', async ({
        app,
    }) => {
        const { page, state } = await open(app, [debt()], {
            seed: {
                fm_transactions: JSON.stringify([
                    {
                        id: 'KEEP',
                        date: '2026-10-05',
                        type: 'expense',
                        source: 'Tiền Mặt',
                        category: 'Ăn uống',
                        amount: 10000,
                        note: '',
                    },
                ]),
            },
        });

        await pay(page, 'Anh Nam', 400000);
        await page.click('.debt-details [data-action=delete-payment]');

        expect(state.confirms.at(-1)).toBe('Xóa lần thanh toán này?');
        expect((await txs(page)).map((t) => t.id)).toEqual(['KEEP']);
    });

    test('giao dịch đã bị xóa tay từ Sổ Giao Dịch: lần thanh toán vẫn còn, xóa nó không báo gì thêm', async ({
        app,
    }) => {
        const { page, state } = await open(app);

        await pay(page, 'Anh Nam', 400000, { source: 'Tiền Mặt' });
        await page.evaluate(() => {
            transactions = [];
            renderAll();
        });
        await expect(page.locator('.debt-details')).not.toContainText('đã ghi vào');

        await page.click('.debt-details [data-action=delete-payment]');

        expect(state.confirms.at(-1)).toBe('Xóa lần thanh toán này?');
        await expect(page.locator('#lbl-debt-owe')).toHaveText('1.000.000 đ');
    });
});

test.describe('Đồng bộ', () => {
    test('giao dịch, danh mục mới và sổ nợ cùng lên Sheet v2', async ({ app }) => {
        const server = newServer('v2');
        const { page } = await app({
            server,
            now: NOW,
            seed: syncedSeed([], { fm_debts: JSON.stringify([debt()]) }),
        });

        await pay(page, 'Anh Nam', 400000, { source: 'Thẻ Ngân Hàng' });
        await wait(400);

        const state = server.get({ v: '2' });
        const created = (await txs(page))[0];
        const remote = state.transactions.find((t) => t.id === created.id);

        expect(remote).toMatchObject({
            type: 'expense',
            source: 'Thẻ Ngân Hàng',
            category: 'Trả nợ',
            amount: 400000,
            note: 'Trả nợ Anh Nam',
        });
        expect(state.meta.debts.value[0].payments[0].transactionId).toBe(created.id);
        expect(state.meta.categories.value.map((c) => c.name)).toContain('Trả nợ');
    });

    test('xóa lần thanh toán thì giao dịch cũng bị xóa trên Sheet', async ({ app }) => {
        const server = newServer('v2');
        const { page } = await app({
            server,
            now: NOW,
            seed: syncedSeed([], { fm_debts: JSON.stringify([debt()]) }),
        });

        await pay(page, 'Anh Nam', 400000, { source: 'Tiền Mặt' });
        await wait(400);
        expect(server.get({ v: '2' }).transactions).toHaveLength(1);

        await page.click('.debt-details [data-action=delete-payment]');
        await wait(400);

        expect(server.get({ v: '2' }).transactions).toHaveLength(0);
        expect(server.get({ v: '2' }).meta.debts.value[0].payments).toHaveLength(0);
    });
});
