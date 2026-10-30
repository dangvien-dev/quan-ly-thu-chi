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
        assert.ok(csv.includes('27/10/2026,Chi,Tiền Mặt,,Ăn uống,17000,Cafe\r\n'));
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

test.describe('vay nợ', () => {
    const debt = (overrides) => ({
        id: 'DB_1',
        party: 'Anh Nam',
        direction: 'owe',
        amount: 1000000,
        date: '2026-10-01',
        dueDate: '2026-11-01',
        payments: [],
        ...overrides,
    });
    const call = (expression, value) =>
        run(expression.replace('$', `normalizeDebt(${JSON.stringify(value)})`));

    test('normalizeDebt từ chối dữ liệu hỏng và làm sạch các lần thanh toán', () => {
        assert.equal(run(`normalizeDebt(${JSON.stringify(debt({ party: ' ' }))})`), null);
        assert.equal(run(`normalizeDebt(${JSON.stringify(debt({ amount: 0 }))})`), null);

        const normalized = plain(
            run(
                `normalizeDebt(${JSON.stringify(debt({ direction: 'x', payments: [{ amount: '200.000', date: '2026-10-05' }, { amount: 0 }, null] }))})`,
            ),
        );

        assert.equal(normalized.direction, 'owe');
        assert.equal(normalized.payments.length, 1);
        assert.equal(normalized.payments[0].amount, 200000);
    });

    test('còn lại = gốc - đã trả, không âm', () => {
        const paid = (amounts) =>
            debt({
                payments: amounts.map((amount, index) => ({
                    id: `P${index}`,
                    date: '2026-10-05',
                    amount,
                })),
            });

        assert.equal(call('debtRemaining($)', paid([])), 1000000);
        assert.equal(call('debtRemaining($)', paid([300000, 200000])), 500000);
        assert.equal(call('debtRemaining($)', paid([1000000])), 0);
        assert.equal(call('debtRemaining($)', paid([900000, 900000])), 0);
        assert.equal(call('debtPaid($)', paid([300000, 200000])), 500000);
    });

    test('trạng thái: đã tất toán, quá hạn, sắp đến hạn, đang nợ', () => {
        const status = (overrides, today) =>
            run(`debtStatus(normalizeDebt(${JSON.stringify(debt(overrides))}), "${today}")`);

        assert.equal(status({ payments: [{ id: 'p', amount: 1000000 }] }, '2026-12-01'), 'settled');
        assert.equal(status({}, '2026-11-02'), 'overdue');
        assert.equal(status({}, '2026-11-01'), 'soon');
        assert.equal(status({}, '2026-10-25'), 'soon');
        assert.equal(status({}, '2026-10-20'), 'open');
        assert.equal(status({ dueDate: '' }, '2030-01-01'), 'open');
    });

    test('tổng hợp theo chiều nợ và các khoản quá hạn', () => {
        const list = [
            debt({
                id: 'a',
                amount: 1000000,
                dueDate: '2026-10-01',
                payments: [{ id: 'p', amount: 400000 }],
            }),
            debt({ id: 'b', direction: 'owed', amount: 500000, dueDate: '' }),
            debt({ id: 'c', amount: 200000, dueDate: '2026-12-31' }),
        ];

        assert.deepEqual(
            plain(run(`summarizeDebts(normalizeDebts(${JSON.stringify(list)}), "2026-10-28")`)),
            { owe: 800000, owed: 500000, overdueCount: 1, overdueAmount: 600000 },
        );
    });
});

test.describe('hiển thị ngày và ô nhập tiền', () => {
    test('formatDateDisplay đổi YYYY-MM-DD sang DD/MM/YYYY, giữ nguyên giá trị lạ', () => {
        assert.equal(run('formatDateDisplay("2026-10-28")'), '28/10/2026');
        assert.equal(run('formatDateDisplay("2026-01-05")'), '05/01/2026');
        assert.equal(run('formatDateDisplay("")'), '');
        assert.equal(run('formatDateDisplay(null)'), '');
        assert.equal(run('formatDateDisplay("hôm nay")'), 'hôm nay');
    });

    test('formatMoneyDigits nhóm hàng nghìn bằng dấu chấm và bỏ ký tự lạ', () => {
        const format = (text, signed = false) =>
            run(`formatMoneyDigits(${JSON.stringify(text)}, ${signed})`);

        assert.equal(format('1234567'), '1.234.567');
        assert.equal(format('1.234.567'), '1.234.567');
        assert.equal(format('1234'), '1.234');
        assert.equal(format('999'), '999');
        assert.equal(format('abc12x3'), '123');
        assert.equal(format(''), '');
        assert.equal(format('abc'), '');
        assert.equal(format('0'), '0');
        assert.equal(format('0012'), '12');
        assert.equal(format('1 000 000'), '1.000.000');
    });

    test('formatMoneyDigits: dấu trừ chỉ được giữ ở ô cho phép số âm', () => {
        const format = (text, signed) =>
            run(`formatMoneyDigits(${JSON.stringify(text)}, ${signed})`);

        assert.equal(format('-5000', true), '-5.000');
        assert.equal(format('-5000', false), '5.000');
        assert.equal(format('-', true), '-');
        assert.equal(format('-', false), '');
        assert.equal(format('5-000', true), '5.000');
    });

    test('formatMoneyDigits giới hạn 15 chữ số để không mất độ chính xác', () => {
        assert.equal(run('formatMoneyDigits("123456789012345678901")'), '123.456.789.012.345');
    });

    test('parseMoneyText đọc lại số đã nhóm, trả NaN khi rỗng hoặc không phải số', () => {
        const parse = (text) => run(`parseMoneyText(${JSON.stringify(text)})`);

        assert.equal(parse('1.500.000'), 1500000);
        assert.equal(parse('-20.000'), -20000);
        assert.equal(parse('17000'), 17000);
        assert.equal(parse('0'), 0);
        assert.ok(Number.isNaN(parse('')));
        assert.ok(Number.isNaN(parse('-')));
        assert.ok(Number.isNaN(parse('abc')));
        assert.ok(Number.isNaN(parse(null)));
    });

    test('formatMoneyDigits và parseMoneyText là hai chiều của nhau', () => {
        for (const value of [0, 7, 999, 1000, 17000, 224500, 15000000, 999999999999]) {
            assert.equal(run(`parseMoneyText(formatMoneyDigits(String(${value})))`), value);
        }
    });

    test('tìm kiếm khớp ngày đang hiển thị (28/10) và ngày đầy đủ', () => {
        const list = [tx({ id: 'a', date: '2026-10-28' }), tx({ id: 'b', date: '2026-09-05' })];
        const search = (text) =>
            plain(
                run(
                    `filterTransactions(${JSON.stringify(list)}, { search: ${JSON.stringify(text)} })`,
                ),
            ).map((item) => item.id);

        assert.deepEqual(search('28/10'), ['a']);
        assert.deepEqual(search('05/09/2026'), ['b']);
        assert.deepEqual(search('2026-10-28'), ['a']);
    });
});

test.describe('lương và cảnh báo chi tiêu', () => {
    const status = (list, plan, month = '2026-10') =>
        plain(
            run(
                `computeSalaryStatus(${JSON.stringify(list)}, ${JSON.stringify(plan)}, ${JSON.stringify(month)})`,
            ),
        );

    const basics = (json) => {
        const { amount, warnPercent } = plain(run(`normalizeSalaryPlan(${json})`));

        return { amount, warnPercent };
    };

    test('normalizeSalaryPlan: làm tròn lương, mức cảnh báo ngoài 1-100 về 80, từ chối không phải object', () => {
        assert.deepEqual(basics('{amount:"15000000.4",warnPercent:70}'), {
            amount: 15000000,
            warnPercent: 70,
        });
        assert.deepEqual(basics('{amount:-5,warnPercent:0}'), { amount: 0, warnPercent: 80 });
        assert.deepEqual(basics('{amount:"abc",warnPercent:101}'), { amount: 0, warnPercent: 80 });
        assert.deepEqual(basics('{}'), { amount: 0, warnPercent: 80 });
        assert.equal(run('normalizeSalaryPlan(null)'), null);
        assert.equal(run('normalizeSalaryPlan([1])'), null);
        assert.equal(run('normalizeSalaryPlan("x")'), null);
    });

    test('normalizeSalaryPlan: thiếu nhóm thì dùng mẫu 50 / 30 / 20 (tiết kiệm là phần còn lại)', () => {
        const plan = plain(run('normalizeSalaryPlan({amount:1000})'));

        assert.deepEqual(
            plan.groups.map((group) => [group.name, group.percent, group.saving]),
            [
                ['Tiêu dùng cá nhân', 50, false],
                ['Công việc', 30, false],
                ['Tiết kiệm', 20, true],
            ],
        );
        assert.deepEqual(plan.assign, {});
    });

    test('normalizeSalaryGroups: bỏ nhóm hỏng / trùng id, chỉ một nhóm tiết kiệm, tối đa 8 nhóm', () => {
        const groups = plain(
            run(`normalizeSalaryGroups([
                {id:'a',name:' Cá nhân ',percent:"40.4",saving:false},
                {id:'a',name:'Trùng id',percent:10},
                {id:'b',name:'',percent:10},
                {id:'c',name:'Âm',percent:-1},
                {id:'d',name:'Quá lớn',percent:101},
                {id:'e',name:'Rác',percent:'abc'},
                null,
                {id:'f',name:'Tiết kiệm',percent:20,saving:true},
                {id:'g',name:'Tiết kiệm 2',percent:5,saving:true}
            ])`),
        );

        assert.deepEqual(groups, [
            { id: 'a', name: 'Cá nhân', percent: 40, saving: false },
            { id: 'f', name: 'Tiết kiệm', percent: 20, saving: true },
            { id: 'g', name: 'Tiết kiệm 2', percent: 5, saving: false },
        ]);
        assert.equal(run('normalizeSalaryGroups("x")'), null);
        assert.equal(
            run(
                `normalizeSalaryGroups(Array.from({length: 12}, (_, i) => ({id: 'g' + i, name: 'N' + i, percent: 1}))).length`,
            ),
            8,
        );
        assert.deepEqual(plain(run('normalizeSalaryGroups([])')), []);
    });

    test('normalizeSalaryPlan: assign chỉ giữ danh mục trỏ tới nhóm chi còn tồn tại', () => {
        const plan = plain(
            run(`normalizeSalaryPlan({
                amount: 1000,
                groups: [{id:'p',name:'P',percent:50},{id:'s',name:'S',percent:50,saving:true}],
                assign: {'Ăn uống':'p','Đi lại':'s','Mua sắm':'x','':'p','__proto__':'p'}
            })`),
        );

        assert.deepEqual(plan.assign, { 'Ăn uống': 'p' });
        assert.deepEqual(plain(run('normalizeSalaryPlan({assign:[1]})')).assign, {});
    });

    test('salaryLevel: 0 dưới mốc, 1 từ mốc cảnh báo, 2 từ 100%', () => {
        assert.equal(run('salaryLevel(0.79, 80)'), 0);
        assert.equal(run('salaryLevel(0.8, 80)'), 1);
        assert.equal(run('salaryLevel(0.999, 80)'), 1);
        assert.equal(run('salaryLevel(1, 80)'), 2);
        assert.equal(run('salaryLevel(3, 80)'), 2);
        assert.equal(run('salaryLevel(0.7, 70)'), 1);
        assert.equal(run('salaryLevel(0.5, 100)'), 0); // warn percent 100: only "over" remains
        assert.equal(run('salaryLevel(1, 100)'), 2);
    });

    test('computeSalaryStatus: null khi chưa đặt lương', () => {
        assert.equal(run('computeSalaryStatus([], {amount:0,warnPercent:80}, "2026-10")'), null);
        assert.equal(run('computeSalaryStatus([], null, "2026-10")'), null);
    });

    test('computeSalaryStatus: chỉ cộng chi của tháng, bỏ thu / chuyển / tháng khác', () => {
        const result = status(
            [
                tx({ amount: 300000 }),
                tx({ amount: 200000, date: '2026-10-01' }),
                tx({ amount: 900000, date: '2026-09-30' }),
                tx({ amount: 500000, type: 'income' }),
                tx({ amount: 400000, type: 'transfer', targetSource: 'X' }),
            ],
            { amount: 1000000, warnPercent: 80 },
        );

        assert.deepEqual(result, {
            salary: 1000000,
            warnPercent: 80,
            spent: 500000,
            remaining: 500000,
            ratio: 0.5,
            percent: 50,
            level: 0,
        });
    });

    test('computeSalaryStatus: phần trăm làm tròn xuống, không hiện 80% khi chưa tới mốc', () => {
        const at = (spent) => status([tx({ amount: spent })], { amount: 1000000, warnPercent: 80 });

        assert.equal(at(799999).percent, 79);
        assert.equal(at(799999).level, 0);
        assert.equal(at(800000).percent, 80);
        assert.equal(at(800000).level, 1);
        assert.equal(at(999999).percent, 99);
        assert.equal(at(1000000).percent, 100);
        assert.equal(at(1000000).level, 2);
        assert.equal(at(1250000).percent, 125);
        assert.equal(at(1250000).remaining, -250000);
        // 29% must not become 28% through floating point (0.29 * 100 = 28.999...).
        assert.equal(status([tx({ amount: 29 })], { amount: 100, warnPercent: 80 }).percent, 29);
    });
    const planJson = (extra = {}) =>
        JSON.stringify({
            amount: 10000000,
            warnPercent: 80,
            groups: [
                { id: 'p', name: 'Cá nhân', percent: 50, saving: false },
                { id: 'w', name: 'Công việc', percent: 30, saving: false },
                { id: 's', name: 'Tiết kiệm', percent: 20, saving: true },
            ],
            assign: { 'Vật tư': 'w' },
            ...extra,
        });
    const allocate = (list, extra, month = '2026-10') =>
        plain(
            run(
                `computeSalaryAllocation(${JSON.stringify(list)}, normalizeSalaryPlan(${planJson(extra)}), ${JSON.stringify(month)})`,
            ),
        );
    const group = (result, id) => result.groups.find((item) => item.id === id);

    test('computeSalaryAllocation: null khi chưa có lương hoặc không có nhóm', () => {
        assert.equal(allocate([], { amount: 0 }), null);
        assert.equal(allocate([], { groups: [] }), null);
    });

    test('computeSalaryAllocation: chi vào đúng nhóm theo danh mục, chưa gán thì vào nhóm chi đầu tiên', () => {
        const result = allocate([
            tx({ id: '1', category: 'Ăn uống', amount: 1000000 }),
            tx({ id: '2', category: 'Vật tư', amount: 2000000 }),
            tx({ id: '3', category: 'Danh mục lạ', amount: 500000 }),
            tx({ id: '4', category: 'Vật tư', amount: 9000000, date: '2026-09-30' }),
            tx({ id: '5', category: 'Vật tư', amount: 9000000, type: 'income' }),
        ]);

        assert.equal(group(result, 'p').spent, 1500000);
        assert.equal(group(result, 'w').spent, 2000000);
        assert.equal(result.totalSpent, 3500000);
        assert.equal(result.totalPercent, 100);
    });

    test('computeSalaryAllocation: hạn mức, phần trăm lương và mức cảnh báo của nhóm chi', () => {
        const result = allocate([
            tx({ id: '1', category: 'Vật tư', amount: 2400000 }), // 80% of the 3,000,000 cap
            tx({ id: '2', category: 'Ăn uống', amount: 2000000 }), // 40% of 5,000,000
        ]);

        assert.deepEqual(group(result, 'w'), {
            id: 'w',
            name: 'Công việc',
            percent: 30,
            saving: false,
            cap: 3000000,
            spent: 2400000,
            ratio: 0.8,
            remaining: 600000,
            percentOfSalary: 24,
            usedPercent: 80,
            level: 1,
        });
        assert.equal(group(result, 'p').level, 0);
        assert.equal(group(result, 'p').percentOfSalary, 20);
    });

    test('computeSalaryAllocation: nhóm chi vượt hạn mức là mức 2; hạn mức 0 mà có chi thì cũng vượt', () => {
        const over = allocate([tx({ category: 'Vật tư', amount: 3500000 })]);

        assert.equal(group(over, 'w').level, 2);
        assert.equal(group(over, 'w').remaining, -500000);
        assert.equal(group(over, 'w').usedPercent, 116);

        const zero = allocate([tx({ category: 'Vật tư', amount: 1 })], {
            groups: [
                { id: 'p', name: 'Cá nhân', percent: 100, saving: false },
                { id: 'w', name: 'Công việc', percent: 0, saving: false },
            ],
        });

        assert.equal(group(zero, 'w').cap, 0);
        assert.equal(group(zero, 'w').level, 2);
        assert.equal(group(zero, 'w').usedPercent, 100);
        assert.equal(
            group(allocate([], { groups: [{ id: 'p', name: 'P', percent: 0 }] }), 'p').level,
            0,
        );
    });

    test('computeSalaryAllocation: tiết kiệm là phần còn lại, đạt mục tiêu khi tổng chi ≤ lương - mục tiêu', () => {
        const at = (spent) => group(allocate([tx({ amount: spent })]), 's');

        // Target 2,000,000 so the spending limit is 8,000,000; warning from 80% of it (6,400,000).
        assert.deepEqual(at(0), {
            id: 's',
            name: 'Tiết kiệm',
            percent: 20,
            saving: true,
            cap: 2000000,
            kept: 10000000,
            reached: true,
            percentOfSalary: 100,
            level: 0,
        });
        assert.equal(at(6399999).level, 0);
        assert.equal(at(6400000).level, 1);
        assert.equal(at(8000000).reached, true); // exactly the target
        assert.equal(at(8000000).level, 1);
        assert.equal(at(8000001).reached, false);
        assert.equal(at(8000001).level, 2);
        assert.equal(at(12000000).kept, 0); // never negative
        assert.equal(at(12000000).level, 2);
    });

    test('computeSalaryAllocation: tiết kiệm 100% lương thì mọi khoản chi đều làm hụt mục tiêu', () => {
        const only = {
            groups: [{ id: 's', name: 'Tiết kiệm', percent: 100, saving: true }],
        };

        assert.equal(group(allocate([], only), 's').level, 0);
        assert.equal(group(allocate([tx({ amount: 1 })], only), 's').level, 2);
    });

    test('salaryGroupFor: nhóm được gán, không có thì nhóm chi đầu tiên, chỉ có nhóm tiết kiệm thì null', () => {
        const plan = (json) => `normalizeSalaryPlan(${json})`;

        assert.equal(run(`salaryGroupFor(${plan(planJson())}, 'Vật tư').id`), 'w');
        assert.equal(run(`salaryGroupFor(${plan(planJson())}, 'Gì đó').id`), 'p');
        assert.equal(run(`salaryGroupFor(${plan(planJson())}, 'constructor').id`), 'p');
        assert.equal(
            run(
                `salaryGroupFor(${plan(planJson({ groups: [{ id: 's', name: 'S', percent: 100, saving: true }] }))}, 'x')`,
            ),
            null,
        );
    });
});

test.describe('sổ tiết kiệm', () => {
    const plan = (extra = {}) =>
        JSON.stringify({
            enabled: true,
            day: 5,
            from: 'Thẻ Ngân Hàng',
            book: 'Sổ tiết kiệm',
            mode: 'percent',
            percent: 20,
            amount: 0,
            since: '2026-10-01',
            lastMonth: '',
            ...extra,
        });
    const due = (extra, today) =>
        plain(
            run(
                `savingsDueDeposits(normalizeSavingsPlan(${plan(extra)}), ${JSON.stringify(today)})`,
            ),
        );

    test('loại nguồn "Sổ tiết kiệm" được giữ nguyên và đánh dấu saving, không phải nợ', () => {
        assert.equal(run('normalizeSource({name:"S", kind:"savings"}).kind'), 'savings');
        assert.equal(run('SOURCE_KINDS.savings.saving'), true);
        assert.equal(run('SOURCE_KINDS.savings.debt'), false);
        assert.equal(run('SOURCE_KINDS.bank.saving'), undefined);
    });

    test('normalizeSavingsPlan: mặc định tắt; bật cần đủ ngày, nguồn, sổ khác nhau và ngày bắt đầu', () => {
        assert.deepEqual(plain(run('normalizeSavingsPlan({})')), {
            enabled: false,
            day: 0,
            from: '',
            book: '',
            mode: 'percent',
            percent: 20,
            amount: 0,
            since: '',
            lastMonth: '',
        });
        assert.equal(plain(run(`normalizeSavingsPlan(${plan()})`)).enabled, true);

        for (const broken of [
            { day: 0 },
            { day: 32 },
            { from: '' },
            { book: ' ' },
            { book: 'Thẻ Ngân Hàng' },
            { since: '' },
            { enabled: 'yes' },
        ]) {
            assert.equal(
                plain(run(`normalizeSavingsPlan(${plan(broken)})`)).enabled,
                false,
                JSON.stringify(broken),
            );
        }
    });

    test('normalizeSavingsPlan: làm sạch phần trăm, số tiền, chế độ, tháng; từ chối không phải object', () => {
        const clean = plain(
            run(
                `normalizeSavingsPlan(${plan({ percent: 150, amount: '1500000.4', mode: 'x', lastMonth: '2026-13x' })})`,
            ),
        );

        assert.equal(clean.percent, 20);
        assert.equal(clean.amount, 1500000);
        assert.equal(clean.mode, 'percent');
        assert.equal(clean.lastMonth, '');
        assert.equal(
            plain(run(`normalizeSavingsPlan(${plan({ mode: 'fixed', percent: 35 })})`)).percent,
            35,
        );
        assert.equal(plain(run(`normalizeSavingsPlan(${plan({ mode: 'fixed' })})`)).mode, 'fixed');
        assert.equal(run('normalizeSavingsPlan(null)'), null);
        assert.equal(run('normalizeSavingsPlan([1])'), null);
        assert.equal(run('normalizeSavingsPlan("x")'), null);
    });

    test('savingsDepositDate: ngày lãnh lương, lùi về cuối tháng với tháng ngắn', () => {
        assert.equal(run('savingsDepositDate("2026-10", 5)'), '2026-10-05');
        assert.equal(run('savingsDepositDate("2026-02", 31)'), '2026-02-28');
        assert.equal(run('savingsDepositDate("2028-02", 31)'), '2028-02-29');
        assert.equal(run('savingsDepositDate("2026-04", 31)'), '2026-04-30');
        assert.equal(run('savingsDepositDate("2026-12", 31)'), '2026-12-31');
    });

    test('savingsDueDeposits: không gửi bù tháng trước ngày bắt đầu, gửi đúng ngày lãnh lương', () => {
        // Set up on 10-20 with payday 5: this month's payday has passed, nothing is due.
        assert.deepEqual(due({ since: '2026-10-20' }, '2026-10-30'), []);
        // The day before / on payday of the next month.
        assert.deepEqual(due({ since: '2026-10-20' }, '2026-11-04'), []);
        assert.deepEqual(due({ since: '2026-10-20' }, '2026-11-05'), [
            { month: '2026-11', date: '2026-11-05' },
        ]);
        // Set up on payday itself: due today.
        assert.deepEqual(due({ since: '2026-10-05' }, '2026-10-05'), [
            { month: '2026-10', date: '2026-10-05' },
        ]);
    });

    test('savingsDueDeposits: gửi bù các tháng bỏ lỡ sau khi không mở app, bỏ qua tháng đã gửi', () => {
        assert.deepEqual(
            due({ since: '2026-07-15', lastMonth: '2026-08', day: 10 }, '2026-11-12').map(
                (d) => d.date,
            ),
            ['2026-09-10', '2026-10-10', '2026-11-10'],
        );
        assert.deepEqual(due({ since: '2026-07-01', lastMonth: '2026-10' }, '2026-10-31'), []);
        assert.deepEqual(due({ enabled: false }, '2026-12-31'), []);
    });

    test('savingsDueDeposits: tháng 2 dùng ngày 28 khi ngày lãnh lương là 31', () => {
        assert.deepEqual(
            due({ day: 31, since: '2026-01-31', lastMonth: '2026-01' }, '2026-03-30').map(
                (d) => d.date,
            ),
            ['2026-02-28'],
        );
    });

    test('savingsDueDeposits: giới hạn số kỳ bù để không treo máy', () => {
        const length = plain(
            run(
                `savingsDueDeposits(normalizeSavingsPlan(${plan({ since: '2000-01-01' })}), "2026-10-30")`,
            ),
        ).length;

        assert.equal(length, 120);
    });

    test('nextSavingsDeposit: kỳ kế tiếp chưa gửi; đã gửi tháng này thì sang tháng sau', () => {
        const next = (extra, today) =>
            plain(
                run(
                    `nextSavingsDeposit(normalizeSavingsPlan(${plan(extra)}), ${JSON.stringify(today)})`,
                ),
            );

        assert.deepEqual(next({ since: '2026-10-20' }, '2026-10-30'), {
            month: '2026-11',
            date: '2026-11-05',
        });
        assert.deepEqual(next({ since: '2026-10-01', lastMonth: '2026-10' }, '2026-10-30'), {
            month: '2026-11',
            date: '2026-11-05',
        });
        // Overdue because it could not be worked out: still reported so the page can say it is waiting.
        assert.deepEqual(next({ since: '2026-10-01' }, '2026-10-30'), {
            month: '2026-10',
            date: '2026-10-05',
        });
        assert.equal(next({ enabled: false }, '2026-10-30'), null);
    });

    test('savingsDepositAmount: % lương làm tròn, cố định, 0 khi chưa đặt lương', () => {
        const amount = (extra, salary) =>
            run(`savingsDepositAmount(normalizeSavingsPlan(${plan(extra)}), ${salary})`);

        assert.equal(amount({}, '{amount: 10000000}'), 2000000);
        assert.equal(amount({ percent: 15 }, '{amount: 17333333}'), 2600000);
        assert.equal(amount({}, '{amount: 0}'), 0);
        assert.equal(amount({}, 'null'), 0);
        assert.equal(amount({ mode: 'fixed', amount: 1500000 }, '{amount: 0}'), 1500000);
        assert.equal(amount({ mode: 'fixed', amount: 1500000 }, '{amount: 9}'), 1500000);
    });

    test('savingsTransactionId chỉ phụ thuộc tháng', () => {
        assert.equal(run('savingsTransactionId("2026-10")'), 'TX_SAV_202610');
    });

    test('savingsMovements: gửi, rút, chuyển giữa sổ, lãi, chi; bỏ qua giao dịch không liên quan; mới nhất trước', () => {
        const books = '["Sổ A", "Sổ B"]';
        const list = [
            tx({ id: 'u1', type: 'expense', source: 'Tiền Mặt', amount: 5 }),
            tx({
                id: 'd1',
                date: '2026-10-05',
                type: 'transfer',
                source: 'Ngân hàng',
                targetSource: 'Sổ A',
                amount: 100,
            }),
            tx({
                id: 'w1',
                date: '2026-10-20',
                type: 'transfer',
                source: 'Sổ A',
                targetSource: 'Tiền Mặt',
                amount: 30,
            }),
            tx({
                id: 'm1',
                date: '2026-10-10',
                type: 'transfer',
                source: 'Sổ A',
                targetSource: 'Sổ B',
                amount: 10,
            }),
            tx({ id: 'i1', date: '2026-10-25', type: 'income', source: 'Sổ B', amount: 7 }),
            tx({ id: 's1', date: '2026-10-26', type: 'expense', source: 'Sổ B', amount: 3 }),
            tx({
                id: 'TX_SAV_202609',
                date: '2026-09-05',
                type: 'transfer',
                source: 'Ngân hàng',
                targetSource: 'Sổ A',
                amount: 90,
            }),
        ];
        const movements = plain(run(`savingsMovements(${JSON.stringify(list)}, ${books})`));

        assert.deepEqual(
            movements.map((m) => [m.id, m.kind, m.book, m.other, m.auto]),
            [
                ['s1', 'spend', 'Sổ B', '', false],
                ['i1', 'income', 'Sổ B', '', false],
                ['w1', 'withdraw', 'Sổ A', 'Tiền Mặt', false],
                ['m1', 'move', 'Sổ B', 'Sổ A', false],
                ['d1', 'deposit', 'Sổ A', 'Ngân hàng', false],
                ['TX_SAV_202609', 'deposit', 'Sổ A', 'Ngân hàng', true],
            ],
        );
        assert.equal(movements.find((m) => m.id === 'd1').amount, 100);
    });
});

test('openingBalanceToMatch: chỉ dịch số dư ban đầu, giữ nguyên các giao dịch', () => {
    // Opening 500.000 and 464.140 spent: the balance shows 35.860; the real balance is -1.343.581.
    assert.equal(
        run('openingBalanceToMatch({target:-1343581,balance:35860,opening:500000})'),
        -879441,
    );
    // Matching the number already shown changes nothing.
    assert.equal(
        run('openingBalanceToMatch({target:-1343581,balance:-1343581,opening:-879441})'),
        -879441,
    );
    // No opening balance stored yet.
    assert.equal(run('openingBalanceToMatch({target:1200000,balance:1500000})'), -300000);
});

test('balanceFromAvailable: khả dụng trừ hạn mức, âm nghĩa là đang nợ', () => {
    assert.equal(run('balanceFromAvailable(30000000,28656419)'), -1343581);
    assert.equal(run('balanceFromAvailable(30000000,30000000)'), 0);
    assert.equal(run('balanceFromAvailable(30000000,31000000)'), 1000000);
});
