// Amounts asked in a dialog (askMoney) instead of window.prompt: thousands separators while typing,
// a minus sign only where the amount can be negative, cancel with Esc / × / the button.

const { test, expect, goTab, scanA11y } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z';
const DIALOG = '#moneyPromptModal';
const FIELD = '#moneyPromptInput';
const card = (page, name) => page.locator('#sources-grid .card', { hasText: name });
const initial = (page, name) => page.evaluate((key) => initialBalances[key], name);

async function openEditBalance(page, name) {
    await goTab(page, 'sources');
    await card(page, name).locator('button[data-action=edit-balance]').click();
    await expect(page.locator(DIALOG)).toHaveClass(/open/);
}

test.describe('Hộp thoại nhập số tiền', () => {
    test('gõ số thì có dấu chấm hàng nghìn ngay, Enter lưu, focus về nút đã bấm', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });

        await openEditBalance(page, 'Tiền Mặt');

        await expect(page.locator('#moneyPromptTitle')).toHaveText('Số dư ban đầu');
        await expect(page.locator('#moneyPromptMessage')).toContainText('[Tiền Mặt]');
        await expect(page.locator(FIELD)).toBeFocused();

        await page.locator(FIELD).pressSequentially('1500000');
        await expect(page.locator(FIELD)).toHaveValue('1.500.000');

        await page.keyboard.press('Enter');

        await expect(page.locator(DIALOG)).not.toHaveClass(/open/);
        expect(await initial(page, 'Tiền Mặt')).toBe(1500000);
        await expect(card(page, 'Tiền Mặt')).toContainText('1.500.000 đ');
        await expect(
            card(page, 'Tiền Mặt').locator('button[data-action=edit-balance]'),
        ).toBeFocused();
    });

    test('số đang có hiện sẵn có dấu chấm và được chọn sẵn: gõ số mới là thay luôn', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            seed: { fm_initial_balances: JSON.stringify({ 'Tiền Mặt': 838000 }) },
        });

        await openEditBalance(page, 'Tiền Mặt');

        await expect(page.locator(FIELD)).toHaveValue('838.000');

        await page.keyboard.type('25000');
        await expect(page.locator(FIELD)).toHaveValue('25.000');
    });

    test('số dư ban đầu nhận dấu trừ (bàn phím chữ), ngân sách thì không (bàn phím số)', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });

        await openEditBalance(page, 'Spaylater');
        await expect(page.locator(FIELD)).toHaveAttribute('inputmode', 'text');
        await page.locator(FIELD).pressSequentially('-879441');
        await expect(page.locator(FIELD)).toHaveValue('-879.441');
        await page.keyboard.press('Enter');
        expect(await initial(page, 'Spaylater')).toBe(-879441);

        // The next question does not inherit the previous one's minus sign.
        await goTab(page, 'categories');
        await page.click('#category-table-body tr:has-text("Ăn uống") [data-action=budget]');
        await expect(page.locator(DIALOG)).toHaveClass(/open/);
        await expect(page.locator('#moneyPromptTitle')).toHaveText('Ngân sách tháng');
        await expect(page.locator(FIELD)).toHaveAttribute('inputmode', 'numeric');
        await page.locator(FIELD).pressSequentially('-2000000');
        await expect(page.locator(FIELD)).toHaveValue('2.000.000');
        await page.keyboard.press('Enter');
        expect(await page.evaluate(() => budgets)).toEqual({ 'Ăn uống': 2000000 });
    });

    test('hủy bằng Esc, nút × hoặc bấm ra ngoài: không đổi gì, không báo lỗi', async ({ app }) => {
        const { page, state } = await app({
            now: NOW,
            seed: { fm_initial_balances: JSON.stringify({ 'Tiền Mặt': 100 }) },
        });

        await openEditBalance(page, 'Tiền Mặt');
        await page.locator(FIELD).pressSequentially('999');
        await page.keyboard.press('Escape');
        await expect(page.locator(DIALOG)).not.toHaveClass(/open/);

        await card(page, 'Tiền Mặt').locator('button[data-action=edit-balance]').click();
        await page.locator(`${DIALOG} .close-btn`).click();
        await expect(page.locator(DIALOG)).not.toHaveClass(/open/);

        expect(await initial(page, 'Tiền Mặt')).toBe(100);
        expect(state.alerts).toEqual([]);

        // After a cancel the next question opens normally.
        await card(page, 'Tiền Mặt').locator('button[data-action=edit-balance]').click();
        await expect(page.locator(FIELD)).toHaveValue('100');
    });

    test('để trống: số dư báo "Số tiền không hợp lệ" và giữ nguyên; ngân sách thì bỏ ngân sách', async ({
        app,
    }) => {
        const { page, state } = await app({
            now: NOW,
            seed: {
                fm_initial_balances: JSON.stringify({ 'Tiền Mặt': 100 }),
                fm_budgets: JSON.stringify({ 'Ăn uống': 500000 }),
            },
        });

        await openEditBalance(page, 'Tiền Mặt');
        await page.fill(FIELD, '');
        await page.keyboard.press('Enter');
        expect(state.alerts).toEqual(['Số tiền không hợp lệ!']);
        expect(await initial(page, 'Tiền Mặt')).toBe(100);

        await goTab(page, 'categories');
        await page.click('#category-table-body tr:has-text("Ăn uống") [data-action=budget]');
        await expect(page.locator(FIELD)).toHaveValue('500.000');
        await page.fill(FIELD, '');
        await page.keyboard.press('Enter');
        expect(await page.evaluate(() => budgets)).toEqual({});
    });

    test('một dấu trừ đứng một mình không phải số: báo không hợp lệ', async ({ app }) => {
        const { page, state } = await app({ now: NOW });

        await openEditBalance(page, 'Tiền Mặt');
        await page.fill(FIELD, '-');
        await page.keyboard.press('Enter');

        expect(state.alerts).toEqual(['Số tiền không hợp lệ!']);
        expect(await initial(page, 'Tiền Mặt')).toBeUndefined();
    });

    test('Khớp số dư: nhập số khả dụng có dấu chấm, thẻ hiện đúng dư nợ', async ({ app }) => {
        const { page } = await app({
            now: NOW,
            seed: {
                fm_sources: JSON.stringify([
                    { name: 'Tiền Mặt', kind: 'cash' },
                    { name: 'Spaylater', kind: 'credit', creditLimit: 30000000 },
                ]),
            },
        });

        await goTab(page, 'sources');
        await card(page, 'Spaylater').locator('button[data-action=match-balance]').click();

        await expect(page.locator('#moneyPromptTitle')).toHaveText('Khớp số dư');
        await expect(page.locator('#moneyPromptMessage')).toContainText('KHẢ DỤNG');
        await expect(page.locator('#moneyPromptSubmit')).toHaveText('Khớp');
        // The hint under the question is on its own line.
        expect(
            await page
                .locator('#moneyPromptMessage')
                .evaluate((element) => getComputedStyle(element).whiteSpace),
        ).toBe('pre-line');

        await page.locator(FIELD).pressSequentially('28656419');
        await expect(page.locator(FIELD)).toHaveValue('28.656.419');
        await page.keyboard.press('Enter');

        await expect(card(page, 'Spaylater')).toContainText('-1.343.581 đ');
        await expect(page.locator('#lbl-total-debt')).toHaveText('1.343.581 đ');
    });

    test('trả nợ: số còn lại hiện sẵn có dấu chấm; gõ quá số còn lại thì báo, đúng số thì tất toán', async ({
        app,
    }) => {
        const { page, state } = await app({
            now: NOW,
            seed: {
                fm_debts: JSON.stringify([
                    {
                        id: 'DB_1',
                        party: 'Anh Nam',
                        direction: 'owe',
                        amount: 1000000,
                        date: '2026-10-01',
                        dueDate: '',
                        note: '',
                        payments: [],
                    },
                ]),
            },
        });

        await goTab(page, 'debts');
        await page.click('#debt-table-body [data-action=pay]');
        await expect(page.locator('#moneyPromptTitle')).toHaveText('Trả nợ');
        await expect(page.locator(FIELD)).toHaveValue('1.000.000');

        await page.keyboard.type('1500000');
        await page.keyboard.press('Enter');
        expect(state.alerts.at(-1)).toContain('vượt quá số còn lại');

        await page.click('#debt-table-body [data-action=pay]');
        await page.keyboard.press('Enter'); // the amount offered: everything that is left

        await expect(page.locator('#debt-table-body')).toContainText('Không có khoản nào đang nợ');
    });

    test('không vi phạm trợ năng và vừa màn hình điện thoại', async ({ app }) => {
        const { page } = await app({ now: NOW, viewport: { width: 390, height: 844 } });

        await page.evaluate(() => switchTab('sources'));
        await card(page, 'Spaylater').locator('button[data-action=edit-balance]').click();
        await expect(page.locator(DIALOG)).toHaveClass(/open/);

        const results = await scanA11y(page, DIALOG);

        expect(results.violations.map((violation) => violation.id)).toEqual([]);

        const box = await page.locator(`${DIALOG} .modal-content`).boundingBox();
        const input = await page.locator(FIELD).boundingBox();

        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(input.x + input.width).toBeLessThanOrEqual(box.x + box.width);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);
    });

    test('Tab giữ trong hộp thoại; không còn hộp prompt gốc của trình duyệt', async ({ app }) => {
        const { page, state } = await app({ now: NOW });

        await openEditBalance(page, 'Tiền Mặt');

        for (let press = 0; press < 6; press++) {
            await page.keyboard.press('Tab');
            expect(
                await page.evaluate(() => Boolean(document.activeElement.closest('.modal.open'))),
            ).toBe(true);
        }

        // window.prompt would have been recorded here by the test dialog handler.
        expect(state.confirms).toEqual([]);
        expect(await page.evaluate(() => typeof askMoney)).toBe('function');
    });
});
