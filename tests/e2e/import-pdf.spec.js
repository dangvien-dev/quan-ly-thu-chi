// Import of a bank statement in PDF (the VPBank credit card statement): the file is read in the
// browser with pdf.js, its table becomes the same rows a CSV gives, a password-protected file asks
// for its password, and the numbers on the statement are checked and can be written to the card.
//
// The PDFs are made up (tests/fixtures/make-statement-pdfs.py): statement cycle 21/09–20/10/2026,
// due 04/11/2026, eight rows (one payment in, seven charges out, a USD purchase, fee and VAT lines
// whose transaction amount is 0.00, a description that wraps, a table that goes on without a
// header on page 2), outstanding balance 944.052.

const path = require('node:path');
const { test, expect, tx, goTab, scanA11y } = require('./helpers');

const NOW = '2026-11-07T03:00:00Z';
const FIXTURES = path.join(__dirname, '..', 'fixtures');
const SAMPLE = path.join(FIXTURES, 'statement-vpbank-sample.pdf');
const LOCKED = path.join(FIXTURES, 'statement-vpbank-sample-locked.pdf');
const NO_TABLE = path.join(FIXTURES, 'statement-no-table.pdf');
const PASSWORD = 'matkhau123';
const CARD = 'Thẻ Tín Dụng';
const BANK = 'Thẻ NH Vpbank';
const SOURCES = [
    { name: 'Tiền Mặt', kind: 'cash' },
    { name: BANK, kind: 'bank' },
    { name: CARD, kind: 'credit', creditLimit: 37800000 },
];
const rowsLocator = (page) => page.locator('#import-table-body tr');
const open = (app, seed = {}, extra = {}) =>
    app({
        now: NOW,
        seed: {
            fm_sources: JSON.stringify(SOURCES),
            fm_transactions: JSON.stringify([]),
            ...seed,
        },
        ...extra,
    });
const source = (page, name = CARD) =>
    page.evaluate((target) => sources.find((item) => item.name === target), name);

async function openImport(page) {
    await goTab(page, 'settings');
    await page.click('#import-open-btn');
}

async function choosePdf(page, file = SAMPLE, target = CARD) {
    await page.selectOption('#importSource', target);
    await page.setInputFiles('#importFile', file);
}

async function toPreview(page) {
    await page.click('#import-continue');
    await expect(page.locator('#import-step-preview')).toBeVisible();
}

async function unlock(page, password = PASSWORD) {
    await page.fill('#importPassword', password);
    await page.click('#import-unlock');
}

test.describe('Nhập sao kê PDF: đọc bảng giao dịch', () => {
    test('chỉ tải pdf.js khi chọn một file PDF; đọc đủ 8 dòng, kể cả dòng xuống hàng và trang 2 không có tiêu đề', async ({
        app,
    }) => {
        const { page, state } = await open(app);
        const loaded = [];

        page.on('request', (request) => {
            if (request.url().includes('/vendor/pdfjs/')) loaded.push(request.url());
        });

        await openImport(page);
        expect(loaded).toEqual([]);
        await expect(page.locator('#importFile')).toHaveAttribute('accept', /\.pdf/);

        await choosePdf(page);
        await expect(page.locator('#import-mapping')).toBeVisible();
        expect(loaded.some((url) => url.endsWith('pdf.min.js'))).toBe(true);
        await expect(page.locator('#importMessage')).toContainText(
            'Đã đọc bảng giao dịch trong file PDF: 8 dòng của kỳ sao kê 21/09/2026 – 20/10/2026',
        );

        // The header is the first row; the bilingual header cells are joined into one choice each.
        await expect(page.locator('#importHeaderRow')).toHaveValue('1');
        await expect(page.locator('#importColDate')).toHaveValue('0');
        await expect(page.locator('#importColDescription')).toHaveValue('2');
        await expect(page.locator('#importColAmount')).toHaveValue('6'); // payment amount (VND)
        await expect(page.locator('#importSign')).toHaveValue('negative'); // charges are negative

        await toPreview(page);
        await expect(rowsLocator(page)).toHaveCount(8);

        const cells = await rowsLocator(page).evaluateAll((rows) =>
            rows.map((row) => ({
                date: row.querySelector('td[data-label="Ngày"]').innerText,
                note: row.querySelector('td[data-label="Nội dung"]').innerText.replace(/\s+/g, ' '),
                amount: row.querySelector('td[data-label="Số tiền"]').innerText,
            })),
        );

        expect(cells.map(({ date, amount }) => [date, amount])).toEqual([
            ['21/09/2026', '+1.200.000 đ'],
            ['21/09/2026', '-100.000 đ'],
            ['23/09/2026', '-132.000 đ'],
            ['23/09/2026', '-10.000 đ'], // the fee line: the amount is in the payment column
            ['23/09/2026', '-1.000 đ'],
            ['23/09/2026', '-73.333 đ'], // on page 2, which has no header
            ['30/09/2026', '-582.720 đ'], // 22,22 USD: the VND column
            ['02/10/2026', '-45.000 đ'],
        ]);
        expect(cells[0].note).toContain('Credit Account I2B Virtual Card payment');
        // A description that wraps over several lines is one cell.
        expect(cells[3].note).toContain('Retail: : MasterCard Acq');
        expect(cells[3].note).toContain('Custom Fee');
        expect(cells[6].note).toContain('ANTHROPIC* CLAUDE SUB');
        // Nothing of the footer ends up in a row.
        expect(cells.some((cell) => /Page \d of|Trụ sở/.test(cell.note))).toBe(false);
        expect(state.external).toEqual([]);
    });

    test('đối chiếu với tóm tắt sao kê: khớp thì báo khớp, đổi sang cột sai thì báo chưa khớp', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openImport(page);
        await choosePdf(page);
        await toPreview(page);

        await expect(page.locator('#import-reconcile')).toContainText('Khớp với sao kê');
        await expect(page.locator('#import-reconcile')).toContainText('đã thanh toán 1.200.000 đ');
        await expect(page.locator('#import-summary')).toContainText('Đọc được 8 giao dịch');

        // The "Số tiền giao dịch" column is 0.00 on the fee and VAT lines: the totals no longer match.
        await page.click('button:has-text("Quay lại")');
        await page.selectOption('#importColAmount', '3');
        await toPreview(page);
        await expect(page.locator('#import-reconcile')).toContainText('Chưa khớp với sao kê');
    });

    test('file PDF không có bảng giao dịch hoặc bị hỏng thì báo rõ, không treo hộp thoại', async ({
        app,
    }) => {
        const { page, state } = await open(app);

        await openImport(page);
        await choosePdf(page, NO_TABLE);
        await expect(page.locator('#importMessage')).toContainText('Không thấy bảng giao dịch');
        await expect(page.locator('#import-mapping')).toBeHidden();

        // Starts like a PDF but is not one.
        await choosePdf(page, {
            name: 'hong.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-1.4\nthis is not a real pdf'),
        });
        await expect(page.locator('#importMessage')).toContainText('Không đọc được file PDF');
        await expect(page.locator('#importMessage')).toHaveClass(/import-error/);
        expect(state.errors).toEqual([]);

        // A good file still works afterwards.
        await choosePdf(page);
        await expect(page.locator('#import-mapping')).toBeVisible();
    });
});

test.describe('Nhập sao kê PDF: file có mật khẩu', () => {
    test('hỏi mật khẩu; sai thì báo và hỏi lại; đúng thì đọc, ô mật khẩu biến mất và không được lưu', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openImport(page);
        await expect(page.locator('#import-password-group')).toBeHidden();
        await choosePdf(page, LOCKED);

        await expect(page.locator('#import-password-group')).toBeVisible();
        await expect(page.locator('#importPassword')).toBeFocused();
        await expect(page.locator('#importMessage')).toContainText('có mật khẩu');
        await expect(page.locator('#import-mapping')).toBeHidden();

        // Nothing typed.
        await page.click('#import-unlock');
        await expect(page.locator('#importMessage')).toContainText('Hãy nhập mật khẩu');
        await expect(page.locator('#importPassword')).toBeFocused();

        await unlock(page, 'sai-mat-khau');
        await expect(page.locator('#importMessage')).toContainText('Mật khẩu chưa đúng');
        await expect(page.locator('#importMessage')).toHaveClass(/import-error/);
        await expect(page.locator('#importPassword')).toHaveValue('');
        await expect(page.locator('#importPassword')).toBeFocused();
        await expect(page.locator('#import-mapping')).toBeHidden();

        // Enter in the field opens the file too.
        await page.fill('#importPassword', PASSWORD);
        await page.press('#importPassword', 'Enter');
        await expect(page.locator('#import-mapping')).toBeVisible();
        await expect(page.locator('#import-password-group')).toBeHidden();
        await expect(page.locator('#importPassword')).toHaveValue('');
        await expect(page.locator('#importMessage')).toContainText('8 dòng');

        await toPreview(page);
        await expect(rowsLocator(page)).toHaveCount(8);
        await expect(page.locator('#import-reconcile')).toContainText('Khớp với sao kê');

        // The password is not kept anywhere on the device.
        const kept = await page.evaluate((password) => {
            const values = [
                ...Object.keys(localStorage).map((key) => localStorage.getItem(key)),
                ...Object.keys(sessionStorage).map((key) => sessionStorage.getItem(key)),
            ];

            return values.some((value) => String(value).includes(password));
        }, PASSWORD);

        expect(kept).toBe(false);
    });

    test('chọn file khác hoặc đóng hộp thoại thì bỏ ô mật khẩu', async ({ app }) => {
        const { page } = await open(app);

        await openImport(page);
        await choosePdf(page, LOCKED);
        await expect(page.locator('#import-password-group')).toBeVisible();

        await choosePdf(page, SAMPLE);
        await expect(page.locator('#import-password-group')).toBeHidden();
        await expect(page.locator('#import-mapping')).toBeVisible();

        await choosePdf(page, LOCKED);
        await expect(page.locator('#import-password-group')).toBeVisible();
        await page.fill('#importPassword', 'dang-go-do');
        await page.click('#importModal .close-btn');
        await expect(page.locator('#importModal')).not.toHaveClass(/open/);

        await page.click('#import-open-btn');
        await expect(page.locator('#import-password-group')).toBeHidden();
        await expect(page.locator('#importPassword')).toHaveValue('');
    });
});

test.describe('Nhập sao kê PDF: ghi giao dịch và cập nhật thẻ', () => {
    test('nhập 8 giao dịch vào thẻ; chọn cập nhật thì ngày chốt, hạn và dư nợ cuối kỳ được ghi vào thẻ', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openImport(page);
        await choosePdf(page);
        await toPreview(page);

        await expect(page.locator('#import-apply-label')).toBeVisible();
        await expect(page.locator('#import-apply-statement')).toBeChecked();
        await expect(page.locator('#import-apply-text')).toHaveText(
            'Cập nhật thẻ "Thẻ Tín Dụng" theo sao kê: ngày chốt sao kê 20, hạn thanh toán ngày 4, dư nợ cuối kỳ 944.052 đ (sao kê chốt 20/10/2026).',
        );
        await expect(page.locator('#import-commit')).toHaveText('Nhập 8 giao dịch và cập nhật thẻ');

        await page.click('#import-commit');
        await expect(page.locator('#importModal')).not.toHaveClass(/open/);

        expect(await page.evaluate(() => transactions.length)).toBe(8);
        expect(await source(page)).toMatchObject({
            statementDay: 20,
            dueDay: 4,
            lastStatement: { date: '2026-10-20', balance: 944052 },
        });
        await expect(page.locator('#tab-transactions')).toHaveClass(/active/);
        await expect(page.locator('#filter-source')).toHaveValue(CARD);
        await expect(page.locator('.toast').last()).toContainText('cập nhật thẻ Thẻ Tín Dụng');
    });

    test('bỏ chọn ô cập nhật thì thẻ giữ nguyên; nguồn không phải thẻ tín dụng không có ô đó', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openImport(page);
        await choosePdf(page);
        await toPreview(page);
        await page.uncheck('#import-apply-statement');
        await expect(page.locator('#import-commit')).toHaveText('Nhập 8 giao dịch');
        await page.click('#import-commit');
        await expect(page.locator('#importModal')).not.toHaveClass(/open/);

        const card = await source(page);

        expect(card.statementDay).toBeNull();
        expect(Object.hasOwn(card, 'lastStatement')).toBe(false);

        await openImport(page);
        await choosePdf(page, SAMPLE, BANK);
        await toPreview(page);
        await expect(page.locator('#import-statement')).toBeVisible();
        await expect(page.locator('#import-apply-label')).toBeHidden();
        await expect(page.locator('#import-reconcile')).toContainText('Khớp với sao kê');
    });

    test('thẻ đã đúng ngày chốt và hạn: chỉ ghi dư nợ cuối kỳ; sao kê cũ hơn mốc đang có thì không đè', async ({
        app,
    }) => {
        const withCard = (extra) =>
            JSON.stringify(
                SOURCES.map((item) =>
                    item.name === CARD ? { ...item, statementDay: 20, dueDay: 4, ...extra } : item,
                ),
            );
        const first = await open(app, { fm_sources: withCard({}) });

        await openImport(first.page);
        await choosePdf(first.page);
        await toPreview(first.page);
        await expect(first.page.locator('#import-apply-text')).toHaveText(
            'Cập nhật thẻ "Thẻ Tín Dụng" theo sao kê: dư nợ cuối kỳ 944.052 đ (sao kê chốt 20/10/2026).',
        );

        // The card already holds the statement of 20/11 (newer): this older one does not replace it.
        const second = await open(app, {
            fm_sources: withCard({ lastStatement: { date: '2026-11-20', balance: 5 } }),
        });

        await openImport(second.page);
        await choosePdf(second.page);
        await toPreview(second.page);
        await expect(second.page.locator('#import-apply-label')).toBeHidden();
    });

    test('mọi dòng đã có sẵn: bỏ chọn hết vẫn cập nhật được thẻ theo sao kê, không đụng sổ giao dịch', async ({
        app,
    }) => {
        const existing = [
            ['A', '2026-09-21', 'income', 1200000],
            ['B', '2026-09-21', 'expense', 100000],
            ['C', '2026-09-23', 'expense', 132000],
            ['D', '2026-09-23', 'expense', 10000],
            ['E', '2026-09-23', 'expense', 1000],
            ['F', '2026-09-23', 'expense', 73333],
            ['G', '2026-09-30', 'expense', 582720],
            ['H', '2026-10-02', 'expense', 45000],
        ].map(([id, date, type, amount]) => tx({ id, date, type, source: CARD, amount }));
        const { page } = await open(app, { fm_transactions: JSON.stringify(existing) });

        await openImport(page);
        await choosePdf(page);
        await toPreview(page);

        // Typed by hand already: every row is flagged and left unticked.
        await expect(page.locator('#import-summary')).toContainText('8 dòng có thể trùng');
        await expect(
            page.locator('#import-table-body input[data-field="include"]:checked'),
        ).toHaveCount(0);
        await expect(page.locator('#import-commit')).toHaveText('Cập nhật thẻ theo sao kê');
        await expect(page.locator('#import-commit')).toBeEnabled();

        await page.uncheck('#import-apply-statement');
        await expect(page.locator('#import-commit')).toBeDisabled();
        await expect(page.locator('#import-commit')).toHaveText('Chưa chọn giao dịch nào');
        await page.check('#import-apply-statement');
        await page.click('#import-commit');

        await expect(page.locator('#importModal')).not.toHaveClass(/open/);
        await expect(page.locator('#tab-sources')).toHaveClass(/active/);
        expect(await page.evaluate(() => transactions.length)).toBe(8);
        expect(await page.evaluate(() => localStorage.getItem('fm_last_import'))).toBeNull();
        expect(await source(page)).toMatchObject({
            statementDay: 20,
            dueDay: 4,
            lastStatement: { date: '2026-10-20', balance: 944052 },
        });
    });

    test('dư nợ cuối kỳ từ PDF làm dòng "Cần trả" của thẻ đúng với sao kê', async ({ app }) => {
        const { page } = await open(app);

        await openImport(page);
        await choosePdf(page);
        await toPreview(page);
        await page.click('#import-commit');
        await expect(page.locator('#importModal')).not.toHaveClass(/open/);

        await goTab(page, 'sources');

        const card = page.locator('#sources-grid .source-card', {
            has: page.locator(`button[data-action="edit-balance"][data-source="${CARD}"]`),
        });

        await expect(card).toContainText('Sao kê chốt 20/10/2026: dư nợ 944.052 đ');
        // The statement's own payment of 1.200.000 (21/09) is before the statement day: it is not
        // counted again, so what is due is the closing balance until it is paid after 20/10.
        await expect(card.locator('.card-due')).toContainText('Cần trả 944.052 đ trước 04/11/2026');
    });

    test('lần sau chọn lại file cùng kiểu thì dùng lại các cột đã xác nhận; nhập lại cùng file không nhân đôi', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openImport(page);
        await choosePdf(page);
        await toPreview(page);
        await page.click('#import-commit');
        await expect(page.locator('#importModal')).not.toHaveClass(/open/);

        await openImport(page);
        await choosePdf(page);
        await expect(page.locator('#importMessage')).toContainText(
            'Đã dùng lại các cột bạn chọn lần trước',
        );
        await toPreview(page);
        await expect(page.locator('#import-summary')).toContainText('8 dòng đã nhập từ lần trước');
        await expect(
            page.locator('#import-table-body input[data-field="include"]:checked'),
        ).toHaveCount(0);
    });
});

test.describe('Nhập sao kê PDF: trợ năng và điện thoại', () => {
    test('ô mật khẩu và bước xem trước có đối chiếu không vi phạm axe, không tràn ngang trên điện thoại', async ({
        app,
    }) => {
        const { page } = await open(app, {}, { viewport: { width: 390, height: 844 } });
        const overflow = () =>
            page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

        await page.evaluate(() => switchTab('settings'));
        await page.click('#import-open-btn');
        await choosePdf(page, LOCKED);
        await expect(page.locator('#import-password-group')).toBeVisible();
        expect(await overflow()).toBe(0);

        const locked = await scanA11y(page, '#importModal');

        expect(locked.violations.map((violation) => violation.id)).toEqual([]);

        await unlock(page);
        await expect(page.locator('#import-mapping')).toBeVisible();
        await toPreview(page);
        await expect(page.locator('#import-reconcile')).toBeVisible();
        expect(await overflow()).toBe(0);

        const preview = await scanA11y(page, '#importModal');

        expect(preview.violations.map((violation) => violation.id)).toEqual([]);

        // A mismatch is drawn in the error colour: still readable.
        await page.click('button:has-text("Quay lại")');
        await page.selectOption('#importColAmount', '3');
        await toPreview(page);
        await expect(page.locator('#import-reconcile')).toContainText('Chưa khớp');

        const bad = await scanA11y(page, '#importModal');

        expect(bad.violations.map((violation) => violation.id)).toEqual([]);
    });
});
