// Editing one payment of a debt: the amount, the date and the source follow into the transaction
// the payment wrote, and a transaction deleted from the book can be written again.

const { test, expect, newServer, syncedSeed, goTab, scanA11y, wait, settle } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z';
const CASH = 'Tiền Mặt';
const BANK = 'Thẻ Ngân Hàng';
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
const payments = (page, index = 0) => page.evaluate((i) => debts[i].payments, index);
const stored = (page, key) => page.evaluate((name) => localStorage.getItem(name), key);
const details = (page) => page.locator('.debt-details');

async function pay(page, party, amount, { date, source } = {}) {
    await goTab(page, 'debts');
    await row(page, party).locator('[data-action=pay]').click();
    await page.fill('#debtPayAmount', String(amount));
    if (date) await page.fill('#debtPayDate', date);
    if (source !== undefined) await page.selectOption('#debtPaySource', source);
    await page.click(SUBMIT);
}

/** Open the edit dialog of a payment (the history is open after paying; open it otherwise). */
async function openEdit(page, party = 'Anh Nam', index = 0) {
    await goTab(page, 'debts');

    const toggle = row(page, party).locator('[data-action=history]');

    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();

    await details(page).locator('[data-action=edit-payment]').nth(index).click();
}

async function edit(page, changes, party = 'Anh Nam', index = 0) {
    await openEdit(page, party, index);
    if (changes.amount !== undefined) await page.fill('#debtPayAmount', String(changes.amount));
    if (changes.date) await page.fill('#debtPayDate', changes.date);
    if (changes.source !== undefined) await page.selectOption('#debtPaySource', changes.source);
    await page.click(SUBMIT);
}

test.describe('Sửa một lần trả', () => {
    test('hộp thoại mở sẵn số tiền, ngày và nguồn của lần trả; Esc đóng mà không đổi gì', async ({
        app,
    }) => {
        const { page } = await open(app);

        await pay(page, 'Anh Nam', 400000, { date: '2026-10-20', source: CASH });
        await openEdit(page);

        await expect(page.locator('#debtPayModal')).toHaveClass(/open/);
        await expect(page.locator('#debtPayTitle')).toHaveText('Sửa lần trả nợ');
        await expect(page.locator('#debtPayMessage')).toContainText(
            'Sửa số tiền đã trả cho [Anh Nam] (tối đa 1.000.000 đ, gồm lần này)',
        );
        await expect(page.locator('#debtPayAmount')).toHaveValue('400.000');
        await expect(page.locator('#debtPayAmount')).toBeFocused();
        await expect(page.locator('#debtPayDate')).toHaveValue('2026-10-20');
        await expect(page.locator('#debtPaySource')).toHaveValue(CASH);
        await expect(page.locator('#debtPaySourceHint')).toContainText(
            `Cập nhật giao dịch đã ghi vào ${CASH}`,
        );

        await page.keyboard.press('Escape');

        await expect(page.locator('#debtPayModal')).not.toHaveClass(/open/);
        await expect(details(page).locator('[data-action=edit-payment]')).toBeFocused();
        expect(await payments(page)).toHaveLength(1);
        expect((await payments(page))[0]).toMatchObject({ amount: 400000, date: '2026-10-20' });
    });

    test('sửa số tiền: giao dịch, số dư nguồn và số còn nợ đổi theo; id giữ nguyên', async ({
        app,
    }) => {
        const { page } = await open(app);

        await pay(page, 'Anh Nam', 400000, { source: CASH });

        const before = (await txs(page))[0];

        expect(await balance(page, CASH)).toBe(-400000);
        await expect(page.locator('#lbl-debt-owe')).toHaveText('600.000 đ');

        // Later in the day: the edit stamps the transaction anew, which is what a sync goes by.
        await page.clock.setFixedTime(new Date('2026-10-28T05:00:00Z'));
        await edit(page, { amount: 250000 });

        const after = await txs(page);

        expect(after).toHaveLength(1);
        expect(after[0]).toMatchObject({
            id: before.id,
            amount: 250000,
            type: 'expense',
            category: 'Trả nợ',
            source: CASH,
            note: 'Trả nợ Anh Nam',
        });
        expect(before.updatedAt).toBe('2026-10-28T03:00:00.000Z');
        expect(after[0].updatedAt).toBe('2026-10-28T05:00:00.000Z');
        expect(await balance(page, CASH)).toBe(-250000);
        await expect(page.locator('#lbl-debt-owe')).toHaveText('750.000 đ');
        await expect(row(page, 'Anh Nam')).toContainText('250.000 đ');
        await expect(details(page).locator('li b')).toHaveText('250.000 đ');
        await expect(page.locator('#toast-container')).toContainText(
            'Đã cập nhật lần thanh toán và giao dịch Chi 250.000 đ từ Tiền Mặt.',
        );
        // The list was drawn again; the focus is back on the payment that was edited.
        await expect(details(page).locator('[data-action=edit-payment]')).toBeFocused();
        await expect(page.locator('#debtPayModal')).not.toHaveClass(/open/);
    });

    test('sửa ngày: giao dịch và lần trả cùng đổi ngày', async ({ app }) => {
        const { page } = await open(app);

        await pay(page, 'Anh Nam', 400000, { date: '2026-10-20', source: CASH });
        await edit(page, { date: '2026-10-05' });

        expect((await txs(page))[0].date).toBe('2026-10-05');
        expect((await payments(page))[0].date).toBe('2026-10-05');
        await expect(details(page).locator('li span').first()).toHaveText('05/10/2026');
    });

    test('sửa nguồn: giao dịch chuyển sang nguồn mới, số dư hai nguồn đổi đúng', async ({
        app,
    }) => {
        const { page } = await open(app);

        await pay(page, 'Anh Nam', 400000, { source: CASH });
        await openEdit(page);
        await page.selectOption('#debtPaySource', BANK);
        await expect(page.locator('#debtPaySourceHint')).toContainText(
            `chuyển từ ${CASH} sang ${BANK}`,
        );
        await page.click(SUBMIT);

        const list = await txs(page);

        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ source: BANK, amount: 400000 });
        expect(await balance(page, CASH)).toBe(0);
        expect(await balance(page, BANK)).toBe(-400000);
        await expect(details(page)).toContainText(`đã ghi vào ${BANK}`);
    });

    test('đổi về "Không ghi giao dịch": hỏi trước; hủy thì không đổi gì, đồng ý thì xóa giao dịch', async ({
        app,
    }) => {
        const { page, state } = await open(app);

        await pay(page, 'Anh Nam', 400000, { source: CASH });
        const id = (await txs(page))[0].id;

        await openEdit(page);
        await page.fill('#debtPayAmount', '300000');
        await page.selectOption('#debtPaySource', '');
        await expect(page.locator('#debtPaySourceHint')).toContainText(
            `Bỏ ghi giao dịch: giao dịch đã ghi vào ${CASH} sẽ bị xóa`,
        );

        // Declined: nothing changes and the dialog stays open.
        await page.evaluate(() => {
            window.confirm = () => false;
        });
        await page.click(SUBMIT);

        await expect(page.locator('#debtPayModal')).toHaveClass(/open/);
        expect(await txs(page)).toHaveLength(1);
        expect((await payments(page))[0]).toMatchObject({ amount: 400000, transactionId: id });

        // Accepted: the transaction goes, the payment keeps its new amount.
        await page.evaluate(() => {
            window.confirm = () => true;
        });
        await page.click(SUBMIT);

        expect(await txs(page)).toHaveLength(0);
        expect(await balance(page, CASH)).toBe(0);
        expect((await payments(page))[0]).toEqual(
            expect.objectContaining({ amount: 300000, date: '2026-10-28' }),
        );
        expect((await payments(page))[0].transactionId).toBeUndefined();
        expect(JSON.parse(await stored(page, 'fm_deleted_ids'))).toContain(id);
        await expect(page.locator('#lbl-debt-owe')).toHaveText('700.000 đ');
        await expect(details(page)).not.toContainText('đã ghi vào');
        expect(state.errors).toEqual([]);
    });

    test('lần trả chưa ghi giao dịch: chọn nguồn thì ghi giao dịch với id suy ra từ lần trả', async ({
        app,
    }) => {
        const { page } = await open(app);

        await pay(page, 'Anh Nam', 400000, { source: '' });
        expect(await txs(page)).toHaveLength(0);

        await openEdit(page);
        await expect(page.locator('#debtPaySource')).toHaveValue('');
        await expect(page.locator('#debtPaySourceHint')).toContainText(
            'Chỉ ghi vào sổ vay nợ, không tạo giao dịch',
        );
        await page.selectOption('#debtPaySource', CASH);
        await page.click(SUBMIT);

        const [payment] = await payments(page);
        const [written] = await txs(page);

        expect(written).toMatchObject({
            id: `TX_DEBT_${payment.id}`,
            type: 'expense',
            category: 'Trả nợ',
            source: CASH,
            amount: 400000,
            date: '2026-10-28',
        });
        expect(payment.transactionId).toBe(written.id);
        expect(await balance(page, CASH)).toBe(-400000);
        await expect(details(page)).toContainText(`đã ghi vào ${CASH}`);
    });

    test('khoản họ nợ mình: sửa lần thu thì giao dịch Thu đổi theo', async ({ app }) => {
        const { page } = await open(app, [owed]);

        await pay(page, 'Công ty ABC', 2000000, { source: BANK });
        await openEdit(page, 'Công ty ABC');

        await expect(page.locator('#debtPayTitle')).toHaveText('Sửa lần thu nợ');
        await expect(page.locator('#debtPayMessage')).toContainText(
            'Sửa số tiền đã thu từ [Công ty ABC] (tối đa 5.000.000 đ, gồm lần này)',
        );

        await page.fill('#debtPayAmount', '3500000');
        await page.click(SUBMIT);

        expect((await txs(page))[0]).toMatchObject({
            type: 'income',
            category: 'Thu nợ',
            amount: 3500000,
        });
        expect(await balance(page, BANK)).toBe(3500000);
        await expect(page.locator('#lbl-debt-owed')).toHaveText('1.500.000 đ');
    });

    test('số tiền tối đa là số còn lại cộng chính lần này; vượt hoặc bằng 0 thì báo', async ({
        app,
    }) => {
        const { page, state } = await open(app);

        await pay(page, 'Anh Nam', 400000, { source: CASH });
        await openEdit(page);

        await page.fill('#debtPayAmount', '1000001');
        await page.click(SUBMIT);
        expect(state.alerts.at(-1)).toBe(
            'Số tiền vượt quá số còn lại (1.000.000 đ, tính cả lần này).',
        );
        await expect(page.locator('#debtPayModal')).toHaveClass(/open/);

        await page.fill('#debtPayAmount', '0');
        await page.click(SUBMIT);
        expect(state.alerts.at(-1)).toBe('Số tiền không hợp lệ!');

        // Up to the limit is fine, and it settles the debt.
        await page.fill('#debtPayAmount', '1000000');
        await page.click(SUBMIT);

        await expect(page.locator('#debtPayModal')).not.toHaveClass(/open/);
        await expect(page.locator('#lbl-debt-owe')).toHaveText('0 đ');
        // Settled debts are hidden by default.
        await page.uncheck('#debt-hide-settled');
        await expect(row(page, 'Anh Nam')).toContainText('Đã tất toán');
        expect((await txs(page))[0].amount).toBe(1000000);
    });

    test('nguồn đã lưu trữ vẫn được giữ khi chỉ sửa số tiền, nhưng không chọn lại được sau khi đổi', async ({
        app,
    }) => {
        const { page, state } = await open(app);

        await pay(page, 'Anh Nam', 400000, { source: BANK });
        await page.evaluate((name) => {
            sources.find((source) => source.name === name).archived = true;
            renderAll();
        }, BANK);
        await openEdit(page);

        await expect(page.locator('#debtPaySource')).toHaveValue(BANK);
        await expect(page.locator(`#debtPaySource option[value="${BANK}"]`)).toHaveText(
            `${BANK} (không còn dùng)`,
        );

        await page.fill('#debtPayAmount', '350000');
        await page.click(SUBMIT);

        expect(state.alerts).toEqual([]);
        expect((await txs(page))[0]).toMatchObject({ source: BANK, amount: 350000 });

        // Moved to another source, the archived one is no longer on offer.
        await edit(page, { source: CASH });
        await openEdit(page);
        await expect(page.locator('#debtPaySource option', { hasText: BANK })).toHaveCount(0);
    });

    test('lần trả bị xóa ở máy khác trong lúc hộp thoại mở: báo và không ghi gì', async ({
        app,
    }) => {
        const { page, state } = await open(app);

        await pay(page, 'Anh Nam', 400000, { source: CASH });
        await openEdit(page);
        await page.evaluate(() => {
            debts[0].payments = [];
        });
        await page.click(SUBMIT);

        expect(state.alerts.at(-1)).toContain('không còn nữa');
        await expect(page.locator('#debtPayModal')).not.toHaveClass(/open/);
        expect(await txs(page)).toHaveLength(1);
    });
});

test.describe('Giao dịch của lần trả đã bị xóa', () => {
    test('hiện rõ trạng thái bằng biểu tượng và chữ; Ghi lại mở hộp thoại với nguồn dùng lần trước', async ({
        app,
    }) => {
        const { page } = await open(app);

        await pay(page, 'Anh Nam', 400000, { source: BANK });
        const id = (await txs(page))[0].id;

        await expect(details(page)).toContainText(`đã ghi vào ${BANK}`);
        await page.evaluate((txId) => deleteTransaction(txId), id);
        await goTab(page, 'debts');

        await expect(details(page)).not.toContainText('đã ghi vào');
        await expect(details(page)).toContainText('Giao dịch đã ghi đã bị xóa');
        await expect(details(page).locator('i.fa-triangle-exclamation')).toHaveCount(1);
        await expect(details(page).locator('.source-warn')).toHaveCount(1);

        await details(page).locator('[data-action=rewrite-payment]').click();

        await expect(page.locator('#debtPayTitle')).toHaveText('Sửa lần trả nợ');
        await expect(page.locator('#debtPaySource')).toHaveValue(BANK);
        await expect(page.locator('#debtPaySourceHint')).toContainText(
            'Giao dịch đã ghi từ lần này đã bị xóa; lưu sẽ ghi lại.',
        );
    });

    test('ghi lại: giao dịch trở lại với cùng id, số dư đúng, và không còn nằm trong hàng chờ xóa', async ({
        app,
    }) => {
        const { page } = await open(app);

        await pay(page, 'Anh Nam', 400000, { source: CASH });
        const [payment] = await payments(page);

        await page.evaluate((id) => deleteTransaction(id), payment.transactionId);
        expect(await balance(page, CASH)).toBe(0);
        // Nothing syncs here, so the deletion is still waiting to be sent.
        expect(JSON.parse(await stored(page, 'fm_deleted_ids'))).toContain(payment.transactionId);

        await goTab(page, 'debts');
        await details(page).locator('[data-action=rewrite-payment]').click();
        await page.fill('#debtPayAmount', '450000');
        await page.click(SUBMIT);

        const [written] = await txs(page);

        expect(written).toMatchObject({
            id: payment.transactionId,
            source: CASH,
            amount: 450000,
            type: 'expense',
        });
        expect(await balance(page, CASH)).toBe(-450000);
        await expect(details(page)).toContainText(`đã ghi vào ${CASH}`);
        await expect(details(page)).not.toContainText('đã bị xóa');
        // The new write replaces the deletion that had not been sent.
        expect(await stored(page, 'fm_deleted_ids')).toBeNull();
        expect(JSON.parse(await stored(page, 'fm_pending_upserts'))).toContain(written.id);
    });

    test('chọn "Không ghi giao dịch": cảnh báo biến mất và không ghi gì', async ({ app }) => {
        const { page } = await open(app);

        await pay(page, 'Anh Nam', 400000, { source: CASH });
        await page.evaluate((id) => deleteTransaction(id), (await txs(page))[0].id);
        await goTab(page, 'debts');
        await details(page).locator('[data-action=rewrite-payment]').click();
        await page.selectOption('#debtPaySource', '');
        await page.click(SUBMIT);

        expect(await txs(page)).toHaveLength(0);
        expect((await payments(page))[0].transactionId).toBeUndefined();
        await expect(details(page)).not.toContainText('đã bị xóa');
        await expect(details(page).locator('[data-action=rewrite-payment]')).toHaveCount(0);
    });
});

test.describe('Sửa lần trả và đồng bộ', () => {
    const remote = (server) => server.get({ v: '2' });

    test('sửa số tiền và nguồn: hàng của giao dịch trên Sheet v2 đổi theo, không thêm hàng', async ({
        app,
    }) => {
        const server = newServer('v2');
        const { page } = await app({
            server,
            now: NOW,
            seed: syncedSeed([], { fm_debts: JSON.stringify([debt()]) }),
        });

        await pay(page, 'Anh Nam', 400000, { source: CASH });
        await wait(400);

        const id = (await txs(page))[0].id;

        await edit(page, { amount: 250000, source: BANK });
        await wait(400);

        const state = remote(server);

        expect(state.transactions).toHaveLength(1);
        expect(state.transactions[0]).toMatchObject({
            id,
            source: BANK,
            amount: 250000,
            type: 'expense',
            category: 'Trả nợ',
        });
        expect(state.meta.debts.value[0].payments[0]).toMatchObject({
            amount: 250000,
            transactionId: id,
        });
    });

    test('đổi về "Không ghi giao dịch" thì hàng của giao dịch bị xóa trên Sheet', async ({
        app,
    }) => {
        const server = newServer('v2');
        const { page } = await app({
            server,
            now: NOW,
            seed: syncedSeed([], { fm_debts: JSON.stringify([debt()]) }),
        });

        await pay(page, 'Anh Nam', 400000, { source: CASH });
        await wait(400);
        expect(remote(server).transactions).toHaveLength(1);

        await edit(page, { source: '' });
        await wait(400);

        expect(remote(server).transactions).toHaveLength(0);
        expect(remote(server).meta.debts.value[0].payments[0].transactionId).toBeUndefined();
    });

    test('ghi lại khi lần xóa chưa kịp lên Sheet: giao dịch vẫn còn trên Sheet, không bị xóa nhầm', async ({
        app,
    }) => {
        const server = newServer('v2');
        const { page } = await app({
            server,
            now: NOW,
            seed: syncedSeed([], { fm_debts: JSON.stringify([debt()]) }),
        });

        await pay(page, 'Anh Nam', 400000, { source: CASH });
        await wait(400);

        const id = (await txs(page))[0].id;

        expect(remote(server).transactions).toHaveLength(1);

        // Deleted here, but the deletion has not been sent yet.
        await page.evaluate((txId) => {
            transactions = transactions.filter((item) => item.id !== txId);
            queueDelete([txId]);
            saveDataLocally();
            renderAll();
        }, id);

        await goTab(page, 'debts');
        await details(page).locator('[data-action=rewrite-payment]').click();
        await page.click(SUBMIT);
        await wait(400);

        expect(remote(server).transactions.map((item) => item.id)).toEqual([id]);
        expect((await txs(page)).map((item) => item.id)).toEqual([id]);
        expect(await stored(page, 'fm_deleted_ids')).toBeNull();
    });
});

test.describe('Sửa lần trả: giao diện', () => {
    test('trợ năng: hộp thoại sửa và danh sách có dòng "đã bị xóa" không vi phạm axe', async ({
        app,
    }) => {
        const { page } = await open(app);

        await pay(page, 'Anh Nam', 400000, { source: CASH });
        await pay(page, 'Anh Nam', 100000, { source: BANK });
        await page.evaluate((id) => deleteTransaction(id), (await txs(page))[1].id);
        await goTab(page, 'debts');
        await settle(page);

        const list = await scanA11y(page, '#tab-debts');

        expect(list.violations.map((violation) => violation.id)).toEqual([]);

        await details(page).locator('[data-action=edit-payment]').first().click();
        await settle(page);

        const dialog = await scanA11y(page, '#debtPayModal');

        expect(dialog.violations.map((violation) => violation.id)).toEqual([]);
    });

    test('điện thoại: dòng lần trả có nút sửa, xóa và ghi lại không tràn ngang', async ({
        app,
    }) => {
        const { page } = await open(app, [debt()], {
            options: { viewport: { width: 390, height: 844 } },
        });

        await page.evaluate(() => switchTab('debts'));
        await page.locator('[data-action=pay]').first().click();
        await page.fill('#debtPayAmount', '400000');
        await page.selectOption('#debtPaySource', CASH);
        await page.click(SUBMIT);
        await page.evaluate((id) => deleteTransaction(id), (await txs(page))[0].id);
        await page.evaluate(() => switchTab('debts'));
        await settle(page);

        const item = details(page).locator('li').first();

        await expect(item.locator('[data-action=rewrite-payment]')).toBeVisible();
        await expect(item.locator('[data-action=edit-payment]')).toBeVisible();
        await expect(item.locator('[data-action=delete-payment]')).toBeVisible();
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);

        const box = await item.boundingBox();

        expect(box.x + box.width).toBeLessThanOrEqual(390);
    });
});
