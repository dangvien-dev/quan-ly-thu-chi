// Splitting the salary into groups (personal, work, saving ...): card rows, dialog, alerts, sync.

const fs = require('fs');
const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect, tx, newServer, wait } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z';
const SALARY = 10000000;
const groups = [
    { id: 'p', name: 'Cá nhân', percent: 50, saving: false },
    { id: 'w', name: 'Công việc', percent: 30, saving: false },
    { id: 's', name: 'Tiết kiệm', percent: 20, saving: true },
];
// "Mua sắm" counts toward work; every other category falls to the first group (personal).
const plan = (extra = {}) => ({
    amount: SALARY,
    warnPercent: 80,
    groups,
    assign: { 'Mua sắm': 'w' },
    ...extra,
});
const withPlan = (value, rows = []) => ({
    now: NOW,
    seed: { fm_salary: JSON.stringify(value), fm_transactions: JSON.stringify(rows) },
});
const spend = (amount, category, extra = {}) =>
    tx({ id: `TX_${category}_${amount}`, amount, category, date: '2026-10-05', ...extra });

const row = (page, name) => page.locator('.salary-group', { hasText: name });
const toasts = (page) => page.locator('#toast-container .toast');
const open = (page) => page.click('.salary-groups-head button');

async function addExpense(page, amount, category) {
    await page.click('header .btn');
    await page.fill('#txAmount', String(amount));
    await page.selectOption('#txCategory', category);
    await page.click('#transactionForm button[type=submit]');
}

test.describe('Thẻ chia lương theo nhóm', () => {
    test('đặt lương xong thì có sẵn 3 nhóm mẫu: tiêu dùng cá nhân 50%, công việc 30%, tiết kiệm 20%', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });

        await page.click('#salary-edit-btn');
        await page.locator('#salaryAmount').pressSequentially('10000000');
        await page.click('#salaryForm button[type=submit]');

        await expect(page.locator('.salary-group')).toHaveCount(3);
        await expect(row(page, 'Tiêu dùng cá nhân')).toContainText('Hạn mức 50% lương');
        await expect(row(page, 'Tiêu dùng cá nhân')).toContainText('0 đ / 5.000.000 đ');
        await expect(row(page, 'Công việc')).toContainText('Hạn mức 30% lương');
        await expect(row(page, 'Tiết kiệm')).toContainText('Mục tiêu 20% lương');
        await expect(row(page, 'Tiết kiệm')).toContainText('10.000.000 đ / mục tiêu 2.000.000 đ');
    });

    test('chưa đặt lương thì không hiện phần nhóm', async ({ app }) => {
        const { page } = await app({ now: NOW });

        await expect(page.locator('.salary-group')).toHaveCount(0);
        await expect(page.locator('.salary-groups')).toHaveCount(0);
    });

    test('chi được tính vào nhóm theo danh mục; chưa gán thì vào nhóm đầu; phần trăm theo lương', async ({
        app,
    }) => {
        const { page } = await app(
            withPlan(plan(), [
                spend(1500000, 'Ăn uống'),
                spend(600000, 'Đi lại'),
                spend(2000000, 'Mua sắm'),
                spend(9000000, 'Mua sắm', { id: 'old', date: '2026-09-29' }),
            ]),
        );

        await expect(row(page, 'Cá nhân')).toContainText('2.100.000 đ / 5.000.000 đ');
        await expect(row(page, 'Cá nhân')).toContainText('đã chi 21% lương');
        await expect(row(page, 'Công việc')).toContainText('2.000.000 đ / 3.000.000 đ');
        await expect(row(page, 'Công việc')).toContainText('đã chi 20% lương');
        await expect(row(page, 'Tiết kiệm')).toContainText('5.900.000 đ / mục tiêu 2.000.000 đ');
        await expect(row(page, 'Tiết kiệm')).toContainText('đang giữ 59% lương');
    });

    test('nhóm chi đổi màu: xanh, vàng từ 80% hạn mức, đỏ khi hết hoặc vượt', async ({ app }) => {
        const { page } = await app(
            withPlan(plan(), [
                spend(1000000, 'Ăn uống'), // 20% of 5,000,000
                spend(2400000, 'Mua sắm'), // 80% of 3,000,000
            ]),
        );

        await expect(row(page, 'Cá nhân')).toHaveClass(/level-0/);
        await expect(row(page, 'Công việc')).toHaveClass(/level-1/);
        await expect(row(page, 'Công việc')).toContainText('Sắp hết hạn mức, còn 600.000 đ');

        await addExpense(page, 700000, 'Mua sắm'); // 3,100,000 / 3,000,000

        await expect(row(page, 'Công việc')).toHaveClass(/level-2/);
        await expect(row(page, 'Công việc')).toContainText('Vượt hạn mức 100.000 đ');
        await expect(row(page, 'Công việc').locator('[role=progressbar]')).toHaveAttribute(
            'aria-valuenow',
            '100',
        );
    });

    test('đúng hạn mức thì báo đã hết hạn mức', async ({ app }) => {
        const { page } = await app(withPlan(plan(), [spend(3000000, 'Mua sắm')]));

        await expect(row(page, 'Công việc')).toHaveClass(/level-2/);
        await expect(row(page, 'Công việc')).toContainText('Đã hết hạn mức');
    });

    test('tiết kiệm là phần còn lại: xanh, vàng khi chi gần tới mức giữ mục tiêu, đỏ khi hụt', async ({
        app,
    }) => {
        const safe = await app(withPlan(plan(), [spend(6000000, 'Ăn uống')]));

        await expect(row(safe.page, 'Tiết kiệm')).toHaveClass(/level-0/);

        const near = await app(withPlan(plan(), [spend(6400000, 'Ăn uống')]));

        await expect(row(near.page, 'Tiết kiệm')).toHaveClass(/level-1/);
        await expect(row(near.page, 'Tiết kiệm')).toContainText('Sắp chạm mức tiết kiệm mục tiêu');

        const short = await app(withPlan(plan(), [spend(8500000, 'Ăn uống')]));

        await expect(row(short.page, 'Tiết kiệm')).toHaveClass(/level-2/);
        await expect(row(short.page, 'Tiết kiệm')).toContainText(
            'Chưa đạt mục tiêu, thiếu 500.000 đ',
        );
    });

    test('không có nhóm nào thì gợi ý chia lương và nút mở hộp thoại', async ({ app }) => {
        const { page } = await app(withPlan(plan({ groups: [], assign: {} })));

        await expect(page.locator('.salary-groups')).toContainText('Chưa chia lương');
        await expect(page.locator('.salary-groups-head button')).toHaveText('Chia lương');
        await open(page);
        await expect(page.locator('#allocationModal')).toHaveClass(/open/);
        await expect(page.locator('#allocationAdd')).toBeFocused();
    });

    test('sửa lương không làm mất nhóm đã chia', async ({ app }) => {
        const { page } = await app(withPlan(plan()));

        await page.click('#salary-edit-btn');
        await page.fill('#salaryWarn', '60');
        await page.click('#salaryForm button[type=submit]');

        const saved = await page.evaluate(() => salaryPlan);

        expect(saved.warnPercent).toBe(60);
        expect(saved.groups.map((group) => group.name)).toEqual([
            'Cá nhân',
            'Công việc',
            'Tiết kiệm',
        ]);
        expect(saved.assign).toEqual({ 'Mua sắm': 'w' });
    });

    test('tắt lương rồi bật lại vẫn giữ nhóm cũ', async ({ app }) => {
        const { page } = await app(withPlan(plan()));

        await page.click('#salary-edit-btn');
        await page.fill('#salaryAmount', '');
        await page.click('#salaryForm button[type=submit]');
        await expect(page.locator('.salary-group')).toHaveCount(0);

        await page.click('#salary-edit-btn');
        await page.locator('#salaryAmount').pressSequentially('8000000');
        await page.click('#salaryForm button[type=submit]');

        await expect(page.locator('.salary-group')).toHaveCount(3);
        await expect(row(page, 'Cá nhân')).toContainText('0 đ / 4.000.000 đ');
    });
});

test.describe('Hộp thoại chia lương theo nhóm', () => {
    const names = (page) => page.locator('#allocationGroups [data-field=name]');

    test('mở ra có sẵn nhóm, % và danh mục đã gán; tổng hiện đúng', async ({ app }) => {
        const { page } = await app(withPlan(plan()));

        await open(page);

        await expect(page.locator('#allocationModal')).toHaveClass(/open/);
        await expect(names(page)).toHaveCount(3);
        await expect(names(page).first()).toBeFocused();
        await expect(names(page).first()).toHaveValue('Cá nhân');
        await expect(page.locator('#allocationGroups [data-field=percent]').nth(1)).toHaveValue(
            '30',
        );
        await expect(page.locator('#allocationGroups [data-field=saving]').nth(2)).toBeChecked();
        await expect(page.locator('#allocationTotal')).toHaveText('Tổng 100%.');
        await expect(page.locator('select[data-category="Mua sắm"]')).toHaveValue('w');
        await expect(page.locator('select[data-category="Ăn uống"]')).toHaveValue('p');
        // Saving groups are not choices for a category.
        await expect(
            page.locator('select[data-category="Ăn uống"] option', { hasText: 'Tiết kiệm' }),
        ).toHaveCount(0);
    });

    test('đổi % cập nhật tổng ngay; vượt 100% thì báo đỏ và không lưu được', async ({ app }) => {
        const { page, state } = await app(withPlan(plan()));

        await open(page);
        await page.locator('#allocationGroups [data-field=percent]').first().fill('60');

        await expect(page.locator('#allocationTotal')).toHaveText(/Tổng 110%.*vượt 100%/);
        await expect(page.locator('#allocationTotal')).toHaveClass(/over/);

        await page.click('#allocationForm button[type=submit]');

        expect(state.alerts.at(-1)).toContain('không được vượt quá 100%');
        await expect(page.locator('#allocationModal')).toHaveClass(/open/);
        expect((await page.evaluate(() => salaryPlan)).groups[0].percent).toBe(50);

        await page.locator('#allocationGroups [data-field=percent]').first().fill('40');
        await expect(page.locator('#allocationTotal')).toHaveText(/Tổng 90%.*còn 10%/);
    });

    test('đổi tên nhóm cập nhật ngay danh sách chọn nhóm của các danh mục, giữ lựa chọn', async ({
        app,
    }) => {
        const { page } = await app(withPlan(plan()));

        await open(page);
        await names(page).nth(1).fill('Làm việc');

        const select = page.locator('select[data-category="Mua sắm"]');

        await expect(select).toHaveValue('w');
        await expect(select.locator('option:checked')).toHaveText('Làm việc');
    });

    test('lưu: nhóm mới, tên mới, % và danh mục gán lại được áp dụng cho thẻ', async ({ app }) => {
        const { page } = await app(withPlan(plan(), [spend(1000000, 'Đi lại')]));

        await open(page);
        await names(page).first().fill('Sinh hoạt');
        await page.locator('select[data-category="Đi lại"]').selectOption('w');
        await page.click('#allocationForm button[type=submit]');

        await expect(page.locator('#allocationModal')).not.toHaveClass(/open/);
        await expect(row(page, 'Sinh hoạt')).toContainText('0 đ / 5.000.000 đ');
        await expect(row(page, 'Công việc')).toContainText('1.000.000 đ / 3.000.000 đ');
        expect((await page.evaluate(() => salaryPlan)).assign['Đi lại']).toBe('w');
        await expect(page.locator('.salary-groups-head button')).toBeFocused();
    });

    test('thêm nhóm: ô tên được focus; lưu cần tên và % hợp lệ; tối đa 8 nhóm', async ({ app }) => {
        const { page, state } = await app(withPlan(plan({ groups: groups.slice(0, 2) })));

        await open(page);
        await page.click('#allocationAdd');

        await expect(names(page)).toHaveCount(3);
        await expect(names(page).nth(2)).toBeFocused();

        await names(page).nth(2).fill('Học tập');
        await page.locator('#allocationGroups [data-field=percent]').nth(2).fill('10');
        await page.locator('#allocationGroups [data-field=percent]').first().fill('40');
        await page.locator('#allocationGroups [data-field=percent]').nth(1).fill('20');
        await page.click('#allocationForm button[type=submit]');

        const saved = (await page.evaluate(() => salaryPlan)).groups;

        expect(saved.map((group) => [group.name, group.percent])).toEqual([
            ['Cá nhân', 40],
            ['Công việc', 20],
            ['Học tập', 10],
        ]);

        await open(page);

        for (let index = 0; index < 5; index++) await page.click('#allocationAdd');

        await expect(names(page)).toHaveCount(8);
        await page.click('#allocationAdd');
        expect(state.alerts.at(-1)).toContain('Tối đa 8 nhóm');
        await expect(names(page)).toHaveCount(8);
    });

    test('tên trùng nhau bị từ chối', async ({ app }) => {
        const { page, state } = await app(withPlan(plan()));

        await open(page);
        await names(page).nth(1).fill('cá nhân');
        await page.click('#allocationForm button[type=submit]');

        expect(state.alerts.at(-1)).toContain('không được trùng');
        await expect(page.locator('#allocationModal')).toHaveClass(/open/);
    });

    test('xóa nhóm: danh mục của nhóm đó chuyển về nhóm chi đầu tiên; xóa hết thì tắt phần nhóm', async ({
        app,
    }) => {
        const { page } = await app(withPlan(plan(), [spend(1000000, 'Mua sắm')]));

        await open(page);
        await page.locator('.allocation-group').nth(1).locator('button').click();

        await expect(names(page)).toHaveCount(2);
        await expect(page.locator('#allocationAdd')).toBeFocused();
        await expect(page.locator('select[data-category="Mua sắm"]')).toHaveValue('p');
        await page.click('#allocationForm button[type=submit]');

        await expect(row(page, 'Cá nhân')).toContainText('1.000.000 đ / 5.000.000 đ');
        // "Mua sắm" is now on the default (first) group, which needs no entry.
        expect((await page.evaluate(() => salaryPlan)).assign).toEqual({});

        await open(page);
        await page.locator('.allocation-group').first().locator('button').click();
        await page.locator('.allocation-group').first().locator('button').click();
        await page.click('#allocationForm button[type=submit]');

        await expect(page.locator('.salary-group')).toHaveCount(0);
        await expect(page.locator('.salary-groups')).toContainText('Chưa chia lương');
    });

    test('chỉ một nhóm là phần tiết kiệm: chọn nhóm khác thì nhóm cũ bị bỏ chọn', async ({
        app,
    }) => {
        const { page } = await app(withPlan(plan()));

        await open(page);
        await page.locator('#allocationGroups [data-field=saving]').first().check();

        await expect(
            page.locator('#allocationGroups [data-field=saving]').nth(2),
        ).not.toBeChecked();
        // The first group became the saving part, so it is no longer a choice for categories.
        await expect(
            page.locator('select[data-category="Ăn uống"] option', { hasText: 'Cá nhân' }),
        ).toHaveCount(0);
    });

    test('"Mẫu 50 / 30 / 20" đặt lại nhóm nhưng giữ danh mục đang chọn; chưa Lưu thì chưa đổi', async ({
        app,
    }) => {
        const { page } = await app(withPlan(plan({ groups: groups.slice(0, 1), assign: {} })));

        await open(page);
        await page.click('[data-action=reset-groups]');

        await expect(names(page)).toHaveCount(3);
        await expect(names(page).first()).toHaveValue('Tiêu dùng cá nhân');
        expect((await page.evaluate(() => salaryPlan)).groups).toHaveLength(1);

        await page.keyboard.press('Escape');
        await expect(page.locator('#allocationModal')).not.toHaveClass(/open/);
        expect((await page.evaluate(() => salaryPlan)).groups).toHaveLength(1);
    });

    test('tên nhóm có ký tự đặc biệt không phá HTML', async ({ app }) => {
        const { page, state } = await app(withPlan(plan()));

        await open(page);
        await names(page).first().fill('<img src=x onerror=alert(1)> "A" & \'B\'');
        await page.click('#allocationForm button[type=submit]');

        await expect(row(page, 'img src=x')).toHaveCount(1);
        await expect(page.locator('.salary-group img')).toHaveCount(0);
        await open(page);
        await expect(names(page).first()).toHaveValue('<img src=x onerror=alert(1)> "A" & \'B\'');
        expect(state.errors).toEqual([]);
    });
});

test.describe('Xóa danh mục, cảnh báo theo nhóm', () => {
    test('xóa danh mục thì bỏ luôn việc gán nhóm của nó', async ({ app }) => {
        const { page } = await app(withPlan(plan()));

        await page.evaluate(() => switchTab('categories'));
        await page.click('#category-table-body tr:has-text("Mua sắm") [data-action=delete]');

        expect((await page.evaluate(() => salaryPlan)).assign).toEqual({});
    });

    test('toast cho đúng nhóm khi một khoản chi làm sắp hết / hết hạn mức; nhóm khác không báo', async ({
        app,
    }) => {
        const { page } = await app(withPlan(plan()));

        await addExpense(page, 2000000, 'Mua sắm'); // 67% of work: quiet
        await expect(toasts(page)).toHaveCount(0);

        await addExpense(page, 500000, 'Mua sắm'); // 83%
        await expect(toasts(page)).toHaveCount(1);
        await expect(toasts(page).first()).toHaveClass(/toast-warning/);
        await expect(toasts(page).first()).toContainText(
            'Nhóm "Công việc" sắp hết hạn mức: 2.500.000 đ / 3.000.000 đ (83%)',
        );

        await addExpense(page, 600000, 'Mua sắm'); // 103%
        await expect(toasts(page)).toHaveCount(2);
        await expect(toasts(page).last()).toHaveClass(/toast-danger/);
        await expect(toasts(page).last()).toContainText('Nhóm "Công việc" đã hết hạn mức');

        await addExpense(page, 100000, 'Mua sắm'); // still over: quiet
        await expect(toasts(page)).toHaveCount(2);
    });

    test('toast tiết kiệm khi chi lấn dần vào mục tiêu', async ({ app }) => {
        const { page } = await app(
            withPlan(plan({ groups: groups.slice(0, 1).concat(groups[2]) })),
        );

        // Personal gets the whole 50% cap but the saving target is 20%: limit to spend is 8,000,000.
        await addExpense(page, 6000000, 'Ăn uống'); // personal over its cap, saving still fine
        await expect(toasts(page).filter({ hasText: 'tiết kiệm' })).toHaveCount(0);

        await addExpense(page, 600000, 'Ăn uống'); // total 6.6M: 82% of the 8M limit
        await expect(toasts(page).filter({ hasText: 'Sắp chạm mức tiết kiệm' })).toHaveCount(1);

        await addExpense(page, 2000000, 'Ăn uống'); // total 8.6M: target missed
        await expect(toasts(page).filter({ hasText: 'Chưa đạt mục tiêu tiết kiệm' })).toHaveCount(
            1,
        );
    });

    test('thu nhập và chi của tháng khác không gây cảnh báo nhóm', async ({ app }) => {
        const { page } = await app(withPlan(plan()));

        await page.click('header .btn');
        await page.click('#btnTypeIncome');
        await page.fill('#txAmount', '9000000');
        await page.click('#transactionForm button[type=submit]');

        await page.click('header .btn');
        await page.fill('#txAmount', '9000000');
        await page.fill('#txDate', '2026-09-15');
        await page.click('#transactionForm button[type=submit]');

        await expect(toasts(page)).toHaveCount(0);
    });
});

test.describe('Đồng bộ, sao lưu và trợ năng của nhóm', () => {
    test('v2: máy B nhận nhóm và việc gán danh mục do máy A đặt', async ({ app }) => {
        const server = newServer('v2');
        const a = await app({ server, now: NOW });

        await a.page.click('#salary-edit-btn');
        await a.page.locator('#salaryAmount').pressSequentially('10000000');
        await a.page.click('#salaryForm button[type=submit]');
        await open(a.page);
        await names(a.page).nth(1).fill('Làm việc');
        await a.page.locator('select[data-category="Mua sắm"]').selectOption({ label: 'Làm việc' });
        await a.page.click('#allocationForm button[type=submit]');
        await wait(400);

        const b = await app({ server, now: NOW });
        const plan = await b.page.evaluate(() => salaryPlan);

        expect(plan.groups.map((group) => group.name)).toEqual([
            'Tiêu dùng cá nhân',
            'Làm việc',
            'Tiết kiệm',
        ]);
        expect(plan.assign['Mua sắm']).toBe('work');
        await expect(row(b.page, 'Làm việc')).toBeVisible();

        function names(page) {
            return page.locator('#allocationGroups [data-field=name]');
        }
    });

    test('sao lưu có nhóm và việc gán danh mục, khôi phục lại được', async ({ app }) => {
        const { page } = await app(withPlan(plan()));

        await page.evaluate(() => switchTab('settings'));

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.click('button:has-text("Sao lưu dữ liệu")'),
        ]);
        const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));

        expect(backup.data.salary).toEqual(plan());

        const other = await app({ now: NOW });

        await other.page.evaluate(() => switchTab('settings'));
        await other.page.setInputFiles('input[type=file]', {
            name: 'backup.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(backup)),
        });
        await wait(300);

        expect(await other.page.evaluate(() => salaryPlan)).toEqual(plan());
    });

    test('dữ liệu nhóm hỏng trong localStorage được làm sạch, không làm vỡ ứng dụng', async ({
        app,
    }) => {
        const { page, state } = await app(
            withPlan({
                amount: SALARY,
                warnPercent: 80,
                groups: [{ id: 'x', name: 'Ổn', percent: 100 }, { junk: true }, 'rác'],
                assign: { 'Ăn uống': 'không-có', 'Mua sắm': 'x' },
            }),
        );

        await expect(page.locator('.salary-group')).toHaveCount(1);
        expect((await page.evaluate(() => salaryPlan)).assign).toEqual({ 'Mua sắm': 'x' });
        expect(state.errors).toEqual([]);
    });

    for (const [name, rows] of [
        ['an toàn', [spend(100000, 'Ăn uống')]],
        ['gần hết', [spend(2500000, 'Mua sắm'), spend(6500000, 'Ăn uống')]],
        ['vượt', [spend(3500000, 'Mua sắm'), spend(8500000, 'Ăn uống')]],
    ]) {
        test(`các nhóm trên thẻ (${name}) không có vi phạm axe`, async ({ app }) => {
            const { page } = await app(withPlan(plan(), rows));
            const results = await new AxeBuilder({ page })
                .include('#salary-section')
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .analyze();

            expect(results.violations.map((violation) => violation.id)).toEqual([]);
        });
    }

    test('hộp thoại chia lương không có vi phạm axe, giữ Tab trong hộp thoại, Esc trả focus', async ({
        app,
    }) => {
        const { page } = await app(withPlan(plan()));

        await open(page);

        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();

        expect(results.violations.map((violation) => violation.id)).toEqual([]);

        for (let step = 0; step < 30; step++) {
            await page.keyboard.press('Tab');
            expect(
                await page.evaluate(() =>
                    document.querySelector('#allocationModal').contains(document.activeElement),
                ),
            ).toBe(true);
        }

        await page.keyboard.press('Escape');
        await expect(page.locator('.salary-groups-head button')).toBeFocused();
    });

    test('trên điện thoại thẻ nhóm không tràn ngang, hộp thoại nằm gọn và nút Lưu cuộn tới được', async ({
        app,
    }) => {
        const { page } = await app({
            ...withPlan(plan(), [spend(2900000, 'Mua sắm')]),
            viewport: { width: 390, height: 844 },
        });

        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);

        await open(page);

        const box = await page.locator('#allocationModal .modal-content').boundingBox();

        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);

        await page.locator('#allocationForm button[type=submit]').scrollIntoViewIfNeeded();
        await expect(page.locator('#allocationForm button[type=submit]')).toBeVisible();
    });
});
