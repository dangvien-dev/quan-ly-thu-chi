// The Dư Nợ card on the overview: the debt as a share of the salary, red from the warning percent.

const { test, expect, tx, scanA11y } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z';
const SALARY = 8000000;

// Spending on Spaylater (a credit source) is what makes the debt.
const owing = (amount) => [tx({ id: 'S1', date: '2026-10-05', source: 'Spaylater', amount })];
const setup = (debt, plan = { amount: SALARY }) => ({
    now: NOW,
    seed: {
        fm_salary: JSON.stringify({ groups: [], ...plan }),
        fm_transactions: JSON.stringify(debt ? owing(debt) : []),
    },
});
const line = (page) => page.locator('#lbl-debt-salary');

test.describe('Dư nợ so với lương', () => {
    test('dưới mốc: hiện % lương làm tròn xuống và mốc cảnh báo, không tô đỏ', async ({ app }) => {
        const { page } = await app(setup(1447355));

        await expect(page.locator('#lbl-total-debt')).toHaveText('1.447.355 đ');
        await expect(line(page)).toBeVisible();
        await expect(line(page)).toHaveText('Bằng 18% lương · cảnh báo từ 30% (2.400.000 đ)');
        await expect(line(page)).toHaveAttribute('data-level', '0');
        await expect(line(page)).not.toHaveClass(/source-warn/);
    });

    test('đúng mốc 30% thì cảnh báo; thiếu một đồng thì vẫn an toàn', async ({ app }) => {
        const exactly = await app(setup(2400000));

        await expect(line(exactly.page)).toHaveAttribute('data-level', '1');
        await expect(line(exactly.page)).toHaveClass(/source-warn/);
        await expect(line(exactly.page)).toContainText('Dư nợ bằng 30% lương');
        await expect(line(exactly.page)).toContainText('đã chạm mốc 30% (2.400.000 đ)');
        await expect(line(exactly.page)).toContainText('Nên trả bớt');

        const under = await app(setup(2399999));

        await expect(line(under.page)).toHaveAttribute('data-level', '0');
        await expect(line(under.page)).toContainText('Bằng 29% lương');
    });

    test('cảnh báo có biểu tượng và chữ (không chỉ dựa vào màu) và không vi phạm trợ năng', async ({
        app,
    }) => {
        const { page } = await app(setup(3000000));

        await expect(line(page).locator('i.fa-triangle-exclamation')).toHaveCount(1);
        await expect(line(page)).toContainText('Dư nợ bằng 37% lương');

        const results = await scanA11y(page, '#tab-overview');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    test('không có dư nợ thì dòng ẩn, kể cả khi đã đặt lương', async ({ app }) => {
        const { page } = await app(setup(0));

        await expect(page.locator('#lbl-total-debt')).toHaveText('0 đ');
        await expect(line(page)).toBeHidden();
    });

    test('chưa đặt lương thì nhắc đặt lương thay vì hiện %', async ({ app }) => {
        const { page } = await app(setup(500000, { amount: 0 }));

        await expect(line(page)).toHaveText('Chưa đặt mức lương nên chưa so được dư nợ với lương.');
        await expect(line(page)).toHaveAttribute('data-level', '');
        await expect(line(page)).not.toHaveClass(/source-warn/);
    });

    test('hộp thoại lương có ô mức cảnh báo dư nợ, mặc định 30; đổi mức thì thẻ đổi theo', async ({
        app,
    }) => {
        const { page } = await app(setup(1447355));

        await page.click('#salary-edit-btn');
        await expect(page.locator('#salaryDebtWarn')).toHaveValue('30');

        await page.fill('#salaryDebtWarn', '15');
        await page.click('#salaryForm button[type=submit]');

        await expect(line(page)).toHaveAttribute('data-level', '1');
        await expect(line(page)).toContainText('đã chạm mốc 15% (1.200.000 đ)');
        expect(await page.evaluate(() => salaryPlan.debtWarnPercent)).toBe(15);

        await page.reload();

        await expect(line(page)).toHaveAttribute('data-level', '1');
    });

    test('mức dư nợ ngoài 1-100 hoặc không nguyên bị từ chối, giữ nguyên mức cũ', async ({
        app,
    }) => {
        const { page, state } = await app(setup(1447355));

        await page.click('#salary-edit-btn');

        for (const bad of ['0', '101', '12.5']) {
            await page.evaluate((value) => {
                document.getElementById('salaryDebtWarn').value = value;
                handleSalarySubmit({ preventDefault() {} });
            }, bad);
        }

        expect(state.alerts).toHaveLength(3);
        expect(state.alerts[0]).toContain('dư nợ');
        expect(await page.evaluate(() => salaryPlan.debtWarnPercent)).toBe(30);
        await expect(page.locator('#salaryModal')).toHaveClass(/open/);
    });

    test('lương cũ chưa có mức dư nợ vẫn dùng mặc định 30%', async ({ app }) => {
        const { page } = await app(setup(1447355, { amount: SALARY, warnPercent: 70 }));

        await expect(line(page)).toContainText('cảnh báo từ 30%');
        expect(await page.evaluate(() => salaryPlan.warnPercent)).toBe(70);
    });

    test('trả bớt nợ (chuyển tiền sang Spaylater) thì % giảm theo', async ({ app }) => {
        const { page } = await app(
            setup(2600000), // 32%: above the limit
        );

        await expect(line(page)).toHaveAttribute('data-level', '1');

        await page.evaluate(() => {
            transactions.push(
                normalizeTransaction({
                    id: 'PAY',
                    date: '2026-10-27',
                    type: 'transfer',
                    source: 'Thẻ Ngân Hàng',
                    targetSource: 'Spaylater',
                    category: 'Chuyển tiền nội bộ',
                    amount: 1500000,
                }),
            );
            renderAll();
        });

        await expect(page.locator('#lbl-total-debt')).toHaveText('1.100.000 đ');
        await expect(line(page)).toHaveAttribute('data-level', '0');
        await expect(line(page)).toContainText('Bằng 13% lương');
    });

    test('điện thoại: dòng cảnh báo không tràn ngang và không đè lên khối khác', async ({
        app,
    }) => {
        const { page } = await app({ ...setup(3000000), viewport: { width: 390, height: 844 } });

        const box = await page.locator('#lbl-total-debt').locator('xpath=..').boundingBox();
        const lineBox = await line(page).boundingBox();

        expect(lineBox.x + lineBox.width).toBeLessThanOrEqual(box.x + box.width);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);
    });
});
