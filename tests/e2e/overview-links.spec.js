// The cards of the overview open what explains their number: filtered transactions or a page.

const { test, expect, tx, scanA11y } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z';
const rows = [
    tx({
        id: 'I1',
        date: '2026-10-20',
        type: 'income',
        category: 'Lương / Thưởng',
        amount: 15000000,
    }),
    tx({
        id: 'I0',
        date: '2026-09-20',
        type: 'income',
        category: 'Lương / Thưởng',
        amount: 9000000,
    }),
    tx({ id: 'E1', date: '2026-10-05', source: 'Tiền Mặt', amount: 20000 }),
    tx({ id: 'E2', date: '2026-10-06', source: 'Spaylater', amount: 100000 }),
    tx({ id: 'E3', date: '2026-09-29', source: 'Spaylater', amount: 50000 }),
    tx({
        id: 'PAY',
        date: '2026-10-10',
        type: 'transfer',
        source: 'Thẻ Ngân Hàng',
        targetSource: 'Spaylater',
        category: 'Chuyển tiền nội bộ',
        amount: 30000,
    }),
    tx({
        id: 'CASH',
        date: '2026-10-11',
        type: 'transfer',
        source: 'Thẻ Ngân Hàng',
        targetSource: 'Tiền Mặt',
        category: 'Chuyển tiền nội bộ',
        amount: 500000,
    }),
];
const open = (app, extra = {}) =>
    app({ now: NOW, seed: { fm_transactions: JSON.stringify(rows) }, ...extra });

const link = (page, name) => page.locator(`[data-card-link=${name}]`);
const listed = (page) =>
    page
        .locator('#transaction-table-body tr[data-id]')
        .evaluateAll((trs) => trs.map((tr) => tr.dataset.id).sort());

test.describe('Thẻ ở Tổng quan mở chi tiết', () => {
    test('Tổng thu tháng này: chỉ các khoản thu của tháng này, tổng khớp với thẻ', async ({
        app,
    }) => {
        const { page } = await open(app);

        await expect(page.locator('#lbl-total-income')).toHaveText('15.000.000 đ');
        await link(page, 'income').click();

        await expect(page.locator('#page-title')).toHaveText('Sổ Giao Dịch');
        await expect(page.locator('#filter-type')).toHaveValue('income');
        await expect(page.locator('#filter-month')).toHaveValue('2026-10');
        expect(await listed(page)).toEqual(['I1']);
        await expect(page.locator('#transaction-summary')).toContainText('Thu 15.000.000 đ');
        expect(await page.evaluate(() => location.hash)).toBe('#transactions');
    });

    test('Tổng chi tháng này: chỉ các khoản chi của tháng này (không có tháng trước, thu, chuyển)', async ({
        app,
    }) => {
        const { page } = await open(app);

        await link(page, 'expense').click();

        await expect(page.locator('#filter-type')).toHaveValue('expense');
        expect(await listed(page)).toEqual(['E1', 'E2']);
        await expect(page.locator('#transaction-summary')).toContainText('Chi 120.000 đ');
        await expect(page.locator('#lbl-total-expense')).toHaveText('120.000 đ');
    });

    test('Dư nợ: giao dịch của mọi thẻ / trả sau / khoản nợ, mọi tháng, gồm cả trả sao kê', async ({
        app,
    }) => {
        const { page } = await open(app);

        await link(page, 'debt').click();

        await expect(page.locator('#filter-source')).toHaveValue('__debt__');
        await expect(page.locator('#filter-month')).toHaveValue('');
        await expect(page.locator('#filter-type')).toHaveValue('ALL');
        // Purchases (both months) and the statement payment; not cash, income or a cash transfer.
        expect(await listed(page)).toEqual(['E2', 'E3', 'PAY']);
    });

    test('mở từ thẻ thì bỏ các bộ lọc và ô tìm kiếm đang có', async ({ app }) => {
        const { page } = await open(app);

        await page.evaluate(() => {
            switchTab('transactions');
            document.getElementById('filter-search').value = 'không-có-gì-khớp';
            document.getElementById('filter-category').value = 'Ăn uống';
            handleTransactionFilterChange();
            switchTab('overview');
        });
        await link(page, 'expense').click();

        await expect(page.locator('#filter-search')).toHaveValue('');
        await expect(page.locator('#filter-category')).toHaveValue('ALL');
        expect(await listed(page)).toEqual(['E1', 'E2']);
    });

    test('chạm vào bất kỳ chỗ nào trên thẻ cũng mở, không chỉ chữ tiêu đề', async ({ app }) => {
        const { page } = await open(app);
        const box = await page
            .locator('.card-clickable', { has: page.locator('#lbl-total-income') })
            .boundingBox();

        await page.mouse.click(box.x + box.width - 40, box.y + box.height - 12);

        await expect(page.locator('#filter-type')).toHaveValue('income');
        await expect(page.locator('#tab-transactions')).toHaveClass(/active/);
    });

    test('Tổng số dư khả dụng mở trang Nguồn Tiền; Tổng tiết kiệm mở Sổ Tiết Kiệm', async ({
        app,
    }) => {
        const { page } = await open(app, {
            seed: {
                fm_transactions: JSON.stringify(rows),
                fm_sources: JSON.stringify([
                    { name: 'Tiền Mặt', kind: 'cash' },
                    { name: 'Thẻ Ngân Hàng', kind: 'bank' },
                    { name: 'Spaylater', kind: 'credit' },
                    { name: 'Sổ Vàng', kind: 'savings' },
                ]),
            },
        });

        await link(page, 'balance').click();
        await expect(page.locator('#page-title')).toHaveText('Nguồn Tiền & Tài Khoản');
        await expect(page.locator('#tab-sources')).toHaveClass(/active/);

        await page.evaluate(() => switchTab('overview'));
        await expect(page.locator('#savings-card')).toBeVisible();
        await link(page, 'savings').click();
        await expect(page.locator('#page-title')).toHaveText('Sổ Tiết Kiệm');
    });

    test('chưa có nguồn nợ nào thì thẻ Dư nợ mở trang Nguồn Tiền thay vì danh sách rỗng', async ({
        app,
    }) => {
        const { page } = await open(app, {
            seed: {
                fm_transactions: JSON.stringify([rows[2]]),
                fm_sources: JSON.stringify([
                    { name: 'Tiền Mặt', kind: 'cash' },
                    { name: 'Thẻ Ngân Hàng', kind: 'bank' },
                ]),
            },
        });

        await link(page, 'debt').click();

        await expect(page.locator('#tab-sources')).toHaveClass(/active/);
    });

    test('chọn "Mọi thẻ tín dụng / trả sau / nợ" trong bộ lọc cũng được; xuất CSV theo bộ lọc có đúng các dòng', async ({
        app,
    }) => {
        const { page } = await open(app);

        await page.evaluate(() => switchTab('transactions'));
        await page.selectOption('#filter-source', '__debt__');

        expect(await listed(page)).toEqual(['E2', 'E3', 'PAY']);
        expect(
            await page.evaluate(() =>
                getFilteredTransactions()
                    .map((t) => t.id)
                    .sort(),
            ),
        ).toEqual(['E2', 'E3', 'PAY']);

        await page.click('button:has-text("Xóa lọc")');
        await expect(page.locator('#filter-source')).toHaveValue('ALL');
        expect((await listed(page)).length).toBe(rows.length);
    });

    test('dùng được bằng bàn phím: nút có tên đọc được, Enter mở', async ({ app }) => {
        const { page } = await open(app);
        const button = page.getByRole('button', { name: /Xem các khoản chi của tháng này/ });

        await expect(button).toHaveText(/Tổng Chi Tháng Này/);
        await button.focus();
        await page.keyboard.press('Enter');

        await expect(page.locator('#filter-type')).toHaveValue('expense');
        await expect(page.locator('#tab-transactions')).toHaveClass(/active/);
    });

    test('không vi phạm trợ năng; điện thoại: không tràn ngang và chạm mở được', async ({
        app,
    }) => {
        const { page } = await open(app, { viewport: { width: 390, height: 844 } });

        const results = await scanA11y(page, '#tab-overview');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);

        const box = await page
            .locator('.card-clickable', { has: page.locator('#lbl-total-expense') })
            .boundingBox();

        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

        await expect(page.locator('#filter-type')).toHaveValue('expense');
    });
});
