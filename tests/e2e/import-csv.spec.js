// Import of a bank statement (CSV): reading the file, checking the columns, the preview with
// duplicates and categories, writing the transactions, and undoing an import.

const {
    test,
    expect,
    newServer,
    syncedSeed,
    tx,
    goTab,
    scanA11y,
    settle,
    wait,
} = require('./helpers');

const NOW = '2026-10-31T03:00:00Z';
const BANK = 'Thẻ Ngân Hàng';
// A statement as an internet bank exports it: lines about the account first, separate debit and
// credit columns, a balance column and a totals line at the end.
const STATEMENT = [
    'SAO KÊ TÀI KHOẢN',
    'Số tài khoản,0011004123456',
    'Ngày giao dịch,Mã giao dịch,Số tiền ghi nợ,Số tiền ghi có,Số dư,Nội dung',
    '25/10/2026,FT001,45.000,,9.955.000,HIGHLANDS COFFEE Q1',
    '26/10/2026,FT002,250.000,,9.705.000,GRAB*TRIP 4421 HCM',
    '27/10/2026,FT003,,12.000.000,21.705.000,CTY ABC LUONG THANG 10',
    '28/10/2026,FT004,1.500.000,,20.205.000,CHUYEN KHOAN 998877',
    'Tổng cộng,,1.795.000,12.000.000,,',
].join('\r\n');
const file = (text = STATEMENT, name = 'sao-ke.csv') => ({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(text, 'utf8'),
});
const rowsLocator = (page) => page.locator('#import-table-body tr');
const open = (app, seed = {}, extra = {}) =>
    app({ now: NOW, seed: { fm_transactions: JSON.stringify([]), ...seed }, ...extra });
const summary = (page) => page.locator('#import-summary');

async function openImport(page) {
    await goTab(page, 'settings');
    await page.click('#import-open-btn');
}

async function chooseFile(page, csv = file(), source = BANK) {
    await page.selectOption('#importSource', source);
    await page.setInputFiles('#importFile', csv);
    await expect(page.locator('#import-mapping')).toBeVisible();
}

async function toPreview(page) {
    await page.click('#import-continue');
    await expect(page.locator('#import-step-preview')).toBeVisible();
}

async function importStatement(page, csv = file(), source = BANK) {
    await openImport(page);
    await chooseFile(page, csv, source);
    await toPreview(page);
    await page.click('#import-commit');
    await expect(page.locator('#importModal')).not.toHaveClass(/open/);
}

const stored = (page) => page.evaluate(() => transactions);

test.describe('Nhập sao kê: đọc file và nhận cột', () => {
    test('tự nhận dòng tiêu đề sau phần giới thiệu và các cột ghi nợ / ghi có', async ({ app }) => {
        const { page } = await open(app);

        await openImport(page);
        await expect(page.locator('#importModal')).toHaveClass(/open/);
        await expect(page.locator('#importFile')).toBeFocused();
        await expect(page.locator('#import-mapping')).toBeHidden();
        expect(await page.locator('#importSource option').allInnerTexts()).toEqual([
            'Tiền Mặt',
            BANK,
            'Thẻ Tín Dụng',
            'Spaylater',
            'Nợ Công Ty',
        ]);

        await chooseFile(page);

        await expect(page.locator('#importHeaderRow')).toHaveValue('3');
        await expect(page.locator('#importColDate')).toHaveValue('0');
        await expect(page.locator('#importColReference')).toHaveValue('1');
        await expect(page.locator('#importColDebit')).toHaveValue('2');
        await expect(page.locator('#importColCredit')).toHaveValue('3');
        await expect(page.locator('#importColDescription')).toHaveValue('5');
        await expect(page.locator('#importColAmount')).toHaveValue('-1');
        await expect(page.locator('#import-sign-group')).toBeHidden(); // debit / credit columns
        await expect(page.locator('#importMessage')).toContainText('dòng tiêu đề ở dòng 3');
        // The choices carry the header text, and the first lines are shown.
        await expect(page.locator('#importColDebit option[value="2"]')).toHaveText(
            'Cột 3: Số tiền ghi nợ',
        );
        await expect(page.locator('#import-raw-body tr').first()).toHaveClass(/import-raw-header/);
        await expect(page.locator('#import-raw-body')).toContainText('HIGHLANDS COFFEE Q1');
    });

    test('một cột số tiền có dấu, dấu ; và số kiểu 1.234,56; thẻ tín dụng mặc định số dương là chi', async ({
        app,
    }) => {
        const text = [
            'Ngày;Mô tả;Số tiền;Số dư',
            '27/10/2026;Mua hàng;150.000,00;0',
            '28/10/2026;Hoàn tiền;-20.000,50;0',
        ].join('\n');
        const { page } = await open(app);

        await openImport(page);
        await chooseFile(page, file(text), 'Spaylater');

        await expect(page.locator('#importColAmount')).toHaveValue('2');
        await expect(page.locator('#importColDebit')).toHaveValue('-1');
        await expect(page.locator('#import-sign-group')).toBeVisible();
        await expect(page.locator('#importSign')).toHaveValue('positive');
        await toPreview(page);

        await expect(rowsLocator(page)).toHaveCount(2);
        await expect(rowsLocator(page).nth(0).locator('td[data-label="Số tiền"]')).toHaveText(
            '-150.000 đ',
        );
        await expect(rowsLocator(page).nth(1).locator('td[data-label="Số tiền"]')).toHaveText(
            '+20.001 đ',
        );
    });

    test('tài khoản thường: số âm là chi, số dương là thu', async ({ app }) => {
        const text = [
            'Date,Description,Amount',
            '2026-10-27,Shop,-90000',
            '2026-10-28,Pay,500000',
        ].join('\n');
        const { page } = await open(app);

        await openImport(page);
        await chooseFile(page, file(text), BANK);
        await expect(page.locator('#importSign')).toHaveValue('negative');
        await toPreview(page);

        await expect(rowsLocator(page).nth(0).locator('select[data-field=type]')).toHaveValue(
            'expense',
        );
        await expect(rowsLocator(page).nth(1).locator('select[data-field=type]')).toHaveValue(
            'income',
        );
    });

    test('đọc được file UTF-16 có BOM và file mã Windows-1258', async ({ app }) => {
        const text = 'Ngày,Nội dung,Số tiền\r\n27/10/2026,Cà phê,-45.000\r\n';
        const utf16 = {
            name: 'utf16.csv',
            mimeType: 'text/csv',
            buffer: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]),
        };
        const { page } = await open(app);

        await openImport(page);
        await chooseFile(page, utf16);
        await toPreview(page);
        await expect(rowsLocator(page).first().locator('td[data-label="Nội dung"]')).toContainText(
            'Cà phê',
        );

        // "Đà Nẵng" is not valid UTF-8 here: 0xD0 0xE0 are Đ and à in Windows-1258.
        const legacy = {
            name: 'cp1258.csv',
            mimeType: 'text/csv',
            buffer: Buffer.concat([
                Buffer.from('Ngay,Noi dung,So tien\r\n27/10/2026,'),
                Buffer.from([0xd0, 0xe0, 0x20, 0x4e, 0x61, 0x6e, 0x67]),
                Buffer.from(',-50.000\r\n'),
            ]),
        };

        await page.click('button:has-text("Quay lại")');
        await page.setInputFiles('#importFile', legacy);
        await expect(page.locator('#importMessage')).toContainText('dòng tiêu đề');
        await toPreview(page);
        await expect(rowsLocator(page).first().locator('td[data-label="Nội dung"]')).toContainText(
            'Đà Nang',
        );
    });

    test('báo lỗi rõ khi file trống, quá lớn, hoặc không đọc được giao dịch nào', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openImport(page);

        await page.setInputFiles('#importFile', file('', 'rong.csv'));
        await expect(page.locator('#importMessage')).toContainText('File trống');
        await expect(page.locator('#import-mapping')).toBeHidden();

        await page.setInputFiles('#importFile', file('x'.repeat(3 * 1024 * 1024 + 10), 'lon.csv'));
        await expect(page.locator('#importMessage')).toContainText('quá lớn');
        await expect(page.locator('#importMessage')).toHaveClass(/import-error/);

        // Columns that do not hold dates or amounts.
        await chooseFile(page, file('Ngày,Nội dung,Số tiền\r\nabc,def,ghi\r\n'));
        await page.click('#import-continue');
        await expect(page.locator('#importMessage')).toContainText('Không đọc được giao dịch nào');
        await expect(page.locator('#import-step-preview')).toBeHidden();

        // No date column / no amount column chosen.
        await page.selectOption('#importColDate', '-1');
        await page.click('#import-continue');
        await expect(page.locator('#importMessage')).toContainText('cột Ngày');
        await page.selectOption('#importColDate', '0');
        await page.selectOption('#importColAmount', '-1');
        await page.click('#import-continue');
        await expect(page.locator('#importMessage')).toContainText('cột Số tiền');
    });

    test('sửa dòng tiêu đề thì danh sách cột đổi theo; chọn lại file khác thì bỏ file cũ', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openImport(page);
        await chooseFile(page);
        await page.fill('#importHeaderRow', '4');
        await page.dispatchEvent('#importHeaderRow', 'change');
        await expect(page.locator('#importColDate option[value="0"]')).toContainText('25/10/2026');

        await page.setInputFiles(
            '#importFile',
            file('Ngày,Nội dung,Số tiền\r\n27/10/2026,Một,-1.000\r\n'),
        );
        await expect(page.locator('#importHeaderRow')).toHaveValue('1');
        await expect(page.locator('#importColDescription option[value="1"]')).toHaveText(
            'Cột 2: Nội dung',
        );
    });

    test('ô chọn nguồn bỏ nguồn lưu trữ và sổ tiết kiệm, nhớ nguồn đã chọn lần trước', async ({
        app,
    }) => {
        const seed = {
            fm_sources: JSON.stringify([
                { name: 'Tiền Mặt', kind: 'cash' },
                { name: 'Vietcombank', kind: 'bank' },
                { name: 'Sổ 6 tháng', kind: 'savings' },
                { name: 'Ví cũ', kind: 'cash', archived: true },
            ]),
        };
        const { page } = await open(app, seed);

        await openImport(page);
        expect(await page.locator('#importSource option').allInnerTexts()).toEqual([
            'Tiền Mặt',
            'Vietcombank',
        ]);

        await page.keyboard.press('Escape');
        await importStatement(page, file(STATEMENT), 'Vietcombank');
        await openImport(page);
        await expect(page.locator('#importSource')).toHaveValue('Vietcombank');
    });
});

test.describe('Nhập sao kê: xem trước và ghi giao dịch', () => {
    test('xem trước đủ giao dịch, bỏ dòng tổng cộng, gợi ý danh mục; nhập xong số dư và danh mục đúng', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openImport(page);
        await chooseFile(page);
        await toPreview(page);

        await expect(summary(page)).toContainText(
            'Đọc được 4 giao dịch từ 25/10/2026 đến 28/10/2026',
        );
        await expect(summary(page)).toContainText('Sẽ nhập 4 giao dịch vào Thẻ Ngân Hàng');
        await expect(summary(page)).toContainText('chi 1.795.000 đ, thu 12.000.000 đ');
        await expect(page.locator('#import-skipped')).toBeVisible();
        await expect(page.locator('#import-skipped-summary')).toHaveText(
            '1 dòng bị bỏ qua (không phải giao dịch)',
        );
        await page.locator('#import-skipped summary').click();
        await expect(page.locator('#import-skipped-list')).toContainText(
            'Dòng 8: Không đọc được ngày',
        );

        const category = (index) =>
            rowsLocator(page).nth(index).locator('select[data-field=category]');

        await expect(category(0)).toHaveValue('Ăn uống');
        await expect(category(1)).toHaveValue('Đi lại');
        await expect(category(2)).toHaveValue('Lương / Thưởng');
        await expect(category(3)).toHaveValue('Chưa phân loại');
        await expect(category(3).locator('option:checked')).toHaveText('Chưa phân loại (mới)');
        await expect(page.locator('#import-commit')).toHaveText('Nhập 4 giao dịch');

        await page.click('#import-commit');

        // The statement lands in the book, the page shows it, and the toast says how to undo.
        await expect(page.locator('#importModal')).not.toHaveClass(/open/);
        await expect(page.locator('#tab-transactions')).toHaveClass(/active/);
        await expect(page.locator('#filter-source')).toHaveValue(BANK);
        await expect(page.locator('#toast-container')).toContainText(
            `Đã nhập 4 giao dịch vào ${BANK}`,
        );

        const list = await stored(page);

        expect(list).toHaveLength(4);
        expect(list.every((entry) => entry.source === BANK && entry.updatedAt)).toBe(true);
        expect(list.every((entry) => /^TX_IMP_2026102\d_[0-9a-f]{8}$/.test(entry.id))).toBe(true);

        const byNote = (text) => list.find((entry) => entry.note.startsWith(text));

        expect(byNote('HIGHLANDS')).toMatchObject({
            date: '2026-10-25',
            type: 'expense',
            amount: 45000,
            category: 'Ăn uống',
            targetSource: null,
        });
        expect(byNote('CTY ABC')).toMatchObject({ type: 'income', amount: 12000000 });
        expect(byNote('CHUYEN KHOAN')).toMatchObject({
            category: 'Chưa phân loại',
            amount: 1500000,
        });
        expect(await page.evaluate((name) => calculateSourceBalances()[name], BANK)).toBe(10205000);
        // The new category exists once, as an expense category.
        expect(
            await page.evaluate(() => categories.filter((c) => c.name === 'Chưa phân loại')),
        ).toMatchObject([{ type: 'expense' }]);
    });

    test('dòng trùng với giao dịch đã nhập tay (cùng nguồn, số tiền, lệch tối đa 2 ngày, kể cả chuyển tiền) chưa được chọn', async ({
        app,
    }) => {
        const { page } = await open(app, {
            fm_transactions: JSON.stringify([
                tx({
                    id: 'M1',
                    date: '2026-10-26',
                    source: BANK,
                    amount: 45000,
                    note: 'Cafe sáng',
                }),
                // Same amount, but typed against another source: not the same money.
                tx({ id: 'M2', date: '2026-10-26', source: 'Tiền Mặt', amount: 250000 }),
                // A withdrawal typed as a transfer is the bank debit of 1.500.000.
                tx({
                    id: 'M3',
                    date: '2026-10-28',
                    type: 'transfer',
                    source: BANK,
                    targetSource: 'Tiền Mặt',
                    category: 'Chuyển tiền nội bộ',
                    amount: 1500000,
                    note: 'Rút ATM',
                }),
            ]),
        });

        await openImport(page);
        await chooseFile(page);
        await toPreview(page);

        const checkbox = (index) =>
            rowsLocator(page).nth(index).locator('input[data-field=include]');

        await expect(checkbox(0)).not.toBeChecked();
        await expect(checkbox(1)).toBeChecked();
        await expect(checkbox(2)).toBeChecked();
        await expect(checkbox(3)).not.toBeChecked();
        await expect(rowsLocator(page).nth(0)).toContainText(
            'Có thể trùng với "Cafe sáng" ngày 26/10/2026',
        );
        await expect(rowsLocator(page).nth(3)).toContainText('Có thể trùng với "Rút ATM"');
        await expect(summary(page)).toContainText('2 dòng có thể trùng');
        await expect(summary(page)).toContainText('Sẽ nhập 2 giao dịch');

        // The person decides: ticking a row counts it again.
        await checkbox(0).check();
        await expect(summary(page)).toContainText('Sẽ nhập 3 giao dịch');
        await checkbox(0).uncheck();
        await page.click('#import-commit');

        expect(
            (await stored(page)).map((entry) => entry.id).filter((id) => id.startsWith('TX_IMP')),
        ).toHaveLength(2);
        expect(await stored(page)).toHaveLength(5);
    });

    test('nhập lại đúng file đó: các dòng đã nhập bị khóa, không thể nhập đôi', async ({ app }) => {
        const { page } = await open(app);

        await importStatement(page);
        expect(await stored(page)).toHaveLength(4);

        await openImport(page);
        await chooseFile(page);
        await toPreview(page);

        await expect(summary(page)).toContainText('4 dòng đã nhập từ lần trước');
        await expect(rowsLocator(page).first().locator('input[data-field=include]')).toBeDisabled();
        await expect(
            rowsLocator(page).first().locator('input[data-field=include]'),
        ).not.toBeChecked();
        await expect(rowsLocator(page).first()).toContainText('Đã nhập từ lần trước');
        await expect(page.locator('#import-commit')).toBeDisabled();
        await expect(page.locator('#import-commit')).toHaveText('Chưa chọn giao dịch nào');

        // "Chọn tất cả" has nothing left to choose.
        await expect(page.locator('#import-select-all')).toBeDisabled();
        await expect(page.locator('#import-select-all')).not.toBeChecked();
    });

    test('sửa loại và danh mục từng dòng, chọn tất cả / bỏ chọn tất cả', async ({ app }) => {
        const { page } = await open(app);

        await openImport(page);
        await chooseFile(page);
        await toPreview(page);

        const row = (index) => rowsLocator(page).nth(index);

        // Highlands is an expense; call it income: the amount flips and the category follows the type.
        await row(0).locator('select[data-field=type]').selectOption('income');
        await expect(row(0).locator('td[data-label="Số tiền"]')).toHaveText('+45.000 đ');
        await expect(row(0).locator('select[data-field=category]')).toHaveValue('Thu nhập khác');
        await expect(row(0).locator('select[data-field=type]')).toBeFocused();
        await expect(summary(page)).toContainText('chi 1.750.000 đ, thu 12.045.000 đ');

        await row(1).locator('select[data-field=category]').selectOption('Mua sắm');

        await page.uncheck('#import-select-all');
        await expect(summary(page)).toContainText('Sẽ nhập 0 giao dịch');
        await expect(page.locator('#import-commit')).toBeDisabled();
        await expect(row(0)).toHaveClass(/import-row-off/);
        await page.check('#import-select-all');
        await expect(summary(page)).toContainText('Sẽ nhập 4 giao dịch');

        await page.click('#import-commit');

        const list = await stored(page);

        expect(list.find((entry) => entry.note.startsWith('HIGHLANDS'))).toMatchObject({
            type: 'income',
            category: 'Thu nhập khác',
        });
        expect(list.find((entry) => entry.note.startsWith('GRAB'))).toMatchObject({
            category: 'Mua sắm',
        });
    });

    test('học danh mục từ giao dịch đã có: cùng cửa hàng thì cùng danh mục', async ({ app }) => {
        const { page } = await open(app, {
            fm_categories: JSON.stringify([
                { id: 1, name: 'Ăn uống', type: 'expense', icon: 'fa-utensils' },
                { id: 9, name: 'Khách', type: 'expense', icon: 'fa-tag' },
                { id: 5, name: 'Lương / Thưởng', type: 'income', icon: 'fa-money-bill-wave' },
            ]),
            fm_transactions: JSON.stringify([
                tx({
                    id: 'H1',
                    date: '2026-09-02',
                    category: 'Khách',
                    note: 'GRAB*TRIP 1234 DN #khachA',
                }),
            ]),
        });

        await openImport(page);
        await chooseFile(page);
        await toPreview(page);

        // GRAB*TRIP is a rule-based "Đi lại" for a new book, but this book filed it under Khách.
        await expect(rowsLocator(page).nth(1).locator('select[data-field=category]')).toHaveValue(
            'Khách',
        );
    });

    test('dấu # trong nội dung không biến thành thẻ; nội dung dài được cắt gọn', async ({
        app,
    }) => {
        const text = [
            'Ngày,Nội dung,Số tiền',
            `27/10/2026,"Mua #keo #302   dán ${'x'.repeat(300)}",-10.000`,
        ].join('\r\n');
        const { page } = await open(app);

        await importStatement(page, file(text));

        const [created] = await stored(page);

        expect(created.note.startsWith('Mua keo 302 dán xxx')).toBe(true);
        expect(created.note).not.toContain('#');
        expect(created.note.length).toBe(200);
    });

    test('nguồn bị lưu trữ trong lúc hộp thoại mở thì báo và không ghi gì', async ({ app }) => {
        const { page, state } = await open(app);

        await openImport(page);
        await chooseFile(page);
        await toPreview(page);
        await page.evaluate((name) => {
            sources.find((source) => source.name === name).archived = true;
        }, BANK);
        await page.click('#import-commit');

        expect(state.alerts.at(-1)).toContain('không còn dùng được');
        await expect(page.locator('#importModal')).toHaveClass(/open/);
        expect(await stored(page)).toHaveLength(0);
    });

    test('nút Quay lại giữ file và các cột; Esc đóng hộp thoại mà không ghi gì', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openImport(page);
        await chooseFile(page);
        await toPreview(page);
        await page.click('button:has-text("Quay lại")');

        await expect(page.locator('#import-step-file')).toBeVisible();
        await expect(page.locator('#importColDebit')).toHaveValue('2');
        await page.keyboard.press('Escape');

        await expect(page.locator('#importModal')).not.toHaveClass(/open/);
        await expect(page.locator('#import-open-btn')).toBeFocused();
        expect(await stored(page)).toHaveLength(0);
    });
});

test.describe('Nhập sao kê: nhớ cột và hoàn tác', () => {
    const ODD = [
        'Cột A,Cột B,Cột C',
        '27/10/2026,Cafe sáng,"-45.000"',
        '28/10/2026,Lương,"12.000.000"',
    ].join('\r\n');

    test('file không có tiêu đề quen thuộc: chọn cột tay một lần, lần sau tự dùng lại', async ({
        app,
    }) => {
        const { page } = await open(app);

        await openImport(page);
        await chooseFile(page, file(ODD));
        await expect(page.locator('#importMessage')).toContainText('Không thấy dòng tiêu đề');

        await page.fill('#importHeaderRow', '1');
        await page.dispatchEvent('#importHeaderRow', 'change');
        await page.selectOption('#importColDate', '0');
        await page.selectOption('#importColDescription', '1');
        await page.selectOption('#importColAmount', '2');
        await toPreview(page);
        await expect(rowsLocator(page)).toHaveCount(2);
        await page.click('#import-commit');

        // The same kind of file (same header row) next month needs no choosing.
        await openImport(page);
        await chooseFile(
            page,
            file(['Cột A,Cột B,Cột C', '05/11/2026,Cơm,-40.000'].join('\r\n'), 'thang-11.csv'),
        );
        await expect(page.locator('#importMessage')).toContainText(
            'dùng lại các cột bạn chọn lần trước',
        );
        await expect(page.locator('#importColAmount')).toHaveValue('2');
        await toPreview(page);
        await expect(rowsLocator(page)).toHaveCount(1);
    });

    test('Hoàn tác xóa đúng các giao dịch của lần nhập vừa rồi, giữ các giao dịch khác', async ({
        app,
    }) => {
        const { page, state } = await open(app, {
            fm_transactions: JSON.stringify([tx({ id: 'KEEP', date: '2026-10-01', amount: 999 })]),
        });

        await goTab(page, 'settings');
        await expect(page.locator('#import-undo-btn')).toBeHidden();

        await importStatement(page);
        expect(await stored(page)).toHaveLength(5);

        await goTab(page, 'settings');
        await expect(page.locator('#import-undo-btn')).toBeVisible();
        await expect(page.locator('#import-undo-label')).toHaveText(
            'Hoàn tác lần nhập vừa rồi (4 giao dịch)',
        );
        await page.click('#import-undo-btn');

        expect(state.confirms.at(-1)).toContain('Xóa 4 giao dịch đã nhập từ file "sao-ke.csv"');
        expect((await stored(page)).map((entry) => entry.id)).toEqual(['KEEP']);
        await expect(page.locator('#import-undo-btn')).toBeHidden();

        // Nothing is left to undo after a reload either.
        await page.reload();
        await goTab(page, 'settings');
        await expect(page.locator('#import-undo-btn')).toBeHidden();
    });

    test('nút Hoàn tác biến mất khi các giao dịch đã bị xóa tay hết', async ({ app }) => {
        const { page } = await open(app);

        await importStatement(page);
        await page.evaluate(() => {
            transactions = [];
            renderAll();
        });
        await goTab(page, 'settings');
        await expect(page.locator('#import-undo-btn')).toBeHidden();
    });
});

test.describe('Nhập sao kê và đồng bộ', () => {
    test('giao dịch và danh mục mới lên Sheet v2; hoàn tác xóa chúng trên Sheet', async ({
        app,
    }) => {
        const server = newServer('v2');
        const { page } = await app({ server, now: NOW, seed: syncedSeed([]) });

        await importStatement(page);
        await wait(500);

        const state = server.get({ v: '2' });

        expect(state.transactions).toHaveLength(4);
        expect(state.transactions.every((row) => row.id.startsWith('TX_IMP_'))).toBe(true);
        expect(state.meta.categories.value.map((c) => c.name)).toContain('Chưa phân loại');

        await goTab(page, 'settings');
        await page.click('#import-undo-btn');
        await wait(500);

        expect(server.get({ v: '2' }).transactions).toHaveLength(0);
    });

    test('hai máy nhập cùng một file: cùng id nên Sheet không bị nhân đôi', async ({ app }) => {
        const server = newServer('v2');
        const a = await app({ server, now: NOW, seed: syncedSeed([]) });
        const b = await app({ server, now: NOW, seed: syncedSeed([]) });

        await importStatement(a.page);
        await wait(500);
        await importStatement(b.page);
        await wait(500);

        expect(server.get({ v: '2' }).transactions).toHaveLength(4);
    });
});

test.describe('Nhập sao kê: giao diện', () => {
    test('trợ năng: cả hai bước của hộp thoại không vi phạm axe', async ({ app }) => {
        const { page } = await open(app);

        await openImport(page);
        await chooseFile(page);
        await settle(page);

        const step1 = await scanA11y(page, '#importModal');

        expect(step1.violations.map((violation) => violation.id)).toEqual([]);

        await toPreview(page);
        await settle(page);

        const step2 = await scanA11y(page, '#importModal');

        expect(step2.violations.map((violation) => violation.id)).toEqual([]);
    });

    test('điện thoại: không tràn ngang ở cả hai bước; mỗi dòng xem trước là một thẻ có nhãn', async ({
        app,
    }) => {
        const { page } = await open(app, {}, { viewport: { width: 390, height: 844 } });

        await page.evaluate(() => switchTab('settings'));
        await page.evaluate(() => openImportModal());
        await chooseFile(page);
        await settle(page);

        const overflow = () =>
            page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        const box = await page.locator('#importModal .modal-content').boundingBox();

        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(await overflow()).toBe(0);

        await toPreview(page);
        await settle(page);

        await expect(rowsLocator(page).first().locator('td[data-label="Danh mục"]')).toBeVisible();
        expect(await overflow()).toBe(0);

        const results = await scanA11y(page, '#importModal');

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
});
