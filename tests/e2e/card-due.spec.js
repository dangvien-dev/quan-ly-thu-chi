// Statement due dates of credit / pay-later cards: the "Cần trả ... trước ..." line of the source
// card and the daily reminder.

const { test, expect, tx, newServer, syncedSeed, scanA11y } = require('./helpers');

const NOW = '2026-11-07T03:00:00Z'; // 7/11/2026 in Vietnam; Spaylater is due on the 10th (3 days)
const SPAY = {
    name: 'Spaylater',
    kind: 'credit',
    creditLimit: 30000000,
    statementDay: 24,
    dueDay: 10,
};
const SOURCES = [{ name: 'Tiền Mặt', kind: 'cash' }, { name: 'Thẻ Ngân Hàng', kind: 'bank' }, SPAY];
// The statement of 24/10 holds 1.000.000 đ; the purchase of 30/10 belongs to the next statement.
const OCTOBER = [
    tx({ id: 'A', date: '2026-10-05', source: 'Spaylater', amount: 1000000 }),
    tx({ id: 'B', date: '2026-10-30', source: 'Spaylater', amount: 464140 }),
];
const payment = (amount, date = '2026-11-05') =>
    tx({
        id: 'PAY',
        date,
        type: 'transfer',
        source: 'Thẻ Ngân Hàng',
        targetSource: 'Spaylater',
        category: 'Chuyển tiền nội bộ',
        amount,
    });
const setup = (rows, now = NOW, sources = SOURCES) => ({
    now,
    seed: { fm_sources: JSON.stringify(sources), fm_transactions: JSON.stringify(rows) },
});
const toasts = (page) => page.locator('#toast-container .toast');
const dueLine = (page) =>
    page
        .locator('.source-card', { has: page.locator('[data-source="Spaylater"]') })
        .locator('.card-due');

async function openSources(page) {
    await page.evaluate(() => switchTab('sources'));
}

test.describe('Hạn thanh toán thẻ', () => {
    test('còn 3 ngày: báo khi mở app, kèm số phải trả của kỳ sao kê và ngày hạn', async ({
        app,
    }) => {
        const { page } = await app(setup(OCTOBER));

        await expect(toasts(page)).toHaveCount(1);
        await expect(toasts(page).first()).toContainText('Sắp đến hạn trả thẻ');
        await expect(toasts(page).first()).toContainText(
            'Spaylater: cần trả 1.000.000 đ (hạn 10/11/2026, còn 3 ngày)',
        );
        await expect(toasts(page).first()).toHaveClass(/toast-warning/);
    });

    test('chỉ báo một lần mỗi ngày trên thiết bị', async ({ app }) => {
        const { page } = await app(setup(OCTOBER));

        await expect(toasts(page)).toHaveCount(1);
        await page.reload();
        await page.waitForTimeout(300);
        await expect(toasts(page)).toHaveCount(0);

        // Another day: the reminder is due again.
        await page.evaluate(() => localStorage.setItem('fm_card_due_reminder_day', '2026-11-06'));
        await page.reload();
        await expect(toasts(page)).toHaveCount(1);
    });

    test('quay lại tab sau một ngày khác thì nhắc lại', async ({ app }) => {
        const { page } = await app(setup(OCTOBER));

        await expect(toasts(page)).toHaveCount(1);
        await toasts(page).first().click();
        await expect(toasts(page)).toHaveCount(0);

        await page.evaluate(() => {
            localStorage.setItem('fm_card_due_reminder_day', '2026-11-06');
            document.dispatchEvent(new Event('visibilitychange'));
        });

        await expect(toasts(page)).toHaveCount(1);
    });

    test('thẻ nguồn tiền có dòng "Cần trả" tô đỏ kèm biểu tượng khi sắp đến hạn', async ({
        app,
    }) => {
        const { page } = await app(setup(OCTOBER));

        await openSources(page);
        await expect(dueLine(page)).toHaveText('Cần trả 1.000.000 đ trước 10/11/2026 (còn 3 ngày)');
        await expect(dueLine(page)).toHaveClass(/source-warn/);
        await expect(dueLine(page).locator('i.fa-triangle-exclamation')).toHaveCount(1);

        const results = await scanA11y(page, '#tab-sources');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    test('đã trả một phần sau kỳ chốt thì chỉ còn phần chưa trả; trả đủ thì hết nhắc', async ({
        app,
    }) => {
        const part = await app(setup([...OCTOBER, payment(400000)]));

        await openSources(part.page);
        await expect(dueLine(part.page)).toContainText('Cần trả 600.000 đ trước 10/11/2026');
        await expect(toasts(part.page).first()).toContainText('cần trả 600.000 đ');

        const full = await app(setup([...OCTOBER, payment(1000000)]));

        await openSources(full.page);
        await expect(dueLine(full.page)).toHaveCount(0);
        await expect(toasts(full.page).filter({ hasText: 'trả thẻ' })).toHaveCount(0);
    });

    test('còn xa hạn: có dòng nhưng không tô đỏ và không báo', async ({ app }) => {
        const { page } = await app(setup(OCTOBER, '2026-11-01T03:00:00Z')); // 9 days left

        await openSources(page);
        await expect(dueLine(page)).toContainText('(còn 9 ngày)');
        await expect(dueLine(page)).not.toHaveClass(/source-warn/);
        await expect(dueLine(page).locator('i')).toHaveCount(0);
        await expect(toasts(page).filter({ hasText: 'trả thẻ' })).toHaveCount(0);
    });

    test('quá hạn mà chưa trả: báo mức đỏ, ghi số ngày quá hạn, không nhảy sang tháng sau', async ({
        app,
    }) => {
        const { page } = await app(setup(OCTOBER, '2026-11-12T03:00:00Z'));

        await expect(toasts(page).first()).toContainText('Có thẻ đã quá hạn thanh toán');
        await expect(toasts(page).first()).toContainText(
            'Spaylater: cần trả 1.000.000 đ (quá hạn 2 ngày)',
        );
        await expect(toasts(page).first()).toHaveClass(/toast-danger/);

        await openSources(page);
        await expect(dueLine(page)).toContainText('trước 10/11/2026 (quá hạn 2 ngày)');
        await expect(dueLine(page)).toHaveClass(/source-warn/);
    });

    test('sau ngày chốt sao kê kế tiếp, khoản cũ gộp vào kỳ mới và hạn dời sang tháng sau', async ({
        app,
    }) => {
        const { page } = await app(setup(OCTOBER, '2026-11-25T03:00:00Z'));

        await openSources(page);
        await expect(dueLine(page)).toContainText('Cần trả 1.464.140 đ trước 10/12/2026');
        await expect(dueLine(page)).not.toHaveClass(/source-warn/);
    });

    test('thẻ không có ngày hạn, thẻ lưu trữ và nguồn không phải thẻ thì không có dòng và không báo', async ({
        app,
    }) => {
        const noDue = await app(setup(OCTOBER, NOW, [{ ...SPAY, dueDay: null }]));

        await openSources(noDue.page);
        await expect(dueLine(noDue.page)).toHaveCount(0);
        await expect(toasts(noDue.page).filter({ hasText: 'trả thẻ' })).toHaveCount(0);

        const archived = await app(setup(OCTOBER, NOW, [{ ...SPAY, archived: true }]));

        await expect(toasts(archived.page).filter({ hasText: 'trả thẻ' })).toHaveCount(0);

        const bank = await app(
            setup(OCTOBER, NOW, [{ name: 'Spaylater', kind: 'bank', dueDay: 10 }]),
        );

        await expect(toasts(bank.page).filter({ hasText: 'trả thẻ' })).toHaveCount(0);
    });

    test('số dư ban đầu dương bù khoản chi thì không nợ, không báo', async ({ app }) => {
        const { page } = await app({
            ...setup(OCTOBER),
            seed: {
                ...setup(OCTOBER).seed,
                fm_initial_balances: JSON.stringify({ Spaylater: 5000000 }),
            },
        });

        await expect(toasts(page).filter({ hasText: 'trả thẻ' })).toHaveCount(0);
    });

    test('hai thẻ cùng sắp đến hạn: một thông báo, thẻ gấp nhất đứng trước', async ({ app }) => {
        const { page } = await app(
            setup(
                [
                    ...OCTOBER,
                    tx({ id: 'C', date: '2026-10-05', source: 'Thẻ Tín Dụng', amount: 250000 }),
                ],
                NOW,
                [...SOURCES, { name: 'Thẻ Tín Dụng', kind: 'credit', dueDay: 9 }],
            ),
        );

        await expect(toasts(page).filter({ hasText: 'trả thẻ' })).toHaveCount(1);

        const text = await toasts(page).first().innerText();

        expect(text.indexOf('Thẻ Tín Dụng: cần trả 250.000 đ')).toBeGreaterThan(-1);
        expect(text.indexOf('Thẻ Tín Dụng')).toBeLessThan(text.indexOf('Spaylater'));
    });
});

test.describe('Hạn thanh toán thẻ và đồng bộ', () => {
    test('đợi đọc xong Sheet rồi mới nhắc: khoản đã trả ở máy khác thì không nhắc', async ({
        app,
    }) => {
        const stamp = '2026-11-06T01:00:00.000Z';
        const remote = [...OCTOBER, payment(1000000)].map((row) => ({ ...row, updatedAt: stamp }));
        // Written through the protocol (not seeded as a grid) so the transfer keeps its targetSource.
        const server = newServer('v2');

        server.post({ action: 'sync', upserts: remote });

        const { page } = await app({
            server,
            now: NOW,
            seed: syncedSeed(
                OCTOBER.map((row) => ({ ...row, updatedAt: stamp })),
                { fm_sources: JSON.stringify(SOURCES) },
            ),
        });

        await expect(page.locator('#sync-status')).toContainText('Đã lưu');
        // The payment made on the other device arrived with the Sheet, before the reminder ran.
        expect(
            await page.evaluate(() => transactions.find((t) => t.id === 'PAY')?.targetSource),
        ).toBe('Spaylater');
        await expect(toasts(page).filter({ hasText: 'trả thẻ' })).toHaveCount(0);
    });

    test('Sheet có đủ dữ liệu mà chưa trả thì vẫn nhắc sau khi đọc xong', async ({ app }) => {
        const stamp = '2026-11-06T01:00:00.000Z';
        const rows = OCTOBER.map((row) => ({ ...row, updatedAt: stamp }));
        const server = newServer('v2', { rows });
        const { page } = await app({
            server,
            now: NOW,
            seed: syncedSeed(rows, { fm_sources: JSON.stringify(SOURCES) }),
        });

        await expect(toasts(page).filter({ hasText: 'cần trả 1.000.000 đ' })).toHaveCount(1);
    });

    test('mất mạng thì vẫn nhắc theo dữ liệu trên máy', async ({ app }) => {
        const stamp = '2026-11-06T01:00:00.000Z';
        const rows = OCTOBER.map((row) => ({ ...row, updatedAt: stamp }));
        const server = newServer('v2', { rows });
        const { page } = await app({
            server,
            now: NOW,
            getFails: true,
            seed: syncedSeed(rows, { fm_sources: JSON.stringify(SOURCES) }),
        });

        await expect(toasts(page).filter({ hasText: 'cần trả 1.000.000 đ' })).toHaveCount(1);
    });
});
