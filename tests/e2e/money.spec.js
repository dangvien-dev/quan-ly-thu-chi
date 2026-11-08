// Money fields show thousands separators while typing and keep the caret where the user is.

const { test, expect, tx, goTab, goTransactions, wait, scanA11y } = require('./helpers');

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
        await input.pressSequentially('a1b2c.3 4 5');
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
            'cardPayAmount',
            'debtAmount',
            'debtPayAmount',
            'moneyPromptInput',
            'rcAmount',
            'salaryAmount',
            'savAmount',
            'srcCreditLimit',
            'srcInitialBalance',
            'srcStatementBalance',
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

test.describe('Xóa chữ số đầu của ô tiền', () => {
    test('chọn giao dịch cài sẵn 20.000, xóa số 2: giữ đủ 0.000 rồi gõ số mới thành 50.000', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });

        await page.click('header .btn');
        await page.click('.chip:has-text("Cafe sáng")');

        const input = page.locator('#txAmount');

        await expect(input).toHaveValue('20.000');

        await input.focus();
        await page.keyboard.press('Home');
        await page.keyboard.press('ArrowRight'); // after the "2"
        await page.keyboard.press('Backspace');

        // Used to collapse to "0": the three zeros after the deleted digit were lost.
        await expect(input).toHaveValue('0.000');

        await page.keyboard.type('5'); // the caret stays at the front
        await expect(input).toHaveValue('50.000');

        await page.click('#transactionForm button[type=submit]');
        expect(await page.evaluate(() => transactions[0].amount)).toBe(50000);
    });

    test('phím Delete ở đầu ô cũng giữ các số 0; rời ô thì gọn lại; lưu số 0 đứng đầu vẫn đúng giá trị', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });

        await page.click('header .btn');

        const input = page.locator('#txAmount');

        await input.fill('20000');
        await input.focus();
        await page.keyboard.press('Home');
        await page.keyboard.press('Delete');
        await expect(input).toHaveValue('0.000');

        // Leaving the field tidies the zeros in front ("0.000" is the number 0).
        await page.locator('#txNote').focus();
        await expect(input).toHaveValue('0');

        await input.fill('20000');
        await input.focus();
        await page.keyboard.press('Home');
        await page.keyboard.press('Delete');
        await page.keyboard.type('7');
        await expect(input).toHaveValue('70.000');
        await page.locator('#txNote').focus();
        await expect(input).toHaveValue('70.000');
    });

    test('xóa số đầu của số khác: các số còn lại không đổi; gõ ở cuối vẫn bỏ số 0 thừa', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });

        await page.click('header .btn');

        const input = page.locator('#txAmount');

        await input.fill('1500000');
        await input.focus();
        await page.keyboard.press('Home');
        await page.keyboard.press('Delete');
        await expect(input).toHaveValue('500.000'); // no zero in front: nothing to keep

        await input.fill('');
        await input.pressSequentially('0007');
        await expect(input).toHaveValue('7');
    });

    test('hộp nhập số tiền và ô số dư có dấu trừ cũng giữ số 0 khi xóa chữ số đầu', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            seed: { fm_initial_balances: JSON.stringify({ 'Tiền Mặt': 20000 }) },
        });

        await page.evaluate(() => switchTab('sources'));
        await page
            .locator('#sources-grid .card', { has: page.locator('[data-source="Tiền Mặt"]') })
            .locator('button[data-action=edit-balance]')
            .click();

        const field = page.locator('#moneyPromptInput');

        await expect(field).toHaveValue('20.000');
        await page.keyboard.press('Home');
        await page.keyboard.press('Delete');
        await expect(field).toHaveValue('0.000');
        await page.keyboard.type('-'); // a minus in front of the kept zeros
        await expect(field).toHaveValue('-0.000');
    });
});

// Calculations in money fields: "582719+11000", "22,22*26225", a decimal comma. The answer shows
// under the field while typing and replaces the calculation when the field is left (or on Enter).
const calcHint = (page, id) => page.locator(`#${id}-calc`);

test.describe('Phép tính trong ô tiền', () => {
    test('gõ 582719+11000: hiện kết quả ngay dưới ô, rời ô thì thay bằng 593.719 và lưu đúng', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });

        await page.click('header .btn');
        await page.locator('#txAmount').pressSequentially('582719+11000');

        // The calculation is not reformatted while it is typed.
        await expect(page.locator('#txAmount')).toHaveValue('582.719+11000');
        await expect(calcHint(page, 'txAmount')).toBeVisible();
        await expect(calcHint(page, 'txAmount')).toHaveText('= 593.719 đ');
        await expect(page.locator('#txAmount')).toHaveAttribute(
            'aria-describedby',
            /txAmount-calc/,
        );

        await page.keyboard.press('Tab');
        await expect(page.locator('#txAmount')).toHaveValue('593.719');
        await expect(calcHint(page, 'txAmount')).toBeHidden();

        await page.click('#transactionForm button[type=submit]');
        expect(await page.evaluate(() => transactions[0].amount)).toBe(593719);
    });

    test('Enter trong ô đang là phép tính vẫn lưu đúng kết quả, không lưu chữ số ghép lại', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });

        await page.click('header .btn');
        await page.locator('#txAmount').pressSequentially('100000*2+50000');
        await expect(calcHint(page, 'txAmount')).toHaveText('= 250.000 đ');
        await page.keyboard.press('Enter');

        expect(await page.evaluate(() => transactions[0].amount)).toBe(250000);
    });

    test('dấu phẩy là phần thập phân: 582719,50 ra 582.720 chứ không phải 58.271.950; 22,22*26225 cũng vậy', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });
        const input = page.locator('#txAmount');

        await page.click('header .btn');
        await input.pressSequentially('582719,50');
        await expect(calcHint(page, 'txAmount')).toHaveText('= 582.720 đ');
        await page.keyboard.press('Tab');
        await expect(input).toHaveValue('582.720');

        await input.fill('');
        await input.pressSequentially('22,22*26225');
        await expect(calcHint(page, 'txAmount')).toHaveText('= 582.720 đ');
        await page.keyboard.press('Tab');
        await expect(input).toHaveValue('582.720');

        // Typing digits afterwards is the plain field again.
        await input.fill('');
        await input.pressSequentially('1234567');
        await expect(input).toHaveValue('1.234.567');
        await expect(calcHint(page, 'txAmount')).toBeHidden();
    });

    test('sửa phép tính thành số thường (xóa toán tử) thì ô lại có dấu chấm hàng nghìn như cũ', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });
        const input = page.locator('#txAmount');

        await page.click('header .btn');
        await input.pressSequentially('1000+');
        await expect(calcHint(page, 'txAmount')).toHaveText('Gõ tiếp phép tính…');
        await expect(calcHint(page, 'txAmount')).not.toHaveClass(/money-calc-error/);

        await page.keyboard.press('Backspace');
        await expect(input).toHaveValue('1.000');
        await expect(calcHint(page, 'txAmount')).toBeHidden();
    });

    test('phép tính không tính được thì báo bằng chữ, giữ nguyên để sửa và không lưu', async ({
        app,
    }) => {
        const { page, state } = await app({ now: NOW });
        const input = page.locator('#txAmount');

        await page.click('header .btn');
        await input.pressSequentially('5/0');
        await expect(calcHint(page, 'txAmount')).toHaveText('Chưa tính được phép tính này');
        await expect(calcHint(page, 'txAmount')).toHaveClass(/money-calc-error/);

        await page.keyboard.press('Tab');
        await expect(input).toHaveValue('5/0');
        await expect(calcHint(page, 'txAmount')).toBeVisible();

        await page.click('#transactionForm button[type=submit]');
        expect(state.alerts.at(-1)).toContain('số tiền hợp lệ');
        expect(await page.evaluate(() => transactions.length)).toBe(0);
    });

    test('ô không nhận số âm: kết quả âm bị báo và không lưu; ô có dấu trừ nhận kết quả âm', async ({
        app,
    }) => {
        const { page, state } = await app({ now: NOW });
        const input = page.locator('#txAmount');

        await page.click('header .btn');
        await input.pressSequentially('5-8');
        await expect(calcHint(page, 'txAmount')).toHaveText('Kết quả âm: ô này không nhận số âm');
        await page.click('#transactionForm button[type=submit]');
        expect(state.alerts.at(-1)).toContain('số tiền hợp lệ');
        expect(await page.evaluate(() => transactions.length)).toBe(0);

        // The opening balance of a source can be negative.
        await page.click('#transactionModal .close-btn');
        await goTab(page, 'sources');
        await page.click('button:has-text("Thêm Nguồn Tiền")');
        await page.fill('#srcName', 'Visa VCB');
        await page.selectOption('#srcKind', 'credit');
        await page.locator('#srcInitialBalance').pressSequentially('-1000000+250000');
        await expect(calcHint(page, 'srcInitialBalance')).toHaveText('= -750.000 đ');
        await page.click('#sourceForm button[type=submit]');

        expect(await page.evaluate(() => initialBalances['Visa VCB'])).toBe(-750000);
    });

    test('hộp nhập số tiền (Sửa số dư): gõ phép tính rồi Enter lưu kết quả', async ({ app }) => {
        const { page } = await app({ now: NOW });

        await goTab(page, 'sources');
        await page
            .locator('#sources-grid .card', { hasText: 'Tiền Mặt' })
            .locator('button[data-action=edit-balance]')
            .click();
        await expect(page.locator('#moneyPromptModal')).toHaveClass(/open/);

        await page.locator('#moneyPromptInput').pressSequentially('-1000000+200000');
        await expect(calcHint(page, 'moneyPromptInput')).toHaveText('= -800.000 đ');
        await page.keyboard.press('Enter');

        await expect(page.locator('#moneyPromptModal')).not.toHaveClass(/open/);
        expect(await page.evaluate(() => initialBalances['Tiền Mặt'])).toBe(-800000);
    });

    test('dán số có phần lẻ (582719.50, 22,22) ra số tròn; dán 1.500.000 thì để trình duyệt tự xử lý', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });
        const paste = (text) =>
            page.evaluate((value) => {
                const input = document.getElementById('txAmount');
                const data = new DataTransfer();

                data.setData('text', value);

                // false when the field took over the paste (preventDefault)
                return input.dispatchEvent(
                    new ClipboardEvent('paste', {
                        clipboardData: data,
                        bubbles: true,
                        cancelable: true,
                    }),
                );
            }, text);

        await page.click('header .btn');
        expect(await paste('582719.50')).toBe(false);
        await expect(page.locator('#txAmount')).toHaveValue('582.720');

        expect(await paste('22,22')).toBe(false);
        await expect(page.locator('#txAmount')).toHaveValue('22');

        // Whole numbers with thousands marks are left to the default paste.
        expect(await paste('1.500.000')).toBe(true);
        expect(await paste('1,500,000')).toBe(true);
    });

    test('mọi ô tiền có chỗ hiện kết quả; aria-describedby cũ được giữ', async ({ app }) => {
        const { page } = await app({ now: NOW });
        const result = await page.evaluate(() =>
            [...document.querySelectorAll('input[data-money]')].map((input) => ({
                id: input.id,
                hint: Boolean(document.getElementById(`${input.id}-calc`)),
                describedBy: input.getAttribute('aria-describedby') || '',
            })),
        );

        expect(result.length).toBeGreaterThan(8);
        expect(result.filter((entry) => !entry.hint)).toEqual([]);
        expect(result.find((entry) => entry.id === 'srcStatementBalance').describedBy).toBe(
            'srcStatementBalanceHint srcStatementBalance-calc',
        );
    });

    test('trợ năng và điện thoại: ô đang hiện kết quả không vi phạm axe, không tràn ngang', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW, viewport: { width: 390, height: 844 } });

        await page.evaluate(() => openModal());
        await page.locator('#txAmount').pressSequentially('582719+11000');
        await expect(calcHint(page, 'txAmount')).toHaveText('= 593.719 đ');
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);

        const ok = await scanA11y(page, '#transactionModal');

        expect(ok.violations.map((violation) => violation.id)).toEqual([]);

        await page.locator('#txAmount').fill('5/0');
        await expect(calcHint(page, 'txAmount')).toHaveClass(/money-calc-error/);

        const bad = await scanA11y(page, '#transactionModal');

        expect(bad.violations.map((violation) => violation.id)).toEqual([]);
    });
});
