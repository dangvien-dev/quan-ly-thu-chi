// Money fields show thousands separators while typing and keep the caret where the user is.

const { test, expect, tx, goTab, goTransactions, wait } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z';

test.describe('Ô nhập tiền có dấu phân cách hàng nghìn', () => {
    test('gõ từng chữ số: giá trị hiện 1.234.567 và lưu đúng 1234567', async ({ app }) => {
        const { page } = await app({ now: NOW });

        await page.click('header .btn');
        await page.locator('#txAmount').pressSequentially('1234567');

        await expect(page.locator('#txAmount')).toHaveValue('1.234.567');

        await page.click('#transactionForm button[type=submit]');

        expect(await page.evaluate(() => transactions[0].amount)).toBe(1234567);
    });

    test('hiện dấu phân cách ngay khi đủ 4 chữ số và chỉ nhận chữ số', async ({ app }) => {
        const { page } = await app();

        await page.click('header .btn');

        const input = page.locator('#txAmount');

        await input.pressSequentially('999');
        await expect(input).toHaveValue('999');
        await input.pressSequentially('9');
        await expect(input).toHaveValue('9.999');

        await input.fill('');
        await input.pressSequentially('a1b-2c.3,4 5');
        await expect(input).toHaveValue('12.345');
    });

    test('chèn chữ số ở giữa: con trỏ ở lại ngay sau chữ số vừa gõ', async ({ app }) => {
        const { page } = await app();

        await page.click('header .btn');

        const input = page.locator('#txAmount');

        await input.pressSequentially('12345'); // 12.345
        await page.keyboard.press('Home');
        await page.keyboard.press('ArrowRight'); // after the "1"
        await page.keyboard.type('9'); // 192.345, caret after the 9
        await page.keyboard.type('7'); // must land right after the 9

        await expect(input).toHaveValue('1.972.345');
    });

    test('xóa lùi qua dấu chấm không làm hỏng số, xóa hết thì ô rỗng', async ({ app }) => {
        const { page } = await app();

        await page.click('header .btn');

        const input = page.locator('#txAmount');

        await input.pressSequentially('12345'); // 12.345
        await page.keyboard.press('Backspace');
        await expect(input).toHaveValue('1.234');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('Backspace'); // removes the "."
        await expect(input).toHaveValue('1.234');

        await input.fill('');
        await expect(input).toHaveValue('');
    });

    test('dán số có sẵn dấu phân cách hoặc ký tự lạ vẫn ra đúng', async ({ app }) => {
        const { page } = await app();

        await page.click('header .btn');
        await page.fill('#txAmount', '17000');
        await expect(page.locator('#txAmount')).toHaveValue('17.000');

        await page.fill('#txAmount', '224.500 đ');
        await expect(page.locator('#txAmount')).toHaveValue('224.500');
    });

    test('tối đa 15 chữ số', async ({ app }) => {
        const { page } = await app();

        await page.click('header .btn');
        await page.fill('#txAmount', '123456789012345678901234');

        await expect(page.locator('#txAmount')).toHaveValue('123.456.789.012.345');
    });

    test('số tiền trống hoặc bằng 0 bị từ chối', async ({ app }) => {
        const { page, state } = await app();

        await page.click('header .btn');
        await page.fill('#txAmount', '0');
        await page.click('#transactionForm button[type=submit]');
        expect(state.alerts.at(-1)).toContain('số tiền hợp lệ');

        await page.fill('#txAmount', '');
        await page.click('#transactionForm button[type=submit]');
        expect(await page.evaluate(() => transactions.length)).toBe(0);
    });

    test('các chip nhập nhanh và khi sửa giao dịch ô tiền cũng có dấu phân cách', async ({
        app,
    }) => {
        const { page } = await app({
            seed: { fm_transactions: JSON.stringify([tx({ id: 'TX_1', amount: 224500 })]) },
        });

        await page.click('header .btn');
        await page.locator('.chip', { hasText: 'Cơm trưa' }).click();
        await expect(page.locator('#txAmount')).toHaveValue('45.000');
        await page.click('#transactionModal .close-btn');

        await goTransactions(page);
        await page.click('#transaction-table-body [data-action=edit]');
        await expect(page.locator('#txAmount')).toHaveValue('224.500');

        await page.locator('#txAmount').pressSequentially('0');
        await expect(page.locator('#txAmount')).toHaveValue('2.245.000');
    });

    test('mọi ô tiền là ô văn bản có bàn phím số, không còn type=number', async ({ app }) => {
        const { page } = await app();
        const fields = await page.$$eval('input[data-money]', (inputs) =>
            inputs.map((input) => ({
                id: input.id,
                type: input.type,
                mode: input.getAttribute('inputmode'),
                money: input.dataset.money,
            })),
        );

        expect(fields.map((field) => field.id).sort()).toEqual([
            'debtAmount',
            'rcAmount',
            'salaryAmount',
            'savAmount',
            'srcCreditLimit',
            'srcInitialBalance',
            'txAmount',
        ]);
        expect(fields.every((field) => field.type === 'text')).toBe(true);
        expect(fields.find((field) => field.id === 'txAmount').mode).toBe('numeric');
        // The signed field needs a minus sign, which a numeric keypad does not have.
        expect(fields.find((field) => field.id === 'srcInitialBalance')).toMatchObject({
            mode: 'text',
            money: 'signed',
        });
    });
});

test.describe('Ô tiền ở các biểu mẫu khác', () => {
    test('số dư ban đầu của nguồn nhận số âm và lưu đúng', async ({ app }) => {
        const { page } = await app();

        await goTab(page, 'sources');
        await page.click('button:has-text("Thêm Nguồn Tiền")');
        await page.fill('#srcName', 'Visa VCB');
        await page.selectOption('#srcKind', 'credit');
        await page.fill('#srcCreditLimit', '20000000');
        await page.locator('#srcInitialBalance').pressSequentially('-1500000');

        await expect(page.locator('#srcCreditLimit')).toHaveValue('20.000.000');
        await expect(page.locator('#srcInitialBalance')).toHaveValue('-1.500.000');

        await page.click('#sourceForm button[type=submit]');

        const saved = await page.evaluate(() => ({
            limit: sources.find((source) => source.name === 'Visa VCB').creditLimit,
            balance: initialBalances['Visa VCB'],
        }));

        expect(saved).toEqual({ limit: 20000000, balance: -1500000 });
        await expect(
            page.locator('#sources-grid .card', { hasText: 'Visa VCB' }).locator('.card-value'),
        ).toHaveText('-1.500.000 đ');
    });

    test('chỉ gõ dấu trừ thì không làm hỏng số dư đang có', async ({ app }) => {
        const { page } = await app({
            seed: { fm_initial_balances: JSON.stringify({ 'Tiền Mặt': 500000 }) },
        });

        await goTab(page, 'sources');
        await page
            .locator('#sources-grid .card', { hasText: 'Tiền Mặt' })
            .locator('[data-action=edit-source]')
            .click();
        await expect(page.locator('#srcInitialBalance')).toHaveValue('500.000');

        await page.fill('#srcInitialBalance', '-');
        await expect(page.locator('#srcInitialBalance')).toHaveValue('-');
        await page.click('#sourceForm button[type=submit]');

        expect(await page.evaluate(() => initialBalances['Tiền Mặt'])).toBe(500000);
    });

    test('số tiền của giao dịch định kỳ và khoản vay nợ có dấu phân cách và lưu đúng', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });

        await goTab(page, 'recurring');
        await page.click('button:has-text("Thêm Định Kỳ")');
        await page.fill('#rcName', 'Tiền nhà');
        await page.locator('#rcAmount').pressSequentially('3500000');
        await expect(page.locator('#rcAmount')).toHaveValue('3.500.000');
        await page.fill('#rcStart', '2026-10-28');
        await page.click('#recurringForm button[type=submit]');

        expect(await page.evaluate(() => recurring[0].amount)).toBe(3500000);

        await goTab(page, 'debts');
        await page.click('button:has-text("Thêm Khoản")');
        await page.fill('#debtParty', 'Anh Nam');
        await page.locator('#debtAmount').pressSequentially('12500000');
        await expect(page.locator('#debtAmount')).toHaveValue('12.500.000');
        await page.click('#debtForm button[type=submit]');

        expect(await page.evaluate(() => debts[0].amount)).toBe(12500000);

        // Editing shows the grouped number again.
        await page.click('#debt-table-body [data-action=edit]');
        await expect(page.locator('#debtAmount')).toHaveValue('12.500.000');
        await wait(50);
    });
});
