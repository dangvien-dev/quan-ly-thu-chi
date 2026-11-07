// Tags: "#word" in a note, a field in the form, chips in the list and a filter.

const fs = require('fs');
const { test, expect, newServer, tx, wait, scanA11y } = require('./helpers');

const NOW = '2026-10-31T03:00:00Z';
const rows = [
    tx({ id: 'A', date: '2026-10-20', amount: 120000, note: 'Mua keo #KhachA #dh102' }),
    tx({
        id: 'B',
        date: '2026-10-21',
        type: 'income',
        category: 'Thu nhập khác',
        amount: 500000,
        note: 'Công sửa bàn #khacha',
    }),
    tx({ id: 'C', date: '2026-10-22', amount: 30000, note: 'Cafe sáng' }),
    tx({ id: 'D', date: '2026-10-23', amount: 80000, note: 'Sơn #dh102' }),
];
const open = (app, extra = {}) =>
    app({ now: NOW, seed: { fm_transactions: JSON.stringify(rows) }, ...extra });
const goTransactions = (page) => page.evaluate(() => switchTab('transactions'));
const listed = (page) =>
    page
        .locator('#transaction-table-body tr[data-id]')
        .evaluateAll((trs) => trs.map((tr) => tr.dataset.id).sort());
const stored = (page, id) =>
    page.evaluate((key) => transactions.find((t) => t.id === key).note, id);

async function addWith(page, { note = '', tags = '', amount = '50000' }) {
    await page.click('header .btn');
    await page.fill('#txAmount', amount);
    await page.fill('#txNote', note);
    await page.fill('#txTags', tags);
    await page.click('#transactionForm button[type=submit]');
}

test.describe('Thẻ (tag) của giao dịch', () => {
    test('ô Thẻ ghi vào cuối ghi chú dưới dạng "#thẻ"; thẻ gõ thẳng trong ghi chú cũng tính, không lặp', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });

        await addWith(page, { note: 'Mua keo  502', tags: 'khachA, #dh102' });
        expect(await page.evaluate(() => transactions[0].note)).toBe('Mua keo 502 #khachA #dh102');

        await addWith(page, { note: 'Sơn #KHACHA tường', tags: 'khacha moi' });
        expect(await page.evaluate(() => transactions[0].note)).toBe('Sơn tường #khacha #moi');

        // No tag at all: the note is stored exactly as typed.
        await addWith(page, { note: '  Cafe   sáng ', tags: '' });
        expect(await page.evaluate(() => transactions[0].note)).toBe('Cafe   sáng');
    });

    test('thẻ sai bị từ chối kèm lý do; quá 10 thẻ bị từ chối; không lưu giao dịch', async ({
        app,
    }) => {
        const { page, state } = await app({ now: NOW });

        await addWith(page, { tags: '12abc ok a$b' });
        expect(state.alerts.at(-1)).toContain('Thẻ không hợp lệ: 12abc, a$b');
        expect(await page.evaluate(() => transactions.length)).toBe(0);
        await expect(page.locator('#transactionModal')).toHaveClass(/open/);

        await page.fill('#txTags', Array.from({ length: 11 }, (_, i) => `t${i}`).join(' '));
        await page.click('#transactionForm button[type=submit]');
        expect(state.alerts.at(-1)).toContain('tối đa 10 thẻ');
        expect(await page.evaluate(() => transactions.length)).toBe(0);
    });

    test('sửa giao dịch: ghi chú và thẻ nằm ở hai ô riêng; sửa thẻ rồi lưu thì ghi chú cập nhật', async ({
        app,
    }) => {
        const { page } = await open(app);

        await goTransactions(page);
        await page.click('#transaction-table-body tr[data-id="A"] [data-action=edit]');

        await expect(page.locator('#txNote')).toHaveValue('Mua keo');
        await expect(page.locator('#txTags')).toHaveValue('#KhachA #dh102');

        await page.fill('#txTags', '#KhachA #moi');
        await page.click('#transactionForm button[type=submit]');

        expect(await stored(page, 'A')).toBe('Mua keo #KhachA #moi');
    });

    test('ghi chú không có thẻ giữ nguyên khi mở rồi lưu lại (không bị chuẩn hóa)', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            seed: { fm_transactions: JSON.stringify([tx({ id: 'X', note: 'Cafe   sáng, Q1' })]) },
        });

        await goTransactions(page);
        await page.click('#transaction-table-body tr[data-id="X"] [data-action=edit]');
        await expect(page.locator('#txNote')).toHaveValue('Cafe   sáng, Q1');
        await page.click('#transactionForm button[type=submit]');

        expect(await stored(page, 'X')).toBe('Cafe   sáng, Q1');
    });

    test('danh sách hiện thẻ thành chip (ghi chú không còn chữ #thẻ); chạm chip thì lọc theo thẻ', async ({
        app,
    }) => {
        const { page } = await open(app);

        await goTransactions(page);

        const row = page.locator('#transaction-table-body tr[data-id="A"]');

        await expect(row.locator('td[data-label="Mô tả"]')).toContainText('Mua keo');
        await expect(row.locator('.tag-chip')).toHaveText(['#KhachA', '#dh102']);
        expect(
            await row
                .locator('td[data-label="Mô tả"] .note-cell')
                .evaluate((cell) => cell.firstChild.textContent),
        ).toBe('Mua keo');

        await row.locator('.tag-chip', { hasText: '#dh102' }).click();

        await expect(page.locator('#filter-tag')).toHaveValue('dh102');
        expect(await listed(page)).toEqual(['A', 'D']);
        // The summary is the answer to "what did this order cost / bring": here 120.000 + 80.000.
        await expect(page.locator('#transaction-summary')).toContainText('Chi 200.000 đ');
    });

    test('bộ lọc thẻ: chỉ hiện khi đã có thẻ, gộp hoa thường kèm số giao dịch, lọc đúng, Xóa lọc đưa về tất cả', async ({
        app,
    }) => {
        const none = await app({ now: NOW });

        await goTransactions(none.page);
        await expect(none.page.locator('#filter-tag-item')).toBeHidden();

        const { page } = await open(app);

        await goTransactions(page);
        await expect(page.locator('#filter-tag-item')).toBeVisible();
        await expect(page.locator('#filter-tag option')).toHaveText([
            'Tất cả thẻ',
            '#dh102 (2)',
            '#KhachA (2)',
        ]);

        await page.selectOption('#filter-tag', 'KhachA');
        // "#KhachA" and "#khacha" are one tag, so the income comes along.
        expect(await listed(page)).toEqual(['A', 'B']);
        await expect(page.locator('#transaction-summary')).toContainText('Thu 500.000 đ');
        await expect(page.locator('#transaction-summary')).toContainText('Chi 120.000 đ');
        await expect(page.locator('#transaction-summary')).toContainText('+380.000 đ');

        await page.click('button:has-text("Xóa lọc")');
        await expect(page.locator('#filter-tag')).toHaveValue('ALL');
        expect((await listed(page)).length).toBe(4);
    });

    test('tìm kiếm thấy cả thẻ; xóa giao dịch cuối cùng của một thẻ thì bộ lọc tự về Tất cả', async ({
        app,
    }) => {
        const { page } = await open(app);

        await goTransactions(page);
        await page.fill('#filter-search', 'khacha');
        expect(await listed(page)).toEqual(['A', 'B']);
        await page.fill('#filter-search', '');

        await page.selectOption('#filter-tag', 'dh102');
        await page.evaluate(() => {
            transactions = transactions.filter((t) => !/#dh102/.test(t.note));
            renderAll();
        });

        await expect(page.locator('#filter-tag')).toHaveValue('ALL');
        expect(await listed(page)).toEqual(['B', 'C']);
    });

    test('gợi ý thẻ trong biểu mẫu: nút chạm để thêm / bỏ thẻ, đúng trạng thái, dùng nhiều nhất trước', async ({
        app,
    }) => {
        const { page } = await open(app);

        await page.click('header .btn');

        const chips = page.locator('#tx-tag-suggestions .tag-chip');

        await expect(chips).toHaveText(['#dh102', '#KhachA']);
        await expect(chips.first()).toHaveAttribute('aria-pressed', 'false');

        await chips.first().click();
        await expect(page.locator('#txTags')).toHaveValue('#dh102');
        await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');

        await chips.nth(1).click();
        await expect(page.locator('#txTags')).toHaveValue('#dh102 #KhachA');

        await chips.first().click();
        await expect(page.locator('#txTags')).toHaveValue('#KhachA');
        await expect(chips.first()).toHaveAttribute('aria-pressed', 'false');

        // Typing updates the buttons too.
        await page.fill('#txTags', 'dh102');
        await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');

        // A closed and reopened form starts clean.
        await page.click('#transactionModal .close-btn');
        await page.click('header .btn');
        await expect(page.locator('#txTags')).toHaveValue('');
    });

    test('chưa có thẻ nào thì không hiện hàng gợi ý', async ({ app }) => {
        const { page } = await app({ now: NOW });

        await page.click('header .btn');
        await expect(page.locator('#tx-tag-suggestions')).toBeHidden();
    });

    test('thẻ đi theo ghi chú lên Sheet v2 và sang máy khác; đồng bộ và khôi phục sao lưu giữ nguyên', async ({
        app,
    }) => {
        const server = newServer('v2');
        const a = await app({ server, now: NOW });

        await addWith(a.page, { note: 'Mua keo', tags: 'khachA dh102' });
        await wait(500);

        expect(server.get({ v: '2' }).transactions[0].note).toBe('Mua keo #khachA #dh102');

        const b = await app({ server, now: NOW });

        await goTransactions(b.page);
        await expect(b.page.locator('#transaction-table-body .tag-chip')).toHaveText([
            '#khachA',
            '#dh102',
        ]);
        await expect(b.page.locator('#filter-tag option')).toHaveCount(3);
    });

    test('xuất CSV giữ thẻ trong cột Ghi chú', async ({ app }) => {
        const { page } = await open(app);

        await page.evaluate(() => switchTab('settings'));

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.click('button:has-text("Xuất CSV")'),
        ]);
        const csv = fs.readFileSync(await download.path(), 'utf8');

        expect(csv).toContain('Mua keo #KhachA #dh102');
    });

    test('điện thoại: chip nằm trong phần chi tiết khi mở dòng, chạm chip lọc mà không mở / đóng dòng; trợ năng ổn', async ({
        app,
    }) => {
        const { page } = await open(app, { viewport: { width: 390, height: 844 } });

        await goTransactions(page);

        const row = page.locator('#transaction-table-body tr[data-id="A"]');

        // The one-line row shows the note without the tags.
        await expect(row.locator('.row-title-text')).toHaveText('Mua keo');
        await row.locator('.row-toggle').click();
        await expect(row.locator('.tag-chip').first()).toBeVisible();

        const results = await scanA11y(page, '#tab-transactions');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);

        await row.locator('.tag-chip', { hasText: '#KhachA' }).click();
        await expect(page.locator('#filter-tag')).toHaveValue('KhachA');
        expect(await listed(page)).toEqual(['A', 'B']);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);
    });

    test('biểu mẫu có ô Thẻ: nhãn, gợi ý và hộp thoại không vi phạm trợ năng', async ({ app }) => {
        const { page } = await open(app);

        await page.click('header .btn');
        await expect(page.locator('label[for=txTags]')).toHaveText('Thẻ (tag)');

        const results = await scanA11y(page, '#transactionModal');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
});
