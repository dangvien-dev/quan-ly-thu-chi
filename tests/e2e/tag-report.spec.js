// Page "Thẻ & Khách Hàng": money per tag (profit or loss of a customer or an order), renaming a tag
// and merging two tags.

const {
    test,
    expect,
    newServer,
    syncedSeed,
    tx,
    goTab,
    scanA11y,
    wait,
    settle,
} = require('./helpers');

const NOW = '2026-10-31T03:00:00Z';
const STAMP = '2026-10-25T01:00:00.000Z';
const rows = [
    tx({ id: 'A', date: '2026-10-20', amount: 120000, note: 'Mua keo #KhachA #dh102' }),
    tx({
        id: 'B',
        date: '2026-10-21',
        type: 'income',
        category: 'Thu nhập khác',
        amount: 500000,
        note: 'Công sửa bàn #khacha',
    }),
    tx({ id: 'C', date: '2026-10-22', amount: 30000, note: 'Cafe sáng' }),
    tx({ id: 'D', date: '2026-10-23', amount: 80000, note: 'Sơn #dh102' }),
    tx({ id: 'E', date: '2026-09-15', amount: 10000, note: 'Vít #khachA' }),
    tx({
        id: 'G',
        date: '2025-05-01',
        type: 'income',
        category: 'Thu nhập khác',
        amount: 1000000,
        note: 'Đơn cũ #cu',
    }),
    tx({
        id: 'T',
        date: '2026-10-24',
        type: 'transfer',
        source: 'Tiền Mặt',
        targetSource: 'Thẻ Ngân Hàng',
        category: 'Chuyển tiền nội bộ',
        amount: 99999,
        note: 'Rút tiền #khachA',
    }),
];
const open = (app, list = rows, extra = {}) =>
    app({ now: NOW, seed: { fm_transactions: JSON.stringify(list) }, ...extra });
const tagRow = (page, tag) => page.locator(`#tag-table-body tr[data-tag="${tag}"]`);
const cell = (page, tag, label) => tagRow(page, tag).locator(`td[data-label="${label}"]`);
const tagNames = (page) =>
    page
        .locator('#tag-table-body tr[data-tag]')
        .evaluateAll((trs) => trs.map((tr) => tr.dataset.tag));
const note = (page, id) => page.evaluate((key) => transactions.find((t) => t.id === key).note, id);
const renameButton = (tag) => `button[data-action="rename-tag"][data-tag="${tag}"]`;

async function rename(page, tag, newName) {
    await page.click(renameButton(tag));
    await page.fill('#tagRenameInput', newName);
    await page.click('#tagRenameSubmit');
}

test.describe('Báo cáo theo thẻ', () => {
    test('mỗi thẻ có số giao dịch, thu, chi, lãi / lỗ và ngày gần nhất; thẻ dùng gần đây nhất đứng trước', async ({
        app,
    }) => {
        const { page } = await open(app);

        await goTab(page, 'tags');
        await expect(page.locator('#page-title')).toHaveText('Thẻ & Khách Hàng');
        await expect(page.locator('#tags-summary')).toHaveText('3 thẻ');
        // KhachA / khacha / khachA are one tag; the transfer only adds to the count.
        expect(await tagNames(page)).toEqual(['KhachA', 'dh102', 'cu']);

        await expect(cell(page, 'KhachA', 'Giao dịch')).toHaveText('4');
        await expect(cell(page, 'KhachA', 'Thu')).toHaveText('500.000 đ');
        await expect(cell(page, 'KhachA', 'Chi')).toHaveText('130.000 đ');
        await expect(cell(page, 'KhachA', 'Lãi / Lỗ')).toHaveText('+370.000 đ Lãi');
        await expect(cell(page, 'KhachA', 'Gần nhất')).toHaveText('24/10/2026');

        await expect(cell(page, 'dh102', 'Giao dịch')).toHaveText('2');
        await expect(cell(page, 'dh102', 'Chi')).toHaveText('200.000 đ');
        await expect(cell(page, 'dh102', 'Lãi / Lỗ')).toHaveText('-200.000 đ Lỗ');
        await expect(cell(page, 'dh102', 'Lãi / Lỗ')).toHaveCSS('color', 'rgb(220, 38, 38)');
    });

    test('chọn tháng này / năm nay / mọi thời gian thì bảng đổi theo', async ({ app }) => {
        const { page } = await open(app);

        await goTab(page, 'tags');
        await page.selectOption('#tags-period', 'month');
        expect(await tagNames(page)).toEqual(['KhachA', 'dh102']);
        await expect(cell(page, 'KhachA', 'Giao dịch')).toHaveText('3');
        await expect(cell(page, 'KhachA', 'Lãi / Lỗ')).toHaveText('+380.000 đ Lãi');

        await page.selectOption('#tags-period', 'year');
        expect(await tagNames(page)).toEqual(['KhachA', 'dh102']);
        await expect(cell(page, 'KhachA', 'Giao dịch')).toHaveText('4');

        await page.selectOption('#tags-period', 'all');
        expect(await tagNames(page)).toEqual(['KhachA', 'dh102', 'cu']);
        await expect(cell(page, 'cu', 'Lãi / Lỗ')).toHaveText('+1.000.000 đ Lãi');
    });

    test('chưa có thẻ nào, hoặc không có thẻ trong khoảng đã chọn thì nói rõ', async ({ app }) => {
        const none = await open(app, [rows[2]]);

        await goTab(none.page, 'tags');
        await expect(none.page.locator('#tag-table-body .empty-row')).toContainText(
            'Chưa có thẻ nào',
        );
        await expect(none.page.locator('#tags-summary')).toHaveText('');

        const old = await open(app, [rows[5]]);

        await goTab(old.page, 'tags');
        await old.page.selectOption('#tags-period', 'month');
        await expect(old.page.locator('#tag-table-body .empty-row')).toContainText(
            'Không có giao dịch nào có thẻ trong khoảng thời gian này',
        );
    });

    test('nút xem giao dịch mở Sổ Giao Dịch đã lọc theo thẻ', async ({ app }) => {
        const { page } = await open(app);

        await goTab(page, 'tags');
        await page.click('button[data-action="view-tag"][data-tag="dh102"]');

        await expect(page.locator('#tab-transactions')).toHaveClass(/active/);
        await expect(page.locator('#filter-tag')).toHaveValue('dh102');
        expect(
            await page
                .locator('#transaction-table-body tr[data-id]')
                .evaluateAll((trs) => trs.map((tr) => tr.dataset.id).sort()),
        ).toEqual(['A', 'D']);
    });
});

test.describe('Đổi tên và gộp thẻ', () => {
    test('đổi tên: viết lại thẻ trong ghi chú của đúng các giao dịch có thẻ đó, đóng dấu thời gian mới', async ({
        app,
    }) => {
        const { page } = await open(app);

        await goTab(page, 'tags');
        await page.click(renameButton('dh102'));

        await expect(page.locator('#tagRenameModal')).toHaveClass(/open/);
        await expect(page.locator('#tagRenameTitle')).toHaveText('Đổi tên thẻ #dh102');
        await expect(page.locator('#tagRenameInput')).toBeFocused();
        await expect(page.locator('#tagRenameInput')).toHaveValue('dh102');

        await page.fill('#tagRenameInput', '#don102');
        await expect(page.locator('#tagRenameSubmit')).toHaveText('Đổi tên');
        await expect(page.locator('#tagRenameHint')).toHaveText('');
        await page.click('#tagRenameSubmit');

        await expect(page.locator('#tagRenameModal')).not.toHaveClass(/open/);
        expect(await note(page, 'A')).toBe('Mua keo #KhachA #don102');
        expect(await note(page, 'D')).toBe('Sơn #don102');
        expect(await note(page, 'B')).toBe('Công sửa bàn #khacha');
        expect(await note(page, 'C')).toBe('Cafe sáng');
        expect(await tagNames(page)).toEqual(['KhachA', 'don102', 'cu']);
        await expect(page.locator('#toast-container')).toContainText(
            'Đã đổi #dh102 thành #don102 (2 giao dịch).',
        );
        // The row of the old name is gone: the focus is on the same action of the new one.
        await expect(page.locator(renameButton('don102'))).toBeFocused();

        const stamps = await page.evaluate(() =>
            Object.fromEntries(transactions.map((t) => [t.id, t.updatedAt])),
        );

        expect(stamps.A).not.toBe(stamps.B);
        expect(stamps.A).toBe(stamps.D);
        expect(stamps.B).toBeFalsy();
        expect(stamps.C).toBeFalsy();
        expect(stamps.A > '2026-10-30').toBe(true);
    });

    test('đổi tên thành thẻ đã có thì báo sẽ gộp, rồi gộp: một thẻ, mỗi giao dịch chỉ còn một lần', async ({
        app,
    }) => {
        const { page } = await open(app);

        await goTab(page, 'tags');
        await page.click(renameButton('dh102'));
        await page.fill('#tagRenameInput', 'khacha');

        await expect(page.locator('#tagRenameHint')).toHaveText(
            '#KhachA đã có (4 giao dịch): các giao dịch của #dh102 sẽ được gộp vào đó.',
        );
        await expect(page.locator('#tagRenameSubmit')).toHaveText('Gộp thẻ');
        await page.click('#tagRenameSubmit');

        // A carried both tags; it ends up with one, written the way KhachA already was.
        expect(await note(page, 'A')).toBe('Mua keo #KhachA');
        expect(await note(page, 'D')).toBe('Sơn #KhachA');
        expect(await tagNames(page)).toEqual(['KhachA', 'cu']);
        await expect(cell(page, 'KhachA', 'Giao dịch')).toHaveText('5');
        await expect(page.locator('#toast-container')).toContainText(
            'Đã gộp #dh102 vào #KhachA (2 giao dịch).',
        );

        // The hint goes away again when the name is no longer an existing tag.
        await page.click(renameButton('cu'));
        await page.fill('#tagRenameInput', 'khacha');
        await expect(page.locator('#tagRenameSubmit')).toHaveText('Gộp thẻ');
        await page.fill('#tagRenameInput', 'moi');
        await expect(page.locator('#tagRenameSubmit')).toHaveText('Đổi tên');
        await expect(page.locator('#tagRenameHint')).toHaveText('');
    });

    test('chỉ đổi chữ hoa / thường vẫn là đổi tên, không phải gộp', async ({ app }) => {
        const { page } = await open(app);

        await goTab(page, 'tags');
        await page.click(renameButton('dh102'));
        await page.fill('#tagRenameInput', 'DH102');
        await expect(page.locator('#tagRenameSubmit')).toHaveText('Đổi tên');
        await page.click('#tagRenameSubmit');

        expect(await note(page, 'D')).toBe('Sơn #DH102');
        expect(await tagNames(page)).toEqual(['KhachA', 'DH102', 'cu']);
    });

    test('tên không hợp lệ hoặc giống tên cũ thì báo và không đổi gì', async ({ app }) => {
        const { page, state } = await open(app);

        await goTab(page, 'tags');

        await page.click(renameButton('dh102'));

        for (const bad of ['', 'a b', '12ab', 'a@b']) {
            await page.fill('#tagRenameInput', bad);
            await page.click('#tagRenameSubmit');
        }

        expect(state.alerts).toHaveLength(4);
        expect(state.alerts.every((text) => text.includes('Nhập đúng một thẻ'))).toBe(true);
        await expect(page.locator('#tagRenameModal')).toHaveClass(/open/);

        await page.fill('#tagRenameInput', 'dh102');
        await page.click('#tagRenameSubmit');
        expect(state.alerts.at(-1)).toContain('giống tên cũ');

        expect(await note(page, 'A')).toBe('Mua keo #KhachA #dh102');
        expect(await tagNames(page)).toEqual(['KhachA', 'dh102', 'cu']);
    });

    test('Esc hoặc nút đóng thì không đổi gì, focus về nút đã mở hộp thoại', async ({ app }) => {
        const { page } = await open(app);

        await goTab(page, 'tags');
        await page.focus(renameButton('dh102'));
        await page.keyboard.press('Enter');
        await page.fill('#tagRenameInput', 'khac');
        await page.keyboard.press('Escape');

        await expect(page.locator('#tagRenameModal')).not.toHaveClass(/open/);
        await expect(page.locator(renameButton('dh102'))).toBeFocused();
        expect(await note(page, 'D')).toBe('Sơn #dh102');
    });

    test('bộ lọc thẻ của Sổ Giao Dịch theo tên mới', async ({ app }) => {
        const { page } = await open(app);

        await goTab(page, 'tags');
        await rename(page, 'dh102', 'don102');
        await page.evaluate(() => switchTab('transactions'));

        const options = await page.locator('#filter-tag option').allInnerTexts();

        expect(options.some((text) => text.startsWith('#don102'))).toBe(true);
        expect(options.some((text) => text.startsWith('#dh102'))).toBe(false);
    });

    test('đồng bộ v2: chỉ gửi các dòng đã đổi, máy kia nhận được tên mới', async ({ app }) => {
        const stamped = rows
            .filter((row) => row.type !== 'transfer')
            .map((row) => ({ ...row, updatedAt: STAMP }));
        const server = newServer('v2', { rows: stamped });
        const a = await app({ server, now: NOW, seed: syncedSeed(stamped) });
        const b = await app({ server, now: NOW, seed: syncedSeed(stamped) });

        await goTab(a.page, 'tags');
        await rename(a.page, 'dh102', 'don102');
        await wait(400);

        const body = a.state.posts.at(-1).body;

        expect(body.upserts.map((row) => row.id).sort()).toEqual(['A', 'D']);
        expect(body.upserts.map((row) => row.note).sort()).toEqual([
            'Mua keo #KhachA #don102',
            'Sơn #don102',
        ]);

        await b.page.evaluate(() => {
            lastPullAt = 0;
            return syncFromGoogleSheet({ quiet: true });
        });
        await goTab(b.page, 'tags');
        expect(await tagNames(b.page)).toEqual(['don102', 'KhachA', 'cu']);
    });

    test('đồng bộ cũ (legacy): ghi lại toàn bộ danh sách với ghi chú mới', async ({ app }) => {
        const server = newServer('legacy', {
            rows: rows.filter((row) => row.type !== 'transfer'),
        });
        const { page } = await app({
            server,
            now: NOW,
            seed: syncedSeed(rows.filter((row) => row.type !== 'transfer')),
        });

        await goTab(page, 'tags');
        await rename(page, 'dh102', 'don102');
        await wait(400);

        const sheet = server.get({ v: '2' });

        expect(sheet.find((row) => row.id === 'D').note).toBe('Sơn #don102');
    });
});

test.describe('Giao diện trang Thẻ', () => {
    test('trợ năng: trang và hộp thoại không vi phạm axe', async ({ app }) => {
        const { page } = await open(app);

        await goTab(page, 'tags');

        const tab = await scanA11y(page, '#tab-tags');

        expect(tab.violations.map((violation) => violation.id)).toEqual([]);

        await page.click(renameButton('dh102'));
        await page.fill('#tagRenameInput', 'khacha');

        const dialog = await scanA11y(page, '#tagRenameModal');

        expect(dialog.violations.map((violation) => violation.id)).toEqual([]);
    });

    test('điện thoại: mỗi thẻ là một thẻ có nhãn, không tràn ngang, đổi tên dùng được', async ({
        app,
    }) => {
        const { page } = await open(app, rows, { viewport: { width: 390, height: 844 } });

        await page.evaluate(() => switchTab('tags'));
        await settle(page);

        await expect(cell(page, 'KhachA', 'Lãi / Lỗ')).toBeVisible();
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);

        const results = await scanA11y(page, '#tab-tags');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);

        await rename(page, 'dh102', 'don102');
        expect(await tagNames(page)).toEqual(['KhachA', 'don102', 'cu']);
    });
});
