// Debt ledger: add, part payments, overdue handling.

const { test, expect, goTab, wait } = require('./helpers');

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
const withDebts = (list, extra = {}) => ({
    now: NOW,
    seed: { fm_debts: JSON.stringify(list) },
    ...extra,
});
const row = (page, party) => page.locator('#debt-table-body tr', { hasText: party }).first();

async function addDebt(page, fields) {
    await goTab(page, 'debts');
    await page.click('button:has-text("Thêm Khoản")');
    await page.fill('#debtParty', fields.party);
    if (fields.direction) await page.selectOption('#debtDirection', fields.direction);
    await page.fill('#debtAmount', String(fields.amount));
    if (fields.date) await page.fill('#debtDate', fields.date);
    if (fields.due) await page.fill('#debtDue', fields.due);
    if (fields.note) await page.fill('#debtNote', fields.note);
    await page.click('#debtForm button[type=submit]');
}

test.describe('Sổ vay nợ', () => {
    test('thêm khoản mình nợ và khoản họ nợ mình, thẻ tổng hợp cập nhật', async ({ app }) => {
        const { page } = await app({ now: NOW });

        await addDebt(page, { party: 'Anh Nam', amount: 2000000, due: '2026-12-01' });
        await addDebt(page, {
            party: 'Công ty ABC',
            direction: 'owed',
            amount: 5000000,
            note: 'Ứng tiền mua vật tư',
        });

        await expect(page.locator('#lbl-debt-owe')).toHaveText('2.000.000 đ');
        await expect(page.locator('#lbl-debt-owed')).toHaveText('5.000.000 đ');
        await expect(page.locator('#lbl-debt-overdue')).toHaveText('Không có');
        await expect(row(page, 'Anh Nam')).toContainText('Tôi nợ');
        await expect(row(page, 'Công ty ABC')).toContainText('Họ nợ tôi');
    });

    test('ghi thanh toán từng phần rồi tất toán; khoản đã tất toán bị ẩn mặc định', async ({
        app,
    }) => {
        const { page } = await app({ ...withDebts([debt()]), promptValue: '400.000' });

        await goTab(page, 'debts');
        await row(page, 'Anh Nam').locator('[data-action=pay]').click();

        await expect(row(page, 'Anh Nam')).toContainText('600.000 đ');
        await expect(page.locator('#lbl-debt-owe')).toHaveText('600.000 đ');
        // the payment history opens by itself
        await expect(page.locator('.debt-details')).toContainText('400.000 đ');

        await page.evaluate(() => {
            window.prompt = () => '600000';
        });
        await row(page, 'Anh Nam').locator('[data-action=pay]').click();

        await expect(page.locator('#debt-table-body')).toContainText('Không có khoản nào đang nợ');
        await expect(page.locator('#lbl-debt-owe')).toHaveText('0 đ');

        await page.uncheck('#debt-hide-settled');
        await expect(row(page, 'Anh Nam')).toContainText('Đã tất toán');
        await expect(row(page, 'Anh Nam').locator('[data-action=pay]')).toHaveCount(0);
    });

    test('từ chối thanh toán vượt số còn lại hoặc không hợp lệ', async ({ app }) => {
        const first = await app({ ...withDebts([debt()]), promptValue: '1.500.000' });

        await goTab(first.page, 'debts');
        await row(first.page, 'Anh Nam').locator('[data-action=pay]').click();
        expect(first.state.alerts.at(-1)).toContain('vượt quá');

        const second = await app({ ...withDebts([debt()]), promptValue: 'abc' });

        await goTab(second.page, 'debts');
        await row(second.page, 'Anh Nam').locator('[data-action=pay]').click();
        expect(second.state.alerts.at(-1)).toContain('không hợp lệ');
        expect(await second.page.evaluate(() => debts[0].payments.length)).toBe(0);
    });

    test('xóa một lần thanh toán trong lịch sử', async ({ app }) => {
        const { page } = await app(
            withDebts([debt({ payments: [{ id: 'P1', date: '2026-10-05', amount: 300000 }] })]),
        );

        await goTab(page, 'debts');
        await row(page, 'Anh Nam').locator('[data-action=history]').click();
        await expect(page.locator('.debt-details')).toContainText('300.000 đ');
        await page.click('.debt-details [data-action=delete-payment]');

        await expect(page.locator('#lbl-debt-owe')).toHaveText('1.000.000 đ');
    });

    test('khoản quá hạn: huy hiệu số ngày, thẻ Quá hạn, và nhắc một lần mỗi ngày', async ({
        app,
    }) => {
        const { page } = await app(
            withDebts([
                debt({ dueDate: '2026-10-20' }),
                debt({ id: 'DB_2', party: 'Chị Lan', dueDate: '2026-11-02' }),
            ]),
        );

        await expect(page.locator('#toast-container')).toContainText(
            '1 khoản vay nợ quá hạn (1.000.000 đ)',
        );

        await goTab(page, 'debts');
        await expect(page.locator('#lbl-debt-overdue')).toHaveText('1 khoản · 1.000.000 đ');
        await expect(row(page, 'Anh Nam')).toContainText('Quá hạn 8 ngày');
        await expect(row(page, 'Chị Lan')).toContainText('Sắp đến hạn');

        await page.reload();
        await wait(200);
        await expect(page.locator('#toast-container .toast')).toHaveCount(0);
    });

    test('sửa khoản: không cho giảm số gốc dưới số đã trả; hạn phải sau ngày vay', async ({
        app,
    }) => {
        const { page, state } = await app(
            withDebts([debt({ payments: [{ id: 'P1', date: '2026-10-05', amount: 600000 }] })]),
        );

        await goTab(page, 'debts');
        await row(page, 'Anh Nam').locator('[data-action=edit]').click();
        await page.fill('#debtAmount', '500000');
        await page.click('#debtForm button[type=submit]');
        expect(state.alerts.at(-1)).toContain('không được nhỏ hơn số đã thanh toán');

        await page.fill('#debtAmount', '900000');
        await page.fill('#debtDue', '2026-09-01');
        await page.click('#debtForm button[type=submit]');
        expect(state.alerts.at(-1)).toContain('Hạn thanh toán phải sau ngày vay');

        await page.fill('#debtDue', '2026-12-01');
        await page.click('#debtForm button[type=submit]');
        await expect(page.locator('#lbl-debt-owe')).toHaveText('300.000 đ');
    });

    test('xóa khoản vay nợ', async ({ app }) => {
        const { page } = await app(withDebts([debt()]));

        await goTab(page, 'debts');
        await row(page, 'Anh Nam').locator('[data-action=delete]').click();

        await expect(page.locator('#debt-table-body')).toContainText('Chưa có khoản vay nợ');
    });

    test('dữ liệu độc hại trong tên đối tác không được thực thi', async ({ app }) => {
        const { page } = await app(
            withDebts([
                debt({
                    party: '<img src=x onerror="window.__debtxss=1">',
                    note: '<b id=pwn>x</b>',
                }),
            ]),
        );

        await goTab(page, 'debts');
        await row(page, 'img').locator('[data-action=history]').click();

        expect(await page.evaluate(() => window.__debtxss)).toBeUndefined();
        await expect(page.locator('#pwn')).toHaveCount(0);
    });

    test('còn sau khi tải lại và nằm trong sao lưu', async ({ app }) => {
        const { page } = await app(withDebts([debt()]));

        await page.reload();
        expect(await page.evaluate(() => debts.map((item) => item.party))).toEqual(['Anh Nam']);

        const backup = await page.evaluate(() => ({
            format: 'finmanager-backup',
            version: 1,
            exportedAt: 'x',
            data: { transactions: [], categories, initialBalances, debts, scriptUrl: '' },
        }));
        const other = await app();

        await goTab(other.page, 'settings');
        await other.page.setInputFiles('input[type=file]', {
            name: 'b.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(backup)),
        });
        await wait(300);

        expect(await other.page.evaluate(() => debts.map((item) => item.party))).toEqual([
            'Anh Nam',
        ]);
    });
});
