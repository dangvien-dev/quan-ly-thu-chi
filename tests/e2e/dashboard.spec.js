// Overview numbers and charts.

const { test, expect, tx, digits } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z';
const seed = {
    fm_initial_balances: JSON.stringify({ 'Tiền Mặt': 100000 }),
    fm_transactions: JSON.stringify([
        tx({
            id: 'A',
            date: '2026-09-15',
            type: 'income',
            amount: 1000000,
            category: 'Lương / Thưởng',
        }),
        tx({ id: 'Z', date: '2026-09-20', type: 'expense', amount: 77000 }),
        tx({
            id: 'B',
            date: '2026-10-10',
            type: 'income',
            amount: 500000,
            category: 'Lương / Thưởng',
        }),
        tx({
            id: 'C',
            date: '2026-10-12',
            type: 'expense',
            source: 'Thẻ Ngân Hàng',
            amount: 200000,
        }),
        tx({ id: 'D', date: '2026-10-20', type: 'expense', source: 'Spaylater', amount: 300000 }),
    ]),
};

test.describe('Thẻ Tổng quan', () => {
    test('thu/chi tháng này chỉ cộng tháng hiện tại', async ({ app }) => {
        const { page } = await app({ seed, now: NOW });

        await expect(page.locator('#lbl-total-income')).toHaveText('500.000 đ');
        await expect(page.locator('#lbl-total-expense')).toHaveText('500.000 đ');
    });

    test('dư nợ tính từ phần âm của nguồn nợ (Spaylater -300.000)', async ({ app }) => {
        const { page } = await app({ seed, now: NOW });

        await expect(page.locator('#lbl-total-debt')).toHaveText('300.000 đ');
    });

    test('số dư khả dụng = tổng các nguồn không phải nợ, gồm số dư ban đầu', async ({ app }) => {
        const { page } = await app({ seed, now: NOW });

        // Tiền mặt 100.000 + 1.000.000 + 500.000 - 77.000 = 1.523.000; thẻ ngân hàng -200.000.
        expect(digits(await page.innerText('#lbl-total-balance'))).toBe('1323000');
    });
});

test.describe('Biểu đồ (Chart.js thật)', () => {
    test('doughnut theo tháng này, bar 6 tháng, cập nhật tại chỗ khi thêm giao dịch', async ({
        app,
    }) => {
        const { page } = await app({ seed, now: NOW });
        const snapshot = () =>
            page.evaluate(() => {
                const pie = Chart.getChart('expenseCategoryChart');
                const bar = Chart.getChart('monthlyChart');

                return {
                    pie: Object.fromEntries(
                        pie.data.labels.map((l, i) => [l, pie.data.datasets[0].data[i]]),
                    ),
                    months: bar.data.labels,
                    income: bar.data.datasets[0].data,
                    expense: bar.data.datasets[1].data,
                    ids: `${pie.id}/${bar.id}`,
                };
            });

        const before = await snapshot();

        expect(before.pie).toEqual({ 'Ăn uống': 500000 });
        expect(before.months).toEqual([
            '05/2026',
            '06/2026',
            '07/2026',
            '08/2026',
            '09/2026',
            '10/2026',
        ]);
        expect(before.income.slice(-2)).toEqual([1000000, 500000]);
        expect(before.expense.slice(-2)).toEqual([77000, 500000]);

        await page.click('header .btn');
        await page.fill('#txAmount', '123456');
        await page.selectOption('#txCategory', 'Mua sắm');
        await page.click('#transactionForm button[type=submit]');

        const after = await snapshot();

        expect(after.pie['Mua sắm']).toBe(123456);
        expect(after.expense.at(-1)).toBe(623456);
        expect(after.ids).toBe(before.ids);
    });

    test('thiếu Chart.js: hiện thông báo, lưu giao dịch vẫn đóng modal, các tab khác vẫn hiển thị', async ({
        app,
    }) => {
        const { page } = await app({ blockChart: true });

        await page.click('header .btn');
        await page.fill('#txAmount', '20000');
        await page.click('#transactionForm button[type=submit]');

        await expect(page.locator('#transactionModal')).not.toHaveClass(/open/);
        expect(await page.evaluate(() => transactions.length)).toBe(1);
        await expect(page.locator('#sources-grid .card')).toHaveCount(5);
        await expect(page.locator('#category-table-body tr')).toHaveCount(6);
        await expect(page.locator('#tab-overview')).toContainText(
            'Không tải được thư viện biểu đồ',
        );
    });
});
