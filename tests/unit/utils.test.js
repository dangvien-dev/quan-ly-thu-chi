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

test.describe('ngân sách', () => {
    test('normalizeBudgets chỉ giữ số dương làm tròn, từ chối không phải object', () => {
        assert.deepEqual(
            plain(run('normalizeBudgets({"Ăn uống":"2000000.4","Đi lại":0,"Xấu":"abc","":5})')),
            {
                'Ăn uống': 2000000,
            },
        );
        assert.equal(run('normalizeBudgets([1])'), null);
        assert.equal(run('normalizeBudgets(null)'), null);
    });

    test('budgetLevel: dưới 80% = 0, từ 80% = 1, từ 100% = 2', () => {
        assert.deepEqual(
            [0, 0.79, 0.8, 0.99, 1, 1.5].map((ratio) => run(`budgetLevel(${ratio})`)),
            [0, 0, 1, 1, 2, 2],
        );
    });

    test('computeBudgetStatus chỉ cộng chi tiêu trong tháng, sắp xếp theo mức dùng giảm dần', () => {
        const list = [
            tx({ category: 'Ăn uống', amount: 300000, date: '2026-10-02' }),
            tx({ id: '2', category: 'Ăn uống', amount: 200000, date: '2026-10-20' }),
            tx({ id: '3', category: 'Ăn uống', amount: 999999, date: '2026-09-30' }),
            tx({
                id: '4',
                category: 'Ăn uống',
                type: 'income',
                amount: 999999,
                date: '2026-10-03',
            }),
            tx({ id: '5', category: 'Đi lại', amount: 90000, date: '2026-10-05' }),
        ];
        const status = plain(
            run(
                `computeBudgetStatus(${JSON.stringify(list)}, ${JSON.stringify({ 'Ăn uống': 1000000, 'Đi lại': 100000, 'Mua sắm': 500000 })}, "2026-10")`,
            ),
        );

        assert.deepEqual(
            status.map((item) => [item.category, item.spent, item.ratio]),
            [
                ['Đi lại', 90000, 0.9],
                ['Ăn uống', 500000, 0.5],
                ['Mua sắm', 0, 0],
            ],
        );
    });
});

test.describe('giao dịch định kỳ', () => {
    const rule = (overrides) => ({
        id: 'RC_1730000000000',
        name: 'Tiền nhà',
        type: 'expense',
        source: 'Tiền Mặt',
        category: 'Hóa đơn & Tiện ích',
        amount: 3000000,
        frequency: 'monthly',
        day: 5,
        startDate: '2026-08-05',
        endDate: '',
        active: true,
        lastGenerated: '',
        ...overrides,
    });
    const due = (overrides, today) =>
        plain(
            run(
                `recurringDueDates(normalizeRecurringRule(${JSON.stringify(rule(overrides))}), "${today}")`,
            ),
        );
    const next = (overrides, today) =>
        run(
            `nextRecurringDate(normalizeRecurringRule(${JSON.stringify(rule(overrides))}), "${today}")`,
        );

    test('hằng tháng: đủ các kỳ từ ngày bắt đầu đến hôm nay, không tính ngày chưa tới', () => {
        assert.deepEqual(due({}, '2026-10-28'), ['2026-08-05', '2026-09-05', '2026-10-05']);
        assert.deepEqual(due({}, '2026-10-04'), ['2026-08-05', '2026-09-05']);
        assert.deepEqual(due({ startDate: '2026-11-01' }, '2026-10-28'), []);
    });

    test('hằng tháng: ngày 31 lùi về ngày cuối của tháng ngắn', () => {
        assert.deepEqual(due({ day: 31, startDate: '2026-01-31' }, '2026-04-30'), [
            '2026-01-31',
            '2026-02-28',
            '2026-03-31',
            '2026-04-30',
        ]);
    });

    test('hằng tuần: đúng thứ trong tuần', () => {
        // 2026-10-01 is a Thursday; day 1 = Monday.
        assert.deepEqual(
            due({ frequency: 'weekly', day: 1, startDate: '2026-10-01' }, '2026-10-28'),
            ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'],
        );
        assert.deepEqual(
            due({ frequency: 'weekly', day: 0, startDate: '2026-10-01' }, '2026-10-12'),
            ['2026-10-04', '2026-10-11'],
        );
    });

    test('bỏ qua các kỳ đã tạo, dừng ở ngày kết thúc, không chạy khi tạm dừng', () => {
        assert.deepEqual(due({ lastGenerated: '2026-09-05' }, '2026-10-28'), ['2026-10-05']);
        assert.deepEqual(due({ lastGenerated: '2026-10-05' }, '2026-10-28'), []);
        assert.deepEqual(due({ endDate: '2026-09-30' }, '2026-10-28'), [
            '2026-08-05',
            '2026-09-05',
        ]);
        assert.deepEqual(due({ active: false }, '2026-10-28'), []);
    });

    test('giới hạn số giao dịch tạo mỗi lần', () => {
        const dates = plain(
            run(
                `recurringDueDates(normalizeRecurringRule(${JSON.stringify(rule({ frequency: 'weekly', day: 1, startDate: '2010-01-01' }))}), "2026-10-28", 50)`,
            ),
        );

        assert.equal(dates.length, 50);
        assert.equal(dates[0], '2010-01-04');
    });

    test('nextRecurringDate: kỳ kế tiếp sau hôm nay, bỏ qua khi đã kết thúc hoặc tạm dừng', () => {
        assert.equal(next({}, '2026-10-28'), '2026-11-05');
        assert.equal(next({}, '2026-10-05'), '2026-11-05');
        assert.equal(next({ startDate: '2026-12-10' }, '2026-10-28'), '2027-01-05');
        assert.equal(next({ endDate: '2026-10-31' }, '2026-10-28'), '');
        assert.equal(next({ active: false }, '2026-10-28'), '');
    });

    test('id giao dịch sinh ra là xác định', () => {
        const id = run(`recurringTransactionId(${JSON.stringify(rule({}))}, "2026-10-05")`);

        assert.equal(id, 'TX_R1730000000000_20261005');
    });

    test('normalizeRecurringRule từ chối dữ liệu hỏng và chuẩn hoá chuyển tiền', () => {
        const normalize = (value) => plain(run(`normalizeRecurringRule(${JSON.stringify(value)})`));

        assert.equal(normalize(rule({ amount: 0 })), null);
        assert.equal(normalize(rule({ type: 'x' })), null);
        assert.equal(normalize(rule({ startDate: 'xx' })), null);
        assert.equal(normalize(rule({ id: '' })), null);
        assert.equal(normalize(rule({ day: 99 })).day, 1);

        const transfer = normalize(
            rule({ type: 'transfer', targetSource: 'Momo', category: 'bỏ qua' }),
        );

        assert.equal(transfer.category, 'Chuyển tiền nội bộ');
        assert.equal(transfer.targetSource, 'Momo');
    });
});
