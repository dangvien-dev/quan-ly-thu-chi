// The closing balance of a card's last statement ("Dư nợ cuối kỳ"): "Cần trả" starts from it, so a
// charge missing from the book (which "Khớp số dư" pushes into the initial balance) no longer makes
// a paid statement look unpaid.

const { test, expect, tx, newServer, syncedSeed, wait } = require('./helpers');

const NOW = '2026-11-07T03:00:00Z';
const CARD = 'Thẻ Tín Dụng';
const VPBANK = 'Thẻ NH Vpbank';
const SOURCES = [
    { name: 'Tiền Mặt', kind: 'cash' },
    { name: VPBANK, kind: 'bank' },
    { name: CARD, kind: 'credit', creditLimit: 37800000, statementDay: 20, dueDay: 4 },
];
// What the book has since the 20/10 statement: five charges and the payment of the statement.
const charge = (id, date, amount) => tx({ id, date, source: CARD, amount });
const ROWS = [
    charge('A', '2026-10-22', 587160),
    charge('B', '2026-10-23', 73333),
    charge('C', '2026-10-24', 30000),
    charge('D', '2026-11-03', 87778),
    charge('E', '2026-11-05', 604390),
    tx({
        id: 'P',
        date: '2026-10-21',
        type: 'transfer',
        source: VPBANK,
        targetSource: CARD,
        category: 'Chuyển tiền nội bộ',
        amount: 1695414,
    }),
];
// "Khớp số dư" with the real available limit put 51.766 of charges the book is missing into the
// initial balance: -1.695.414 would be right, -1.747.180 is what the app holds.
const seed = (extra = {}, sources = SOURCES, opening = -1747180) => ({
    fm_sources: JSON.stringify(sources),
    fm_initial_balances: JSON.stringify({ [CARD]: opening }),
    fm_transactions: JSON.stringify(ROWS),
    ...extra,
});
const open = (app, extra, sources, opening) =>
    app({ now: NOW, seed: seed(extra, sources, opening) });
const card = (page) =>
    page.locator('#sources-grid .source-card', {
        has: page.locator(`button[data-action="edit-balance"][data-source="${CARD}"]`),
    });
const dueLine = (page) => card(page).locator('.card-due');
const source = (page) => page.evaluate((name) => sources.find((item) => item.name === name), CARD);

async function openEditor(page) {
    await page.evaluate(() => switchTab('sources'));
    await card(page).locator('button[data-action="edit-source"]').click();
    await expect(page.locator('#sourceModal')).toHaveClass(/open/);
}

test.describe('Dư nợ cuối kỳ của sao kê gần nhất', () => {
    test('trước khi nhập mốc: số dư ban đầu lệch 51.766 thì thẻ đã trả đủ vẫn báo cần trả 51.766', async ({
        app,
    }) => {
        const { page } = await open(app);

        await page.evaluate(() => switchTab('sources'));
        await expect(dueLine(page)).toHaveText(
            'Cần trả 51.766 đ trước 04/11/2026 (quá hạn 3 ngày)',
        );
        await expect(card(page)).not.toContainText('Sao kê chốt');
    });

    test('nhập dư nợ cuối kỳ 1.695.414: hết báo cần trả, số dư ban đầu và số dư thẻ giữ nguyên', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openEditor(page);
        await expect(page.locator('#srcStatementBalance')).toHaveValue('');
        await expect(page.locator('#srcStatementBalanceHint')).toContainText('Dư nợ cuối kỳ');
        await page.fill('#srcStatementBalance', '1695414');
        await expect(page.locator('#srcStatementBalance')).toHaveValue('1.695.414');
        await page.click('#sourceForm button[type=submit]');

        await expect(dueLine(page)).toHaveCount(0);
        await expect(card(page)).toContainText('Sao kê chốt 20/10/2026: dư nợ 1.695.414 đ');
        // The number is a fact about the statement: nothing else changes.
        await expect(card(page).locator('.card-value')).toHaveText('-1.434.427 đ');
        await expect(card(page)).toContainText('Số dư ban đầu -1.747.180 đ');
        expect(await source(page)).toMatchObject({
            lastStatement: { date: '2026-10-20', balance: 1695414 },
        });

        // It survives a reload, and the dialog shows it with its statement day.
        await page.reload();
        await openEditor(page);
        await expect(page.locator('#srcStatementBalance')).toHaveValue('1.695.414');
        await expect(page.locator('#srcStatementBalanceHint')).toContainText(
            'Đang dùng sao kê chốt ngày 20/10/2026.',
        );
    });

    test('một sao kê chưa trả hết: số còn lại tính từ mốc, không từ số dư ban đầu', async ({
        app,
    }) => {
        const unpaid = ROWS.map((row) => (row.id === 'P' ? { ...row, amount: 1000000 } : row));
        const { page } = await app({
            now: NOW,
            seed: seed(
                {
                    fm_transactions: JSON.stringify(unpaid),
                    fm_sources: JSON.stringify(
                        SOURCES.map((item) =>
                            item.name === CARD
                                ? {
                                      ...item,
                                      lastStatement: { date: '2026-10-20', balance: 1695414 },
                                  }
                                : item,
                        ),
                    ),
                },
                undefined,
                -999,
            ),
        });

        await page.evaluate(() => switchTab('sources'));
        await expect(dueLine(page)).toHaveText(
            'Cần trả 695.414 đ trước 04/11/2026 (quá hạn 3 ngày)',
        );
    });

    test('lưu lại không đổi số thì giữ ngày của sao kê; đổi số thì gắn vào ngày chốt gần nhất; để trống thì bỏ mốc', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            seed: seed({
                fm_sources: JSON.stringify(
                    SOURCES.map((item) =>
                        item.name === CARD
                            ? { ...item, lastStatement: { date: '2026-09-20', balance: 1614164 } }
                            : item,
                    ),
                ),
            }),
        });

        await openEditor(page);
        await expect(page.locator('#srcStatementBalance')).toHaveValue('1.614.164');
        await page.click('#sourceForm button[type=submit]');
        expect((await source(page)).lastStatement).toEqual({
            date: '2026-09-20',
            balance: 1614164,
        });

        await openEditor(page);
        await page.fill('#srcStatementBalance', '1695414');
        await page.click('#sourceForm button[type=submit]');
        expect((await source(page)).lastStatement).toEqual({
            date: '2026-10-20',
            balance: 1695414,
        });

        await openEditor(page);
        await page.fill('#srcStatementBalance', '');
        await page.click('#sourceForm button[type=submit]');
        expect(Object.hasOwn(await source(page), 'lastStatement')).toBe(false);
        await expect(card(page)).not.toContainText('Sao kê chốt');
    });

    test('nhập dư nợ cuối kỳ mà chưa có ngày chốt sao kê thì báo', async ({ app }) => {
        const { page, state } = await open(
            app,
            {},
            SOURCES.map((item) => (item.name === CARD ? { ...item, statementDay: null } : item)),
        );

        await openEditor(page);
        await page.fill('#srcStatementBalance', '1695414');
        await page.click('#sourceForm button[type=submit]');

        expect(state.alerts.at(-1)).toContain('ngày chốt sao kê');
        await expect(page.locator('#sourceModal')).toHaveClass(/open/);
        expect(Object.hasOwn(await source(page), 'lastStatement')).toBe(false);
    });

    test('ô chỉ hiện với thẻ tín dụng', async ({ app }) => {
        const { page } = await open(app);

        await openEditor(page);
        await expect(page.locator('#srcStatementBalance')).toBeVisible();
        await page.selectOption('#srcKind', 'bank');
        await expect(page.locator('#srcStatementBalance')).toBeHidden();
    });

    test('mốc lên Sheet v2 cùng nguồn tiền', async ({ app }) => {
        const server = newServer('v2');
        const { page } = await app({
            server,
            now: NOW,
            seed: syncedSeed(ROWS, {
                fm_sources: JSON.stringify(SOURCES),
                fm_initial_balances: JSON.stringify({ [CARD]: -1747180 }),
            }),
        });

        await openEditor(page);
        await page.fill('#srcStatementBalance', '1695414');
        await page.click('#sourceForm button[type=submit]');
        await wait(500);

        const remote = server.get({ v: '2' }).meta.sources.value.find((item) => item.name === CARD);

        expect(remote.lastStatement).toEqual({ date: '2026-10-20', balance: 1695414 });
    });
});
