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
    { name: CARD, kind: 'credit', creditLimit: 25000000, statementDay: 20, dueDay: 4 },
];
// What the book has since the 20/10 statement: five charges and the payment of the statement.
const charge = (id, date, amount) => tx({ id, date, source: CARD, amount });
const ROWS = [
    charge('A', '2026-10-22', 612450),
    charge('B', '2026-10-23', 73333),
    charge('C', '2026-10-24', 30000),
    charge('D', '2026-11-03', 91111),
    charge('E', '2026-11-05', 571820),
    tx({
        id: 'P',
        date: '2026-10-21',
        type: 'transfer',
        source: VPBANK,
        targetSource: CARD,
        category: 'Chuyển tiền nội bộ',
        amount: 1644436,
    }),
];
// "Khớp số dư" with the real available limit put 48.213 of charges the book is missing into the
// initial balance: -1.644.436 would be right, -1.692.649 is what the app holds.
const seed = (extra = {}, sources = SOURCES, opening = -1692649) => ({
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
    test('trước khi nhập mốc: số dư ban đầu lệch 48.213 thì thẻ đã trả đủ vẫn báo cần trả 48.213', async ({
        app,
    }) => {
        const { page } = await open(app);

        await page.evaluate(() => switchTab('sources'));
        await expect(dueLine(page)).toHaveText(
            'Cần trả 48.213 đ trước 04/11/2026 (quá hạn 3 ngày)',
        );
        await expect(card(page)).not.toContainText('Sao kê chốt');
    });

    test('nhập dư nợ cuối kỳ 1.644.436: hết báo cần trả, số dư ban đầu và số dư thẻ giữ nguyên', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openEditor(page);
        await expect(page.locator('#srcStatementBalance')).toHaveValue('');
        await expect(page.locator('#srcStatementBalanceHint')).toContainText('Dư nợ cuối kỳ');
        await page.fill('#srcStatementBalance', '1644436');
        await expect(page.locator('#srcStatementBalance')).toHaveValue('1.644.436');
        await page.click('#sourceForm button[type=submit]');

        await expect(dueLine(page)).toHaveCount(0);
        await expect(card(page)).toContainText('Sao kê chốt 20/10/2026: dư nợ 1.644.436 đ');
        // The number is a fact about the statement: nothing else changes.
        await expect(card(page).locator('.card-value')).toHaveText('-1.426.927 đ');
        await expect(card(page)).toContainText('Số dư ban đầu -1.692.649 đ');
        expect(await source(page)).toMatchObject({
            lastStatement: { date: '2026-10-20', balance: 1644436 },
        });

        // It survives a reload, and the dialog shows it with its statement day.
        await page.reload();
        await openEditor(page);
        await expect(page.locator('#srcStatementBalance')).toHaveValue('1.644.436');
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
                                      lastStatement: { date: '2026-10-20', balance: 1644436 },
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
            'Cần trả 644.436 đ trước 04/11/2026 (quá hạn 3 ngày)',
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
                            ? { ...item, lastStatement: { date: '2026-09-20', balance: 1523907 } }
                            : item,
                    ),
                ),
            }),
        });

        await openEditor(page);
        await expect(page.locator('#srcStatementBalance')).toHaveValue('1.523.907');
        await page.click('#sourceForm button[type=submit]');
        expect((await source(page)).lastStatement).toEqual({
            date: '2026-09-20',
            balance: 1523907,
        });

        await openEditor(page);
        await page.fill('#srcStatementBalance', '1644436');
        await page.click('#sourceForm button[type=submit]');
        expect((await source(page)).lastStatement).toEqual({
            date: '2026-10-20',
            balance: 1644436,
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
        await page.fill('#srcStatementBalance', '1644436');
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
                fm_initial_balances: JSON.stringify({ [CARD]: -1692649 }),
            }),
        });

        await openEditor(page);
        await page.fill('#srcStatementBalance', '1644436');
        await page.click('#sourceForm button[type=submit]');
        await wait(500);

        const remote = server.get({ v: '2' }).meta.sources.value.find((item) => item.name === CARD);

        expect(remote.lastStatement).toEqual({ date: '2026-10-20', balance: 1644436 });
    });
});

// "Cần trả" without the closing balance of the statement is only a guess from the initial balance.
// A made-up book with the shape of a real case (7/11/2026): the balance matches the bank (available
// 22.990.354 of 25.000.000), the 20/10 statement is paid, and the card still said 48.213 was due
// because "Khớp số dư" had pushed charges the book misses (fee / VAT lines) into the opening.
const REAL_CHARGES = [
    ['2026-09-21', 100000],
    ['2026-09-23', 73333],
    ['2026-09-24', 132000],
    ['2026-09-28', 30000],
    ['2026-09-30', 582719],
    ['2026-10-03', 91111],
    ['2026-10-05', 498273],
    ['2026-10-10', 30000],
    ['2026-10-17', 30000],
    ['2026-10-22', 612450],
    ['2026-10-23', 73333],
    ['2026-10-24', 30000],
    ['2026-10-30', 582719],
    ['2026-11-03', 91111],
    ['2026-11-05', 571820],
];
const REAL_PAYMENTS = [
    ['2026-09-21', 1523907],
    ['2026-10-21', 1644436],
    ['2026-10-21', 48213],
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
    fm_initial_balances: JSON.stringify({ [CARD]: -1697333 }),
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
        await expect(card(page).locator('.card-value')).toHaveText('-2.009.646 đ');
        await expect(dueLine(page)).toHaveText(
            'Cần trả 48.213 đ trước 04/11/2026 (quá hạn 3 ngày)',
        );
        await expect(note(page)).toContainText('ước tính từ số dư ban đầu');
        await expect(note(page)).toContainText('Dư nợ cuối kỳ');
        await expect(balanceButton(page)).toHaveAccessibleName(
            'Nhập dư nợ cuối kỳ của sao kê thẻ Thẻ Tín Dụng',
        );
    });

    test('nhập 1.644.436 trên thẻ: hết báo cần trả, số dư và số dư ban đầu giữ nguyên, mốc được lưu', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW, seed: realSeed() });

        await page.evaluate(() => switchTab('sources'));
        await balanceButton(page).click();

        await expect(page.locator('#moneyPromptModal')).toHaveClass(/open/);
        await expect(page.locator('#moneyPromptMessage')).toContainText('chốt ngày 20/10/2026');
        await expect(page.locator('#moneyPromptInput')).toHaveValue('');
        await page.fill('#moneyPromptInput', '1644436');
        await expect(page.locator('#moneyPromptInput')).toHaveValue('1.644.436');
        await page.click('#moneyPromptSubmit');

        await expect(dueLine(page)).toHaveCount(0);
        await expect(note(page)).toHaveCount(0);
        await expect(balanceButton(page)).toHaveCount(0);
        await expect(card(page)).toContainText('Sao kê chốt 20/10/2026: dư nợ 1.644.436 đ');
        await expect(card(page).locator('.card-value')).toHaveText('-2.009.646 đ');
        await expect(card(page)).toContainText('Số dư ban đầu -1.697.333 đ');
        expect(await source(page)).toMatchObject({
            lastStatement: { date: '2026-10-20', balance: 1644436 },
        });
        await expect(page.locator('.toast').last()).toContainText(
            'Đã lưu dư nợ cuối kỳ 1.644.436 đ',
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

        // The statement was 1.800.000 and only 1.692.649 was paid: 107.351 is really still due.
        await balanceButton(page).click();
        await page.fill('#moneyPromptInput', '1800000');
        await page.click('#moneyPromptSubmit');
        await expect(dueLine(page)).toHaveText(
            'Cần trả 107.351 đ trước 04/11/2026 (quá hạn 3 ngày)',
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
        await expect(dueLine(first.page)).toContainText('Cần trả 107.351 đ');
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
                fm_initial_balances: JSON.stringify({ [CARD]: -1697333 }),
            }),
        });

        await page.evaluate(() => switchTab('sources'));
        await balanceButton(page).click();
        await page.fill('#moneyPromptInput', '1644436');
        await page.click('#moneyPromptSubmit');
        await wait(500);

        const remote = server.get({ v: '2' }).meta.sources.value.find((item) => item.name === CARD);

        expect(remote.lastStatement).toEqual({ date: '2026-10-20', balance: 1644436 });
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

// The book as it is after the VPBank statement was imported (fee / VAT lines included) and the
// closing balance entered. "Khớp số dư" had put the 48.213 of fees posted after the statement day
// into the initial balance (-1.572.120 instead of -1.523.907); the card says so, so that months
// later the gap is not a mystery.
const FEES = [
    ['2026-09-23', 11000],
    ['2026-09-23', 11000],
    ['2026-09-28', 11000],
    ['2026-09-30', 11000],
    ['2026-10-04', 11000],
    ['2026-10-10', 11000],
    ['2026-10-17', 11000],
];
const BOOK_ROWS = [
    ...REAL_CHARGES.map(([date, amount], index) => charge(`B${index}`, date, amount)),
    ...FEES.map(([date, amount], index) => charge(`F${index}`, date, amount)),
    ...REAL_PAYMENTS.slice(0, 2).map(([date, amount], index) =>
        tx({
            id: `BP${index}`,
            date,
            type: 'transfer',
            source: VPBANK,
            targetSource: CARD,
            category: 'Chuyển tiền nội bộ',
            amount,
        }),
    ),
];
const ANCHORED_SOURCES = JSON.stringify(
    SOURCES.map((item) =>
        item.name === CARD
            ? { ...item, lastStatement: { date: '2026-10-20', balance: 1644436 } }
            : item,
    ),
);
const bookSeed = (opening) => ({
    fm_sources: ANCHORED_SOURCES,
    fm_initial_balances: JSON.stringify({ [CARD]: opening }),
    fm_transactions: JSON.stringify(BOOK_ROWS),
});
const gapNote = (page) => card(page).locator('.card-gap-note');

test.describe('Sổ lệch so với sao kê: ghi chú giải thích trên thẻ', () => {
    test('số dư ban đầu chứa 48.213 phí chưa nhập: thẻ nói rõ khoản lệch, lý do và cách làm hết', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW, seed: bookSeed(-1572120) });

        await page.evaluate(() => switchTab('sources'));
        await expect(card(page)).toContainText('Sao kê chốt 20/10/2026: dư nợ 1.644.436 đ');
        await expect(gapNote(page)).toContainText(
            'Sổ đang lệch 48.213 đ so với sao kê chốt 20/10/2026',
        );
        await expect(gapNote(page)).toContainText('số dư ban đầu đang chứa khoản nợ này');
        await expect(gapNote(page)).toContainText('phí chuyển đổi ngoại tệ, VAT hoặc lãi');
        await expect(gapNote(page)).toContainText('Nhập sao kê kỳ sau rồi bấm Khớp số dư');
        // It is a note, not a due line: nothing is owed on the statement.
        await expect(dueLine(page)).toHaveCount(0);
    });

    test('số dư ban đầu đúng thì không có ghi chú; sổ ghi nợ ít hơn sao kê thì nói theo chiều ngược lại', async ({
        app,
    }) => {
        const exact = await app({ now: NOW, seed: bookSeed(-1523907) });

        await exact.page.evaluate(() => switchTab('sources'));
        await expect(card(exact.page)).toContainText('Sao kê chốt 20/10/2026');
        await expect(gapNote(exact.page)).toHaveCount(0);

        const less = await app({ now: NOW, seed: bookSeed(-1423907) });

        await less.page.evaluate(() => switchTab('sources'));
        await expect(gapNote(less.page)).toContainText(
            'Sổ đang ghi nợ ít hơn sao kê chốt 20/10/2026 100.000 đ',
        );
        await expect(gapNote(less.page)).toContainText('Xem theo kỳ sao kê');
    });

    test('thẻ chưa nhập dư nợ cuối kỳ thì không có ghi chú (không có gì để so)', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            seed: { ...bookSeed(-1572120), fm_sources: JSON.stringify(SOURCES) },
        });

        await page.evaluate(() => switchTab('sources'));
        await expect(card(page).locator('.card-value')).toBeVisible();
        await expect(gapNote(page)).toHaveCount(0);
    });

    test('Khớp số dư nhắc ngay rằng sổ đang lệch so với sao kê', async ({ app }) => {
        // The available limit 22.990.354 is what the bank shows: the balance is already right
        // (-2.009.646), so the opening stays and the gap is what the toast warns about.
        const { page } = await app({
            now: NOW,
            seed: bookSeed(-1572120),
            promptValue: '22990354',
        });

        await page.evaluate(() => switchTab('sources'));
        await card(page).locator('button[data-action="match-balance"]').click();

        const toast = page.locator('.toast').last();

        await expect(toast).toContainText('Đã khớp [Thẻ Tín Dụng]');
        await expect(toast).toContainText('sổ đang lệch 48.213 đ so với sao kê chốt 20/10/2026');
        await expect(gapNote(page)).toBeVisible();
    });

    test('trợ năng và điện thoại: ghi chú không vi phạm axe, không tràn ngang', async ({ app }) => {
        const { page } = await app({
            now: NOW,
            seed: bookSeed(-1572120),
            viewport: { width: 390, height: 844 },
        });

        await page.evaluate(() => switchTab('sources'));
        await expect(gapNote(page)).toBeVisible();
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);

        const results = await scanA11y(page, '#tab-sources');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
});
