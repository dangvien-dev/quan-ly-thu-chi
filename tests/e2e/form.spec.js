// Transaction form, modal behaviour, dates, and categories.

const { test, expect, tx, wait, goTab, goTransactions, addExpense } = require('./helpers');

const seedTransactions = (rows) => ({ fm_transactions: JSON.stringify(rows) });

test.describe('Form nhập giao dịch', () => {
    for (const amount of ['17000', '224500', '1']) {
        test(`chấp nhận số tiền ${amount}đ`, async ({ app }) => {
            const { page } = await app();

            await page.click('header .btn');
            await page.fill('#txAmount', amount);

            expect(await page.evaluate(() => transactionForm.checkValidity())).toBe(true);
        });
    }

    test('ngày mặc định theo giờ địa phương (05:30 sáng GMT+7 vẫn là hôm nay)', async ({ app }) => {
        const { page } = await app({ now: '2026-10-27T22:30:00Z' }); // 28/10 05:30 GMT+7

        await expect(page.locator('#txDate')).toHaveValue('2026-10-28');
    });

    test('lưu giao dịch chuyển tiền và cập nhật số dư cả hai nguồn', async ({ app }) => {
        const { page } = await app();

        await page.click('header .btn');
        await page.click('#btnTypeTransfer');
        await page.fill('#txAmount', '21000');
        await page.selectOption('#txSource', 'Tiền Mặt');
        await page.selectOption('#txTargetSource', 'Thẻ Ngân Hàng');
        await page.click('#transactionForm button[type=submit]');

        expect(await page.evaluate(() => transactions.length)).toBe(1);

        const cards = await page.locator('#sources-grid .card').allInnerTexts();
        const balanceOf = (name) =>
            cards
                .find((text) => text.includes(name))
                .split('Sửa số dư')[1]
                .replace(/\s+/g, ' ')
                .trim();

        expect(balanceOf('Tiền Mặt')).toContain('-21.000');
        expect(balanceOf('Thẻ Ngân Hàng')).toContain('21.000');
    });

    test('từ chối chuyển tiền cùng một nguồn', async ({ app }) => {
        const { page, state } = await app();

        await page.click('header .btn');
        await page.click('#btnTypeTransfer');
        await page.fill('#txAmount', '50000');
        await page.selectOption('#txSource', 'Tiền Mặt');
        await page.selectOption('#txTargetSource', 'Tiền Mặt');
        await page.click('#transactionForm button[type=submit]');

        expect(await page.evaluate(() => transactions.length)).toBe(0);
        expect(state.alerts).toHaveLength(1);
    });

    test('sửa giao dịch chuyển giữ đúng nguồn nhận', async ({ app }) => {
        const transfer = tx({
            id: 'TX_7',
            type: 'transfer',
            source: 'Tiền Mặt',
            targetSource: 'Spaylater',
            category: 'Chuyển tiền nội bộ',
            amount: 30000,
        });
        const { page } = await app({ seed: seedTransactions([transfer]) });

        await goTransactions(page);
        await page.click('#transaction-table-body button[data-action=edit]');
        await expect(page.locator('#txTargetSource')).toHaveValue('Spaylater');
        await page.fill('#txAmount', '40000');
        await page.click('#transactionForm button[type=submit]');

        const saved = await page.evaluate(() => transactions);

        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({ id: 'TX_7', targetSource: 'Spaylater', amount: 40000 });
    });
});

test.describe('Modal sửa giao dịch', () => {
    test('đóng rồi mở lại thì form sạch và tiêu đề là "Thêm"', async ({ app }) => {
        const { page } = await app({
            seed: seedTransactions([tx({ amount: 55000, note: 'abc' })]),
        });

        await goTransactions(page);
        await page.click('#transaction-table-body button[data-action=edit]');
        await page.click('#transactionModal .close-btn');
        await page.click('header .btn');

        await expect(page.locator('#transactionModal .modal-header h3')).toContainText('Thêm');
        await expect(page.locator('#txAmount')).toHaveValue('');
    });

    test('sửa giữ nguyên id, không nhân đôi', async ({ app }) => {
        const { page } = await app({
            seed: seedTransactions([tx({ id: 'TX_5', amount: 10000, note: 'cu' })]),
        });

        await goTransactions(page);
        await page.click('#transaction-table-body button[data-action=edit]');
        await page.fill('#txAmount', '99000');
        await page.fill('#txNote', 'moi');
        await page.click('#transactionForm button[type=submit]');

        const saved = await page.evaluate(() => ({ list: transactions, editing: editingId }));

        expect(saved.list).toHaveLength(1);
        expect(saved.list[0]).toMatchObject({ id: 'TX_5', amount: 99000, note: 'moi' });
        expect(saved.editing).toBeNull();
    });

    test('phím Esc đóng modal', async ({ app }) => {
        const { page } = await app();

        await page.click('header .btn');
        await page.keyboard.press('Escape');

        await expect(page.locator('#transactionModal')).not.toHaveClass(/open/);
    });

    test('sửa giao dịch có danh mục không còn trong danh sách vẫn giữ danh mục', async ({
        app,
    }) => {
        const { page } = await app({
            seed: seedTransactions([tx({ category: 'Đồ nghề và dụng cụ', amount: 224500 })]),
        });

        await goTransactions(page);
        await page.click('#transaction-table-body button[data-action=edit]');

        await expect(page.locator('#txCategory')).toHaveValue('Đồ nghề và dụng cụ');
    });
});

test.describe('Ngày từ Google Sheet', () => {
    test('ngày UTC 26T17:00Z hiển thị là 27/10 (giờ VN) và khi sửa', async ({ app }) => {
        const { page } = await app({ remote: [tx({ date: '2026-10-26T17:00:00.000Z' })] });

        await goTransactions(page);
        await expect(page.locator('#transaction-table-body tr').first()).toContainText(
            '2026-10-27',
        );

        await page.click('#transaction-table-body button[data-action=edit]');
        await expect(page.locator('#txDate')).toHaveValue('2026-10-27');
    });

    test('giao dịch được sắp xếp theo ngày mới nhất trước', async ({ app }) => {
        const { page } = await app({
            remote: [
                tx({ id: 'o', date: '2026-10-01', note: 'cu' }),
                tx({ id: 'n', date: '2026-10-25', note: 'moi' }),
                tx({ id: 'm', date: '2026-10-10', note: 'giua' }),
            ],
        });
        const rows = await page.$$eval('#transaction-table-body tr', (list) =>
            list.map((row) => row.innerText),
        );

        expect(rows[0]).toContain('moi');
        expect(rows[1]).toContain('giua');
        expect(rows[2]).toContain('cu');
    });

    test('số tiền dạng chuỗi được chuẩn hoá và dòng rỗng bị loại', async ({ app }) => {
        const blank = {
            id: '',
            date: '',
            type: '',
            source: '',
            category: '',
            amount: '',
            note: '',
        };
        const { page } = await app({
            now: '2026-10-28T03:00:00Z',
            remote: [
                tx({ id: 'S1', date: '2026-10-05', type: 'income', amount: '100000' }),
                tx({ id: 'S2', date: '2026-10-06', type: 'income', amount: '200000' }),
                blank,
            ],
        });

        await expect(page.locator('#lbl-total-income')).toHaveText('300.000 đ');
        expect(await page.evaluate(() => transactions.length)).toBe(2);
    });

    test('giao dịch chuyển thiếu targetSource (Sheet 7 cột) không hiện "undefined"', async ({
        app,
    }) => {
        const { page } = await app({
            remote: [tx({ type: 'transfer', category: 'Chuyển tiền nội bộ', amount: 100000 })],
        });
        const row = await page.locator('#transaction-table-body tr').first().innerText();

        expect(row).not.toContain('undefined');
        expect(row).toContain('chưa rõ nguồn nhận');
    });
});

test.describe('Danh mục và điều hướng', () => {
    test('từ chối tên danh mục rỗng hoặc trùng', async ({ app }) => {
        const { page } = await app();

        for (const name of ['   ', 'ăn uống']) {
            await page.evaluate(() => openCategoryModal());
            await page.fill('#catName', name);
            await page.selectOption('#catType', 'expense');
            await page.click('#categoryModal button[type=submit]');
        }

        expect(await page.evaluate(() => categories.length)).toBe(6);
    });

    test('xóa danh mục có xác nhận (cảnh báo số giao dịch) và cập nhật dropdown', async ({
        app,
    }) => {
        const { page, state } = await app({
            seed: seedTransactions([tx({ category: 'Ăn uống' })]),
        });

        await goTab(page, 'categories');
        await page.click('#category-table-body button[data-action=delete] >> nth=0');

        expect(state.confirms).toHaveLength(1);
        expect(state.confirms[0]).toContain('1 giao dịch');
        expect(
            await page.$$eval('#txCategory option', (options) => options.map((o) => o.value)),
        ).not.toContain('Ăn uống');
    });

    test('chuyển tab cập nhật tiêu đề trang', async ({ app }) => {
        const { page } = await app();

        await goTransactions(page);

        await expect(page.locator('#page-title')).toHaveText('Sổ Giao Dịch');
    });

    test('nhập số dư ban đầu kiểu VN "1.500.000"; chuỗi rỗng bị từ chối', async ({ app }) => {
        const first = await app({ promptValue: '1.500.000' });

        await goTab(first.page, 'sources');
        await first.page.click('#sources-grid button[data-action=edit-balance] >> nth=0');
        await expect(first.page.locator('#sources-grid .card').first()).toContainText('1.500.000');

        const second = await app({ promptValue: '' });

        await goTab(second.page, 'sources');
        await second.page.click('#sources-grid button[data-action=edit-balance] >> nth=0');
        expect(second.state.alerts).toHaveLength(1);
    });

    test('một phiên dùng đầy đủ không phát sinh lỗi console', async ({ app }) => {
        const { page, state } = await app({ remote: [tx({ id: 'TX_1' })] });

        await addExpense(page, 12000, 'a');
        await goTab(page, 'categories');
        await page.evaluate(() => openCategoryModal());
        await page.fill('#catName', 'Mới');
        await page.click('#categoryModal button[type=submit]');
        await goTab(page, 'sources');
        await goTab(page, 'settings');
        await wait(300);

        expect(state.errors).toEqual([]);
        expect(state.external).toEqual([]);
    });
});
