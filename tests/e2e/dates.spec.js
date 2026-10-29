// Dates are shown as dd/mm/yyyy everywhere; stored values and date pickers stay ISO.

const fs = require('fs');
const { test, expect, tx, goTab, goTransactions } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z';
const seed = (rows) => ({ fm_transactions: JSON.stringify(rows) });

test.describe('Ngày dd/mm/yyyy', () => {
    test('sổ giao dịch hiển thị dd/mm/yyyy, dữ liệu lưu vẫn là YYYY-MM-DD', async ({ app }) => {
        const { page } = await app({ seed: seed([tx({ id: 'TX_1', date: '2026-10-05' })]) });

        await goTransactions(page);

        await expect(
            page.locator('#transaction-table-body td[data-label="Ngày"]').first(),
        ).toHaveText('05/10/2026');
        expect(await page.evaluate(() => transactions[0].date)).toBe('2026-10-05');
    });

    test('nút sửa và xóa đọc ngày theo dd/mm/yyyy', async ({ app }) => {
        const { page } = await app({
            seed: seed([tx({ id: 'TX_1', date: '2026-10-05', amount: 17000 })]),
        });

        await goTransactions(page);

        await expect(page.locator('#transaction-table-body [data-action=edit]')).toHaveAttribute(
            'aria-label',
            'Sửa giao dịch 05/10/2026 17.000 đ',
        );
        await expect(page.locator('#transaction-table-body [data-action=delete]')).toHaveAttribute(
            'aria-label',
            'Xóa giao dịch 05/10/2026 17.000 đ',
        );
    });

    test('ngày UTC từ Google Sheet (giờ VN) hiện đúng dd/mm/yyyy', async ({ app }) => {
        const { page } = await app({ remote: [tx({ date: '2026-10-26T17:00:00.000Z' })] });

        await goTransactions(page);

        await expect(page.locator('#transaction-table-body td[data-label="Ngày"]')).toHaveText(
            '27/10/2026',
        );
    });

    test('gõ 28/10 vào ô tìm kiếm tìm được giao dịch ngày 28/10', async ({ app }) => {
        const { page } = await app({
            seed: seed([
                tx({ id: 'TX_1', date: '2026-10-28', note: 'a' }),
                tx({ id: 'TX_2', date: '2026-10-05', note: 'b' }),
            ]),
        });

        await goTransactions(page);
        await page.fill('#filter-search', '28/10');

        await expect(page.locator('#transaction-table-body tr')).toHaveCount(1);
        await expect(page.locator('#transaction-table-body')).toContainText('28/10/2026');
    });

    test('xuất CSV dùng dd/mm/yyyy', async ({ app }) => {
        const { page } = await app({
            seed: seed([tx({ id: 'TX_1', date: '2026-10-05', note: 'cafe' })]),
        });

        await goTab(page, 'settings');

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.click('button:has-text("Xuất CSV")'),
        ]);
        const csv = fs.readFileSync(await download.path(), 'utf8');

        expect(csv).toContain('\r\n05/10/2026,Chi,Tiền Mặt,,Ăn uống,1000,cafe\r\n');
    });

    test('định kỳ và vay nợ hiển thị ngày dd/mm/yyyy', async ({ app }) => {
        const { page, state } = await app({
            now: NOW,
            seed: {
                fm_recurring: JSON.stringify([
                    {
                        id: 'RC_1',
                        name: 'Tiền nhà',
                        type: 'expense',
                        source: 'Tiền Mặt',
                        category: 'Hóa đơn & Tiện ích',
                        amount: 3000000,
                        frequency: 'monthly',
                        day: 5,
                        startDate: '2026-10-05',
                        endDate: '2027-03-05',
                        lastGenerated: '2026-10-05',
                    },
                ]),
                fm_debts: JSON.stringify([
                    {
                        id: 'DB_1',
                        party: 'Anh Nam',
                        direction: 'owe',
                        amount: 1000000,
                        date: '2026-10-01',
                        dueDate: '2026-12-20',
                        payments: [{ id: 'P1', date: '2026-10-10', amount: 300000 }],
                    },
                ]),
            },
        });

        await goTab(page, 'recurring');
        await expect(page.locator('#recurring-table-body')).toContainText(
            '05/10/2026 → 05/03/2027',
        );
        await expect(page.locator('#recurring-table-body')).toContainText('Lần tới: 05/11/2026');

        await goTab(page, 'debts');
        await expect(page.locator('#debt-table-body td[data-label="Hạn"]')).toHaveText(
            '20/12/2026',
        );
        await page.click('#debt-table-body [data-action=history]');
        await expect(page.locator('.debt-details')).toContainText('Ngày vay: 01/10/2026');
        await expect(page.locator('.debt-details')).toContainText('10/10/2026');
        expect(state.errors).toEqual([]);
    });

    test('ô chọn ngày của biểu mẫu vẫn dùng giá trị ISO (định dạng hiển thị theo máy)', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            seed: seed([tx({ id: 'TX_1', date: '2026-10-05' })]),
        });

        await goTransactions(page);
        await page.click('#transaction-table-body [data-action=edit]');

        await expect(page.locator('#txDate')).toHaveValue('2026-10-05');
    });
});
