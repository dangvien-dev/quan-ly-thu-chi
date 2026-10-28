// Tests for apps-script/Code.gs (protocol v2 and the legacy requests it still accepts) against the
// in-memory spreadsheet mock.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, dateCell } = require('./sandbox');

const HEADER_7 = ['id', 'date', 'type', 'source', 'category', 'amount', 'note'];
const HEADER_9 = [...HEADER_7, 'targetSource', 'updatedAt'];

// The existing "Transactions" sheet of DataThuChi_CaNhan: 7 columns, real date cells.
const existingSheet = () => [
    HEADER_7,
    [
        'TX_1793107199811',
        dateCell('2026-10-27'),
        'expense',
        'Tiền Mặt',
        'Ăn uống',
        17000,
        'Cafe sáng',
    ],
    [
        'TX_1793107122617',
        dateCell('2026-10-26'),
        'expense',
        'Spaylater',
        'Đồ nghề và dụng cụ',
        224500,
        'Túi đồ nghề Daikin',
    ],
];

const row = (overrides = {}) => ({
    id: 'TX_1',
    date: '2026-10-28',
    type: 'expense',
    source: 'Tiền Mặt',
    targetSource: '',
    category: 'Ăn uống',
    amount: 1000,
    note: '',
    updatedAt: '2026-10-28T01:00:00.000Z',
    ...overrides,
});
const sync = (gas, body) => gas.post({ action: 'sync', ...body });
const ids = (gas) => gas.get().map((item) => item.id);

test.describe('yêu cầu cũ (tương thích với client và script ban đầu)', () => {
    test('GET trả mảng; sheet 7 cột được bổ sung cột targetSource và updatedAt', () => {
        const gas = createGas({ sheets: { Transactions: existingSheet() } });
        const rows = gas.get();

        assert.ok(Array.isArray(rows));
        assert.equal(rows.length, 2);
        assert.equal(rows[0].date, '2026-10-27');
        assert.equal(rows[1].date, '2026-10-26');
        assert.deepEqual(gas.sheet('Transactions').grid[0], HEADER_9);
    });

    test('POST {transactions} ghi lại, giữ targetSource, ngày, số tiền; ghi chú công thức là text', () => {
        const gas = createGas({ sheets: { Transactions: existingSheet() } });
        const data = [
            row({
                id: 'TX_1',
                type: 'transfer',
                targetSource: 'Thẻ Ngân Hàng',
                amount: 100000,
                note: '=1+1',
            }),
            row({ id: 'TX_2', date: '2026-10-27', source: 'Spaylater', amount: 17000 }),
        ];

        assert.deepEqual(gas.post({ transactions: data }), {
            status: 'success',
            ok: true,
            rows: 2,
        });
        assert.deepEqual(
            gas
                .get()
                .map((item) => [item.id, item.date, item.targetSource, item.amount, item.note]),
            [
                ['TX_1', '2026-10-28', 'Thẻ Ngân Hàng', 100000, '=1+1'],
                ['TX_2', '2026-10-27', '', 17000, ''],
            ],
        );

        const { formats } = gas.sheet('Transactions');

        assert.equal(formats[1], '@', 'id là text');
        assert.equal(formats[7], '@', 'note là text, không bị hiểu thành công thức');
        assert.equal(formats[8], '@', 'targetSource là text');
        assert.equal(formats[2], 'dd/mm/yyyy', 'cột ngày hiển thị dd/mm/yyyy');
    });

    test('REGRESSION: body sai định dạng không bao giờ xóa Sheet (sự cố 28/10/2026)', () => {
        const gas = createGas({ sheets: { Transactions: existingSheet() } });

        for (const body of [
            { action: 'save', data: [row()] }, // what the first PR #3 client sent
            { data: [row()] },
            { transactions: 'not a list' },
            { transactions: [row(), { junk: true }] },
            {},
        ]) {
            const reply = gas.post(body);

            assert.ok(reply.error, `phải báo lỗi cho ${JSON.stringify(body).slice(0, 40)}`);
            assert.equal(ids(gas).length, 2, 'dữ liệu phải còn nguyên');
        }

        assert.ok(gas.postRaw('not json').error);
        assert.equal(ids(gas).length, 2);
    });

    test('POST {transactions: []} xóa các dòng dữ liệu nhưng giữ header', () => {
        const gas = createGas({ sheets: { Transactions: existingSheet() } });

        gas.post({ transactions: [] });

        assert.deepEqual(gas.get(), []);
        assert.equal(gas.sheet('Transactions').grid[0].length, 9);
    });

    test('GET ?action=save&data= ghi được, dữ liệu có dấu % không bị giải mã hai lần', () => {
        const gas = createGas({ sheets: { Transactions: existingSheet() } });
        const data = JSON.stringify([row({ id: 'TX_9', note: 'giảm 50%' })]);

        assert.equal(gas.get({ action: 'save', data }).ok, true);
        assert.deepEqual(
            gas.get().map((item) => [item.id, item.note]),
            [['TX_9', 'giảm 50%']],
        );
    });

    test('GET ?action=save với dữ liệu hỏng báo lỗi và không xóa gì', () => {
        const gas = createGas({ sheets: { Transactions: existingSheet() } });

        assert.ok(gas.get({ action: 'save', data: '{not json' }).error);
        assert.ok(gas.get({ action: 'save', data: '[{"junk":1}]' }).error);
        assert.equal(ids(gas).length, 2);
    });

    test('sheet trống: tạo header đủ cột và trả về []', () => {
        const gas = createGas();

        assert.deepEqual(gas.get(), []);
        assert.deepEqual(gas.sheet('Transactions').grid[0], HEADER_9);
    });
});

test.describe('giao thức v2', () => {
    test('GET ?v=2 trả trạng thái đầy đủ', () => {
        const gas = createGas({ sheets: { Transactions: existingSheet() } });
        const state = gas.get({ v: '2' });

        assert.equal(state.version, 2);
        assert.equal(state.transactions.length, 2);
        assert.deepEqual(state.meta, {});
        assert.ok(state.serverTime);
    });

    test('upsert thêm dòng mới và chỉ ghi đè khi updatedAt bằng hoặc mới hơn', () => {
        const gas = createGas();

        sync(gas, { upserts: [row({ id: 'A', amount: 100 }), row({ id: 'B', amount: 200 })] });
        assert.deepEqual(ids(gas), ['A', 'B']);

        sync(gas, {
            upserts: [row({ id: 'A', amount: 111, updatedAt: '2026-10-28T00:00:00.000Z' })],
        });
        assert.equal(gas.get().find((item) => item.id === 'A').amount, 100, 'bản cũ hơn bị bỏ qua');

        sync(gas, {
            upserts: [row({ id: 'A', amount: 222, updatedAt: '2026-10-28T02:00:00.000Z' })],
        });
        assert.equal(gas.get().find((item) => item.id === 'A').amount, 222, 'bản mới hơn thắng');

        sync(gas, {
            upserts: [row({ id: 'A', amount: 333, updatedAt: '2026-10-28T02:00:00.000Z' })],
        });
        assert.equal(
            gas.get().find((item) => item.id === 'A').amount,
            333,
            'cùng thời điểm: bản gửi sau thắng',
        );
        assert.deepEqual(ids(gas), ['A', 'B'], 'thứ tự dòng ổn định');
    });

    test('sync chỉ động đến các dòng được gửi; dòng không có updatedAt (legacy) vẫn nâng cấp được', () => {
        const gas = createGas({ sheets: { Transactions: existingSheet() } });

        sync(gas, {
            upserts: [
                row({
                    id: 'TX_1793107199811',
                    amount: 18000,
                    updatedAt: '2026-10-28T01:00:00.000Z',
                }),
            ],
        });

        const rows = gas.get();

        assert.equal(rows.find((item) => item.id === 'TX_1793107199811').amount, 18000);
        assert.equal(rows.find((item) => item.id === 'TX_1793107122617').amount, 224500);
    });

    test('deletes xóa dòng; xóa rồi upsert lại cùng id trong một yêu cầu thì còn đúng một dòng', () => {
        const gas = createGas();

        sync(gas, { upserts: [row({ id: 'A' }), row({ id: 'B' }), row({ id: 'C' })] });
        sync(gas, { deletes: ['B', 'khong-ton-tai'] });
        assert.deepEqual(ids(gas), ['A', 'C']);

        sync(gas, { deletes: ['A'], upserts: [row({ id: 'A', amount: 5 })] });
        assert.deepEqual(ids(gas), ['A', 'C']); // one row, kept in its original place
    });

    test('replace thay toàn bộ danh sách và ép ghi đè meta', () => {
        const gas = createGas();

        sync(gas, {
            upserts: [row({ id: 'A' }), row({ id: 'B' })],
            meta: { budgets: { value: { 'Ăn uống': 1 }, updatedAt: '2026-10-28T05:00:00.000Z' } },
        });
        sync(gas, {
            replace: true,
            upserts: [row({ id: 'Z' })],
            meta: { budgets: { value: { 'Đi lại': 2 }, updatedAt: '2026-10-01T00:00:00.000Z' } },
        });

        assert.deepEqual(ids(gas), ['Z']);
        assert.deepEqual(gas.get({ v: '2' }).meta.budgets.value, { 'Đi lại': 2 });
    });

    test('replace với danh sách rỗng xóa hết dòng', () => {
        const gas = createGas({ sheets: { Transactions: existingSheet() } });

        sync(gas, { replace: true, upserts: [] });

        assert.deepEqual(gas.get(), []);
    });

    test('dòng không hợp lệ trong upserts bị bỏ qua, các dòng hợp lệ vẫn được ghi', () => {
        const gas = createGas();

        sync(gas, {
            upserts: [
                row({ id: 'A' }),
                { junk: true },
                row({ id: '', amount: 1 }),
                row({ id: 'B', type: 'x' }),
            ],
        });

        assert.deepEqual(ids(gas), ['A']);
    });

    test('meta: giữ bản có updatedAt mới hơn, trả về giá trị đã parse', () => {
        const gas = createGas();
        const categories = (names, updatedAt) => ({
            value: names.map((name) => ({ name })),
            updatedAt,
        });

        sync(gas, { meta: { categories: categories(['Mới'], '2026-10-28T02:00:00.000Z') } });
        sync(gas, { meta: { categories: categories(['Cũ'], '2026-10-28T01:00:00.000Z') } });

        assert.deepEqual(gas.get({ v: '2' }).meta.categories.value, [{ name: 'Mới' }]);

        sync(gas, { meta: { categories: categories(['Mới hơn'], '2026-10-28T03:00:00.000Z') } });

        assert.deepEqual(gas.get({ v: '2' }).meta.categories.value, [{ name: 'Mới hơn' }]);
        assert.equal(gas.get({ v: '2' }).meta.categories.updatedAt, '2026-10-28T03:00:00.000Z');
    });

    test('meta quá lớn cho một ô bị từ chối và không làm hỏng dữ liệu', () => {
        const gas = createGas();

        sync(gas, { upserts: [row({ id: 'A' })] });

        const reply = sync(gas, {
            meta: { debts: { value: ['x'.repeat(50000)], updatedAt: '2026-10-28T00:00:00.000Z' } },
        });

        assert.match(reply.error, /quá lớn/);
        assert.deepEqual(ids(gas), ['A']);
    });

    test('ô meta bị sửa tay thành JSON hỏng thì bị bỏ qua thay vì làm hỏng đồng bộ', () => {
        const gas = createGas({
            sheets: {
                Meta: [
                    ['key', 'value', 'updatedAt'],
                    ['budgets', '{oops', 'x'],
                    ['sources', '[]', 'y'],
                ],
            },
        });

        assert.deepEqual(Object.keys(gas.get({ v: '2' }).meta), ['sources']);
    });

    test('GET ?action=sync&payload= hoạt động như POST (dự phòng khi POST bị chặn)', () => {
        const gas = createGas();
        const payload = JSON.stringify({ upserts: [row({ id: 'A' })] });
        const reply = gas.get({ action: 'sync', payload });

        assert.equal(reply.version, 2);
        assert.deepEqual(ids(gas), ['A']);
    });
});

test.describe('mã bảo vệ (FM_TOKEN)', () => {
    const secured = () =>
        createGas({
            sheets: { Transactions: existingSheet() },
            properties: { FM_TOKEN: 'bi-mat' },
        });

    test('không đặt token thì mọi yêu cầu đều mở', () => {
        const gas = createGas({ sheets: { Transactions: existingSheet() } });

        assert.equal(gas.get({ v: '2' }).version, 2);
        assert.equal(sync(gas, { upserts: [row({ id: 'A' })] }).version, 2);
    });

    test('đặt token: thiếu hoặc sai token bị từ chối ở mọi đường vào và không ghi gì', () => {
        const gas = secured();
        const before = JSON.stringify(gas.sheet('Transactions').grid);

        assert.equal(gas.get({ v: '2' }).error, 'unauthorized');
        assert.equal(gas.get({ v: '2', token: 'sai' }).error, 'unauthorized');
        assert.equal(gas.get().error, 'unauthorized', 'GET kiểu cũ cũng bị chặn');
        assert.equal(sync(gas, { upserts: [row({ id: 'A' })] }).error, 'unauthorized');
        assert.equal(sync(gas, { token: 'sai', replace: true, upserts: [] }).error, 'unauthorized');
        assert.equal(
            gas.post({ transactions: [] }).error,
            'unauthorized',
            'POST kiểu cũ cũng bị chặn',
        );
        assert.equal(gas.get({ action: 'save', data: '[]' }).error, 'unauthorized');
        assert.equal(
            gas.get({ action: 'sync', payload: JSON.stringify({ replace: true }) }).error,
            'unauthorized',
        );

        assert.equal(JSON.stringify(gas.sheet('Transactions').grid), before, 'sheet không đổi');
    });

    test('đúng token thì dùng được', () => {
        const gas = secured();

        assert.equal(gas.get({ v: '2', token: 'bi-mat' }).version, 2);
        assert.equal(
            sync(gas, { token: 'bi-mat', upserts: [row({ id: 'A' })] }).transactions.length,
            3,
        );
        assert.equal(gas.get({ token: 'bi-mat' }).length, 3);
    });
});
