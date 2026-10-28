// Transactions tab: filters, search, paging, summary and CSV export.

const fs = require('fs');
const { test, expect, tx, goTransactions } = require('./helpers');

const seed = (rows) => ({ fm_transactions: JSON.stringify(rows) });
const NOW = '2026-10-28T03:00:00Z';

const sample = [
    tx({ id: 'a', date: '2026-10-05', note: 'Cà phê sáng', amount: 20000 }),
    tx({ id: 'b', date: '2026-09-30', category: 'Đi lại', note: 'Xăng xe', amount: 50000 }),
    tx({
        id: 'c',
        date: '2026-10-12',
        type: 'income',
        category: 'Lương / Thưởng',
        note: 'Lương tháng 10',
        amount: 15000000,
    }),
    tx({
        id: 'd',
        date: '2026-10-20',
        type: 'transfer',
        source: 'Thẻ Ngân Hàng',
        targetSource: 'Tiền Mặt',
        category: 'Chuyển tiền nội bộ',
        amount: 300000,
    }),
];

const visibleNotes = (page) =>
    page.$$eval('#transaction-table-body tr:not(.empty-row)', (rows) =>
        rows.map((row) => row.querySelector('[data-label="Mô tả"]').innerText),
    );

test.describe('Lọc, tìm kiếm và tổng hợp', () => {
    test('lọc theo tháng bằng ô chọn tháng và nút trước/sau', async ({ app }) => {
        const { page } = await app({ seed: seed(sample), now: NOW });

        await goTransactions(page);
        await expect(page.locator('#transaction-table-body tr')).toHaveCount(4);

        await page.fill('#filter-month', '2026-10');
        await expect(page.locator('#transaction-table-body tr')).toHaveCount(3);

        await page.click('button[aria-label="Tháng trước"]');
        await expect(page.locator('#filter-month')).toHaveValue('2026-09');
        expect(await visibleNotes(page)).toEqual(['Xăng xe']);

        await page.click('button[aria-label="Tháng sau"]');
        await expect(page.locator('#filter-month')).toHaveValue('2026-10');
    });

    test('nút tháng trước bắt đầu từ tháng hiện tại khi chưa chọn tháng', async ({ app }) => {
        const { page } = await app({ seed: seed(sample), now: NOW });

        await goTransactions(page);
        await page.click('button[aria-label="Tháng trước"]');

        await expect(page.locator('#filter-month')).toHaveValue('2026-09');
    });

    test('lọc theo loại, danh mục và nguồn (nguồn khớp cả nguồn nhận)', async ({ app }) => {
        const { page } = await app({ seed: seed(sample) });

        await goTransactions(page);
        await page.selectOption('#filter-type', 'income');
        expect(await visibleNotes(page)).toEqual(['Lương tháng 10']);

        await page.selectOption('#filter-type', 'ALL');
        await page.selectOption('#filter-category', 'Đi lại');
        expect(await visibleNotes(page)).toEqual(['Xăng xe']);

        await page.selectOption('#filter-category', 'ALL');
        await page.selectOption('#filter-source', 'Thẻ Ngân Hàng');
        await expect(page.locator('#transaction-table-body tr')).toHaveCount(1);

        await page.selectOption('#filter-source', 'Tiền Mặt');
        await expect(page.locator('#transaction-table-body tr')).toHaveCount(4);
    });

    test('danh mục chỉ có trong giao dịch (không có trong danh sách) vẫn lọc được', async ({
        app,
    }) => {
        const { page } = await app({
            seed: seed([tx({ category: 'Đồ nghề và dụng cụ', note: 'Túi đồ nghề' })]),
        });

        await goTransactions(page);
        await page.selectOption('#filter-category', 'Đồ nghề và dụng cụ');

        expect(await visibleNotes(page)).toEqual(['Túi đồ nghề']);
    });

    test('tìm kiếm không dấu, nhiều từ, theo số tiền', async ({ app }) => {
        const { page } = await app({ seed: seed(sample) });

        await goTransactions(page);
        await page.fill('#filter-search', 'ca phe');
        expect(await visibleNotes(page)).toEqual(['Cà phê sáng']);

        await page.fill('#filter-search', 'luong thang');
        expect(await visibleNotes(page)).toEqual(['Lương tháng 10']);

        await page.fill('#filter-search', '15.000.000');
        expect(await visibleNotes(page)).toEqual(['Lương tháng 10']);

        await page.fill('#filter-search', 'khong co gi');
        await expect(page.locator('#transaction-table-body')).toContainText(
            'Không có giao dịch phù hợp',
        );
    });

    test('tổng hợp theo bộ lọc: số giao dịch, thu, chi, chênh lệch (bỏ qua chuyển tiền)', async ({
        app,
    }) => {
        const { page } = await app({ seed: seed(sample) });

        await goTransactions(page);

        const summary = page.locator('#transaction-summary');

        await expect(summary).toContainText('4 giao dịch');
        await expect(summary).toContainText('Thu 15.000.000 đ');
        await expect(summary).toContainText('Chi 70.000 đ');
        await expect(summary).toContainText('Chênh lệch +14.930.000 đ');

        await page.fill('#filter-month', '2026-09');
        await expect(summary).toContainText('1 giao dịch');
        await expect(summary).toContainText('Chênh lệch -50.000 đ');
    });

    test('"Xóa lọc" đưa mọi bộ lọc về mặc định', async ({ app }) => {
        const { page } = await app({ seed: seed(sample) });

        await goTransactions(page);
        await page.fill('#filter-month', '2026-09');
        await page.selectOption('#filter-type', 'expense');
        await page.fill('#filter-search', 'xang');
        await page.click('button:has-text("Xóa lọc")');

        await expect(page.locator('#filter-month')).toHaveValue('');
        await expect(page.locator('#filter-type')).toHaveValue('ALL');
        await expect(page.locator('#filter-search')).toHaveValue('');
        await expect(page.locator('#transaction-table-body tr')).toHaveCount(4);
    });

    test('bộ lọc giữ nguyên khi thêm giao dịch mới', async ({ app }) => {
        const { page } = await app({ seed: seed(sample) });

        await goTransactions(page);
        await page.selectOption('#filter-type', 'income');
        await page.click('header .btn');
        await page.fill('#txAmount', '5000');
        await page.fill('#txNote', 'cafe moi');
        await page.click('#transactionForm button[type=submit]');

        await expect(page.locator('#filter-type')).toHaveValue('income');
        expect(await visibleNotes(page)).toEqual(['Lương tháng 10']);
    });
});

test.describe('Phân trang', () => {
    const many = Array.from({ length: 120 }, (_, index) =>
        tx({
            id: `TX_${1000000000000 + index}`,
            date: `2026-10-${String((index % 28) + 1).padStart(2, '0')}`,
            note: `ghi chu ${index}`,
        }),
    );

    test('hiển thị 50 dòng mỗi lần, "Xem thêm" tải tiếp và ẩn khi hết', async ({ app }) => {
        const { page } = await app({ seed: seed(many) });

        await goTransactions(page);
        await expect(page.locator('#transaction-table-body tr')).toHaveCount(50);
        await expect(page.locator('#transaction-summary')).toContainText(
            'Hiển thị 50 / 120 giao dịch',
        );
        await expect(page.locator('#load-more-btn')).toHaveText('Xem thêm (70)');

        await page.click('#load-more-btn');
        await expect(page.locator('#transaction-table-body tr')).toHaveCount(100);

        await page.click('#load-more-btn');
        await expect(page.locator('#transaction-table-body tr')).toHaveCount(120);
        await expect(page.locator('#load-more-btn')).toBeHidden();
    });

    test('đổi bộ lọc thì quay về trang đầu', async ({ app }) => {
        const { page } = await app({ seed: seed(many) });

        await goTransactions(page);
        await page.click('#load-more-btn');
        await expect(page.locator('#transaction-table-body tr')).toHaveCount(100);

        await page.fill('#filter-search', 'ghi chu');
        await expect(page.locator('#transaction-table-body tr')).toHaveCount(50);
    });
});

test.describe('Xuất CSV', () => {
    test('xuất đúng danh sách đang lọc, UTF-8 BOM, chặn công thức', async ({ app }) => {
        const rows = [
            ...sample,
            tx({ id: 'e', date: '2026-10-25', note: '=HYPERLINK("http://x")', amount: 1000 }),
        ];
        const { page } = await app({ seed: seed(rows) });

        await goTransactions(page);
        await page.fill('#filter-month', '2026-10');
        await page.selectOption('#filter-type', 'expense');

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.click('button:has-text("Xuất CSV")'),
        ]);
        const content = fs.readFileSync(await download.path(), 'utf8');

        expect(download.suggestedFilename()).toMatch(
            /^finmanager-giao-dich-\d{4}-\d{2}-\d{2}\.csv$/,
        );
        expect(
            content.startsWith('﻿Ngày,Loại,Nguồn tiền,Nguồn nhận,Danh mục,Số tiền,Ghi chú'),
        ).toBe(true);

        const lines = content.trim().split('\r\n');

        expect(lines).toHaveLength(3); // header + 2 October expenses
        expect(lines.join('\n')).toContain('Cà phê sáng');
        expect(lines.join('\n')).not.toContain('Lương');
        expect(lines.join('\n')).toContain(`"'=HYPERLINK(""http://x"")"`);
    });

    test('báo khi không có gì để xuất', async ({ app }) => {
        const { page, state } = await app();

        await goTransactions(page);
        await page.click('button:has-text("Xuất CSV")');

        expect(state.alerts).toEqual(['Không có giao dịch nào để xuất.']);
    });
});
