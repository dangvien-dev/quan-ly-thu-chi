// Pure helpers in js/utils.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./load');

const run = loadScripts('js/utils.js');
// Values cross the vm boundary with foreign prototypes; compare them as plain JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

const tx = (overrides) => ({
    id: 'TX_1',
    date: '2026-10-27',
    type: 'expense',
    source: 'Tiền Mặt',
    targetSource: null,
    category: 'Ăn uống',
    amount: 1000,
    note: '',
    ...overrides,
});

const filter = (list, filters) =>
    plain(run(`filterTransactions(${JSON.stringify(list)}, ${JSON.stringify(filters)})`)).map(
        (item) => item.id,
    );

test('normalizeSearchText bỏ dấu, đ -> d, gộp khoảng trắng', () => {
    assert.equal(run('normalizeSearchText("  Cà   PHÊ Đá ")'), 'ca phe da');
    assert.equal(run('normalizeSearchText(null)'), '');
});

test('formatMoney dùng dấu chấm kiểu Việt Nam và đ', () => {
    assert.equal(run('formatMoney(1234567)'), '1.234.567 đ');
    assert.equal(run('formatMoney(-1000)'), '-1.000 đ');
    assert.equal(run('formatMoney("abc")'), '0 đ');
});

test('normalizeDate: ngày thuần, dd/mm/yyyy, ISO UTC theo giờ máy, rác', () => {
    assert.equal(run('normalizeDate("2026-10-27")'), '2026-10-27');
    assert.equal(run('normalizeDate("7/3/2026")'), '2026-03-07');
    assert.equal(run('normalizeDate("not a date")'), '');
    assert.equal(run('normalizeDate("")'), '');
});

test('normalizeTransaction chuẩn hoá số tiền chuỗi, loại bỏ dòng rỗng, cấp id khi thiếu', () => {
    assert.equal(
        run('normalizeTransaction({id:"a",type:"income",amount:"224.500"}).amount'),
        224500,
    );
    assert.equal(
        run('normalizeTransaction({id:"a",type:"income",amount:"17000.5"}).amount'),
        17000.5,
    );
    assert.equal(run('normalizeTransaction({id:"",date:"",type:"",amount:""})'), null);
    assert.equal(run('normalizeTransaction({id:"a",type:"expense",amount:""})'), null);
    assert.match(run('normalizeTransaction({type:"expense",amount:5}).id'), /^TX_\d+_0$/);
    assert.equal(
        run('normalizeTransaction({id:"a",type:"expense",amount:1,targetSource:"x"}).targetSource'),
        null,
    );
});

test('normalizeTransactions bỏ trùng id', () => {
    const list = run(
        'normalizeTransactions([{id:"a",type:"expense",amount:1},{id:"a",type:"income",amount:2}])',
    );

    assert.equal(list.length, 1);
    assert.equal(list[0].type, 'expense');
});

test('normalizeSource chấp nhận dạng chuỗi cũ và giới hạn trường theo loại', () => {
    assert.deepEqual(plain(run('normalizeSource("Momo")')), {
        name: 'Momo',
        kind: 'other',
        creditLimit: 0,
        statementDay: null,
        dueDay: null,
        archived: false,
    });
    assert.deepEqual(
        plain(
            run(
                'normalizeSource({name:"Visa",kind:"credit",creditLimit:"5000000",statementDay:"31",dueDay:40})',
            ),
        ),
        {
            name: 'Visa',
            kind: 'credit',
            creditLimit: 5000000,
            statementDay: 31,
            dueDay: null,
            archived: false,
        },
    );
    assert.equal(run('normalizeSource({name:"Bank",kind:"bank",creditLimit:9}).creditLimit'), 0);
    assert.equal(run('normalizeSource({name:"  "})'), null);
    assert.equal(run('normalizeSources([])'), null);
    assert.equal(run('normalizeSources("x")'), null);
});

test('nextDayOfMonth: hôm nay, tháng sau, kẹp ngày cuối tháng', () => {
    const next = (day, from) =>
        run(
            `(() => { const d = nextDayOfMonth(${day}, new Date(${from})); return [d.getFullYear(), d.getMonth() + 1, d.getDate()]; })()`,
        );

    assert.deepEqual(plain(next(28, '2026, 9, 28')), [2026, 10, 28]);
    assert.deepEqual(plain(next(15, '2026, 9, 28')), [2026, 11, 15]);
    assert.deepEqual(plain(next(31, '2026, 10, 2')), [2026, 11, 30]);
    assert.deepEqual(plain(next(31, '2026, 0, 31')), [2026, 1, 31]);
});

test('shiftMonthKey đi qua ranh giới năm', () => {
    assert.equal(run('shiftMonthKey("2026-01", -1)'), '2025-12');
    assert.equal(run('shiftMonthKey("2026-12", 1)'), '2027-01');
});

test.describe('filterTransactions', () => {
    const list = [
        tx({ id: 'a', date: '2026-10-05', note: 'Cà phê sáng', amount: 20000 }),
        tx({ id: 'b', date: '2026-09-30', category: 'Đi lại', note: 'Xăng xe', amount: 50000 }),
        tx({
            id: 'c',
            date: '2026-10-12',
            type: 'income',
            category: 'Lương / Thưởng',
            amount: 15000000,
        }),
        tx({
            id: 'd',
            date: '2026-10-20',
            type: 'transfer',
            source: 'Thẻ Ngân Hàng',
            targetSource: 'Momo',
            category: 'Chuyển tiền nội bộ',
            amount: 300000,
        }),
    ];

    test('theo tháng, loại, danh mục', () => {
        assert.deepEqual(filter(list, { month: '2026-10' }), ['a', 'c', 'd']);
        assert.deepEqual(filter(list, { type: 'income' }), ['c']);
        assert.deepEqual(filter(list, { type: 'ALL', category: 'Đi lại' }), ['b']);
    });

    test('nguồn khớp cả nguồn chuyển và nguồn nhận', () => {
        assert.deepEqual(filter(list, { source: 'Momo' }), ['d']);
        assert.deepEqual(filter(list, { source: 'Thẻ Ngân Hàng' }), ['d']);
    });

    test('tìm kiếm không dấu, nhiều từ phải cùng khớp, khớp cả số tiền', () => {
        assert.deepEqual(filter(list, { search: 'ca phe' }), ['a']);
        assert.deepEqual(filter(list, { search: 'xang  XE' }), ['b']);
        assert.deepEqual(filter(list, { search: 'xang ca' }), []);
        assert.deepEqual(filter(list, { search: '15.000.000' }), ['c']);
        assert.deepEqual(filter(list, { search: '300000' }), ['d']);
    });

    test('kết hợp nhiều bộ lọc', () => {
        assert.deepEqual(filter(list, { month: '2026-10', type: 'expense', search: 'phe' }), ['a']);
    });
});

test.describe('CSV', () => {
    test('có BOM, dòng tiêu đề tiếng Việt, số tiền là số thô', () => {
        const csv = run(
            `buildTransactionsCsv([${JSON.stringify(tx({ amount: 17000, note: 'Cafe' }))}])`,
        );

        assert.ok(csv.startsWith('﻿Ngày,Loại,Nguồn tiền,Nguồn nhận,Danh mục,Số tiền,Ghi chú\r\n'));
        assert.ok(csv.includes('2026-10-27,Chi,Tiền Mặt,,Ăn uống,17000,Cafe\r\n'));
    });

    test('escape dấu phẩy, nháy kép, xuống dòng', () => {
        assert.equal(run("csvCell('a,b')"), '"a,b"');
        assert.equal(run('csvCell(\'say "hi"\')'), '"say ""hi"""');
        assert.equal(run('csvCell("line1\\nline2")'), '"line1\nline2"');
    });

    test('chặn CSV injection nhưng không đụng số tiền âm', () => {
        assert.equal(run('csvCell("=HYPERLINK(1)")'), "'=HYPERLINK(1)");
        assert.equal(run('csvCell("+84 912")'), "'+84 912");
        assert.equal(run('csvCell("@cmd")'), "'@cmd");
        assert.equal(run('csvCell(-5000, { isText: false })'), '-5000');
    });
});
