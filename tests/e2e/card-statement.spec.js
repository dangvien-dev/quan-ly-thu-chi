// The closing balance of a card's last statement ("Dư nợ cuối kỳ"): "Cần trả" starts from it, so a
// charge missing from the book (which "Khớp số dư" pushes into the initial balance) no longer makes
// a paid statement look unpaid.

const { test, expect, tx, newServer, syncedSeed, wait, scanA11y } = require('./helpers');

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

// "Cần trả" without the closing balance of the statement is only a guess from the initial balance.
// These are the cards' real numbers of 7/11/2026: the balance matches the bank (available
// 35.782.854 of 37.800.000), the 20/10 statement is paid, and the card still said 51.766 was due
// because "Khớp số dư" had pushed charges the book misses (fee / VAT lines) into the opening.
const REAL_CHARGES = [
    ['2026-09-21', 100000],
    ['2026-09-23', 73333],
    ['2026-09-24', 132000],
    ['2026-09-28', 30000],
    ['2026-09-30', 582719],
    ['2026-10-03', 87778],
    ['2026-10-05', 552584],
    ['2026-10-10', 30000],
    ['2026-10-17', 30000],
    ['2026-10-22', 587160],
    ['2026-10-23', 73333],
    ['2026-10-24', 30000],
    ['2026-10-30', 582719],
    ['2026-11-03', 87778],
    ['2026-11-05', 604390],
];
const REAL_PAYMENTS = [
    ['2026-09-21', 1614164],
    ['2026-10-21', 1695414],
    ['2026-10-21', 51766],
];
const REAL_ROWS = [
    ...REAL_CHARGES.map(([date, amount], index) => charge(`R${index}`, date, amount)),
    ...REAL_PAYMENTS.map(([date, amount], index) =>
        tx({
            id: `RP${index}`,
            date,
            type: 'transfer',
            source: VPBANK,
            targetSource: CARD,
            category: 'Chuyển tiền nội bộ',
            amount,
        }),
    ),
];
const realSeed = (extra = {}) => ({
    fm_sources: JSON.stringify(SOURCES),
    fm_initial_balances: JSON.stringify({ [CARD]: -1794696 }),
    fm_transactions: JSON.stringify(REAL_ROWS),
    ...extra,
});
const note = (page) => card(page).locator('.card-due-note');
const balanceButton = (page) => card(page).locator('button[data-action="statement-balance"]');

test.describe('Cần trả ước tính: báo rõ và nhập dư nợ cuối kỳ ngay trên thẻ', () => {
    test('số dư thẻ khớp ngân hàng nhưng "Cần trả" chỉ là ước tính: có dòng giải thích và nút nhập dư nợ cuối kỳ', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW, seed: realSeed() });

        await page.evaluate(() => switchTab('sources'));
        await expect(card(page).locator('.card-value')).toHaveText('-2.017.146 đ');
        await expect(dueLine(page)).toHaveText(
            'Cần trả 51.766 đ trước 04/11/2026 (quá hạn 3 ngày)',
        );
        await expect(note(page)).toContainText('ước tính từ số dư ban đầu');
        await expect(note(page)).toContainText('Dư nợ cuối kỳ');
        await expect(balanceButton(page)).toHaveAccessibleName(
            'Nhập dư nợ cuối kỳ của sao kê thẻ Thẻ Tín Dụng',
        );
    });

    test('nhập 1.695.414 trên thẻ: hết báo cần trả, số dư và số dư ban đầu giữ nguyên, mốc được lưu', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW, seed: realSeed() });

        await page.evaluate(() => switchTab('sources'));
        await balanceButton(page).click();

        await expect(page.locator('#moneyPromptModal')).toHaveClass(/open/);
        await expect(page.locator('#moneyPromptMessage')).toContainText('chốt ngày 20/10/2026');
        await expect(page.locator('#moneyPromptInput')).toHaveValue('');
        await page.fill('#moneyPromptInput', '1695414');
        await expect(page.locator('#moneyPromptInput')).toHaveValue('1.695.414');
        await page.click('#moneyPromptSubmit');

        await expect(dueLine(page)).toHaveCount(0);
        await expect(note(page)).toHaveCount(0);
        await expect(balanceButton(page)).toHaveCount(0);
        await expect(card(page)).toContainText('Sao kê chốt 20/10/2026: dư nợ 1.695.414 đ');
        await expect(card(page).locator('.card-value')).toHaveText('-2.017.146 đ');
        await expect(card(page)).toContainText('Số dư ban đầu -1.794.696 đ');
        expect(await source(page)).toMatchObject({
            lastStatement: { date: '2026-10-20', balance: 1695414 },
        });
        await expect(page.locator('.toast').last()).toContainText(
            'Đã lưu dư nợ cuối kỳ 1.695.414 đ',
        );

        // It survives a reload.
        await page.reload();
        await page.evaluate(() => switchTab('sources'));
        await expect(dueLine(page)).toHaveCount(0);
    });

    test('hủy hộp nhập thì không lưu gì; sao kê vẫn chưa trả hết thì số còn lại tính từ mốc', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW, seed: realSeed() });

        await page.evaluate(() => switchTab('sources'));
        await balanceButton(page).click();
        await expect(page.locator('#moneyPromptModal')).toHaveClass(/open/);
        await page.keyboard.press('Escape');
        await expect(page.locator('#moneyPromptModal')).not.toHaveClass(/open/);
        expect(Object.hasOwn(await source(page), 'lastStatement')).toBe(false);
        await expect(balanceButton(page)).toBeVisible();

        // The statement was 1.800.000 and only 1.747.180 was paid: 52.820 is really still due.
        await balanceButton(page).click();
        await page.fill('#moneyPromptInput', '1800000');
        await page.click('#moneyPromptSubmit');
        await expect(dueLine(page)).toHaveText(
            'Cần trả 52.820 đ trước 04/11/2026 (quá hạn 3 ngày)',
        );
        await expect(note(page)).toHaveCount(0);
    });

    test('không có dòng giải thích khi số cần trả đã dựa vào sao kê, hoặc thẻ không có ngày chốt', async ({
        app,
    }) => {
        const anchored = JSON.stringify(
            SOURCES.map((item) =>
                item.name === CARD
                    ? { ...item, lastStatement: { date: '2026-10-20', balance: 1800000 } }
                    : item,
            ),
        );
        const first = await app({ now: NOW, seed: realSeed({ fm_sources: anchored }) });

        await first.page.evaluate(() => switchTab('sources'));
        await expect(dueLine(first.page)).toContainText('Cần trả 52.820 đ');
        await expect(note(first.page)).toHaveCount(0);
        await expect(balanceButton(first.page)).toHaveCount(0);

        // No statement day: the whole debt is due, a number that is exact, not a guess.
        const plain = JSON.stringify(
            SOURCES.map((item) => (item.name === CARD ? { ...item, statementDay: null } : item)),
        );
        const second = await app({ now: NOW, seed: realSeed({ fm_sources: plain }) });

        await second.page.evaluate(() => switchTab('sources'));
        await expect(dueLine(second.page)).toBeVisible();
        await expect(note(second.page)).toHaveCount(0);
        await expect(balanceButton(second.page)).toHaveCount(0);
    });

    test('hộp "Đã trả" nhắc rằng số cần trả chỉ là ước tính, để khỏi ghi thêm một khoản trả không có thật', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW, seed: realSeed() });

        await page.evaluate(() => switchTab('sources'));
        await card(page).locator('button[data-action="pay-card"]').click();
        await expect(page.locator('#cardPayModal')).toHaveClass(/open/);
        await expect(page.locator('#cardPayMessage')).toContainText('chỉ là ước tính');
        await expect(page.locator('#cardPayMessage')).toContainText('Nhập dư nợ cuối kỳ');
    });

    test('dư nợ cuối kỳ nhập nhanh lên Sheet v2 cùng nguồn tiền', async ({ app }) => {
        const server = newServer('v2');
        const { page } = await app({
            server,
            now: NOW,
            seed: syncedSeed(REAL_ROWS, {
                fm_sources: JSON.stringify(SOURCES),
                fm_initial_balances: JSON.stringify({ [CARD]: -1794696 }),
            }),
        });

        await page.evaluate(() => switchTab('sources'));
        await balanceButton(page).click();
        await page.fill('#moneyPromptInput', '1695414');
        await page.click('#moneyPromptSubmit');
        await wait(500);

        const remote = server.get({ v: '2' }).meta.sources.value.find((item) => item.name === CARD);

        expect(remote.lastStatement).toEqual({ date: '2026-10-20', balance: 1695414 });
    });

    test('trợ năng và điện thoại: dòng giải thích và nút mới không vi phạm axe, không tràn ngang', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            seed: realSeed(),
            viewport: { width: 390, height: 844 },
        });

        await page.evaluate(() => switchTab('sources'));
        await expect(balanceButton(page)).toBeVisible();
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);

        const results = await scanA11y(page, '#tab-sources');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
});
