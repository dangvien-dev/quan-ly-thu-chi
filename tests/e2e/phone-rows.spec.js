// Transactions on a phone: one line each, tap a line to open its details and edit / delete buttons.

const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect, tx } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z';
const phone = { width: 390, height: 844 };
const LONG_NOTE =
    'Mua đồ dùng văn phòng phẩm cho cả công ty gồm giấy in, mực in, bút, kẹp tài liệu, băng keo';

const rows = [
    tx({ id: 'TX_1', date: '2026-10-27', note: 'Cafe sáng', amount: 20000 }),
    tx({
        id: 'TX_2',
        date: '2026-10-20',
        type: 'income',
        category: 'Lương / Thưởng',
        note: '',
        amount: 15000000,
    }),
    tx({
        id: 'TX_3',
        date: '2026-10-21',
        type: 'transfer',
        source: 'Thẻ Ngân Hàng',
        targetSource: 'Tiền Mặt',
        category: 'Chuyển tiền nội bộ',
        note: '',
        amount: 500000,
    }),
    tx({ id: 'TX_4', date: '2026-10-19', note: LONG_NOTE, amount: 1234000 }),
];

async function openPhone(app, extra = {}) {
    const result = await app({
        now: NOW,
        viewport: phone,
        seed: { fm_transactions: JSON.stringify(rows) },
        ...extra,
    });

    await result.page.evaluate(() => switchTab('transactions'));

    return result;
}

const row = (page, id) => page.locator(`#transaction-table-body tr[data-id="${id}"]`);

test.describe('Sổ giao dịch trên điện thoại: mỗi giao dịch một dòng', () => {
    test('mỗi giao dịch cao đúng một dòng và không tràn ngang', async ({ app }) => {
        const { page } = await openPhone(app);

        for (const { id } of rows) {
            const box = await row(page, id).boundingBox();

            // A card of five labelled lines would be 150px+; one line stays compact.
            expect(box.height, id).toBeLessThan(60);
            expect(box.x + box.width, id).toBeLessThanOrEqual(phone.width);
        }

        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);
    });

    test('dòng gồm ngày dd/mm/yyyy, ghi chú và số tiền; chi tiết ẩn cho tới khi chạm', async ({
        app,
    }) => {
        const { page } = await openPhone(app);
        const line = row(page, 'TX_1');

        await expect(line.locator('td[data-label="Ngày"]')).toHaveText('27/10/2026');
        await expect(line.locator('.row-title-text')).toHaveText('Cafe sáng');
        await expect(line.locator('td[data-label="Số tiền"]')).toHaveText('-20.000 đ');
        await expect(line.locator('td[data-label="Nguồn tiền"]')).toBeHidden();
        await expect(line.locator('td[data-label="Danh mục"]')).toBeHidden();
        await expect(line.locator('[data-action=edit]')).toBeHidden();
        await expect(line.locator('[data-action=delete]')).toBeHidden();
    });

    test('tiêu đề: có ghi chú thì dùng ghi chú, không có thì dùng danh mục, chuyển tiền thì nguồn ➔ nguồn nhận', async ({
        app,
    }) => {
        const { page } = await openPhone(app);

        await expect(row(page, 'TX_1').locator('.row-title-text')).toHaveText('Cafe sáng');
        await expect(row(page, 'TX_2').locator('.row-title-text')).toHaveText('Lương / Thưởng');
        await expect(row(page, 'TX_3').locator('.row-title-text')).toHaveText(
            'Thẻ Ngân Hàng ➔ Tiền Mặt',
        );
    });

    test('ghi chú quá dài bị cắt bằng dấu ba chấm, dòng vẫn cao một dòng', async ({ app }) => {
        const { page } = await openPhone(app);
        const title = row(page, 'TX_4').locator('.row-title-text');
        const sizes = await title.evaluate((element) => ({
            clipped: element.scrollWidth > element.clientWidth,
            overflow: getComputedStyle(element).textOverflow,
        }));

        expect(sizes).toEqual({ clipped: true, overflow: 'ellipsis' });
        expect((await row(page, 'TX_4').boundingBox()).height).toBeLessThan(60);
        // The full text stays available once the row is opened.
        await row(page, 'TX_4').locator('.row-toggle').click();
        await expect(row(page, 'TX_4').locator('td[data-label="Mô tả"]')).toHaveText(LONG_NOTE);
    });

    test('chạm vào dòng mở chi tiết và nút sửa / xóa, chạm lần nữa thì thu lại', async ({
        app,
    }) => {
        const { page } = await openPhone(app);
        const line = row(page, 'TX_1');
        const toggle = line.locator('.row-toggle');

        await expect(toggle).toHaveAttribute('aria-expanded', 'false');

        // Tapping the amount (not the title button) also opens it.
        await line.locator('td[data-label="Số tiền"]').click();

        await expect(line).toHaveClass(/expanded/);
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(line.locator('td[data-label="Nguồn tiền"]')).toBeVisible();
        await expect(line.locator('td[data-label="Nguồn tiền"]')).toContainText('Tiền Mặt');
        await expect(line.locator('td[data-label="Danh mục"]')).toContainText('Ăn uống');
        await expect(line.locator('td[data-label="Loại"]')).toContainText('Chi');
        await expect(line.locator('[data-action=edit]')).toBeVisible();
        await expect(line.locator('[data-action=delete]')).toBeVisible();

        await toggle.click();

        await expect(line).not.toHaveClass(/expanded/);
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(line.locator('[data-action=edit]')).toBeHidden();
    });

    test('mở một dòng không mở các dòng khác', async ({ app }) => {
        const { page } = await openPhone(app);

        await row(page, 'TX_2').locator('.row-toggle').click();

        await expect(row(page, 'TX_2')).toHaveClass(/expanded/);
        await expect(row(page, 'TX_1')).not.toHaveClass(/expanded/);
        await expect(row(page, 'TX_3')).not.toHaveClass(/expanded/);
    });

    test('nút tiêu đề dùng được bằng bàn phím (Enter mở, Enter thu lại)', async ({ app }) => {
        const { page } = await openPhone(app);
        const toggle = row(page, 'TX_1').locator('.row-toggle');

        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(row(page, 'TX_1')).toHaveClass(/expanded/);

        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(row(page, 'TX_1')).not.toHaveClass(/expanded/);
    });

    test('sửa từ dòng đã mở: hộp thoại có sẵn số tiền đã định dạng, lưu xong dòng cập nhật', async ({
        app,
    }) => {
        const { page } = await openPhone(app);
        const line = row(page, 'TX_1');

        await line.locator('.row-toggle').click();
        await line.locator('[data-action=edit]').click();

        await expect(page.locator('#transactionModal')).toHaveClass(/open/);
        await expect(page.locator('#txAmount')).toHaveValue('20.000');

        await page.fill('#txAmount', '');
        await page.locator('#txAmount').pressSequentially('45000');
        await expect(page.locator('#txAmount')).toHaveValue('45.000');
        await page.locator('#transactionForm button[type=submit]').click();

        await expect(page.locator('#transactionModal')).not.toHaveClass(/open/);
        await expect(row(page, 'TX_1').locator('td[data-label="Số tiền"]')).toHaveText('-45.000 đ');
        expect(await page.evaluate(() => transactions.find((t) => t.id === 'TX_1').amount)).toBe(
            45000,
        );
    });

    test('xóa từ dòng đã mở', async ({ app }) => {
        const { page, state } = await openPhone(app);

        await row(page, 'TX_1').locator('.row-toggle').click();
        await row(page, 'TX_1').locator('[data-action=delete]').click();

        await expect(row(page, 'TX_1')).toHaveCount(0);
        await expect(page.locator('#transaction-table-body tr')).toHaveCount(3);
        expect(state.confirms).toEqual(['Xóa giao dịch này?']);
    });

    test('dòng đang mở vẫn mở sau khi danh sách vẽ lại (đổi bộ lọc, xóa bộ lọc)', async ({
        app,
    }) => {
        const { page } = await openPhone(app);

        await row(page, 'TX_2').locator('.row-toggle').click();
        await expect(row(page, 'TX_2')).toHaveClass(/expanded/);

        await page.evaluate(() => {
            document.getElementById('filter-search').value = 'lương';
            handleTransactionFilterChange();
        });
        await expect(page.locator('#transaction-table-body tr')).toHaveCount(1);
        await expect(row(page, 'TX_2')).toHaveClass(/expanded/);
        await expect(row(page, 'TX_2').locator('.row-toggle')).toHaveAttribute(
            'aria-expanded',
            'true',
        );

        await page.fill('#filter-search', '');
        await expect(row(page, 'TX_2')).toHaveClass(/expanded/);
        await expect(row(page, 'TX_1')).not.toHaveClass(/expanded/);
    });

    test('màu viền trái thể hiện loại giao dịch (chi / thu / chuyển)', async ({ app }) => {
        const { page } = await openPhone(app);
        const color = (id) =>
            row(page, id).evaluate((element) => getComputedStyle(element).borderLeftColor);
        const root = await page.evaluate(() => {
            const style = getComputedStyle(document.documentElement);

            return ['--danger', '--success', '--warning'].map((name) =>
                style.getPropertyValue(name).trim(),
            );
        });
        const toRgb = (hex) => {
            const value = hex.replace('#', '');

            return `rgb(${[0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)).join(', ')})`;
        };

        expect(await color('TX_1')).toBe(toRgb(root[0]));
        expect(await color('TX_2')).toBe(toRgb(root[1]));
        expect(await color('TX_3')).toBe(toRgb(root[2]));
    });

    test('danh sách trống hiện thông báo, không phải dòng lưới', async ({ app }) => {
        const { page } = await app({ now: NOW, viewport: phone });

        await page.evaluate(() => switchTab('transactions'));

        const empty = page.locator('#transaction-table-body tr.empty-row');

        await expect(empty).toHaveText('Chưa có giao dịch');
        expect(await empty.evaluate((element) => getComputedStyle(element).display)).toBe('block');
    });

    test('không có vi phạm trợ năng khi có dòng đang mở', async ({ app }) => {
        const { page } = await openPhone(app);

        await row(page, 'TX_1').locator('.row-toggle').click();
        await row(page, 'TX_3').locator('.row-toggle').click();

        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
});

test.describe('Sổ giao dịch trên máy tính giữ nguyên dạng bảng', () => {
    test('có tiêu đề cột, không có cột tiêu đề rút gọn, chạm dòng không mở rộng', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            seed: { fm_transactions: JSON.stringify(rows) },
        });

        await page.evaluate(() => switchTab('transactions'));

        await expect(page.locator('#tab-transactions thead')).toBeVisible();
        await expect(row(page, 'TX_1').locator('td.cell-title')).toBeHidden();
        await expect(row(page, 'TX_1').locator('td[data-label="Nguồn tiền"]')).toBeVisible();
        await expect(row(page, 'TX_1').locator('[data-action=edit]')).toBeVisible();

        await row(page, 'TX_1').locator('td[data-label="Danh mục"]').click();

        await expect(row(page, 'TX_1')).not.toHaveClass(/expanded/);
    });
});
