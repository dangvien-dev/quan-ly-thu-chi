// Money sources: add / edit / rename / archive / delete, and how they feed the form and totals.

const { test, expect, tx, goTab, wait } = require('./helpers');

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
