// Card spending of the month against the salary: the second line of the Dư Nợ card and its toasts.

const { test, expect, tx, scanA11y } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z';
const SALARY = 8000000;

const onCard = (id, amount, extra = {}) =>
    tx({ id, date: '2026-10-05', source: 'Spaylater', amount, ...extra });
const setup = (rows, plan = { amount: SALARY }) => ({
    now: NOW,
    seed: {
        fm_salary: JSON.stringify({ groups: [], ...plan }),
        fm_transactions: JSON.stringify(rows),
    },
});
const line = (page) => page.locator('#lbl-card-spend');
const toasts = (page) => page.locator('#toast-container .toast');

async function addExpense(page, amount, source) {
    await page.click('header .btn');
    await page.fill('#txAmount', String(amount));
    await page.selectOption('#txSource', source);
    await page.click('#transactionForm button[type=submit]');
}

test.describe('Dùng thẻ / trả sau trong tháng', () => {
    test('cộng chi của mọi thẻ tín dụng / trả sau trong tháng, hiện % lương và mốc 30%', async ({
        app,
    }) => {
        const { page } = await app(
            setup([
                onCard('A', 1000000),
                onCard('B', 500000, { source: 'Thẻ Tín Dụng' }),
                onCard('C', 700000, { source: 'Tiền Mặt' }), // cash: not a card
                onCard('D', 900000, { date: '2026-09-30' }), // last month
            ]),
        );

        await expect(line(page)).toBeVisible();
        await expect(line(page)).toHaveText(
            'Tháng này dùng thẻ / trả sau 1.500.000 đ = 18% lương · cảnh báo từ 30% (2.400.000 đ)',
        );
        await expect(line(page)).toHaveAttribute('data-level', '0');
        await expect(line(page)).not.toHaveClass(/source-warn/);
    });

    test('trả sao kê xong dư nợ về 0 nhưng mức dùng thẻ trong tháng vẫn còn và vẫn cảnh báo', async ({
        app,
    }) => {
        const { page } = await app(
            setup([
                onCard('A', 3000000),
                tx({
                    id: 'PAY',
                    date: '2026-10-10',
                    type: 'transfer',
                    source: 'Thẻ Ngân Hàng',
                    targetSource: 'Spaylater',
                    category: 'Chuyển tiền nội bộ',
                    amount: 3000000,
                }),
            ]),
        );

        await expect(page.locator('#lbl-total-debt')).toHaveText('0 đ');
        await expect(page.locator('#lbl-debt-salary')).toBeHidden();
        await expect(line(page)).toBeVisible();
        await expect(line(page)).toHaveAttribute('data-level', '1');
        await expect(line(page)).toContainText('= 37% lương');
        await expect(line(page)).toContainText('đã chạm mốc 30% (2.400.000 đ)');
        await expect(line(page).locator('i.fa-triangle-exclamation')).toHaveCount(1);
    });

    test('rút tiền mặt từ thẻ tính là dùng thẻ; chuyển giữa hai thẻ thì không', async ({ app }) => {
        const { page } = await app(
            setup([
                tx({
                    id: 'ATM',
                    date: '2026-10-06',
                    type: 'transfer',
                    source: 'Spaylater',
                    targetSource: 'Tiền Mặt',
                    category: 'Chuyển tiền nội bộ',
                    amount: 1000000,
                }),
                tx({
                    id: 'MOVE',
                    date: '2026-10-07',
                    type: 'transfer',
                    source: 'Spaylater',
                    targetSource: 'Thẻ Tín Dụng',
                    category: 'Chuyển tiền nội bộ',
                    amount: 400000,
                }),
            ]),
        );

        await expect(line(page)).toContainText('dùng thẻ / trả sau 1.000.000 đ = 12% lương');
    });

    test('bằng hoặc hơn cả tháng lương thì mức đỏ nhất, có biểu tượng và chữ', async ({ app }) => {
        const { page } = await app(setup([onCard('A', 8500000)]));

        await expect(line(page)).toHaveAttribute('data-level', '2');
        await expect(line(page)).toHaveClass(/source-warn/);
        await expect(line(page)).toContainText('= 106% lương: bằng cả tháng lương');
        await expect(line(page).locator('i.fa-circle-exclamation')).toHaveCount(1);

        const results = await scanA11y(page, '#tab-overview');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    test('ẩn khi chưa đặt lương hoặc tháng này chưa dùng thẻ', async ({ app }) => {
        const noSalary = await app(setup([onCard('A', 1000000)], { amount: 0 }));

        await expect(line(noSalary.page)).toBeHidden();

        const noSpend = await app(setup([onCard('A', 1000000, { date: '2026-09-01' })]));

        await expect(line(noSpend.page)).toBeHidden();
    });

    test('hộp thoại lương có ô mức dùng thẻ, mặc định 30; đổi mức thì dòng đổi theo', async ({
        app,
    }) => {
        const { page } = await app(setup([onCard('A', 1000000)]));

        await page.click('#salary-edit-btn');
        await expect(page.locator('#salaryCardWarn')).toHaveValue('30');

        await page.fill('#salaryCardWarn', '10');
        await page.click('#salaryForm button[type=submit]');

        await expect(line(page)).toHaveAttribute('data-level', '1');
        await expect(line(page)).toContainText('đã chạm mốc 10% (800.000 đ)');
        expect(await page.evaluate(() => salaryPlan.cardWarnPercent)).toBe(10);

        await page.reload();

        await expect(line(page)).toHaveAttribute('data-level', '1');
    });

    test('mức dùng thẻ ngoài 1-100 hoặc không nguyên bị từ chối', async ({ app }) => {
        const { page, state } = await app(setup([onCard('A', 1000000)]));

        await page.click('#salary-edit-btn');

        for (const bad of ['0', '101', '3.5']) {
            await page.evaluate((value) => {
                document.getElementById('salaryCardWarn').value = value;
                handleSalarySubmit({ preventDefault() {} });
            }, bad);
        }

        expect(state.alerts).toHaveLength(3);
        expect(state.alerts[0]).toContain('dùng thẻ');
        expect(await page.evaluate(() => salaryPlan.cardWarnPercent)).toBe(30);
    });

    test('điện thoại: dòng không tràn ngang', async ({ app }) => {
        const { page } = await app({
            ...setup([onCard('A', 3000000)]),
            viewport: { width: 390, height: 844 },
        });

        const card = await page.locator('#lbl-total-debt').locator('xpath=..').boundingBox();
        const box = await line(page).boundingBox();

        expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);
    });
});

test.describe('Báo khi thêm khoản chi bằng thẻ', () => {
    test('khoản mua trả sau làm chạm mốc 30% thì báo một lần; khoản tiếp theo cùng mức thì im', async ({
        app,
    }) => {
        const { page } = await app(setup([onCard('A', 2000000)])); // 25%

        await addExpense(page, 500000, 'Spaylater'); // 31%

        await expect(toasts(page).filter({ hasText: 'chạm mốc 30% lương' })).toHaveCount(1);
        await expect(
            toasts(page).filter({ hasText: '2.500.000 đ / 8.000.000 đ (31%)' }),
        ).toHaveCount(1);

        await addExpense(page, 100000, 'Spaylater'); // 32%: still the same band

        await expect(toasts(page).filter({ hasText: 'chạm mốc' })).toHaveCount(1);
    });

    test('vượt hết lương thì báo mức đỏ', async ({ app }) => {
        const { page } = await app(setup([onCard('A', 7000000)])); // 87%: already past 30%

        await addExpense(page, 1500000, 'Thẻ Tín Dụng');

        await expect(toasts(page).filter({ hasText: 'đã bằng cả tháng lương' })).toHaveCount(1);
    });

    test('khoản chi bằng tiền mặt hoặc thẻ ngân hàng không báo mức dùng thẻ', async ({ app }) => {
        const { page } = await app(setup([onCard('A', 2300000)])); // 28%

        await addExpense(page, 500000, 'Tiền Mặt');

        await expect(toasts(page).filter({ hasText: 'trả sau' })).toHaveCount(0);
    });

    test('chưa đặt lương thì không báo', async ({ app }) => {
        const { page } = await app(setup([onCard('A', 2300000)], { amount: 0 }));

        await addExpense(page, 5000000, 'Spaylater');

        await expect(toasts(page).filter({ hasText: 'trả sau' })).toHaveCount(0);
    });

    test('sửa khoản chi cũ không báo', async ({ app }) => {
        const { page } = await app(setup([onCard('A', 2300000)]));

        await page.evaluate(() => switchTab('transactions'));
        await page.click('#transaction-table-body tr[data-id="A"] [data-action=edit]');
        await page.fill('#txAmount', '3000000');
        await page.click('#transactionForm button[type=submit]');

        await expect(line(page)).toContainText('= 37% lương');
        await expect(toasts(page).filter({ hasText: 'trả sau' })).toHaveCount(0);
    });
});
