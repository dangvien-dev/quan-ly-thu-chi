// Savings book: a savings source kind, the automatic deposit on payday, books and history.

const fs = require('fs');
const { test, expect, tx, newServer, goTab, wait, scanA11y } = require('./helpers');

const NOW = '2026-10-30T03:00:00Z'; // 30/10/2026 in Vietnam
const PAYDAY_NOW = '2026-10-05T03:00:00Z';
const BOOK = 'Sổ tiết kiệm';
const BANK = 'Thẻ Ngân Hàng';
const SOURCES = [
    { name: 'Tiền Mặt', kind: 'cash' },
    { name: BANK, kind: 'bank' },
    { name: 'Thẻ Tín Dụng', kind: 'credit' },
    { name: 'Spaylater', kind: 'credit' },
    { name: 'Nợ Công Ty', kind: 'debt' },
    { name: BOOK, kind: 'savings' },
];
const SALARY = { amount: 10000000, warnPercent: 80 };
const plan = (extra = {}) => ({
    enabled: true,
    day: 5,
    from: BANK,
    book: BOOK,
    mode: 'percent',
    percent: 20,
    amount: 0,
    since: '2026-10-01',
    lastMonth: '',
    ...extra,
});
const seed = ({ savings, salary = SALARY, sources = SOURCES, rows = [], balances } = {}) => ({
    fm_sources: JSON.stringify(sources),
    fm_initial_balances: JSON.stringify(balances || { [BANK]: 15000000 }),
    ...(salary ? { fm_salary: JSON.stringify(salary) } : {}),
    ...(savings ? { fm_savings: JSON.stringify(savings) } : {}),
    fm_transactions: JSON.stringify(rows),
});
const toasts = (page) => page.locator('#toast-container .toast');
const autoRows = (page) =>
    page.evaluate(() =>
        transactions
            .filter((t) => t.id.startsWith('TX_SAV_'))
            .map((t) => [t.id, t.date, t.source, t.targetSource, t.amount, t.type])
            .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    );
const balancesOf = (page) => page.evaluate(() => calculateSourceBalances());

async function submitSavings(page, values) {
    return page.evaluate((entries) => {
        Object.entries(entries).forEach(([id, value]) => {
            document.getElementById(id).value = value;
        });
        handleSavingsSubmit({ preventDefault() {} });
    }, values);
}

test.describe('Trang Sổ Tiết Kiệm lúc chưa có gì', () => {
    test('có mục trong menu, tổng 0, chưa bật tự động gửi, chưa có sổ; thẻ ở Tổng quan ẩn', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });

        await expect(page.locator('#savings-card')).toBeHidden();
        await goTab(page, 'savings');

        await expect(page.locator('#page-title')).toHaveText('Sổ Tiết Kiệm');
        await expect(page.locator('#lbl-savings-total')).toHaveText('0 đ');
        await expect(page.locator('#savings-auto-body')).toContainText('Chưa bật');
        await expect(page.locator('#savings-edit-label')).toHaveText('Cài đặt');
        await expect(page.locator('#savings-books')).toContainText('Chưa có sổ tiết kiệm nào');
        await expect(page.locator('#savings-history')).toContainText(
            'Chưa có khoản gửi hoặc rút nào',
        );
        await expect(page.locator('#savings-more')).toBeHidden();
    });

    test('loại "Sổ tiết kiệm" có trong danh sách loại nguồn tiền', async ({ app }) => {
        const { page } = await app({ now: NOW });

        await page.evaluate(() => openSourceModal());

        await expect(page.locator('#srcKind option[value="savings"]')).toHaveText('Sổ tiết kiệm');
    });
});

test.describe('Cài đặt tự động gửi', () => {
    test('mặc định theo lương: % lấy từ nhóm tiết kiệm, nguồn là ngân hàng, tạo sổ mới', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW, seed: seed({ sources: SOURCES.slice(0, 5) }) });

        await goTab(page, 'savings');
        await page.click('#savings-edit-btn');

        await expect(page.locator('#savingsModal')).toHaveClass(/open/);
        await expect(page.locator('#savDay')).toBeFocused();
        await expect(page.locator('#savMode')).toHaveValue('percent');
        await expect(page.locator('#savPercent')).toHaveValue('20');
        await expect(page.locator('#savPreview')).toContainText('2.000.000 đ');
        await expect(page.locator('#savFrom')).toHaveValue(BANK);
        await expect(page.locator('#savBook')).toHaveValue('__new__');
        await expect(page.locator('#savNewGroup')).toBeVisible();
        await expect(page.locator('#savNewName')).toHaveValue(BOOK);
        await expect(page.locator('#savDisable')).toBeHidden();
        // Debts and the savings books themselves are not where a salary arrives.
        await expect(page.locator('#savFrom option')).toHaveText(['Tiền Mặt', BANK]);
    });

    test('lưu: tạo sổ mới, ghi kế hoạch bắt đầu từ hôm nay, chưa gửi bù (đã qua ngày 5)', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW, seed: seed({ sources: SOURCES.slice(0, 5) }) });

        await goTab(page, 'savings');
        await page.click('#savings-edit-btn');
        await page.fill('#savDay', '5');
        await page.click('#savingsForm button[type=submit]');

        await expect(page.locator('#savingsModal')).not.toHaveClass(/open/);

        const saved = await page.evaluate(() => ({
            plan: savingsPlan,
            book: sources.find((source) => source.name === 'Sổ tiết kiệm'),
        }));

        expect(saved.plan).toEqual(plan({ since: '2026-10-30', lastMonth: '' }));
        expect(saved.book.kind).toBe('savings');
        expect(await autoRows(page)).toEqual([]);
        await expect(page.locator('#savings-auto-body')).toContainText(
            'Ngày 5 hằng tháng: gửi 20% lương (≈ 2.000.000 đ) từ Thẻ Ngân Hàng vào Sổ tiết kiệm.',
        );
        await expect(page.locator('#savings-auto-body')).toContainText('Lần tới: 05/11/2026');
        await expect(page.locator('#savings-edit-label')).toHaveText('Sửa');
        await expect(page.locator('#savings-books .source-card')).toHaveCount(1);
    });

    test('chọn số tiền cố định: ô tiền có dấu phân cách, không cần mức lương', async ({ app }) => {
        const { page } = await app({ now: NOW, seed: seed({ salary: null }) });

        await goTab(page, 'savings');
        await page.click('#savings-edit-btn');

        await expect(page.locator('#savMode')).toHaveValue('fixed');
        await expect(page.locator('#savAmountGroup')).toBeVisible();
        await expect(page.locator('#savPercentGroup')).toBeHidden();

        await page.fill('#savDay', '28');
        await page.locator('#savAmount').pressSequentially('1500000');
        await expect(page.locator('#savAmount')).toHaveValue('1.500.000');
        await page.click('#savingsForm button[type=submit]');

        const saved = await page.evaluate(() => savingsPlan);

        expect(saved).toMatchObject({ enabled: true, mode: 'fixed', amount: 1500000, day: 28 });
        await expect(page.locator('#savings-auto-body')).toContainText('gửi 1.500.000 đ');
    });

    test('đổi giữa hai cách tính chỉ hiện ô tương ứng', async ({ app }) => {
        const { page } = await app({ now: NOW, seed: seed() });

        await page.evaluate(() => openSavingsModal());
        await page.selectOption('#savMode', 'fixed');
        await expect(page.locator('#savAmountGroup')).toBeVisible();
        await expect(page.locator('#savPercentGroup')).toBeHidden();
        await page.selectOption('#savMode', 'percent');
        await expect(page.locator('#savPercentGroup')).toBeVisible();
        await expect(page.locator('#savAmountGroup')).toBeHidden();

        await page.fill('#savPercent', '35');
        await expect(page.locator('#savPreview')).toContainText('3.500.000 đ');
    });

    test('chọn sổ có sẵn thì không hiện ô tên sổ mới', async ({ app }) => {
        const { page } = await app({ now: NOW, seed: seed() });

        await page.evaluate(() => openSavingsModal());

        await expect(page.locator('#savBook')).toHaveValue(BOOK);
        await expect(page.locator('#savNewGroup')).toBeHidden();

        await page.selectOption('#savBook', '__new__');
        await expect(page.locator('#savNewGroup')).toBeVisible();
    });

    test('kiểm tra dữ liệu nhập: ngày, phần trăm, số tiền, tên sổ, mức lương', async ({ app }) => {
        const { page, state } = await app({ now: NOW, seed: seed() });
        const base = { savMode: 'percent', savPercent: '20', savFrom: BANK, savBook: BOOK };

        await page.evaluate(() => openSavingsModal());

        for (const values of [
            { savDay: '0' },
            { savDay: '32' },
            { savDay: '1.5' },
            { savDay: '5', savPercent: '0' },
            { savDay: '5', savPercent: '101' },
            { savDay: '5', savMode: 'fixed', savAmount: '' },
            { savDay: '5', savBook: '__new__', savNewName: '  ' },
            { savDay: '5', savBook: '__new__', savNewName: 'tiền mặt' },
        ]) {
            const before = state.alerts.length;

            await submitSavings(page, { ...base, ...values });

            expect(state.alerts.length, JSON.stringify(values)).toBe(before + 1);
        }

        expect((await page.evaluate(() => savingsPlan)).enabled).toBe(false);
        await expect(page.locator('#savingsModal')).toHaveClass(/open/);
    });

    test('% lương mà chưa đặt mức lương thì từ chối', async ({ app }) => {
        const { page, state } = await app({ now: NOW, seed: seed({ salary: null }) });

        await page.evaluate(() => openSavingsModal());
        await submitSavings(page, {
            savDay: '5',
            savMode: 'percent',
            savPercent: '20',
            savFrom: BANK,
            savBook: BOOK,
        });

        expect(state.alerts.at(-1)).toContain('đặt mức lương');
        expect((await page.evaluate(() => savingsPlan)).enabled).toBe(false);
    });

    test('sửa kế hoạch đang chạy: giữ tháng đã gửi, ngày bắt đầu đặt lại về hôm nay, hiện nút Tắt', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            seed: seed({ savings: plan({ since: '2026-09-01', lastMonth: '2026-10' }) }),
        });

        await page.evaluate(() => openSavingsModal());
        await expect(page.locator('#savDisable')).toBeVisible();
        await expect(page.locator('#savDay')).toHaveValue('5');
        await page.fill('#savPercent', '25');
        await page.click('#savingsForm button[type=submit]');

        expect(await page.evaluate(() => savingsPlan)).toMatchObject({
            percent: 25,
            since: '2026-10-30',
            lastMonth: '2026-10',
        });
    });

    test('tắt tự động gửi: không còn gửi; bật lại thì không gửi bù thời gian đã tắt', async ({
        app,
    }) => {
        const { page } = await app({
            now: PAYDAY_NOW,
            seed: seed({ savings: plan({ lastMonth: '2026-10' }) }),
        });

        await page.evaluate(() => openSavingsModal());
        await page.click('#savDisable');

        expect((await page.evaluate(() => savingsPlan)).enabled).toBe(false);
        await goTab(page, 'savings');
        await expect(page.locator('#savings-auto-body')).toContainText('Chưa bật');

        // Switched on again later: the months in between are not made up.
        await page.evaluate(() => openSavingsModal());
        await page.fill('#savDay', '1');
        await page.click('#savingsForm button[type=submit]');

        expect(await autoRows(page)).toEqual([]);
        expect((await page.evaluate(() => savingsPlan)).since).toBe('2026-10-05');
    });
});

test.describe('Tự động gửi khi đến ngày lãnh lương', () => {
    test('đúng ngày lãnh lương: tự chuyển 20% lương từ ngân hàng vào sổ, có thông báo', async ({
        app,
    }) => {
        const { page } = await app({ now: PAYDAY_NOW, seed: seed({ savings: plan() }) });

        expect(await autoRows(page)).toEqual([
            ['TX_SAV_202610', '2026-10-05', BANK, BOOK, 2000000, 'transfer'],
        ]);
        expect(await page.evaluate(() => savingsPlan.lastMonth)).toBe('2026-10');
        await expect(toasts(page).first()).toContainText(
            'Đã tự gửi 2.000.000 đ vào "Sổ tiết kiệm"',
        );
        expect(await balancesOf(page)).toMatchObject({ [BANK]: 13000000, [BOOK]: 2000000 });
    });

    test('khoản tự gửi là chuyển tiền: không tính vào chi tiêu, và có ghi chú rõ ràng', async ({
        app,
    }) => {
        const { page } = await app({ now: PAYDAY_NOW, seed: seed({ savings: plan() }) });

        await expect(page.locator('#lbl-total-expense')).toHaveText('0 đ');

        const row = await page.evaluate(() => transactions.find((t) => t.id === 'TX_SAV_202610'));

        expect(row.category).toBe('Chuyển tiền nội bộ');
        expect(row.note).toBe('Tự động gửi tiết kiệm tháng 10/2026');
        expect(await page.evaluate(() => getSalaryStatus().spent)).toBe(0);
    });

    test('tiền trong sổ không nằm trong "Tổng số dư khả dụng", có thẻ "Tổng Tiết Kiệm" riêng', async ({
        app,
    }) => {
        const { page } = await app({ now: PAYDAY_NOW, seed: seed({ savings: plan() }) });

        await expect(page.locator('#lbl-total-balance')).toHaveText('13.000.000 đ');
        await expect(page.locator('#savings-card')).toBeVisible();
        await expect(page.locator('#lbl-total-savings')).toHaveText('2.000.000 đ');
    });

    test('chưa tới ngày (đã cài sau ngày 5): không gửi gì và hiện ngày gửi tới', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            seed: seed({ savings: plan({ since: '2026-10-20' }) }),
        });

        expect(await autoRows(page)).toEqual([]);
        await goTab(page, 'savings');
        await expect(page.locator('#savings-auto-body')).toContainText('Lần tới: 05/11/2026');
    });

    test('mở lại hoặc tải lại không gửi trùng; xóa khoản tự gửi thì không bị tạo lại', async ({
        app,
    }) => {
        const { page } = await app({ now: PAYDAY_NOW, seed: seed({ savings: plan() }) });

        await page.reload();
        await page.waitForLoadState('load');
        expect(await autoRows(page)).toHaveLength(1);

        await page.evaluate(() => {
            transactions = transactions.filter((t) => t.id !== 'TX_SAV_202610');
            saveDataLocally();
        });
        await page.reload();
        await page.waitForLoadState('load');

        expect(await autoRows(page)).toEqual([]);
    });

    test('lâu không mở app: gửi bù các tháng đã đến hạn, mỗi tháng đúng ngày lãnh lương', async ({
        app,
    }) => {
        const { page } = await app({
            now: '2026-10-20T03:00:00Z',
            seed: seed({
                savings: plan({ day: 10, since: '2026-07-15', lastMonth: '2026-07' }),
                balances: { [BANK]: 30000000 },
            }),
        });

        expect(await autoRows(page)).toEqual([
            ['TX_SAV_202608', '2026-08-10', BANK, BOOK, 2000000, 'transfer'],
            ['TX_SAV_202609', '2026-09-10', BANK, BOOK, 2000000, 'transfer'],
            ['TX_SAV_202610', '2026-10-10', BANK, BOOK, 2000000, 'transfer'],
        ]);
        expect(await page.evaluate(() => savingsPlan.lastMonth)).toBe('2026-10');
        await expect(toasts(page).first()).toContainText('3 kỳ');
    });

    test('ngày lãnh lương 31: tháng 2 gửi vào ngày 28', async ({ app }) => {
        const { page } = await app({
            now: '2026-03-01T03:00:00Z',
            seed: seed({ savings: plan({ day: 31, since: '2026-02-01', lastMonth: '2026-01' }) }),
        });

        expect(await autoRows(page)).toEqual([
            ['TX_SAV_202602', '2026-02-28', BANK, BOOK, 2000000, 'transfer'],
        ]);
    });

    test('% theo lương hiện tại: lương đổi thì khoản gửi tháng sau đổi theo', async ({ app }) => {
        const { page } = await app({
            now: PAYDAY_NOW,
            seed: seed({ salary: { amount: 20000000, warnPercent: 80 }, savings: plan() }),
        });

        expect((await autoRows(page))[0][4]).toBe(4000000);
    });

    test('số tiền cố định không phụ thuộc lương', async ({ app }) => {
        const { page } = await app({
            now: PAYDAY_NOW,
            seed: seed({ salary: null, savings: plan({ mode: 'fixed', amount: 1500000 }) }),
        });

        expect((await autoRows(page))[0][4]).toBe(1500000);
    });

    test('% lương mà chưa có mức lương: không gửi, báo lý do; đặt lương xong thì gửi', async ({
        app,
    }) => {
        const { page } = await app({
            now: PAYDAY_NOW,
            seed: seed({ salary: null, savings: plan() }),
        });

        expect(await autoRows(page)).toEqual([]);
        await goTab(page, 'savings');
        await expect(page.locator('.savings-problem')).toContainText('Chưa đặt mức lương');

        await page.evaluate(() => {
            salaryPlan = normalizeSalaryPlan({ amount: 10000000, warnPercent: 80 });
            saveMeta('salary');
            generateSavingsDeposits();
        });

        expect((await autoRows(page))[0][4]).toBe(2000000);
    });

    test('kế hoạch hỏng (nguồn bị đổi loại hoặc mất): không gửi, hiện cảnh báo', async ({
        app,
    }) => {
        const { page } = await app({
            now: PAYDAY_NOW,
            seed: seed({
                savings: plan(),
                sources: SOURCES.map((source) =>
                    source.name === BOOK ? { name: BOOK, kind: 'bank' } : source,
                ),
            }),
        });

        expect(await autoRows(page)).toEqual([]);
        await goTab(page, 'savings');
        await expect(page.locator('.savings-problem')).toContainText('không còn là sổ tiết kiệm');
    });

    test('tắt kế hoạch thì không gửi dù đã đến ngày', async ({ app }) => {
        const { page } = await app({
            now: PAYDAY_NOW,
            seed: seed({ savings: plan({ enabled: false }) }),
        });

        expect(await autoRows(page)).toEqual([]);
    });

    test('quay lại ứng dụng khi đã sang ngày lãnh lương thì gửi (không cần tải lại)', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            seed: seed({ savings: plan({ since: '2026-10-20' }) }),
        });

        expect(await autoRows(page)).toEqual([]);

        // The app was left open across payday.
        await page.evaluate(() => {
            savingsPlan = normalizeSavingsPlan({ ...savingsPlan, since: '2026-10-01' });
            document.dispatchEvent(new Event('visibilitychange'));
        });

        expect(await autoRows(page)).toHaveLength(1);
    });
});

test.describe('Nhiều thiết bị và Google Sheet', () => {
    test('hai thiết bị cùng đến ngày lãnh lương: trên server chỉ có một khoản gửi', async ({
        app,
    }) => {
        const server = newServer('v2');
        const options = { server, now: PAYDAY_NOW, seed: seed({ savings: plan() }) };
        const a = await app(options);
        const b = await app(options);

        await wait(700);

        const rows = server
            .get({ v: '2' })
            .transactions.filter((row) => String(row.id).startsWith('TX_SAV_'));

        expect(rows.map((row) => row.id)).toEqual(['TX_SAV_202610']);
        expect(await autoRows(a.page)).toHaveLength(1);
        expect(await autoRows(b.page)).toHaveLength(1);
    });

    test('máy thứ hai nhận kế hoạch qua đồng bộ v2 và không gửi lại kỳ đã gửi', async ({ app }) => {
        const server = newServer('v2');
        const a = await app({ server, now: PAYDAY_NOW, seed: seed({ savings: plan() }) });

        await wait(500);

        const b = await app({ server, now: PAYDAY_NOW, seed: seed() });

        await wait(500);

        expect(await b.page.evaluate(() => savingsPlan)).toMatchObject({
            enabled: true,
            lastMonth: '2026-10',
        });
        expect(await autoRows(b.page)).toHaveLength(1);
        expect(await autoRows(a.page)).toHaveLength(1);
    });

    test('script cũ: khoản gửi là một dòng chuyển tiền trên Sheet, và chỉ gửi {transactions}', async ({
        app,
    }) => {
        const { page, state } = await app({
            now: PAYDAY_NOW,
            remote: [tx({ id: 'TX_OLD', date: '2026-10-01' })],
            seed: seed({ savings: plan() }),
        });

        await wait(600);

        const row = state.remote.find((item) => item.id === 'TX_SAV_202610');

        expect(row).toBeTruthy();
        expect(row.category).toContain('Chuyển tiền nội bộ');
        expect(row.category).toContain(BOOK);
        expect(state.posts.length).toBeGreaterThan(0);

        for (const post of state.posts) {
            expect(Object.keys(post.body)).toEqual(['transactions']);
        }

        expect(await autoRows(page)).toHaveLength(1);
    });

    test('sao lưu có kế hoạch và khôi phục lại được', async ({ app }) => {
        const { page } = await app({
            now: NOW,
            seed: seed({ savings: plan({ lastMonth: '2026-10' }) }),
        });

        await goTab(page, 'settings');

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.click('button:has-text("Sao lưu dữ liệu")'),
        ]);
        const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));

        expect(backup.data.savings).toEqual(plan({ lastMonth: '2026-10' }));

        const other = await app({ now: NOW });

        await goTab(other.page, 'settings');
        await other.page.setInputFiles('input[type=file]', {
            name: 'backup.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(backup)),
        });
        await wait(300);

        expect(await other.page.evaluate(() => savingsPlan)).toEqual(
            plan({ lastMonth: '2026-10' }),
        );
    });
});

test.describe('Sổ, gửi / rút và lịch sử', () => {
    const rows = [
        tx({
            id: 'TX_1',
            date: '2026-10-02',
            type: 'transfer',
            source: BANK,
            targetSource: BOOK,
            category: 'Chuyển tiền nội bộ',
            amount: 3000000,
            note: 'Thưởng',
        }),
        tx({
            id: 'TX_2',
            date: '2026-10-12',
            type: 'transfer',
            source: BOOK,
            targetSource: 'Tiền Mặt',
            category: 'Chuyển tiền nội bộ',
            amount: 500000,
        }),
        tx({
            id: 'TX_3',
            date: '2026-10-20',
            type: 'income',
            source: BOOK,
            category: 'Thu nhập khác',
            amount: 25000,
            note: 'Lãi tháng 10',
        }),
        tx({
            id: 'TX_4',
            date: '2026-10-21',
            type: 'expense',
            source: 'Tiền Mặt',
            amount: 99000,
            note: 'Cà phê',
        }),
    ];

    test('mỗi sổ hiện số dư và các nút Gửi vào / Rút ra / Sửa', async ({ app }) => {
        const { page } = await app({ now: NOW, seed: seed({ rows }) });

        await goTab(page, 'savings');

        const card = page.locator('#savings-books .source-card');

        await expect(card).toHaveCount(1);
        await expect(card).toContainText(BOOK);
        await expect(card.locator('.card-value')).toHaveText('2.525.000 đ');
        await expect(card.locator('[data-action=savings-deposit]')).toBeVisible();
        await expect(card.locator('[data-action=savings-withdraw]')).toBeVisible();
        await expect(card.locator('[data-action=edit-source]')).toHaveAccessibleName(
            `Sửa sổ ${BOOK}`,
        );
        await expect(page.locator('#lbl-savings-total')).toHaveText('2.525.000 đ');
        await expect(page.locator('#lbl-savings-month')).toHaveText('Tháng này đã gửi 3.000.000 đ');
    });

    test('lịch sử: gửi, rút, lãi; bỏ qua giao dịch không liên quan; mới nhất trước', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW, seed: seed({ rows }) });

        await goTab(page, 'savings');

        const items = page.locator('#savings-history .savings-row');

        await expect(items).toHaveCount(3);
        await expect(items.nth(0)).toContainText('Thu vào sổ');
        await expect(items.nth(0)).toContainText('Lãi tháng 10');
        await expect(items.nth(0).locator('.savings-amount')).toHaveText('+25.000 đ');
        await expect(items.nth(1)).toContainText('Rút từ sổ');
        await expect(items.nth(1)).toContainText('về Tiền Mặt');
        await expect(items.nth(1).locator('.savings-amount')).toHaveText('−500.000 đ');
        await expect(items.nth(2)).toContainText('Gửi vào sổ');
        await expect(items.nth(2)).toContainText('từ Thẻ Ngân Hàng');
        await expect(items.nth(2)).toContainText('Thưởng');
        await expect(items.nth(2).locator('.savings-amount')).toHaveText('+3.000.000 đ');
        await expect(page.locator('#savings-history')).not.toContainText('Cà phê');
    });

    test('có từ hai sổ thì tiêu đề mỗi dòng ghi rõ sổ nào', async ({ app }) => {
        const { page } = await app({
            now: NOW,
            seed: seed({
                sources: [...SOURCES, { name: 'Sổ mua nhà', kind: 'savings' }],
                rows: [
                    tx({
                        id: 'TX_A',
                        date: '2026-10-02',
                        type: 'transfer',
                        source: BANK,
                        targetSource: BOOK,
                        category: 'Chuyển tiền nội bộ',
                        amount: 1000,
                    }),
                    tx({
                        id: 'TX_B',
                        date: '2026-10-03',
                        type: 'transfer',
                        source: BANK,
                        targetSource: 'Sổ mua nhà',
                        category: 'Chuyển tiền nội bộ',
                        amount: 2000,
                    }),
                    tx({
                        id: 'TX_C',
                        date: '2026-10-04',
                        type: 'transfer',
                        source: BOOK,
                        targetSource: 'Sổ mua nhà',
                        category: 'Chuyển tiền nội bộ',
                        amount: 300,
                    }),
                ],
            }),
        });

        await goTab(page, 'savings');

        const items = page.locator('#savings-history .savings-row');

        await expect(items.nth(0)).toContainText('Chuyển giữa các sổ');
        await expect(items.nth(0)).toContainText('Sổ tiết kiệm ➔ Sổ mua nhà');
        await expect(items.nth(0).locator('.savings-amount')).toHaveText('⟷300 đ');
        await expect(items.nth(1)).toContainText('Gửi vào Sổ mua nhà');
        await expect(items.nth(2)).toContainText('Gửi vào Sổ tiết kiệm');
    });

    test('khoản tự động có nhãn "Tự động"', async ({ app }) => {
        const { page } = await app({ now: PAYDAY_NOW, seed: seed({ savings: plan() }) });

        await goTab(page, 'savings');

        const first = page.locator('#savings-history .savings-row').first();

        await expect(first.locator('.savings-auto')).toHaveText('Tự động');
        await expect(first).toContainText('Gửi vào sổ');
    });

    test('"Gửi vào": mở form chuyển tiền sẵn nguồn và sổ, lưu thì sổ tăng và nguồn giảm', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            seed: seed({ savings: plan({ enabled: false, from: BANK }) }),
        });

        await goTab(page, 'savings');
        await page.click('[data-action=savings-deposit]');

        await expect(page.locator('#transactionModal')).toHaveClass(/open/);
        await expect(page.locator('#txSource')).toHaveValue(BANK);
        await expect(page.locator('#txTargetSource')).toHaveValue(BOOK);
        await expect(page.locator('#txNote')).toHaveValue('Gửi tiết kiệm');

        await page.locator('#txAmount').pressSequentially('1000000');
        await page.click('#transactionForm button[type=submit]');

        expect(await balancesOf(page)).toMatchObject({ [BANK]: 14000000, [BOOK]: 1000000 });
        await expect(page.locator('#savings-history .savings-row').first()).toContainText(
            'Gửi vào',
        );
    });

    test('"Rút ra": chiều ngược lại, về nguồn tiền chính', async ({ app }) => {
        const { page } = await app({ now: NOW, seed: seed({ rows }) });

        await goTab(page, 'savings');
        await page.click('[data-action=savings-withdraw]');

        await expect(page.locator('#txSource')).toHaveValue(BOOK);
        await expect(page.locator('#txTargetSource')).not.toHaveValue(BOOK);
        await expect(page.locator('#txNote')).toHaveValue('Rút tiết kiệm');
    });

    test('"Thêm Sổ" mở form nguồn tiền với loại Sổ tiết kiệm; thêm xong hiện ở danh sách', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW, seed: seed() });

        await goTab(page, 'savings');
        await page.click('#tab-savings .section-head .btn');

        await expect(page.locator('#sourceModal')).toHaveClass(/open/);
        await expect(page.locator('#srcKind')).toHaveValue('savings');

        await page.fill('#srcName', 'Sổ mua nhà');
        await page.locator('#srcInitialBalance').pressSequentially('5000000');
        await page.click('#sourceForm button[type=submit]');

        await expect(page.locator('#savings-books .source-card')).toHaveCount(2);
        await expect(page.locator('#savings-books')).toContainText('Sổ mua nhà');
        await expect(page.locator('#lbl-savings-total')).toHaveText('5.000.000 đ');
    });

    test('quá 30 dòng thì "Xem thêm" tải tiếp', async ({ app }) => {
        const many = Array.from({ length: 35 }, (_, index) =>
            tx({
                id: `TX_M${index}`,
                date: `2026-09-${String((index % 28) + 1).padStart(2, '0')}`,
                type: 'transfer',
                source: BANK,
                targetSource: BOOK,
                category: 'Chuyển tiền nội bộ',
                amount: 1000 + index,
            }),
        );
        const { page } = await app({ now: NOW, seed: seed({ rows: many }) });

        await goTab(page, 'savings');
        await expect(page.locator('#savings-history .savings-row')).toHaveCount(30);
        await expect(page.locator('#savings-more')).toHaveText('Xem thêm (5)');

        await page.click('#savings-more');

        await expect(page.locator('#savings-history .savings-row')).toHaveCount(35);
        await expect(page.locator('#savings-more')).toBeHidden();
    });

    test('tên sổ có ký tự đặc biệt không phá HTML', async ({ app }) => {
        const evil = '<img src=x onerror=alert(1)> "S" & \'T\'';
        const { page, state } = await app({
            now: NOW,
            seed: seed({
                sources: [...SOURCES.slice(0, 5), { name: evil, kind: 'savings' }],
                rows: [
                    tx({
                        id: 'TX_E',
                        type: 'transfer',
                        source: BANK,
                        targetSource: evil,
                        category: 'Chuyển tiền nội bộ',
                        amount: 1000,
                    }),
                ],
            }),
        });

        await goTab(page, 'savings');

        await expect(page.locator('#tab-savings img')).toHaveCount(0);
        await expect(page.locator('#savings-books')).toContainText('<img src=x');
        expect(state.errors).toEqual([]);
    });
});

test.describe('Nguồn tiền được kế hoạch dùng', () => {
    test('đổi tên sổ: kế hoạch và giao dịch cùng đổi theo', async ({ app }) => {
        const { page } = await app({ now: PAYDAY_NOW, seed: seed({ savings: plan() }) });

        await page.evaluate(() => openSourceModal('Sổ tiết kiệm'));
        await page.fill('#srcName', 'Quỹ dự phòng');
        await page.click('#sourceForm button[type=submit]');

        expect(await page.evaluate(() => savingsPlan.book)).toBe('Quỹ dự phòng');
        expect(await autoRows(page)).toEqual([
            ['TX_SAV_202610', '2026-10-05', BANK, 'Quỹ dự phòng', 2000000, 'transfer'],
        ]);
    });

    test('đổi tên nguồn nhận lương: kế hoạch đổi theo', async ({ app }) => {
        const { page } = await app({
            now: NOW,
            seed: seed({ savings: plan({ since: '2026-10-20' }) }),
        });

        await page.evaluate(() => openSourceModal('Thẻ Ngân Hàng'));
        await page.fill('#srcName', 'Vietcombank');
        await page.click('#sourceForm button[type=submit]');

        expect(await page.evaluate(() => savingsPlan.from)).toBe('Vietcombank');
        expect(await page.evaluate(() => savingsPlanProblem(savingsPlan))).toBe('');
    });

    test('không xóa hoặc lưu trữ được nguồn đang nằm trong kế hoạch', async ({ app }) => {
        const { page, state } = await app({
            now: NOW,
            seed: seed({ savings: plan({ since: '2026-10-20' }), balances: {} }),
        });

        await page.evaluate(() => deleteSource('Sổ tiết kiệm'));
        expect(state.alerts.at(-1)).toContain('kế hoạch tự động gửi tiết kiệm');

        await page.evaluate(() => archiveSource('Thẻ Ngân Hàng', true));
        expect(state.alerts.at(-1)).toContain('kế hoạch tự động gửi tiết kiệm');
        expect(await page.evaluate(() => sources.map((s) => [s.name, s.archived]))).toContainEqual([
            'Thẻ Ngân Hàng',
            false,
        ]);
    });
});

test.describe('Trợ năng và điện thoại', () => {
    const full = {
        now: PAYDAY_NOW,
        seed: seed({
            savings: plan(),
            rows: [
                tx({
                    id: 'TX_1',
                    date: '2026-10-02',
                    type: 'transfer',
                    source: BOOK,
                    targetSource: 'Tiền Mặt',
                    category: 'Chuyển tiền nội bộ',
                    amount: 500000,
                    note: 'Rút lo việc nhà',
                }),
                tx({
                    id: 'TX_2',
                    date: '2026-10-03',
                    type: 'income',
                    source: BOOK,
                    category: 'Thu nhập khác',
                    amount: 20000,
                    note: 'Lãi',
                }),
            ],
        }),
    };

    test('thẻ chia lương ở Tổng quan ghi số đã gửi vào sổ trong tháng ở dòng nhóm Tiết kiệm', async ({
        app,
    }) => {
        const { page } = await app({ now: PAYDAY_NOW, seed: seed({ savings: plan() }) });

        await expect(page.locator('.salary-group', { hasText: 'Tiết kiệm' })).toContainText(
            'đã gửi vào sổ tiết kiệm 2.000.000 đ',
        );
    });

    test('chưa gửi gì thì dòng nhóm Tiết kiệm không nhắc tới sổ', async ({ app }) => {
        const { page } = await app({ now: NOW, seed: seed() });

        await expect(page.locator('.salary-group', { hasText: 'Tiết kiệm' })).not.toContainText(
            'đã gửi vào sổ',
        );
    });

    test('trang có dữ liệu không có vi phạm axe (máy tính)', async ({ app }) => {
        const { page } = await app(full);

        await goTab(page, 'savings');

        const results = await scanA11y(page);

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    test('trang có dữ liệu không có vi phạm axe và không tràn ngang (điện thoại)', async ({
        app,
    }) => {
        const { page } = await app({ ...full, viewport: { width: 390, height: 844 } });

        await page.evaluate(() => switchTab('savings'));

        const results = await scanA11y(page);

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);
    });

    test('trên điện thoại vào qua menu trái; dòng lịch sử gọn, thanh dưới vẫn 4 mục', async ({
        app,
    }) => {
        const { page } = await app({ ...full, viewport: { width: 390, height: 844 } });

        await page.click('#menu-toggle');
        await page.click('aside [data-tab="savings"] button');

        await expect(page.locator('#tab-savings')).toHaveClass(/active/);
        await expect(page.locator('#page-title')).toHaveText('Sổ Tiết Kiệm');
        await expect(page.locator('.mobile-nav-item')).toHaveCount(4);

        for (const row of await page.locator('#savings-history .savings-row').all()) {
            expect((await row.boundingBox()).height).toBeLessThan(70);
        }

        expect((await page.locator('header').boundingBox()).height).toBe(56);
    });

    test('hộp thoại cài đặt nằm gọn màn hình điện thoại và có tên cho mọi ô nhập', async ({
        app,
    }) => {
        const { page } = await app({ ...full, viewport: { width: 390, height: 844 } });

        await page.evaluate(() => openSavingsModal());

        const box = await page.locator('#savingsModal .modal-content').boundingBox();

        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);

        for (const id of ['savDay', 'savMode', 'savPercent', 'savFrom', 'savBook']) {
            await expect(page.locator(`#${id}`)).toHaveAccessibleName(/.+/);
        }
    });

    test('mở thẳng #savings (kéo làm mới) vẫn ở trang Sổ Tiết Kiệm', async ({ app }) => {
        const { page } = await app({ now: NOW });

        await page.evaluate(() => switchTab('savings'));
        await page.reload();
        await page.waitForLoadState('load');

        await expect(page.locator('#tab-savings')).toHaveClass(/active/);
    });
});
