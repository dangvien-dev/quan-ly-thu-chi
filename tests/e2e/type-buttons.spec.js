// The three type buttons of the transaction form: the selected one must keep a readable label.

const { test, expect, scanA11y } = require('./helpers');

const BUTTONS = [
    ['#btnTypeExpense', 'rgb(220, 38, 38)'],
    ['#btnTypeIncome', 'rgb(4, 120, 87)'],
    ['#btnTypeTransfer', 'rgb(180, 83, 9)'],
];
const WHITE = 'rgb(255, 255, 255)';

test.describe('Nút loại giao dịch', () => {
    test('nút được chọn có nền màu và chữ trắng (kể cả Chuyển Tiền); nút không chọn chữ cùng màu viền', async ({
        app,
    }) => {
        const { page } = await app();

        await page.click('header .btn');

        for (const [selected, color] of BUTTONS) {
            await page.click(selected);

            await expect(page.locator(selected)).toHaveClass(/active/);
            await expect(page.locator(selected)).toHaveCSS('background-color', color);
            await expect(page.locator(selected)).toHaveCSS('color', WHITE);

            // The others stay plain; only Chuyển Tiền keeps its brown label and border.
            for (const [other] of BUTTONS.filter(([id]) => id !== selected)) {
                await expect(page.locator(other)).not.toHaveClass(/active/);
                await expect(page.locator(other)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
            }
        }

        await page.click('#btnTypeExpense');
        await expect(page.locator('#btnTypeTransfer')).toHaveCSS('color', 'rgb(180, 83, 9)');
        await expect(page.locator('#btnTypeTransfer')).toHaveCSS(
            'border-top-color',
            'rgb(180, 83, 9)',
        );
    });

    test('trợ năng: biểu mẫu với Chuyển Tiền được chọn không vi phạm axe (chữ đủ tương phản)', async ({
        app,
    }) => {
        const { page } = await app();

        await page.click('header .btn');
        await page.click('#btnTypeTransfer');

        const results = await scanA11y(page, '#transactionModal');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
});
