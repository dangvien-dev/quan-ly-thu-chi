// Sổ Giao Dịch by statement cycle ("Kỳ sao kê") for a credit card or pay-later source.

const { test, expect, tx, goTab, scanA11y, settle } = require('./helpers');

const NOW = '2026-11-07T03:00:00Z';
const CARD = 'Thẻ Tín Dụng'; // statement day 20
const SPAY = 'Spaylater'; // statement day 24
const BANK = 'Thẻ NH Vpbank';
const SOURCES = [
    { name: 'Tiền Mặt', kind: 'cash' },
    { name: BANK, kind: 'bank' },
    { name: CARD, kind: 'credit', creditLimit: 37800000, statementDay: 20, dueDay: 4 },
    { name: SPAY, kind: 'credit', creditLimit: 30000000, statementDay: 24, dueDay: 10 },
    { name: 'Visa không ngày chốt', kind: 'credit' },
];
const on = (source, id, date, amount, extra = {}) => tx({ id, date, source, amount, ...extra });
const ROWS = [
    on(CARD, 'X1', '2026-09-20', 1000), // the last day of the cycle 21/08-20/09
    on(CARD, 'X2', '2026-09-21', 2000), // the first day of the cycle 21/09-20/10
    on(CARD, 'X3', '2026-10-20', 3000), // the last day of it: the statement day belongs to it
    tx({
        id: 'X4',
        date: '2026-10-21',
        type: 'transfer',
        source: BANK,
        targetSource: CARD,
        category: 'Chuyển tiền nội bộ',
        amount: 5000,
    }),
    on(CARD, 'X5', '2026-11-05', 7000),
    on('Tiền Mặt', 'C1', '2026-10-05', 99),
    on(SPAY, 'S1', '2026-10-24', 400), // Spaylater's cycle 25/09-24/10
    on(SPAY, 'S2', '2026-10-25', 500), // the next one
];
const open = (app, extra = {}) =>
    app({
        now: NOW,
        seed: {
            fm_sources: JSON.stringify(SOURCES),
            fm_transactions: JSON.stringify(ROWS),
        },
        ...extra,
    });
const listed = (page) =>
    page
        .locator('#transaction-table-body tr[data-id]')
        .evaluateAll((trs) => trs.map((tr) => tr.dataset.id).sort());
const cycleOptions = (page) => page.locator('#filter-cycle option').allInnerTexts();

async function filterBySource(page, source) {
    await goTab(page, 'transactions');
    await page.selectOption('#filter-source', source);
}

test.describe('Lọc giao dịch theo kỳ sao kê', () => {
    test('ô Kỳ sao kê chỉ hiện khi lọc một thẻ có ngày chốt, với kỳ đang mở đứng đầu', async ({
        app,
    }) => {
        const { page } = await open(app);

        await goTab(page, 'transactions');
        await expect(page.locator('#filter-cycle-item')).toBeHidden();

        await page.selectOption('#filter-source', 'Tiền Mặt');
        await expect(page.locator('#filter-cycle-item')).toBeHidden();

        await page.selectOption('#filter-source', 'Visa không ngày chốt');
        await expect(page.locator('#filter-cycle-item')).toBeHidden();

        await page.selectOption('#filter-source', CARD);
        await expect(page.locator('#filter-cycle-item')).toBeVisible();

        const options = await cycleOptions(page);

        expect(options).toHaveLength(13); // all + 12 cycles
        expect(options.slice(0, 4)).toEqual([
            'Tất cả các kỳ',
            'Kỳ này: 21/10 – 20/11/2026',
            'Kỳ trước: 21/09 – 20/10/2026',
            'Kỳ: 21/08 – 20/09/2026',
        ]);
        await expect(page.locator('#filter-cycle')).toHaveValue('ALL');
        expect((await listed(page)).sort()).toEqual(['X1', 'X2', 'X3', 'X4', 'X5']);
    });

    test('chọn một kỳ: đúng các giao dịch từ ngày đầu đến ngày chốt (tính cả hai đầu)', async ({
        app,
    }) => {
        const { page } = await open(app);

        await filterBySource(page, CARD);
        await page.selectOption('#filter-cycle', { label: 'Kỳ trước: 21/09 – 20/10/2026' });
        expect(await listed(page)).toEqual(['X2', 'X3']);

        await page.selectOption('#filter-cycle', { label: 'Kỳ: 21/08 – 20/09/2026' });
        expect(await listed(page)).toEqual(['X1']);

        await page.selectOption('#filter-cycle', { label: 'Kỳ này: 21/10 – 20/11/2026' });
        expect(await listed(page)).toEqual(['X4', 'X5']);

        await page.selectOption('#filter-cycle', 'ALL');
        expect(await listed(page)).toEqual(['X1', 'X2', 'X3', 'X4', 'X5']);
    });

    test('dòng tổng kết của kỳ: phát sinh và đã thanh toán, để đối chiếu với tóm tắt sao kê', async ({
        app,
    }) => {
        const { page } = await open(app);

        await filterBySource(page, CARD);
        await expect(page.locator('#cycle-summary')).toBeHidden();

        await page.selectOption('#filter-cycle', { label: 'Kỳ trước: 21/09 – 20/10/2026' });
        await expect(page.locator('#cycle-summary')).toContainText(
            'Sao kê Thẻ Tín Dụng 21/09/2026 – 20/10/2026: phát sinh 5.000 đ · đã thanh toán 0 đ · 2 giao dịch',
        );
        await expect(page.locator('#cycle-summary')).not.toContainText('chưa chốt');

        // The open cycle: the payment of 21/10 and a charge of 5/11.
        await page.selectOption('#filter-cycle', { label: 'Kỳ này: 21/10 – 20/11/2026' });
        await expect(page.locator('#cycle-summary')).toContainText(
            'Sao kê Thẻ Tín Dụng 21/10/2026 – 20/11/2026 (kỳ chưa chốt): phát sinh 7.000 đ · đã thanh toán 5.000 đ · 2 giao dịch',
        );
        // The other filters still narrow the list, but not the statement's own totals.
        await page.selectOption('#filter-type', 'transfer');
        expect(await listed(page)).toEqual(['X4']);
        await expect(page.locator('#cycle-summary')).toContainText('phát sinh 7.000 đ');

        await page.selectOption('#filter-cycle', 'ALL');
        await expect(page.locator('#cycle-summary')).toBeHidden();
    });

    test('Spaylater có kỳ riêng theo ngày chốt 24; đổi thẻ thì chọn lại từ tất cả các kỳ', async ({
        app,
    }) => {
        const { page } = await open(app);

        await filterBySource(page, SPAY);
        expect((await cycleOptions(page)).slice(0, 3)).toEqual([
            'Tất cả các kỳ',
            'Kỳ này: 25/10 – 24/11/2026',
            'Kỳ trước: 25/09 – 24/10/2026',
        ]);
        await page.selectOption('#filter-cycle', { label: 'Kỳ trước: 25/09 – 24/10/2026' });
        expect(await listed(page)).toEqual(['S1']);

        await page.selectOption('#filter-source', CARD);
        await expect(page.locator('#filter-cycle')).toHaveValue('ALL');
        expect(await listed(page)).toEqual(['X1', 'X2', 'X3', 'X4', 'X5']);

        await page.selectOption('#filter-source', 'Tiền Mặt');
        await expect(page.locator('#filter-cycle-item')).toBeHidden();
        expect(await listed(page)).toEqual(['C1']);
    });

    test('chọn kỳ bỏ lọc tháng, chọn tháng bỏ lọc kỳ; Xóa lọc đưa cả hai về mặc định', async ({
        app,
    }) => {
        const { page } = await open(app);

        await filterBySource(page, CARD);
        await page.fill('#filter-month', '2026-11');
        await page.dispatchEvent('#filter-month', 'change');
        expect(await listed(page)).toEqual(['X5']);

        await page.selectOption('#filter-cycle', { label: 'Kỳ trước: 21/09 – 20/10/2026' });
        await expect(page.locator('#filter-month')).toHaveValue('');
        expect(await listed(page)).toEqual(['X2', 'X3']);

        await page.fill('#filter-month', '2026-09');
        await page.dispatchEvent('#filter-month', 'change');
        await expect(page.locator('#filter-cycle')).toHaveValue('ALL');
        expect(await listed(page)).toEqual(['X1', 'X2']);

        await page.selectOption('#filter-cycle', { label: 'Kỳ trước: 21/09 – 20/10/2026' });
        await page.click('button:has-text("Xóa lọc")');
        await expect(page.locator('#filter-cycle-item')).toBeHidden();
        await expect(page.locator('#filter-source')).toHaveValue('ALL');
        expect((await listed(page)).length).toBe(ROWS.length);
    });

    test('nút "Xem theo kỳ" trên thẻ mở Sổ Giao Dịch ở kỳ sao kê gần nhất đã chốt', async ({
        app,
    }) => {
        const { page } = await open(app);

        await goTab(page, 'sources');

        const card = (name) =>
            page.locator('#sources-grid .source-card', {
                has: page.locator(`button[data-action="edit-balance"][data-source="${name}"]`),
            });

        await expect(card(CARD).locator('button[data-action="view-cycle"]')).toHaveAccessibleName(
            'Xem theo kỳ sao kê của Thẻ Tín Dụng',
        );
        // Needs a statement day, so a card without one has no such button.
        await expect(
            card('Visa không ngày chốt').locator('button[data-action="view-cycle"]'),
        ).toHaveCount(0);

        await card(CARD).locator('button[data-action="view-cycle"]').click();

        await expect(page.locator('#tab-transactions')).toHaveClass(/active/);
        await expect(page.locator('#filter-source')).toHaveValue(CARD);
        await expect(page.locator('#filter-cycle option:checked')).toHaveText(
            'Kỳ trước: 21/09 – 20/10/2026',
        );
        expect(await listed(page)).toEqual(['X2', 'X3']);

        await goTab(page, 'sources');
        await card(SPAY).locator('button[data-action="view-cycle"]').click();
        await expect(page.locator('#filter-cycle option:checked')).toHaveText(
            'Kỳ trước: 25/09 – 24/10/2026',
        );
        expect(await listed(page)).toEqual(['S1']);
    });

    test('thẻ vừa có nút Đã trả vừa có nút Xem theo kỳ; thẻ không còn nợ chỉ có nút xem', async ({
        app,
    }) => {
        const { page } = await open(app, {
            seed: {
                fm_sources: JSON.stringify(SOURCES),
                fm_transactions: JSON.stringify([
                    ...ROWS,
                    // Spaylater's 24/10 statement (400) is paid.
                    tx({
                        id: 'SP',
                        date: '2026-10-26',
                        type: 'transfer',
                        source: BANK,
                        targetSource: SPAY,
                        category: 'Chuyển tiền nội bộ',
                        amount: 400,
                    }),
                ]),
                fm_initial_balances: JSON.stringify({ [CARD]: -10000 }),
            },
        });

        await goTab(page, 'sources');

        const actions = (name) =>
            page
                .locator('#sources-grid .source-card', {
                    has: page.locator(`button[data-action="edit-balance"][data-source="${name}"]`),
                })
                .locator('.card-due-actions button');

        await expect(actions(CARD)).toHaveCount(2); // 10.000 of the 20/10 statement still owed
        await expect(actions(SPAY)).toHaveCount(1); // a statement day but nothing due
    });

    test('trợ năng và điện thoại: ô Kỳ sao kê và dòng tổng kết không vi phạm axe, không tràn ngang', async ({
        app,
    }) => {
        const { page } = await open(app, { viewport: { width: 390, height: 844 } });

        await page.evaluate(() => switchTab('transactions'));
        await page.selectOption('#filter-source', CARD);
        await page.selectOption('#filter-cycle', { label: 'Kỳ trước: 21/09 – 20/10/2026' });
        await settle(page);

        await expect(page.locator('#cycle-summary')).toBeVisible();
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);

        const results = await scanA11y(page, '#tab-transactions');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
});
