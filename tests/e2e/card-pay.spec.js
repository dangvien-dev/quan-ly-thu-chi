// "Đã trả" under the due line of a credit card: the dialog and the transfer it records.
// The numbers are those of the owner's Thẻ Tín Dụng on 7/11/2026 (statement 21/09-20/10, due 4/11).

const { test, expect, tx, newServer, syncedSeed, scanA11y, settle, wait } = require('./helpers');

const NOW = '2026-11-07T03:00:00Z';
const CARD = 'Thẻ Tín Dụng';
const BANK = 'Thẻ Ngân Hàng';
const SOURCES = [
    { name: 'Tiền Mặt', kind: 'cash' },
    { name: BANK, kind: 'bank' },
    { name: CARD, kind: 'credit', creditLimit: 37800000, statementDay: 20, dueDay: 4 },
    { name: 'Spaylater', kind: 'credit', creditLimit: 30000000, statementDay: 24, dueDay: 10 },
    { name: 'Nợ Công Ty', kind: 'debt' },
];
// The 712.493 đ opening debt is the statement of 20/10; 1.382.661 đ was spent after it.
const SPENDING = [tx({ id: 'S1', date: '2026-10-25', source: CARD, amount: 1382661 })];
const seedFor = (rows = SPENDING, sources = SOURCES, extra = {}) => ({
    fm_sources: JSON.stringify(sources),
    fm_initial_balances: JSON.stringify({ [CARD]: -712493 }),
    fm_transactions: JSON.stringify(rows),
    ...extra,
});
const open = (app, rows, extra = {}) => app({ now: NOW, seed: seedFor(rows), ...extra });
const card = (page, name = CARD) =>
    page.locator('#sources-grid .source-card', {
        has: page.locator(`button[data-action="edit-balance"][data-source="${name}"]`),
    });
const dueLine = (page, name = CARD) => card(page, name).locator('.card-due');
const payButton = (page, name = CARD) => card(page, name).locator('button[data-action="pay-card"]');
const balance = (page, name) => page.evaluate((source) => calculateSourceBalances()[source], name);
const stored = (page) => page.evaluate(() => transactions);

async function openSources(page) {
    await page.evaluate(() => switchTab('sources'));
}

async function openPay(page) {
    await openSources(page);
    await payButton(page).click();
    await expect(page.locator('#cardPayModal')).toHaveClass(/open/);
}

test.describe('Nút Đã trả trên dòng Cần trả', () => {
    test('đúng tình huống của chủ repo: có nút, mở hộp thoại điền sẵn số phải trả và ngày hôm nay', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openSources(page);
        await expect(dueLine(page)).toHaveText(
            'Cần trả 712.493 đ trước 04/11/2026 (quá hạn 3 ngày)',
        );
        await expect(payButton(page)).toBeVisible();
        await expect(payButton(page)).toHaveAccessibleName('Ghi khoản đã trả cho thẻ Thẻ Tín Dụng');

        await payButton(page).click();

        await expect(page.locator('#cardPayModal')).toHaveClass(/open/);
        await expect(page.locator('#cardPayTitle')).toHaveText('Trả sao kê Thẻ Tín Dụng');
        await expect(page.locator('#cardPayMessage')).toContainText(
            'Cần trả 712.493 đ trước 04/11/2026',
        );
        await expect(page.locator('#cardPayAmount')).toHaveValue('712.493');
        await expect(page.locator('#cardPayAmount')).toBeFocused();
        await expect(page.locator('#cardPayDate')).toHaveValue('2026-11-07');
        // Not the card itself, not another card, not a loan.
        expect(await page.locator('#cardPaySource option').allInnerTexts()).toEqual([
            'Tiền Mặt',
            BANK,
        ]);
    });

    test('ghi khoản trả đủ: tạo giao dịch chuyển tiền, dòng đỏ và nút biến mất, số dư hai nguồn đúng', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openPay(page);
        await page.selectOption('#cardPaySource', BANK);
        await page.fill('#cardPayDate', '2026-11-03');
        await expect(page.locator('#cardPaySourceHint')).toHaveText(
            `Tạo giao dịch chuyển tiền từ ${BANK} sang ${CARD}: số dư ${BANK} giảm, nợ ${CARD} giảm. Số dư ${CARD} sau khi ghi: -1.382.661 đ.`,
        );
        await page.click('#cardPayForm button[type=submit]');

        await expect(page.locator('#cardPayModal')).not.toHaveClass(/open/);

        const [created] = await stored(page);

        expect(created).toMatchObject({
            type: 'transfer',
            date: '2026-11-03',
            source: BANK,
            targetSource: CARD,
            category: 'Chuyển tiền nội bộ',
            amount: 712493,
            note: `Trả sao kê ${CARD}`,
        });
        expect(created.id).toMatch(/^TX_CARDPAY_\d+$/);
        expect(created.updatedAt).toBeTruthy();

        expect(await balance(page, CARD)).toBe(-1382661);
        expect(await balance(page, BANK)).toBe(-712493);
        await expect(dueLine(page)).toHaveCount(0);
        await expect(payButton(page)).toHaveCount(0);
        await expect(card(page).locator('.card-value')).toHaveText('-1.382.661 đ');
        // The statement is paid, so the card shows the due day alone and no reminder comes back.
        await expect(card(page)).toContainText('Hạn thanh toán ngày 4 (còn 27 ngày)');
        await expect(page.locator('#toast-container')).toContainText(
            `Đã ghi trả 712.493 đ cho ${CARD} từ ${BANK}.`,
        );
        // The button is gone: the focus stays on the card.
        await expect(card(page).locator('button[data-action="edit-balance"]')).toBeFocused();

        await page.reload();
        await wait(300);
        await expect(
            page.locator('#toast-container .toast').filter({ hasText: 'trả thẻ' }),
        ).toHaveCount(0);
    });

    test('trả một phần thì còn lại phần chưa trả, nút vẫn còn; lần sau nguồn đã chọn được chọn sẵn', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openPay(page);
        await page.selectOption('#cardPaySource', BANK);
        await page.fill('#cardPayAmount', '300000');
        await page.click('#cardPayForm button[type=submit]');

        await expect(dueLine(page)).toHaveText(
            'Cần trả 412.493 đ trước 04/11/2026 (quá hạn 3 ngày)',
        );
        await expect(payButton(page)).toBeVisible();

        await payButton(page).click();
        await expect(page.locator('#cardPayAmount')).toHaveValue('412.493');
        await expect(page.locator('#cardPaySource')).toHaveValue(BANK);

        // Remembered on this device across a reload.
        await page.keyboard.press('Escape');
        await page.reload();
        await openPay(page);
        await expect(page.locator('#cardPaySource')).toHaveValue(BANK);
    });

    test('trả nhiều hơn số còn nợ vẫn ghi được; hộp thoại nói số dư thẻ sau khi ghi', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openPay(page);
        await page.fill('#cardPayAmount', '2500000');
        await expect(page.locator('#cardPaySourceHint')).toContainText(
            `Số dư ${CARD} sau khi ghi: 404.846 đ.`,
        );
        await page.click('#cardPayForm button[type=submit]');

        expect(await balance(page, CARD)).toBe(404846);
    });

    test('số tiền rỗng hoặc 0 thì báo và giữ hộp thoại; Esc đóng mà không ghi gì, focus về nút Đã trả', async ({
        app,
    }) => {
        const { page, state } = await open(app);

        await openPay(page);

        for (const bad of ['', '0']) {
            await page.fill('#cardPayAmount', bad);
            await page.click('#cardPayForm button[type=submit]');
        }

        expect(state.alerts).toEqual(['Số tiền không hợp lệ!', 'Số tiền không hợp lệ!']);
        await expect(page.locator('#cardPayModal')).toHaveClass(/open/);

        await page.keyboard.press('Escape');

        await expect(page.locator('#cardPayModal')).not.toHaveClass(/open/);
        await expect(payButton(page)).toBeFocused();
        expect(await stored(page)).toHaveLength(1);
    });

    test('nguồn trả hoặc thẻ bị lưu trữ trong lúc hộp thoại mở thì không ghi gì', async ({
        app,
    }) => {
        const { page, state } = await open(app);

        await openPay(page);
        await page.selectOption('#cardPaySource', BANK);
        await page.evaluate((name) => {
            sources.find((source) => source.name === name).archived = true;
        }, BANK);
        await page.click('#cardPayForm button[type=submit]');

        expect(state.alerts.at(-1)).toContain('không còn dùng được');
        await expect(page.locator('#cardPayModal')).toHaveClass(/open/);

        await page.evaluate((name) => {
            sources.find((source) => source.name === name).archived = true;
        }, CARD);
        await page.click('#cardPayForm button[type=submit]');

        await expect(page.locator('#cardPayModal')).not.toHaveClass(/open/);
        expect(await stored(page)).toHaveLength(1);
    });

    test('không có nguồn nào để trả từ đó thì báo', async ({ app }) => {
        const { page, state } = await app({
            now: NOW,
            seed: seedFor(SPENDING, [
                { name: CARD, kind: 'credit', statementDay: 20, dueDay: 4 },
                { name: 'Sổ 6 tháng', kind: 'savings' },
            ]),
        });

        await openSources(page);
        await payButton(page).click();

        expect(state.alerts.at(-1)).toContain('Chưa có nguồn tiền nào');
        await expect(page.locator('#cardPayModal')).not.toHaveClass(/open/);
    });
});

test.describe('Khi nào có nút Đã trả', () => {
    test('chỉ khi thẻ đang có khoản phải trả: đã trả đủ, không có ngày hạn hoặc thẻ lưu trữ thì không có', async ({
        app,
    }) => {
        const paid = await open(app, [
            ...SPENDING,
            tx({
                id: 'P',
                date: '2026-11-03',
                type: 'transfer',
                source: BANK,
                targetSource: CARD,
                category: 'Chuyển tiền nội bộ',
                amount: 712493,
            }),
        ]);

        await openSources(paid.page);
        await expect(payButton(paid.page)).toHaveCount(0);

        const noDue = await app({
            now: NOW,
            seed: seedFor(
                SPENDING,
                SOURCES.map((source) =>
                    source.name === CARD ? { ...source, dueDay: null } : source,
                ),
            ),
        });

        await openSources(noDue.page);
        await expect(payButton(noDue.page)).toHaveCount(0);

        const archived = await app({
            now: NOW,
            seed: seedFor(
                SPENDING,
                SOURCES.map((source) =>
                    source.name === CARD ? { ...source, archived: true } : source,
                ),
            ),
        });

        await openSources(archived.page);
        await expect(archived.page.locator('button[data-action="pay-card"]')).toHaveCount(0);
    });

    test('chế độ Sắp xếp chỉ còn nút Lên / Xuống, không có nút Đã trả', async ({ app }) => {
        const { page } = await open(app);

        await openSources(page);
        await page.click('#sources-sort-btn');
        await expect(page.locator('button[data-action="pay-card"]')).toHaveCount(0);
        await page.click('#sources-sort-btn');
        await expect(payButton(page)).toBeVisible();
    });
});

test.describe('Chữ "Hạn thanh toán" không mâu thuẫn với "quá hạn"', () => {
    test('quá hạn: dòng hạn chỉ ghi ngày hằng tháng; chưa quá hạn: giữ "còn N ngày"', async ({
        app,
    }) => {
        const overdue = await open(app);

        await openSources(overdue.page);
        await expect(card(overdue.page)).toContainText('Hạn thanh toán ngày 4 hằng tháng');
        await expect(card(overdue.page)).not.toContainText('Hạn thanh toán ngày 4 (còn');
        await expect(card(overdue.page)).toContainText('Chốt sao kê ngày 20 (còn 13 ngày)');

        const early = await app({ now: '2026-11-01T03:00:00Z', seed: seedFor() });

        await openSources(early.page);
        await expect(card(early.page)).toContainText('Hạn thanh toán ngày 4 (còn 3 ngày)');
        await expect(dueLine(early.page)).toHaveText(
            'Cần trả 712.493 đ trước 04/11/2026 (còn 3 ngày)',
        );
    });
});

test.describe('Đã trả và đồng bộ', () => {
    test('giao dịch chuyển tiền lên Sheet v2 kèm nguồn nhận là thẻ', async ({ app }) => {
        const server = newServer('v2');
        const { page } = await app({
            server,
            now: NOW,
            seed: syncedSeed(SPENDING, {
                fm_sources: JSON.stringify(SOURCES),
                fm_initial_balances: JSON.stringify({ [CARD]: -712493 }),
            }),
        });

        await openPay(page);
        await page.selectOption('#cardPaySource', BANK);
        await page.click('#cardPayForm button[type=submit]');
        await wait(500);

        const remote = server
            .get({ v: '2' })
            .transactions.find((row) => row.id.startsWith('TX_CARDPAY_'));

        expect(remote).toMatchObject({
            type: 'transfer',
            source: BANK,
            targetSource: CARD,
            amount: 712493,
        });
    });
});

test.describe('Giao diện hộp thoại Đã trả', () => {
    test('trợ năng: hộp thoại không vi phạm axe', async ({ app }) => {
        const { page } = await open(app);

        await openPay(page);
        await settle(page);

        const results = await scanA11y(page, '#cardPayModal');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    test('điện thoại: nút nằm gọn trong thẻ, hộp thoại không tràn ngang', async ({ app }) => {
        const { page } = await open(app, SPENDING, { viewport: { width: 390, height: 844 } });

        await openSources(page);
        await settle(page);

        const box = await payButton(page).boundingBox();
        const inside = await card(page).boundingBox();

        expect(box.x).toBeGreaterThanOrEqual(inside.x);
        expect(box.x + box.width).toBeLessThanOrEqual(inside.x + inside.width);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);

        const sources = await scanA11y(page, '#tab-sources');

        expect(sources.violations.map((violation) => violation.id)).toEqual([]);

        await payButton(page).click();
        await settle(page);

        const dialog = await page.locator('#cardPayModal .modal-content').boundingBox();

        expect(dialog.x).toBeGreaterThanOrEqual(0);
        expect(dialog.x + dialog.width).toBeLessThanOrEqual(390);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);
    });
});
