// Import of a bank statement: rows that are money moving between the person's own sources (an ATM
// withdrawal, paying a card) are suggested as transfers in the preview, and written as transfers
// between the right two sources, so they are neither spending nor income.

const { test, expect, tx, goTab, scanA11y, settle } = require('./helpers');

const NOW = '2026-10-31T03:00:00Z';
const BANK = 'Thẻ Ngân Hàng';
const CASH = 'Tiền Mặt';
const CARD = 'Thẻ Tín Dụng';
const TRANSFER = 'Chuyển tiền nội bộ';

const HEADER = 'Ngày giao dịch,Mã giao dịch,Số tiền ghi nợ,Số tiền ghi có,Số dư,Nội dung';
// The account's statement: a coffee, an ATM withdrawal and a salary.
const ACCOUNT = [
    HEADER,
    '26/10/2026,FT001,45.000,,0,HIGHLANDS COFFEE Q1',
    '27/10/2026,FT002,2.000.000,,0,RUT TIEN ATM 0123 HA NOI',
    '28/10/2026,FT003,,12.000.000,0,CTY ABC LUONG THANG 10',
].join('\r\n');
// The card's statement: a charge, and the payment made from the person's own account.
const CARD_STATEMENT = [
    HEADER,
    '20/10/2026,FT010,,1.695.414,0,Credit Account I2B Virtual Card payment',
    '21/10/2026,FT011,587.160,,0,CLAUDE.AI SUBSCRIPTION',
].join('\r\n');

const file = (text, name = 'sao-ke.csv') => ({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(text, 'utf8'),
});
const rowsLocator = (page) => page.locator('#import-table-body tr');
const row = (page, index) => rowsLocator(page).nth(index);
const type = (page, index) => row(page, index).locator('select[data-field=type]');
const counter = (page, index) => row(page, index).locator('select[data-field=counter]');
const summary = (page) => page.locator('#import-summary');
const stored = (page) => page.evaluate(() => transactions);
const balances = (page) => page.evaluate(() => calculateSourceBalances());
const open = (app, seed = {}, extra = {}) =>
    app({
        now: NOW,
        seed: {
            fm_transactions: JSON.stringify([]),
            fm_initial_balances: JSON.stringify({ [BANK]: 10000000, [CASH]: 500000 }),
            ...seed,
        },
        ...extra,
    });

async function toPreview(page, text = ACCOUNT, source = BANK) {
    await goTab(page, 'settings');
    await page.click('#import-open-btn');
    await page.selectOption('#importSource', source);
    await page.setInputFiles('#importFile', file(text));
    await expect(page.locator('#import-mapping')).toBeVisible();
    await page.click('#import-continue');
    await expect(page.locator('#import-step-preview')).toBeVisible();
}

test.describe('Nhập sao kê: chuyển tiền giữa các nguồn', () => {
    test('dòng rút ATM được đề xuất là chuyển tiền sang Tiền Mặt; nhập xong số dư hai nguồn đổi, không tính là chi', async ({
        app,
    }) => {
        const { page } = await open(app);

        await toPreview(page);

        // The coffee is an expense with a category; the ATM line is a transfer to the cash source.
        await expect(type(page, 0)).toHaveValue('expense');
        await expect(row(page, 0).locator('select[data-field=category]')).toBeVisible();
        await expect(type(page, 1)).toHaveValue('transfer-out');
        await expect(counter(page, 1)).toHaveValue(CASH);
        await expect(row(page, 1).locator('select[data-field=category]')).toHaveCount(0);
        await expect(row(page, 1).locator('td[data-label="Số tiền"]')).toHaveText('-2.000.000 đ');
        await expect(row(page, 1)).toContainText('Có vẻ là rút tiền mặt');
        await expect(row(page, 1)).toContainText('không tính là chi hay thu');
        await expect(row(page, 1).locator('input[data-field=include]')).toBeChecked();
        await expect(type(page, 2)).toHaveValue('income');

        await expect(summary(page)).toContainText('1 dòng có vẻ là chuyển tiền giữa các nguồn');
        await expect(summary(page)).toContainText(
            'chi 45.000 đ, thu 12.000.000 đ, chuyển tiền giữa các nguồn 1 giao dịch (2.000.000 đ)',
        );

        await page.click('#import-commit');
        await expect(page.locator('#importModal')).not.toHaveClass(/open/);

        const moved = (await stored(page)).find((entry) => entry.type === 'transfer');

        expect(moved).toMatchObject({
            date: '2026-10-27',
            source: BANK,
            targetSource: CASH,
            category: TRANSFER,
            amount: 2000000,
            note: 'RUT TIEN ATM 0123 HA NOI',
        });
        expect(moved.id).toMatch(/^TX_IMP_20261027_/);
        expect(await stored(page)).toHaveLength(3);

        // 10.000.000 - 45.000 - 2.000.000 + 12.000.000 in the account; the cash gained 2.000.000.
        expect(await balances(page)).toMatchObject({ [BANK]: 19955000, [CASH]: 2500000 });
        await expect(page.locator('#toast-container')).toContainText(
            'Đã nhập 3 giao dịch vào Thẻ Ngân Hàng (1 chuyển tiền giữa các nguồn)',
        );

        // The overview counts only the coffee as spending and the salary as income.
        await page.evaluate(() => switchTab('overview'));
        await expect(page.locator('#lbl-total-expense')).toHaveText('45.000 đ');
        await expect(page.locator('#lbl-total-income')).toHaveText('12.000.000 đ');
    });

    test('sao kê thẻ: dòng trả thẻ từ tài khoản là chuyển tiền vào thẻ, nợ thẻ giảm và tài khoản giảm', async ({
        app,
    }) => {
        const { page } = await open(app, {
            fm_initial_balances: JSON.stringify({ [BANK]: 10000000, [CARD]: -1695414 }),
        });

        await toPreview(page, CARD_STATEMENT, CARD);

        await expect(type(page, 0)).toHaveValue('transfer-in');
        await expect(counter(page, 0)).toHaveValue(BANK);
        await expect(row(page, 0)).toContainText('Có vẻ là trả sao kê thẻ');
        await expect(row(page, 0).locator('td[data-label="Số tiền"]')).toHaveText('+1.695.414 đ');
        await expect(type(page, 1)).toHaveValue('expense');
        await expect(summary(page)).toContainText(
            'chi 587.160 đ, thu 0 đ, chuyển tiền giữa các nguồn 1 giao dịch (1.695.414 đ)',
        );

        await page.click('#import-commit');

        // Money into the imported source comes from the other one.
        expect((await stored(page)).find((entry) => entry.type === 'transfer')).toMatchObject({
            source: BANK,
            targetSource: CARD,
            category: TRANSFER,
            amount: 1695414,
        });
        expect(await balances(page)).toMatchObject({ [BANK]: 8304586, [CARD]: -587160 });
    });

    test('nguồn người dùng vừa trả thẻ được ưu tiên làm nguồn trả', async ({ app }) => {
        const { page } = await open(app, { fm_card_pay_source: CASH });

        await toPreview(page, CARD_STATEMENT, CARD);

        await expect(counter(page, 0)).toHaveValue(CASH);
    });

    test('tên một nguồn khác nằm trong nội dung thì dòng đó là chuyển tiền tới nguồn ấy', async ({
        app,
    }) => {
        const text = [HEADER, '26/10/2026,FT020,500.000,,0,CHUYEN KHOAN SANG TIEN MAT'].join(
            '\r\n',
        );
        const { page } = await open(app);

        await toPreview(page, text);

        await expect(type(page, 0)).toHaveValue('transfer-out');
        await expect(counter(page, 0)).toHaveValue(CASH);
        await expect(row(page, 0)).toContainText('Tên nguồn nằm trong nội dung');
    });

    test('người dùng quyết định: đổi về Chi, chọn nguồn khác, hoặc tự chọn chuyển tiền cho dòng không được đề xuất', async ({
        app,
    }) => {
        const { page } = await open(app);

        await toPreview(page);

        // The suggestion can be refused: the row becomes an expense with a category again.
        await type(page, 1).selectOption('expense');
        await expect(type(page, 1)).toBeFocused();
        await expect(row(page, 1).locator('select[data-field=category]')).toBeVisible();
        await expect(counter(page, 1)).toHaveCount(0);
        await expect(row(page, 1)).not.toContainText('Có vẻ là rút tiền mặt');
        await expect(row(page, 1).locator('td[data-label="Số tiền"]')).toHaveText('-2.000.000 đ');
        await expect(summary(page)).toContainText('chi 2.045.000 đ, thu 12.000.000 đ');
        await expect(summary(page)).not.toContainText('chuyển tiền giữa các nguồn 1');

        // ... and back: the other source is kept, and the note about the suggestion is gone.
        await type(page, 1).selectOption('transfer-out');
        await expect(counter(page, 1)).toHaveValue(CASH);
        await expect(row(page, 1)).not.toContainText('Có vẻ là rút tiền mặt');

        // A row nobody suggested: the person turns it into money coming in from the card.
        await type(page, 0).selectOption('transfer-in');
        await expect(counter(page, 0)).toHaveValue(CASH);
        await expect(row(page, 0).locator('td[data-label="Số tiền"]')).toHaveText('+45.000 đ');
        await expect(row(page, 0)).toContainText('Nhận từ');
        await counter(page, 0).selectOption(CARD);
        await counter(page, 1).selectOption(CARD);

        await page.click('#import-commit');

        const list = await stored(page);

        expect(list.find((entry) => entry.note.startsWith('HIGHLANDS'))).toMatchObject({
            type: 'transfer',
            source: CARD,
            targetSource: BANK,
            amount: 45000,
        });
        expect(list.find((entry) => entry.note.startsWith('RUT TIEN'))).toMatchObject({
            type: 'transfer',
            source: BANK,
            targetSource: CARD,
            amount: 2000000,
        });
    });

    test('bỏ chọn dòng chuyển tiền thì không ghi; hoàn tác xóa cả giao dịch chuyển tiền', async ({
        app,
    }) => {
        const { page } = await open(app);

        await toPreview(page);
        await row(page, 1).locator('input[data-field=include]').uncheck();
        await expect(summary(page)).toContainText('Sẽ nhập 2 giao dịch');
        await expect(summary(page)).not.toContainText('chuyển tiền giữa các nguồn 1');
        await row(page, 1).locator('input[data-field=include]').check();
        await page.click('#import-commit');
        expect((await stored(page)).filter((entry) => entry.type === 'transfer')).toHaveLength(1);

        await goTab(page, 'settings');
        await page.click('#import-undo-btn');

        expect(await stored(page)).toHaveLength(0);
        expect(await balances(page)).toMatchObject({ [BANK]: 10000000, [CASH]: 500000 });
    });

    test('nhập lại đúng file: dòng chuyển tiền đã nhập bị khóa, không nhân đôi, số dư không đổi', async ({
        app,
    }) => {
        const { page } = await open(app);

        await toPreview(page);
        await page.click('#import-commit');
        await expect(page.locator('#importModal')).not.toHaveClass(/open/);
        expect(await stored(page)).toHaveLength(3);

        await toPreview(page);

        await expect(summary(page)).toContainText('3 dòng đã nhập từ lần trước');
        await expect(row(page, 1).locator('input[data-field=include]')).toBeDisabled();
        await expect(page.locator('#import-commit')).toBeDisabled();
        expect(await stored(page)).toHaveLength(3);
        expect(await balances(page)).toMatchObject({ [BANK]: 19955000, [CASH]: 2500000 });
    });

    test('dòng trùng với khoản chuyển tiền đã gõ tay vẫn được đánh dấu trùng và chưa chọn', async ({
        app,
    }) => {
        const { page } = await open(app, {
            fm_transactions: JSON.stringify([
                tx({
                    id: 'M1',
                    date: '2026-10-27',
                    type: 'transfer',
                    source: BANK,
                    targetSource: CASH,
                    category: TRANSFER,
                    amount: 2000000,
                    note: 'Rút ATM',
                }),
            ]),
        });

        await toPreview(page);

        // Still suggested as a transfer, but it is the one already typed: left unticked.
        await expect(type(page, 1)).toHaveValue('transfer-out');
        await expect(row(page, 1).locator('input[data-field=include]')).not.toBeChecked();
        await expect(row(page, 1)).toContainText('Có thể trùng với "Rút ATM"');
        await expect(summary(page)).toContainText('Sẽ nhập 2 giao dịch');
    });

    test('nguồn kia bị lưu trữ trong lúc hộp thoại mở: báo, chọn lại và không ghi gì', async ({
        app,
    }) => {
        const { page, state } = await open(app);

        await toPreview(page);
        await page.evaluate((name) => {
            sources.find((source) => source.name === name).archived = true;
        }, CASH);
        await page.click('#import-commit');

        expect(state.alerts.at(-1)).toContain('không còn dùng được');
        await expect(page.locator('#importModal')).toHaveClass(/open/);
        expect(await stored(page)).toHaveLength(0);
        // The row was given a source that exists; the person checks it and imports again.
        await expect(counter(page, 1)).toHaveValue(CARD);

        await page.click('#import-commit');

        expect((await stored(page)).find((entry) => entry.type === 'transfer')).toMatchObject({
            source: BANK,
            targetSource: CARD,
        });
    });

    test('chỉ có một nguồn tiền thì không có lựa chọn chuyển tiền và dòng ATM vẫn là chi', async ({
        app,
    }) => {
        const { page } = await open(app, {
            fm_sources: JSON.stringify([{ name: 'VPBank', kind: 'bank' }]),
            fm_initial_balances: JSON.stringify({}),
        });

        await toPreview(page, ACCOUNT, 'VPBank');

        expect(await type(page, 1).locator('option').allInnerTexts()).toEqual(['Chi', 'Thu']);
        await expect(type(page, 1)).toHaveValue('expense');
        await expect(summary(page)).not.toContainText('chuyển tiền');
    });

    test('trợ năng: xem trước có dòng chuyển tiền không vi phạm axe; điện thoại không tràn ngang', async ({
        app,
    }) => {
        const { page } = await open(app, {}, { viewport: { width: 390, height: 844 } });

        await page.evaluate(() => switchTab('settings'));
        await page.evaluate(() => openImportModal());
        await page.selectOption('#importSource', BANK);
        await page.setInputFiles('#importFile', file(ACCOUNT));
        await expect(page.locator('#import-mapping')).toBeVisible();
        await page.click('#import-continue');
        await expect(page.locator('#import-step-preview')).toBeVisible();
        await settle(page);

        await expect(type(page, 1)).toHaveValue('transfer-out');
        await expect(row(page, 1).locator('td[data-label="Nguồn kia"]')).toBeVisible();
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);

        const results = await scanA11y(page, '#importModal');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
});
