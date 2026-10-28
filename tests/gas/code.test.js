// Tests for apps-script/Code.gs (legacy protocol) against the in-memory spreadsheet mock.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, dateCell } = require('./sandbox');

const HEADER_7 = ['id', 'date', 'type', 'source', 'category', 'amount', 'note'];
const HEADER_8 = [...HEADER_7, 'targetSource'];

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

const save = (gas, data) => gas.post({ action: 'save', data });

test('đọc sheet 7 cột cũ: ngày yyyy-MM-dd và thêm cột targetSource ở cuối', () => {
    const gas = createGas({ sheets: { Transactions: existingSheet() } });
    const rows = gas.get();

    assert.equal(rows.length, 2);
    assert.equal(rows[0].date, '2026-10-27');
    assert.equal(rows[1].date, '2026-10-26');
    assert.deepEqual(gas.sheet('Transactions').grid[0], HEADER_8);
});

test('ghi rồi đọc lại giữ nguyên targetSource, ngày, số tiền và ghi chú dạng công thức', () => {
    const gas = createGas({ sheets: { Transactions: existingSheet() } });
    const data = [
        {
            id: 'TX_1',
            date: '2026-10-28',
            type: 'transfer',
            source: 'Tiền Mặt',
            targetSource: 'Thẻ Ngân Hàng',
            category: 'Chuyển tiền nội bộ',
            amount: 100000,
            note: '=1+1',
        },
        {
            id: 'TX_2',
            date: '2026-10-27',
            type: 'expense',
            source: 'Spaylater',
            targetSource: null,
            category: 'Ăn uống',
            amount: 17000,
            note: '',
        },
    ];

    assert.deepEqual(save(gas, data), { ok: true, rows: 2 });
    assert.deepEqual(
        gas.get().map((row) => [row.id, row.date, row.targetSource, row.amount, row.note]),
        [
            ['TX_1', '2026-10-28', 'Thẻ Ngân Hàng', 100000, '=1+1'],
            ['TX_2', '2026-10-27', '', 17000, ''],
        ],
    );

    const { formats } = gas.sheet('Transactions');

    assert.equal(formats[1], '@', 'id là text');
    assert.equal(formats[7], '@', 'note là text, không bị hiểu thành công thức');
    assert.equal(formats[8], '@', 'targetSource là text');
    assert.equal(formats[2], 'yyyy-mm-dd');
});

test('lưu danh sách ngắn hơn hoặc rỗng xóa các dòng thừa và giữ header', () => {
    const gas = createGas({ sheets: { Transactions: existingSheet() } });

    save(gas, [{ id: 'TX_1', date: '2026-10-28', type: 'expense', amount: 1 }]);
    assert.deepEqual(
        gas.get().map((row) => row.id),
        ['TX_1'],
    );

    save(gas, []);
    assert.deepEqual(gas.get(), []);
    assert.equal(gas.sheet('Transactions').grid[0].length, 8);
});

test('yêu cầu sai hoặc JSON hỏng trả về {error}', () => {
    const gas = createGas();

    assert.deepEqual(Object.keys(gas.post({ action: 'x' })), ['error']);
    assert.deepEqual(Object.keys(gas.postRaw('not json')), ['error']);
});

test('sheet trống: tạo header đủ cột và trả về []', () => {
    const gas = createGas();

    assert.deepEqual(gas.get(), []);
    assert.deepEqual(gas.sheet('Transactions').grid[0], HEADER_8);
});
