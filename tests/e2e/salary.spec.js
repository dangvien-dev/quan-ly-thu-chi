// Spending against the monthly salary: overview card, settings dialog, alerts, sync and backup.

const fs = require('fs');
const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect, tx, newServer, wait } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z';
const SALARY = 20000000;
const withSalary = (plan, rows = []) => ({
    now: NOW,
    seed: { fm_salary: JSON.stringify(plan), fm_transactions: JSON.stringify(rows) },
});
const spend = (amount, extra = {}) =>
    tx({ id: `TX_${amount}_${extra.date || ''}`, amount, date: '2026-10-05', ...extra });

const card = (page) => page.locator('#salary-section');
const toasts = (page) => page.locator('#toast-container .toast');

async function addExpense(page, amount, { type = 'expense', date } = {}) {
    await page.click('header .btn');

    if (type !== 'expense')
        await page.click(type === 'income' ? '#btnTypeIncome' : '#btnTypeTransfer');

    await page.fill('#txAmount', String(amount));

    if (date) await page.fill('#txDate', date);

    await page.click('#transactionForm button[type=submit]');
}

async function saveSalary(page, amount, warn) {
    await page.click('#salary-section button.btn');
    await page.fill('#salaryAmount', '');
    await page.locator('#salaryAmount').pressSequentially(String(amount));

    if (warn !== undefined) await page.fill('#salaryWarn', String(warn));

    await page.click('#salaryForm button[type=submit]');
}

test.describe('Đặt mức lương', () => {
    test('chưa đặt thì thẻ gợi ý đặt lương và không có thanh tiến độ', async ({ app }) => {
        const { page } = await app({ now: NOW });

        await expect(card(page)).toContainText('Chưa đặt mức lương');
        await expect(card(page).locator('[role=progressbar]')).toHaveCount(0);
        await expect(card(page).locator('button.btn')).toHaveText(/Đặt mức lương/);
    });

    test('đặt lương bằng hộp thoại: ô tiền có dấu chấm, mặc định cảnh báo 80%', async ({ app }) => {
        const { page } = await app({ now: NOW });

        await page.click('#salary-section button.btn');
        await expect(page.locator('#salaryModal')).toHaveClass(/open/);
        await expect(page.locator('#salaryAmount')).toBeFocused();
        await expect(page.locator('#salaryWarn')).toHaveValue('80');

        await page.locator('#salaryAmount').pressSequentially('20000000');
        await expect(page.locator('#salaryAmount')).toHaveValue('20.000.000');
        await page.click('#salaryForm button[type=submit]');

        await expect(page.locator('#salaryModal')).not.toHaveClass(/open/);
        await expect(card(page)).toContainText('0% lương đã chi');
        await expect(card(page)).toContainText('0 đ / lương 20.000.000 đ');
        await expect(card(page).locator('button.btn')).toHaveText(/Sửa/);
        expect(await page.evaluate(() => salaryPlan)).toEqual({ amount: SALARY, warnPercent: 80 });
        expect(await page.evaluate(() => localStorage.getItem('fm_salary'))).toBe(
            JSON.stringify({ amount: SALARY, warnPercent: 80 }),
        );
    });

    test('mở lại hộp thoại thì có sẵn giá trị đã lưu; sửa được mức cảnh báo', async ({ app }) => {
        const { page } = await app(withSalary({ amount: SALARY, warnPercent: 70 }));

        await page.click('#salary-section button.btn');

        await expect(page.locator('#salaryAmount')).toHaveValue('20.000.000');
        await expect(page.locator('#salaryWarn')).toHaveValue('70');

        await page.fill('#salaryWarn', '90');
        await page.click('#salaryForm button[type=submit]');

        expect(await page.evaluate(() => salaryPlan)).toEqual({ amount: SALARY, warnPercent: 90 });
    });

    test('để trống hoặc 0 thì tắt tính năng', async ({ app }) => {
        const { page } = await app(withSalary({ amount: SALARY, warnPercent: 80 }));

        await page.click('#salary-section button.btn');
        await page.fill('#salaryAmount', '');
        await page.click('#salaryForm button[type=submit]');

        await expect(card(page)).toContainText('Chưa đặt mức lương');
        expect(await page.evaluate(() => salaryPlan.amount)).toBe(0);
    });

    test('mức cảnh báo ngoài 1-100 hoặc không phải số nguyên bị từ chối, không lưu', async ({
        app,
    }) => {
        const { page, state } = await app({ now: NOW });

        await page.click('#salary-section button.btn');
        await page.locator('#salaryAmount').pressSequentially('1000000');

        for (const bad of ['0', '101', '12.5']) {
            await page.evaluate((value) => {
                document.getElementById('salaryWarn').value = value;
                handleSalarySubmit({ preventDefault() {} });
            }, bad);
        }

        expect(state.alerts).toHaveLength(3);
        expect(await page.evaluate(() => salaryPlan.amount)).toBe(0);
        await expect(page.locator('#salaryModal')).toHaveClass(/open/);
    });

    test('Esc đóng hộp thoại mà không lưu', async ({ app }) => {
        const { page } = await app({ now: NOW });

        await page.click('#salary-section button.btn');
        await page.locator('#salaryAmount').pressSequentially('5000000');
        await page.keyboard.press('Escape');

        await expect(page.locator('#salaryModal')).not.toHaveClass(/open/);
        expect(await page.evaluate(() => salaryPlan.amount)).toBe(0);
    });

    test('dữ liệu lương hỏng trong localStorage thì dùng mặc định, ứng dụng vẫn chạy', async ({
        app,
    }) => {
        const { page, state } = await app({ now: NOW, seed: { fm_salary: '{oops' } });

        await expect(card(page)).toContainText('Chưa đặt mức lương');
        expect(state.errors).toEqual([]);
    });
});

test.describe('Phần trăm chi tiêu trên lương', () => {
    test('chỉ tính chi của tháng này; thu và chuyển tiền không tính', async ({ app }) => {
        const { page } = await app(
            withSalary({ amount: SALARY, warnPercent: 80 }, [
                spend(5000000, { id: 'a' }),
                spend(3000000, { id: 'b', date: '2026-10-27' }),
                spend(9000000, { id: 'c', date: '2026-09-30' }),
                tx({ id: 'd', type: 'income', category: 'Lương / Thưởng', amount: 20000000 }),
                tx({
                    id: 'e',
                    type: 'transfer',
                    targetSource: 'Thẻ Ngân Hàng',
                    category: 'Chuyển tiền nội bộ',
                    amount: 7000000,
                    date: '2026-10-10',
                }),
            ]),
        );

        await expect(card(page)).toContainText('40% lương đã chi');
        await expect(card(page)).toContainText('8.000.000 đ / lương 20.000.000 đ');
        await expect(card(page)).toContainText('Còn lại 12.000.000 đ');
    });

    test('3 mức: an toàn (xanh), sắp hết (vàng) từ mốc cảnh báo, hết/vượt (đỏ) từ 100%', async ({
        app,
    }) => {
        const levelFor = async (rows) => {
            const { page } = await app(withSalary({ amount: 1000000, warnPercent: 80 }, rows));

            return {
                cls: await card(page).locator('.salary-status').getAttribute('class'),
                text: await card(page).locator('.salary-message').innerText(),
                percent: await card(page).locator('.salary-percent b').innerText(),
                now: await card(page).locator('[role=progressbar]').getAttribute('aria-valuenow'),
            };
        };

        const safe = await levelFor([spend(799999)]);
        const warn = await levelFor([spend(800000)]);
        const exact = await levelFor([spend(1000000)]);
        const over = await levelFor([spend(1250000)]);

        expect(safe.cls).toContain('level-0');
        expect(safe.percent).toBe('79%');
        expect(safe.text).toContain('Trong mức an toàn');
        expect(warn.cls).toContain('level-1');
        expect(warn.percent).toBe('80%');
        expect(warn.text).toContain('Sắp hết lương');
        expect(warn.text).toContain('Còn lại 200.000 đ');
        expect(exact.cls).toContain('level-2');
        expect(exact.text).toContain('Đã chi hết lương');
        expect(over.cls).toContain('level-2');
        expect(over.percent).toBe('125%');
        expect(over.text).toContain('vượt lương tháng này 250.000 đ');
        expect(over.now).toBe('100'); // the bar stops at full
    });

    test('mức cảnh báo tuỳ chỉnh dời mốc đổi màu', async ({ app }) => {
        const { page } = await app(
            withSalary({ amount: 1000000, warnPercent: 50 }, [spend(500000)]),
        );

        await expect(card(page).locator('.salary-status')).toHaveClass(/level-1/);
        await expect(card(page).locator('.salary-marker')).toHaveAttribute('style', /left:\s*50%/);
    });

    test('thêm khoản chi thì thẻ cập nhật ngay', async ({ app }) => {
        const { page } = await app(withSalary({ amount: SALARY, warnPercent: 80 }));

        await addExpense(page, 5000000);

        await expect(card(page)).toContainText('25% lương đã chi');
    });
});

test.describe('Cảnh báo khi gần hết lương', () => {
    test('toast vàng khi một khoản chi làm chạm mốc cảnh báo, đỏ khi chạm 100%', async ({
        app,
    }) => {
        const { page } = await app(
            withSalary({ amount: 1000000, warnPercent: 80 }, [spend(600000)]),
        );

        await addExpense(page, 100000); // 70%: still fine
        await expect(toasts(page)).toHaveCount(0);

        await addExpense(page, 150000); // 85%
        await expect(toasts(page)).toHaveCount(1);
        await expect(toasts(page).first()).toHaveClass(/toast-warning/);
        await expect(toasts(page).first()).toContainText('Sắp hết lương');
        await expect(toasts(page).first()).toContainText('850.000 đ / 1.000.000 đ (85%)');

        await addExpense(page, 50000); // 90%: same band, stays quiet
        await expect(toasts(page)).toHaveCount(1);

        await addExpense(page, 200000); // 110%
        await expect(toasts(page)).toHaveCount(2);
        await expect(toasts(page).last()).toHaveClass(/toast-danger/);
        await expect(toasts(page).last()).toContainText('Đã chi hết lương');

        await addExpense(page, 10000); // already over: no more toasts
        await expect(toasts(page)).toHaveCount(2);
    });

    test('một khoản chi vượt thẳng từ an toàn lên 100% chỉ báo mức đỏ', async ({ app }) => {
        const { page } = await app(withSalary({ amount: 1000000, warnPercent: 80 }));

        await addExpense(page, 1200000);

        await expect(toasts(page)).toHaveCount(1);
        await expect(toasts(page).first()).toHaveClass(/toast-danger/);
    });

    test('thu nhập, chi của tháng khác và sửa giao dịch không gây cảnh báo', async ({ app }) => {
        const { page } = await app(
            withSalary({ amount: 1000000, warnPercent: 80 }, [spend(100000, { id: 'old' })]),
        );

        await addExpense(page, 900000, { type: 'income' });
        await addExpense(page, 900000, { date: '2026-09-15' });
        await expect(toasts(page)).toHaveCount(0);

        await page.evaluate(() => switchTab('transactions'));
        await page.click('#transaction-table-body tr[data-id="old"] [data-action=edit]');
        await page.fill('#txAmount', '');
        await page.locator('#txAmount').pressSequentially('950000');
        await page.click('#transactionForm button[type=submit]');

        await expect(toasts(page)).toHaveCount(0);
        // The edit took spending to 95%: no toast, but the card shows the warning level.
        await page.evaluate(() => switchTab('overview'));
        await expect(card(page).locator('.salary-status')).toHaveClass(/level-1/);
        await expect(card(page)).toContainText('95% lương đã chi');
    });

    test('chưa đặt lương thì không có cảnh báo nào', async ({ app }) => {
        const { page } = await app({ now: NOW });

        await addExpense(page, 99000000);

        await expect(toasts(page)).toHaveCount(0);
    });
});

test.describe('Đồng bộ và sao lưu', () => {
    test('v2: máy B nhận mức lương do máy A đặt', async ({ app }) => {
        const server = newServer('v2');
        const a = await app({ server, now: NOW });

        await saveSalary(a.page, 15000000, 75);
        await wait(400);

        const b = await app({ server, now: NOW });

        expect(await b.page.evaluate(() => salaryPlan)).toEqual({
            amount: 15000000,
            warnPercent: 75,
        });
        await expect(card(b.page)).toContainText('lương 15.000.000 đ');
    });

    test('v2: lần đầu kết nối, lương đã đặt trên máy được đẩy lên server', async ({ app }) => {
        const server = newServer('v2');
        const { page } = await app({
            server,
            now: NOW,
            seed: { fm_salary: JSON.stringify({ amount: SALARY, warnPercent: 80 }) },
        });

        await wait(400);

        expect(server.get({ v: '2' }).meta.salary.value).toEqual({
            amount: SALARY,
            warnPercent: 80,
        });
        expect(await page.evaluate(() => salaryPlan.amount)).toBe(SALARY);
    });

    test('script cũ (legacy): đặt lương không ghi gì lên Sheet', async ({ app }) => {
        const { page, state } = await app({
            now: NOW,
            remote: [tx({ id: 'TX_1' })],
        });

        const writesBefore = state.posts.length;

        await saveSalary(page, 10000000);
        await wait(400);

        expect(state.posts).toHaveLength(writesBefore);
        expect(state.gets).toBeGreaterThan(0);
        expect(await page.evaluate(() => salaryPlan.amount)).toBe(10000000);
    });

    test('sao lưu có mức lương và khôi phục lại được', async ({ app }) => {
        const { page } = await app(withSalary({ amount: SALARY, warnPercent: 65 }));

        await page.evaluate(() => switchTab('settings'));

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.click('button:has-text("Sao lưu dữ liệu")'),
        ]);
        const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));

        expect(backup.data.salary).toEqual({ amount: SALARY, warnPercent: 65 });

        const other = await app({ now: NOW });

        await other.page.evaluate(() => switchTab('settings'));
        await other.page.setInputFiles('input[type=file]', {
            name: 'backup.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(backup)),
        });
        await wait(300);

        expect(await other.page.evaluate(() => salaryPlan)).toEqual({
            amount: SALARY,
            warnPercent: 65,
        });
    });

    test('bản sao lưu cũ không có mức lương thì giữ nguyên mức lương hiện tại', async ({ app }) => {
        const { page } = await app(withSalary({ amount: SALARY, warnPercent: 80 }));

        await page.evaluate(() => switchTab('settings'));
        await page.setInputFiles('input[type=file]', {
            name: 'backup.json',
            mimeType: 'application/json',
            buffer: Buffer.from(
                JSON.stringify({
                    format: 'finmanager-backup',
                    version: 1,
                    exportedAt: 'x',
                    data: { transactions: [], categories: [], initialBalances: {}, scriptUrl: '' },
                }),
            ),
        });
        await wait(300);

        expect(await page.evaluate(() => salaryPlan.amount)).toBe(SALARY);
    });
});

test.describe('Trợ năng và điện thoại', () => {
    for (const [name, plan, rows] of [
        ['an toàn', { amount: 1000000, warnPercent: 80 }, [spend(100000)]],
        ['sắp hết', { amount: 1000000, warnPercent: 80 }, [spend(900000)]],
        ['vượt lương', { amount: 1000000, warnPercent: 80 }, [spend(1300000)]],
        ['chưa đặt', { amount: 0, warnPercent: 80 }, []],
    ]) {
        test(`thẻ lương (${name}) không có vi phạm axe`, async ({ app }) => {
            const { page } = await app(withSalary(plan, rows));
            const results = await new AxeBuilder({ page })
                .include('#salary-section')
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .analyze();

            expect(results.violations.map((violation) => violation.id)).toEqual([]);
        });
    }

    test('hộp thoại lương không có vi phạm axe và giữ Tab trong hộp thoại', async ({ app }) => {
        const { page } = await app(withSalary({ amount: SALARY, warnPercent: 80 }));

        await page.click('#salary-section button.btn');

        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();

        expect(results.violations.map((violation) => violation.id)).toEqual([]);

        for (let step = 0; step < 8; step++) {
            await page.keyboard.press('Tab');
            expect(
                await page.evaluate(() =>
                    document.querySelector('#salaryModal').contains(document.activeElement),
                ),
            ).toBe(true);
        }

        await page.keyboard.press('Escape');
        await expect(page.locator('#salary-section button.btn')).toBeFocused();
    });

    test('trên điện thoại thẻ lương không tràn ngang và hộp thoại nằm gọn màn hình', async ({
        app,
    }) => {
        const { page } = await app({
            ...withSalary({ amount: 123456789, warnPercent: 80 }, [spend(120000000)]),
            viewport: { width: 390, height: 844 },
        });

        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);

        await page.click('#salary-section button.btn');

        const box = await page.locator('#salaryModal .modal-content').boundingBox();

        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
    });
});
