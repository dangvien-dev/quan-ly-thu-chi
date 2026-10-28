// Recurring transactions: rules, generation, and their interaction with sources.

const { test, expect, tx, goTab, wait } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z'; // 28/10/2026 (Wednesday) 10:00 GMT+7
const seedRules = (rules, extra = {}) => ({
    now: NOW,
    seed: { fm_recurring: JSON.stringify(rules), ...extra },
});

const monthlyRule = (overrides = {}) => ({
    id: 'RC_1730000000000',
    name: 'Tiền nhà',
    type: 'expense',
    source: 'Tiền Mặt',
    category: 'Hóa đơn & Tiện ích',
    amount: 500000,
    frequency: 'monthly',
    day: 5,
    startDate: '2026-08-05',
    endDate: '',
    active: true,
    lastGenerated: '',
    ...overrides,
});

async function addRule(page, rule) {
    await goTab(page, 'recurring');
    await page.click('button:has-text("Thêm Định Kỳ")');
    await page.fill('#rcName', rule.name);

    if (rule.type) await page.selectOption('#rcType', rule.type);
    if (rule.frequency) await page.selectOption('#rcFrequency', rule.frequency);
    if (rule.source) await page.selectOption('#rcSource', rule.source);
    if (rule.target) await page.selectOption('#rcTarget', rule.target);
    if (rule.category) await page.selectOption('#rcCategory', rule.category);

    await page.fill('#rcAmount', String(rule.amount));

    if (rule.monthDay) await page.fill('#rcMonthDay', String(rule.monthDay));
    if (rule.weekDay !== undefined) await page.selectOption('#rcWeekDay', String(rule.weekDay));

    await page.fill('#rcStart', rule.start);

    if (rule.end) await page.fill('#rcEnd', rule.end);
    if (rule.note) await page.fill('#rcNote', rule.note);

    await page.click('#recurringForm button[type=submit]');
}

const generatedIds = (page) => page.evaluate(() => transactions.map((t) => t.id).sort());

test.describe('Giao dịch định kỳ', () => {
    test('tạo quy tắc hằng tháng có ngày bắt đầu trong quá khứ: hỏi xác nhận rồi tạo giao dịch bù', async ({
        app,
    }) => {
        const { page, state } = await app({ now: NOW });

        await addRule(page, {
            name: 'Tiền nhà',
            category: 'Hóa đơn & Tiện ích',
            amount: 500000,
            monthDay: 5,
            start: '2026-08-05',
        });

        expect(state.confirms[0]).toContain('3 giao dịch bù');

        const saved = await page.evaluate(() => ({
            ids: transactions.map((t) => t.id).sort(),
            dates: transactions.map((t) => t.date).sort(),
            notes: [...new Set(transactions.map((t) => t.note))],
            rule: { last: recurring[0].lastGenerated },
        }));

        expect(saved.dates).toEqual(['2026-08-05', '2026-09-05', '2026-10-05']);
        expect(saved.ids.every((id) => /^TX_R\d+_2026\d{4}$/.test(id))).toBe(true);
        expect(saved.notes).toEqual(['Tiền nhà']);
        expect(saved.rule.last).toBe('2026-10-05');
        await expect(page.locator('#toast-container')).toContainText('Đã tạo 3 giao dịch định kỳ');
        await expect(page.locator('#recurring-table-body')).toContainText('Hằng tháng, ngày 5');
        await expect(page.locator('#recurring-table-body')).toContainText('Lần tới: 2026-11-05');

        await goTab(page, 'sources');
        await expect(
            page.locator('#sources-grid .card', { hasText: 'Tiền Mặt' }).locator('.card-value'),
        ).toHaveText('-1.500.000 đ');
    });

    test('mở lại ứng dụng không tạo trùng giao dịch', async ({ app }) => {
        const { page } = await app(seedRules([monthlyRule()]));
        const first = await generatedIds(page);

        expect(first).toHaveLength(3);

        await page.reload();
        await wait(200);

        expect(await generatedIds(page)).toEqual(first);
    });

    test('khi quay lại ứng dụng sang ngày mới thì tạo thêm giao dịch đến hạn', async ({ app }) => {
        const { page } = await app(seedRules([monthlyRule({ day: 29 })]));

        expect(await page.evaluate(() => transactions.length)).toBe(2); // 29/8, 29/9

        await page.clock.setFixedTime(new Date('2026-10-29T03:00:00Z'));
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

        expect(await page.evaluate(() => transactions.map((t) => t.date).sort())).toEqual([
            '2026-08-29',
            '2026-09-29',
            '2026-10-29',
        ]);
    });

    test('hằng tuần tạo đúng các ngày thứ Hai', async ({ app }) => {
        const { page } = await app({ now: NOW });

        await addRule(page, {
            name: 'Cafe thứ Hai',
            category: 'Ăn uống',
            amount: 30000,
            frequency: 'weekly',
            weekDay: 1,
            start: '2026-10-01',
        });

        expect(await page.evaluate(() => transactions.map((t) => t.date).sort())).toEqual([
            '2026-10-05',
            '2026-10-12',
            '2026-10-19',
            '2026-10-26',
        ]);
        await expect(page.locator('#recurring-table-body')).toContainText('Hằng tuần, Thứ hai');
    });

    test('ngày 31 lùi về ngày cuối tháng ở tháng ngắn', async ({ app }) => {
        const { page } = await app({
            now: '2026-11-30T03:00:00Z',
            seed: {
                fm_recurring: JSON.stringify([monthlyRule({ day: 31, startDate: '2026-10-01' })]),
            },
        });

        expect(await page.evaluate(() => transactions.map((t) => t.date).sort())).toEqual([
            '2026-10-31',
            '2026-11-30',
        ]);
    });

    test('ngày kết thúc chặn các kỳ sau đó và hiện "Đã kết thúc"', async ({ app }) => {
        const { page } = await app(seedRules([monthlyRule({ endDate: '2026-09-30' })]));

        expect(await page.evaluate(() => transactions.map((t) => t.date).sort())).toEqual([
            '2026-08-05',
            '2026-09-05',
        ]);
        await goTab(page, 'recurring');
        await expect(page.locator('#recurring-table-body')).toContainText('Đã kết thúc');
    });

    test('quy tắc tạm dừng không tạo giao dịch; tiếp tục thì không tạo bù thời gian đã dừng', async ({
        app,
    }) => {
        const { page } = await app(seedRules([monthlyRule({ active: false })]));

        expect(await page.evaluate(() => transactions.length)).toBe(0);

        await goTab(page, 'recurring');
        await expect(page.locator('#recurring-table-body')).toContainText('Tạm dừng');
        await page.click('#recurring-table-body [data-action=toggle]');

        // Resumes from today: 28/10 is not the 5th, so nothing is created yet.
        expect(await page.evaluate(() => transactions.length)).toBe(0);
        await expect(page.locator('#recurring-table-body')).toContainText('Đang chạy');
        await expect(page.locator('#recurring-table-body')).toContainText('Lần tới: 2026-11-05');
    });

    test('quy tắc chuyển tiền tạo giao dịch chuyển với nguồn nhận và cập nhật cả hai số dư', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });

        await addRule(page, {
            name: 'Chuyển tiết kiệm',
            type: 'transfer',
            source: 'Tiền Mặt',
            target: 'Thẻ Ngân Hàng',
            amount: 1000000,
            monthDay: 10,
            start: '2026-10-01',
        });

        const saved = await page.evaluate(() => transactions[0]);

        expect(saved).toMatchObject({
            type: 'transfer',
            source: 'Tiền Mặt',
            targetSource: 'Thẻ Ngân Hàng',
            category: 'Chuyển tiền nội bộ',
            date: '2026-10-10',
        });
        await goTab(page, 'sources');
        await expect(
            page
                .locator('#sources-grid .card', { hasText: 'Thẻ Ngân Hàng' })
                .locator('.card-value'),
        ).toHaveText('1.000.000 đ');
    });

    test('đổi Lặp lại hoặc Loại không làm mất nguồn đã chọn', async ({ app }) => {
        const { page } = await app();

        await goTab(page, 'recurring');
        await page.click('button:has-text("Thêm Định Kỳ")');
        await page.selectOption('#rcSource', 'Spaylater');
        await page.selectOption('#rcFrequency', 'weekly');

        await expect(page.locator('#rcSource')).toHaveValue('Spaylater');
        await expect(page.locator('#rcWeekDayGroup')).toBeVisible();
        await expect(page.locator('#rcMonthDayGroup')).toBeHidden();

        await page.selectOption('#rcType', 'transfer');
        await expect(page.locator('#rcSource')).toHaveValue('Spaylater');
        await expect(page.locator('#rcTargetGroup')).toBeVisible();
        await expect(page.locator('#rcCategoryGroup')).toBeHidden();
    });

    test('kiểm tra hợp lệ: chuyển cùng nguồn, ngày kết thúc trước ngày bắt đầu', async ({
        app,
    }) => {
        const { page, state } = await app({ now: NOW });

        await addRule(page, {
            name: 'Sai nguồn',
            type: 'transfer',
            source: 'Tiền Mặt',
            target: 'Tiền Mặt',
            amount: 1000,
            start: '2026-10-28',
        });
        expect(state.alerts.at(-1)).toContain('phải khác nhau');

        await page.click('#recurringModal .close-btn');
        await addRule(page, {
            name: 'Sai ngày',
            category: 'Ăn uống',
            amount: 1000,
            start: '2026-10-28',
            end: '2026-10-01',
        });
        expect(state.alerts.at(-1)).toContain('Ngày kết thúc');
        expect(await page.evaluate(() => recurring.length)).toBe(0);
    });

    test('xóa quy tắc giữ lại các giao dịch đã tạo', async ({ app }) => {
        const { page } = await app(seedRules([monthlyRule()]));

        await goTab(page, 'recurring');
        await page.click('#recurring-table-body [data-action=delete]');

        expect(await page.evaluate(() => recurring.length)).toBe(0);
        expect(await page.evaluate(() => transactions.length)).toBe(3);
        await expect(page.locator('#recurring-table-body')).toContainText(
            'Chưa có giao dịch định kỳ',
        );
    });

    test('sửa quy tắc giữ lastGenerated nên không tạo lại các kỳ cũ', async ({ app }) => {
        const { page } = await app(seedRules([monthlyRule()]));

        await goTab(page, 'recurring');
        await page.click('#recurring-table-body [data-action=edit]');
        await page.fill('#rcAmount', '600000');
        await page.click('#recurringForm button[type=submit]');

        expect(await page.evaluate(() => transactions.length)).toBe(3);
        expect(await page.evaluate(() => recurring[0].amount)).toBe(600000);
    });

    test('đổi tên nguồn cập nhật quy tắc; nguồn đang được quy tắc dùng không xóa được', async ({
        app,
    }) => {
        const { page, state } = await app(
            seedRules([monthlyRule({ source: 'Nợ Công Ty' })], {
                fm_transactions: JSON.stringify([tx({ source: 'Tiền Mặt' })]),
            }),
        );

        await goTab(page, 'sources');
        await page
            .locator('#sources-grid .card', { hasText: 'Nợ Công Ty' })
            .locator('[data-action=delete-source]')
            .click();

        // 3 transactions were generated from the rule, so the source is in use.
        expect(state.alerts.at(-1)).toContain('Không thể xóa');

        await page
            .locator('#sources-grid .card', { hasText: 'Nợ Công Ty' })
            .locator('[data-action=edit-source]')
            .click();
        await page.fill('#srcName', 'Công ty ABC');
        await page.click('#sourceForm button[type=submit]');

        expect(await page.evaluate(() => recurring[0].source)).toBe('Công ty ABC');
    });

    test('sao lưu và khôi phục giữ các quy tắc định kỳ', async ({ app }) => {
        const first = await app(seedRules([monthlyRule()]));
        const backup = await first.page.evaluate(() => ({
            format: 'finmanager-backup',
            version: 1,
            exportedAt: 'x',
            data: {
                transactions: [],
                categories,
                initialBalances,
                recurring,
                scriptUrl: '',
            },
        }));
        const other = await app();

        await goTab(other.page, 'settings');
        await other.page.setInputFiles('input[type=file]', {
            name: 'b.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(backup)),
        });
        await wait(300);

        expect(await other.page.evaluate(() => recurring.map((rule) => rule.name))).toEqual([
            'Tiền nhà',
        ]);
    });
});
