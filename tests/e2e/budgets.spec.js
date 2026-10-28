// Monthly budgets per expense category.

const fs = require('fs');
const { test, expect, tx, goTab, wait } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z';
const withBudget = (limits, rows = []) => ({
    now: NOW,
    seed: { fm_budgets: JSON.stringify(limits), fm_transactions: JSON.stringify(rows) },
});

async function addExpense(page, { amount, category = 'Ăn uống', date }) {
    await page.click('header .btn');
    await page.fill('#txAmount', String(amount));
    await page.selectOption('#txCategory', category);

    if (date) await page.fill('#txDate', date);

    await page.click('#transactionForm button[type=submit]');
}

const toasts = (page) => page.locator('#toast-container .toast');

test.describe('Đặt ngân sách', () => {
    test('đặt ngân sách kiểu VN trong tab Danh mục rồi hiện ở bảng và Tổng quan', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW, promptValue: '2.000.000' });

        await expect(page.locator('#budget-section')).toBeHidden();

        await goTab(page, 'categories');
        await page.click('#category-table-body tr:has-text("Ăn uống") [data-action=budget]');
        await expect(page.locator('#category-table-body tr:has-text("Ăn uống")')).toContainText(
            '2.000.000 đ',
        );

        await goTab(page, 'overview');
        await expect(page.locator('#budget-section')).toBeVisible();
        await expect(page.locator('#budget-list')).toContainText('Ăn uống');
        await expect(page.locator('#budget-list')).toContainText('0 đ / 2.000.000 đ');
    });

    test('danh mục thu nhập không có nút đặt ngân sách', async ({ app }) => {
        const { page } = await app();

        await goTab(page, 'categories');

        await expect(
            page.locator('#category-table-body tr:has-text("Lương") [data-action=budget]'),
        ).toHaveCount(0);
    });

    test('nhập 0 hoặc để trống thì bỏ ngân sách; số không hợp lệ bị từ chối', async ({ app }) => {
        const first = await app({ ...withBudget({ 'Ăn uống': 1000000 }), promptValue: '0' });

        await goTab(first.page, 'categories');
        await first.page.click('#category-table-body tr:has-text("Ăn uống") [data-action=budget]');
        expect(await first.page.evaluate(() => budgets)).toEqual({});
        await expect(first.page.locator('#budget-section')).toBeHidden();

        const second = await app({ ...withBudget({ 'Ăn uống': 1000000 }), promptValue: 'abc' });

        await goTab(second.page, 'categories');
        await second.page.click('#category-table-body tr:has-text("Ăn uống") [data-action=budget]');
        expect(second.state.alerts).toHaveLength(1);
        expect(await second.page.evaluate(() => budgets)).toEqual({ 'Ăn uống': 1000000 });
    });

    test('xóa danh mục cũng xóa ngân sách của nó', async ({ app }) => {
        const { page } = await app(withBudget({ 'Ăn uống': 1000000, 'Đi lại': 500000 }));

        await goTab(page, 'categories');
        await page.click('#category-table-body tr:has-text("Ăn uống") [data-action=delete]');

        expect(await page.evaluate(() => budgets)).toEqual({ 'Đi lại': 500000 });
    });

    test('sao lưu có ngân sách và khôi phục lại được', async ({ app }) => {
        const { page } = await app(withBudget({ 'Ăn uống': 1000000 }));

        await goTab(page, 'settings');

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.click('button:has-text("Sao lưu dữ liệu")'),
        ]);
        const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));

        expect(backup.data.budgets).toEqual({ 'Ăn uống': 1000000 });

        const other = await app();

        await goTab(other.page, 'settings');
        await other.page.setInputFiles('input[type=file]', {
            name: 'backup.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(backup)),
        });
        await wait(300);

        expect(await other.page.evaluate(() => budgets)).toEqual({ 'Ăn uống': 1000000 });
    });
});

test.describe('Thanh tiến độ và cảnh báo', () => {
    test('màu theo mức dùng: xanh < 80%, vàng từ 80%, đỏ từ 100%', async ({ app }) => {
        const rows = [
            tx({ id: '1', category: 'Ăn uống', amount: 500000, date: '2026-10-02' }),
            tx({ id: '2', category: 'Đi lại', amount: 450000, date: '2026-10-03' }),
            tx({ id: '3', category: 'Mua sắm', amount: 700000, date: '2026-10-04' }),
        ];
        const { page } = await app(
            withBudget({ 'Ăn uống': 1000000, 'Đi lại': 500000, 'Mua sắm': 600000 }, rows),
        );
        const level = (name) =>
            page.locator('.budget-item', { hasText: name }).getAttribute('class');

        expect(await level('Ăn uống')).toContain('level-0');
        expect(await level('Đi lại')).toContain('level-1');
        expect(await level('Mua sắm')).toContain('level-2');
        await expect(page.locator('.budget-item', { hasText: 'Mua sắm' })).toContainText('117%');
        await expect(page.locator('.budget-item').first()).toContainText('Mua sắm'); // most used first
    });

    test('chi tháng trước không tính vào ngân sách tháng này', async ({ app }) => {
        const { page } = await app(
            withBudget({ 'Ăn uống': 1000000 }, [tx({ amount: 900000, date: '2026-09-28' })]),
        );

        await expect(page.locator('#budget-list')).toContainText('0 đ / 1.000.000 đ');
    });

    test('cảnh báo khi vượt 80% rồi khi vượt 100%, không nhắc lại trong cùng mức', async ({
        app,
    }) => {
        const { page } = await app(withBudget({ 'Ăn uống': 1000000 }));

        await addExpense(page, { amount: 500000 });
        await expect(toasts(page)).toHaveCount(0);

        await addExpense(page, { amount: 350000 });
        await expect(toasts(page)).toHaveCount(1);
        await expect(toasts(page).first()).toContainText('Sắp hết ngân sách "Ăn uống"');
        await expect(toasts(page).first()).toContainText('85%');
        await expect(toasts(page).first()).toHaveClass(/toast-warning/);

        await addExpense(page, { amount: 20000 });
        await expect(toasts(page)).toHaveCount(1);

        await addExpense(page, { amount: 200000 });
        await expect(toasts(page)).toHaveCount(2);
        await expect(toasts(page).last()).toContainText('Đã vượt ngân sách "Ăn uống"');
        await expect(toasts(page).last()).toHaveClass(/toast-danger/);

        await addExpense(page, { amount: 50000 });
        await expect(toasts(page)).toHaveCount(2);
    });

    test('một khoản chi vượt thẳng từ dưới 80% lên trên 100% chỉ báo "đã vượt"', async ({
        app,
    }) => {
        const { page } = await app(withBudget({ 'Ăn uống': 1000000 }));

        await addExpense(page, { amount: 1200000 });

        await expect(toasts(page)).toHaveCount(1);
        await expect(toasts(page).first()).toContainText('Đã vượt ngân sách');
    });

    test('không cảnh báo cho thu nhập, chi tháng khác, danh mục không có ngân sách hoặc khi sửa', async ({
        app,
    }) => {
        const { page } = await app(withBudget({ 'Ăn uống': 1000000 }));

        await addExpense(page, { amount: 1200000, date: '2026-09-15' });
        await addExpense(page, { amount: 1200000, category: 'Đi lại' });
        await expect(toasts(page)).toHaveCount(0);

        await addExpense(page, { amount: 100000 });
        await goTab(page, 'transactions');
        await page.click('#transaction-table-body tr:has-text("Ăn uống") [data-action=edit]');
        await page.fill('#txAmount', '1500000');
        await page.click('#transactionForm button[type=submit]');

        await expect(toasts(page)).toHaveCount(0);
    });

    test('thông báo tự đóng khi bấm vào', async ({ app }) => {
        const { page } = await app(withBudget({ 'Ăn uống': 1000000 }));

        await addExpense(page, { amount: 900000 });
        await toasts(page).first().click();

        await expect(toasts(page)).toHaveCount(0);
    });
});
