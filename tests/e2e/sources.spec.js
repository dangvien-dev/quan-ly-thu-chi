// Money sources: add / edit / rename / archive / delete, and how they feed the form and totals.

const { test, expect, tx, goTab, wait, scanA11y } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z'; // 28/10/2026 10:00 GMT+7
const card = (page, name) => page.locator('#sources-grid .card', { hasText: name });

async function fillSource(page, { name, kind, limit, statementDay, dueDay, balance }) {
    await page.fill('#srcName', name);
    if (kind) await page.selectOption('#srcKind', kind);
    if (limit !== undefined) await page.fill('#srcCreditLimit', String(limit));
    if (statementDay !== undefined) await page.fill('#srcStatementDay', String(statementDay));
    if (dueDay !== undefined) await page.fill('#srcDueDay', String(dueDay));
    if (balance !== undefined) await page.fill('#srcInitialBalance', String(balance));
    await page.click('#sourceForm button[type=submit]');
}

test.describe('Nguồn tiền', () => {
    test('mặc định có 5 nguồn với loại đúng', async ({ app }) => {
        const { page } = await app();

        await goTab(page, 'sources');

        await expect(page.locator('#sources-grid .card')).toHaveCount(5);
        await expect(card(page, 'Tiền Mặt')).toContainText('Tiền mặt');
        await expect(card(page, 'Thẻ Ngân Hàng')).toContainText('Ngân hàng');
        await expect(card(page, 'Spaylater')).toContainText('Thẻ tín dụng / Trả sau');
        await expect(card(page, 'Nợ Công Ty')).toContainText('Khoản nợ');
    });

    test('thêm ví Momo: có trong lưới, trong form giao dịch và còn sau khi tải lại', async ({
        app,
    }) => {
        const { page } = await app();

        await goTab(page, 'sources');
        await page.click('button:has-text("Thêm Nguồn Tiền")');
        await fillSource(page, { name: 'Momo', kind: 'ewallet', balance: 500000 });

        await expect(card(page, 'Momo').locator('.card-value')).toHaveText('500.000 đ');

        await page.click('header .btn');
        expect(await page.$$eval('#txSource option', (o) => o.map((x) => x.value))).toContain(
            'Momo',
        );
        await page.click('#btnTypeTransfer');
        expect(await page.$$eval('#txTargetSource option', (o) => o.map((x) => x.value))).toContain(
            'Momo',
        );

        await page.reload();
        await goTab(page, 'sources');
        await expect(card(page, 'Momo')).toHaveCount(1);
    });

    test('thẻ tín dụng hiện hạn mức, số dư khả dụng, ngày sao kê và hạn thanh toán', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW });

        await goTab(page, 'sources');
        await page.click('button:has-text("Thêm Nguồn Tiền")');
        await fillSource(page, {
            name: 'Visa VCB',
            kind: 'credit',
            limit: 20000000,
            statementDay: 31,
            dueDay: 15,
            balance: -5000000,
        });

        const visa = card(page, 'Visa VCB');

        await expect(visa).toContainText('Hạn mức 20.000.000 đ · Khả dụng 15.000.000 đ');
        await expect(visa).toContainText('Chốt sao kê ngày 31 (còn 3 ngày)');
        await expect(visa).toContainText('Hạn thanh toán ngày 15 (còn 18 ngày)');
        await expect(page.locator('#lbl-total-debt')).toHaveText('5.000.000 đ');
    });

    test('ô hạn mức chỉ hiện với thẻ tín dụng', async ({ app }) => {
        const { page } = await app();

        await goTab(page, 'sources');
        await page.click('button:has-text("Thêm Nguồn Tiền")');

        await expect(page.locator('#srcCreditFields')).toBeHidden();
        await page.selectOption('#srcKind', 'credit');
        await expect(page.locator('#srcCreditFields')).toBeVisible();
    });

    test('từ chối tên rỗng hoặc trùng (không phân biệt hoa thường)', async ({ app }) => {
        const { page, state } = await app();

        await goTab(page, 'sources');
        await page.click('button:has-text("Thêm Nguồn Tiền")');
        await fillSource(page, { name: 'tiền mặt', kind: 'cash' });

        expect(state.alerts.at(-1)).toContain('đã tồn tại');
        expect(await page.evaluate(() => sources.length)).toBe(5);
    });

    test('đổi tên nguồn cập nhật giao dịch, số dư ban đầu và form', async ({ app }) => {
        const transfer = tx({
            id: 'TX_2',
            type: 'transfer',
            source: 'Thẻ Ngân Hàng',
            targetSource: 'Tiền Mặt',
            category: 'Chuyển tiền nội bộ',
            amount: 100000,
        });
        const { page, state } = await app({
            seed: {
                fm_transactions: JSON.stringify([tx({ id: 'TX_1', amount: 20000 }), transfer]),
                fm_initial_balances: JSON.stringify({ 'Tiền Mặt': 300000 }),
            },
        });

        await goTab(page, 'sources');
        await card(page, 'Tiền Mặt').locator('[data-action=edit-source]').click();
        await page.fill('#srcName', 'Ví tiền');
        await page.click('#sourceForm button[type=submit]');

        expect(state.confirms[0]).toContain('2 giao dịch');
        await expect(card(page, 'Ví tiền').locator('.card-value')).toHaveText('380.000 đ');
        await expect(
            page.locator('#sources-grid .card-title', { hasText: /^Tiền Mặt$/ }),
        ).toHaveCount(0);

        const data = await page.evaluate(() => ({
            sources: transactions.map((t) => [t.source, t.targetSource]),
            balances: initialBalances,
            options: [...document.querySelectorAll('#txSource option')].map((o) => o.value),
        }));

        expect(data.sources).toEqual(
            expect.arrayContaining([
                ['Ví tiền', null],
                ['Thẻ Ngân Hàng', 'Ví tiền'],
            ]),
        );
        expect(data.balances).toEqual({ 'Ví tiền': 300000 });
        expect(data.options).toContain('Ví tiền');
        expect(data.options).not.toContain('Tiền Mặt');
    });

    test('không xóa được nguồn đang có giao dịch; xóa được nguồn chưa dùng', async ({ app }) => {
        const { page, state } = await app({ seed: { fm_transactions: JSON.stringify([tx()]) } });

        await goTab(page, 'sources');
        await card(page, 'Tiền Mặt').locator('[data-action=delete-source]').click();

        expect(state.alerts.at(-1)).toContain('Không thể xóa');
        await expect(card(page, 'Tiền Mặt')).toHaveCount(1);

        await card(page, 'Nợ Công Ty').locator('[data-action=delete-source]').click();
        await expect(card(page, 'Nợ Công Ty')).toHaveCount(0);
    });

    test('lưu trữ cần số dư 0; nguồn lưu trữ ẩn khỏi form và khôi phục được', async ({ app }) => {
        const { page, state } = await app({
            seed: { fm_transactions: JSON.stringify([tx({ amount: 50000, source: 'Tiền Mặt' })]) },
        });

        await goTab(page, 'sources');
        await card(page, 'Tiền Mặt').locator('[data-action=archive-source]').click();
        expect(state.alerts.at(-1)).toContain('còn số dư');

        await card(page, 'Spaylater').locator('[data-action=archive-source]').click();

        await expect(page.locator('#sources-grid .card', { hasText: 'Spaylater' })).toHaveCount(0);
        await expect(page.locator('#sources-archived .card', { hasText: 'Spaylater' })).toHaveCount(
            1,
        );
        expect(await page.$$eval('#txSource option', (o) => o.map((x) => x.value))).not.toContain(
            'Spaylater',
        );

        await page
            .locator('#sources-archived .card', { hasText: 'Spaylater' })
            .locator('[data-action=restore-source]')
            .click();
        await expect(card(page, 'Spaylater')).toHaveCount(1);
        await expect(page.locator('#sources-archived-section')).toBeHidden();
    });

    test('sửa giao dịch dùng nguồn đã lưu trữ vẫn giữ nguồn đó', async ({ app }) => {
        const { page } = await app({
            seed: {
                fm_transactions: JSON.stringify([tx({ source: 'Spaylater', amount: 70000 })]),
                fm_sources: JSON.stringify([
                    { name: 'Tiền Mặt', kind: 'cash' },
                    { name: 'Spaylater', kind: 'credit', archived: true },
                ]),
            },
        });

        await goTab(page, 'transactions');
        await page.click('#transaction-table-body button[data-action=edit]');

        await expect(page.locator('#txSource')).toHaveValue('Spaylater');
    });

    test('nguồn lạ từ Sheet được tự thêm vào và tính số dư', async ({ app }) => {
        const { page } = await app({
            remote: [
                tx({
                    id: 'TX_9',
                    type: 'income',
                    source: 'Ví Zalo',
                    category: 'Lương / Thưởng',
                    amount: 90000,
                }),
            ],
        });

        await goTab(page, 'sources');

        await expect(card(page, 'Ví Zalo').locator('.card-value')).toHaveText('90.000 đ');
        await expect(card(page, 'Ví Zalo')).toContainText('Khác');
    });

    test('đổi loại sang thẻ tín dụng thì số âm tính vào dư nợ', async ({ app }) => {
        const { page } = await app({
            seed: {
                fm_transactions: JSON.stringify([tx({ source: 'Thẻ Ngân Hàng', amount: 400000 })]),
            },
        });

        await expect(page.locator('#lbl-total-debt')).toHaveText('0 đ');
        await goTab(page, 'sources');
        await card(page, 'Thẻ Ngân Hàng').locator('[data-action=edit-source]').click();
        await page.selectOption('#srcKind', 'credit');
        await page.click('#sourceForm button[type=submit]');
        await wait(100);

        await expect(page.locator('#lbl-total-debt')).toHaveText('400.000 đ');
    });

    test('sao lưu và khôi phục giữ cả danh sách nguồn tiền', async ({ app }) => {
        const { page } = await app();

        await goTab(page, 'sources');
        await page.click('button:has-text("Thêm Nguồn Tiền")');
        await fillSource(page, { name: 'Momo', kind: 'ewallet' });

        const backup = await page.evaluate(() => ({
            format: 'finmanager-backup',
            version: 1,
            exportedAt: 'x',
            data: {
                transactions: [],
                categories: categories,
                initialBalances: initialBalances,
                sources: sources,
                scriptUrl: '',
            },
        }));
        const { page: other } = await app();

        await goTab(other, 'settings');
        await other.setInputFiles('input[type=file]', {
            name: 'b.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(backup)),
        });
        await wait(300);
        await goTab(other, 'sources');

        await expect(card(other, 'Momo')).toHaveCount(1);
    });
});

test.describe('Số dư ban đầu của nguồn nợ', () => {
    const spay = [
        tx({ id: 'S1', date: '2026-10-30', source: 'Spaylater', amount: 75000 }),
        tx({ id: 'S2', date: '2026-10-29', source: 'Spaylater', amount: 164640 }),
        tx({ id: 'S3', date: '2026-10-26', source: 'Spaylater', amount: 224500 }),
    ];
    const seed = (balances) => ({
        fm_transactions: JSON.stringify(spay),
        fm_initial_balances: JSON.stringify(balances),
    });

    test('chi qua Spaylater (số dư ban đầu 0) thì dư nợ bằng đúng tổng đã chi', async ({ app }) => {
        const { page } = await app({ now: NOW, seed: seed({}) });

        await expect(page.locator('#lbl-total-debt')).toHaveText('464.140 đ');

        await goTab(page, 'sources');

        await expect(card(page, 'Spaylater')).not.toContainText('Số dư ban đầu');
    });

    test('số dư ban đầu dương bù vào khoản chi nên dư nợ 0, và thẻ nguồn nói rõ lý do', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW, seed: seed({ Spaylater: 500000 }) });

        await expect(page.locator('#lbl-total-debt')).toHaveText('0 đ');

        await goTab(page, 'sources');

        const spaylater = card(page, 'Spaylater');

        await expect(spaylater).toContainText('35.860 đ');
        await expect(spaylater).toContainText('Số dư ban đầu 500.000 đ');
        await expect(spaylater).toContainText('nên chưa tính là dư nợ');

        const results = await scanA11y(page, '#tab-sources');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    test('số dư ban đầu âm (đã nợ sẵn) được hiện nhưng không cảnh báo, và tính vào dư nợ', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW, seed: seed({ Spaylater: -200000 }) });

        await expect(page.locator('#lbl-total-debt')).toHaveText('664.140 đ');

        await goTab(page, 'sources');

        await expect(card(page, 'Spaylater')).toContainText('Số dư ban đầu -200.000 đ');
        await expect(card(page, 'Spaylater')).not.toContainText('chưa tính là dư nợ');
    });

    test('nguồn thường có số dư ban đầu dương thì chỉ hiện dòng số dư, không cảnh báo', async ({
        app,
    }) => {
        const { page } = await app({ now: NOW, seed: seed({ 'Tiền Mặt': 1000000 }) });

        await goTab(page, 'sources');

        await expect(card(page, 'Tiền Mặt')).toContainText('Số dư ban đầu 1.000.000 đ');
        await expect(card(page, 'Tiền Mặt')).not.toContainText('chưa tính là dư nợ');
    });

    test('hộp nhập số dư: nguồn nợ có gợi ý "nhập 0 hoặc số âm", nguồn thường thì không', async ({
        app,
    }) => {
        const { page, state } = await app({ now: NOW, promptValue: '0' });

        await goTab(page, 'sources');
        await card(page, 'Spaylater').locator('button[data-action=edit-balance]').click();
        await card(page, 'Tiền Mặt').locator('button[data-action=edit-balance]').click();

        expect(state.confirms).toHaveLength(2);
        expect(state.confirms[0]).toContain('Nhập số dư ban đầu cho [Spaylater]');
        expect(state.confirms[0]).toContain('nhập 0 nếu chưa nợ, số âm nếu đã nợ sẵn');
        expect(state.confirms[1]).toBe('Nhập số dư ban đầu cho [Tiền Mặt]:');
    });

    test('đặt lại số dư ban đầu về 0 thì dư nợ hiện đúng và dòng cảnh báo biến mất', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            promptValue: '0',
            seed: seed({ Spaylater: 500000 }),
        });

        await goTab(page, 'sources');
        await card(page, 'Spaylater').locator('button[data-action=edit-balance]').click();

        await expect(card(page, 'Spaylater')).not.toContainText('Số dư ban đầu');
        await expect(card(page, 'Spaylater')).toContainText('-464.140 đ');
        await expect(page.locator('#lbl-total-debt')).toHaveText('464.140 đ');
    });
});

test.describe('Khớp số dư thực tế', () => {
    const spay = [
        tx({ id: 'S1', date: '2026-10-30', source: 'Spaylater', amount: 75000 }),
        tx({ id: 'S2', date: '2026-10-29', source: 'Spaylater', amount: 164640 }),
        tx({ id: 'S3', date: '2026-10-26', source: 'Spaylater', amount: 224500 }),
    ];
    const sourcesWith = (spaylater) =>
        JSON.stringify([
            { name: 'Tiền Mặt', kind: 'cash' },
            { name: 'Thẻ Ngân Hàng', kind: 'bank' },
            { name: 'Thẻ Tín Dụng', kind: 'credit' },
            { name: 'Nợ Công Ty', kind: 'debt' },
            { name: 'Spaylater', kind: 'credit', ...spaylater },
        ]);
    const matchButton = (page, name) =>
        card(page, name).locator('button[data-action=match-balance]');
    const opening = (page, name) => page.evaluate((key) => initialBalances[key], name);

    test('SPayLater hạn mức 30 triệu, khả dụng 28.656.419 → nợ 1.343.581, số dư ban đầu tự tính', async ({
        app,
    }) => {
        const { page, state } = await app({
            now: NOW,
            promptValue: '28.656.419',
            seed: {
                fm_transactions: JSON.stringify(spay),
                // The wrong value that made the debt read 0: the available amount typed as a balance.
                fm_initial_balances: JSON.stringify({ Spaylater: 28656419 }),
                fm_sources: sourcesWith({ creditLimit: 30000000, statementDay: 24, dueDay: 10 }),
            },
        });

        await expect(page.locator('#lbl-total-debt')).toHaveText('0 đ');

        await goTab(page, 'sources');
        await matchButton(page, 'Spaylater').click();

        expect(state.confirms).toHaveLength(1);
        expect(state.confirms[0]).toContain('KHẢ DỤNG');
        expect(state.confirms[0]).toContain('hạn mức 30.000.000 đ');
        await expect(card(page, 'Spaylater')).toContainText('-1.343.581 đ');
        await expect(card(page, 'Spaylater')).toContainText(
            'Hạn mức 30.000.000 đ · Khả dụng 28.656.419 đ',
        );
        await expect(card(page, 'Spaylater')).toContainText('Số dư ban đầu -879.441 đ');
        await expect(card(page, 'Spaylater')).not.toContainText('chưa tính là dư nợ');
        await expect(page.locator('#lbl-total-debt')).toHaveText('1.343.581 đ');
        await expect(page.locator('#toast-container')).toContainText('Đã khớp [Spaylater]');
        expect(await opening(page, 'Spaylater')).toBe(-879441);

        await page.reload();

        expect(await opening(page, 'Spaylater')).toBe(-879441);
    });

    test('khớp lại đúng số đang hiện thì số dư ban đầu không đổi', async ({ app }) => {
        const { page } = await app({
            now: NOW,
            promptValue: '28.656.419',
            seed: {
                fm_transactions: JSON.stringify(spay),
                fm_initial_balances: JSON.stringify({ Spaylater: -879441 }),
                fm_sources: sourcesWith({ creditLimit: 30000000 }),
            },
        });

        await goTab(page, 'sources');
        await matchButton(page, 'Spaylater').click();

        expect(await opening(page, 'Spaylater')).toBe(-879441);
        await expect(card(page, 'Spaylater')).toContainText('-1.343.581 đ');
    });

    test('nguồn thường: nhập số dư thực tế, số dư ban đầu bù phần chênh với các giao dịch', async ({
        app,
    }) => {
        const { page, state } = await app({
            now: NOW,
            promptValue: '1.200.000',
            seed: {
                fm_transactions: JSON.stringify([
                    tx({ id: 'I1', type: 'income', category: 'Lương / Thưởng', amount: 2000000 }),
                    tx({ id: 'E1', amount: 500000 }),
                ]),
            },
        });

        await goTab(page, 'sources');
        await matchButton(page, 'Tiền Mặt').click();

        expect(state.confirms[0]).toContain('số dư thực tế hiện tại của [Tiền Mặt]');
        expect(state.confirms[0]).toContain('App đang tính: 1.500.000 đ');
        await expect(card(page, 'Tiền Mặt')).toContainText('1.200.000 đ');
        await expect(card(page, 'Tiền Mặt')).toContainText('Số dư ban đầu -300.000 đ');
        // A plain source is never a debt, so no warning appears.
        await expect(card(page, 'Tiền Mặt')).not.toContainText('chưa tính là dư nợ');
    });

    test('thẻ tín dụng chưa đặt hạn mức: hỏi số dư (âm = đang nợ), không hỏi khả dụng', async ({
        app,
    }) => {
        const { page, state } = await app({
            now: NOW,
            promptValue: '-1.000.000',
            seed: { fm_transactions: JSON.stringify(spay) },
        });

        await goTab(page, 'sources');
        await matchButton(page, 'Spaylater').click();

        expect(state.confirms[0]).not.toContain('KHẢ DỤNG');
        expect(state.confirms[0]).toContain('đang nợ thì nhập số âm');
        await expect(card(page, 'Spaylater')).toContainText('-1.000.000 đ');
        await expect(page.locator('#lbl-total-debt')).toHaveText('1.000.000 đ');
        expect(await opening(page, 'Spaylater')).toBe(-535860);
    });

    test('nhập sai thì báo lỗi và giữ nguyên số dư ban đầu', async ({ app }) => {
        const { page, state } = await app({
            now: NOW,
            promptValue: 'abc',
            seed: {
                fm_transactions: JSON.stringify(spay),
                fm_initial_balances: JSON.stringify({ Spaylater: -100 }),
            },
        });

        await goTab(page, 'sources');
        await matchButton(page, 'Spaylater').click();

        expect(state.alerts).toEqual(['Số tiền không hợp lệ!']);
        expect(await opening(page, 'Spaylater')).toBe(-100);
    });

    test('bấm Hủy ở hộp nhập thì không đổi gì và không báo lỗi', async ({ app }) => {
        const { page, state } = await app({
            now: NOW,
            seed: {
                fm_transactions: JSON.stringify(spay),
                fm_initial_balances: JSON.stringify({ Spaylater: -100 }),
            },
        });

        await page.evaluate(() => {
            window.prompt = () => null;
        });
        await goTab(page, 'sources');
        await matchButton(page, 'Spaylater').click();

        expect(state.alerts).toEqual([]);
        expect(await opening(page, 'Spaylater')).toBe(-100);
    });

    test('nguồn đã lưu trữ không có nút khớp số dư; nút có tên đọc được và không vi phạm trợ năng', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            seed: {
                fm_sources: JSON.stringify([
                    { name: 'Tiền Mặt', kind: 'cash' },
                    { name: 'Ví cũ', kind: 'ewallet', archived: true },
                ]),
            },
        });

        await goTab(page, 'sources');

        await expect(page.locator('#sources-grid button[data-action=match-balance]')).toHaveCount(
            1,
        );
        await expect(
            page.locator('#sources-archived button[data-action=match-balance]'),
        ).toHaveCount(0);
        await expect(matchButton(page, 'Tiền Mặt')).toHaveAttribute(
            'aria-label',
            'Khớp số dư thực tế của Tiền Mặt',
        );

        const results = await scanA11y(page, '#tab-sources');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
});
