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

        assert.ok(
            csv.startsWith('﻿Ngày,Loại,Nguồn tiền,Nguồn nhận,Danh mục,Số tiền,Ghi chú,Thẻ\r\n'),
        );
        assert.ok(csv.includes('27/10/2026,Chi,Tiền Mặt,,Ăn uống,17000,Cafe,\r\n'));
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

test('normalizeSalaryPlan: mức cảnh báo dư nợ mặc định 30, ngoài 1-100 về 30, làm tròn', () => {
    assert.equal(run('normalizeSalaryPlan({amount:1000}).debtWarnPercent'), 30);
    assert.equal(run('normalizeSalaryPlan({debtWarnPercent:25}).debtWarnPercent'), 25);
    assert.equal(run('normalizeSalaryPlan({debtWarnPercent:24.6}).debtWarnPercent'), 25);
    assert.equal(run('normalizeSalaryPlan({debtWarnPercent:0}).debtWarnPercent'), 30);
    assert.equal(run('normalizeSalaryPlan({debtWarnPercent:101}).debtWarnPercent'), 30);
    assert.equal(run('normalizeSalaryPlan({debtWarnPercent:"abc"}).debtWarnPercent'), 30);
});

test('computeDebtStatus: dư nợ so với lương, làm tròn xuống, chạm mốc là mức 1', () => {
    const plan = '{amount:8000000,debtWarnPercent:30}';
    const status = (debt, p = plan) =>
        JSON.parse(JSON.stringify(run(`computeDebtStatus(${debt},${p})`)));

    // 1.447.355 / 8.000.000 = 18,09%: shown as 18%, below the 2.400.000 limit.
    assert.deepEqual(status(1447355), {
        debt: 1447355,
        salary: 8000000,
        percent: 18,
        warnPercent: 30,
        limit: 2400000,
        level: 0,
    });
    // One đồng under the limit is still 29% and safe; exactly at the limit is 30% and a warning.
    assert.equal(status(2399999).percent, 29);
    assert.equal(status(2399999).level, 0);
    assert.equal(status(2400000).percent, 30);
    assert.equal(status(2400000).level, 1);
    assert.equal(status(9000000).percent, 112);
    // A lower warning percent moves the line.
    assert.equal(status(1600000, '{amount:8000000,debtWarnPercent:20}').level, 1);
    // No debt (or a negative number) reads as 0%.
    assert.equal(status(0).percent, 0);
    assert.equal(status(-5).debt, 0);
});

test('computeDebtStatus: chưa đặt lương thì không so được', () => {
    assert.equal(run('computeDebtStatus(1000,{amount:0,debtWarnPercent:30})'), null);
    assert.equal(run('computeDebtStatus(1000,null)'), null);
});

test('normalizeSalaryPlan: mức cảnh báo dùng thẻ mặc định 30, ngoài 1-100 về 30', () => {
    assert.equal(run('normalizeSalaryPlan({amount:1000}).cardWarnPercent'), 30);
    assert.equal(run('normalizeSalaryPlan({cardWarnPercent:40}).cardWarnPercent'), 40);
    assert.equal(run('normalizeSalaryPlan({cardWarnPercent:0}).cardWarnPercent'), 30);
    assert.equal(run('normalizeSalaryPlan({cardWarnPercent:150}).cardWarnPercent'), 30);
});

test('computeCardSpend: chi và rút tiền từ thẻ tín dụng / trả sau trong tháng, không tính trả sao kê', () => {
    const sources =
        '[{name:"Tiền Mặt",kind:"cash"},{name:"Ngân Hàng",kind:"bank"},{name:"Spay",kind:"credit"},{name:"Visa",kind:"credit"},{name:"Nợ",kind:"debt"}]';
    const spend = (rows) => run(`computeCardSpend(${rows},${sources},"2026-10")`);
    const row = (type, source, amount, extra = '') =>
        `{type:"${type}",source:"${source}",amount:${amount},date:"2026-10-05"${extra}}`;

    // Purchases on any card count; cash and bank purchases do not.
    assert.equal(spend(`[${row('expense', 'Spay', 100)},${row('expense', 'Visa', 50)}]`), 150);
    assert.equal(
        spend(`[${row('expense', 'Tiền Mặt', 100)},${row('expense', 'Ngân Hàng', 70)}]`),
        0,
    );
    // A loan source is not a card.
    assert.equal(spend(`[${row('expense', 'Nợ', 100)}]`), 0);
    // Cash taken out of a card counts; a transfer between two cards does not.
    assert.equal(spend(`[${row('transfer', 'Spay', 80, ',targetSource:"Tiền Mặt"')}]`), 80);
    assert.equal(spend(`[${row('transfer', 'Spay', 80, ',targetSource:"Visa"')}]`), 0);
    // Paying the statement (money into the card) and income do not count.
    assert.equal(spend(`[${row('transfer', 'Ngân Hàng', 500, ',targetSource:"Spay"')}]`), 0);
    assert.equal(spend(`[${row('income', 'Spay', 500)}]`), 0);
    // Only the asked month.
    assert.equal(
        run(
            `computeCardSpend([{type:"expense",source:"Spay",amount:100,date:"2026-09-30"}],${sources},"2026-10")`,
        ),
        0,
    );
    // An unknown source is ignored.
    assert.equal(spend(`[${row('expense', 'Lạ', 100)}]`), 0);
});

test('computeCardSpendStatus: mức 0 / 1 / 2, làm tròn xuống, đúng mốc là cảnh báo', () => {
    const plan = '{amount:8000000,cardWarnPercent:30}';
    const status = (spent) =>
        JSON.parse(JSON.stringify(run(`computeCardSpendStatus(${spent},${plan})`)));

    assert.deepEqual(status(1500000), {
        spent: 1500000,
        salary: 8000000,
        percent: 18,
        warnPercent: 30,
        limit: 2400000,
        level: 0,
    });
    assert.equal(status(2399999).level, 0);
    assert.equal(status(2399999).percent, 29);
    assert.equal(status(2400000).level, 1);
    assert.equal(status(7999999).level, 1);
    assert.equal(status(8000000).level, 2);
    assert.equal(status(9000000).percent, 112);
    assert.equal(run('computeCardSpendStatus(10,{amount:0,cardWarnPercent:30})'), null);
    assert.equal(run('computeCardSpendStatus(10,null)'), null);
});

test('computeCardDue: số phải trả là dư nợ lúc chốt sao kê trừ khoản đã trả, hạn là ngày hạn sau kỳ chốt', () => {
    // Spaylater: statement on the 24th, due on the 10th of the next month.
    const spay = '{name:"Spay",kind:"credit",statementDay:24,dueDay:10}';
    const row = (date, type, amount, extra = '') =>
        `{id:"${date}${type}${amount}",date:"${date}",type:"${type}",source:"Spay",amount:${amount}${extra}}`;
    const due = (list, today, source = spay, opening = 0) =>
        JSON.parse(
            JSON.stringify(run(`computeCardDue(${source},[${list}],${opening},"${today}")`)),
        );
    const october = [row('2026-10-05', 'expense', 1000000), row('2026-10-30', 'expense', 464140)];

    // On 7/11 the 24/10 statement (1.000.000) is due on 10/11; the purchase of 30/10 is next month's.
    assert.deepEqual(due(october, '2026-11-07'), {
        name: 'Spay',
        amount: 1000000,
        statementDate: '2026-10-24',
        dueDate: '2026-11-10',
        daysLeft: 3,
    });

    // A part payment into the card after the statement lowers it; paying all of it clears it.
    const paid = (amount) =>
        `{id:"pay",date:"2026-11-05",type:"transfer",source:"Bank",targetSource:"Spay",amount:${amount}}`;

    assert.equal(due([...october, paid(400000)], '2026-11-07').amount, 600000);
    assert.equal(due([...october, paid(1000000)], '2026-11-07'), null);
    // Money paid before the statement is already in the balance and is not counted twice.
    assert.equal(
        due(
            [row('2026-10-05', 'expense', 1000000), row('2026-10-20', 'income', 300000)],
            '2026-11-07',
        ).amount,
        700000,
    );

    // The due date passed and the statement is still unpaid: overdue, not "next month".
    const late = due(october, '2026-11-11');

    assert.equal(late.dueDate, '2026-11-10');
    assert.equal(late.daysLeft, -1);
    // After the next statement (24/11) the old debt rolls into it and the due date moves on.
    const next = due(october, '2026-11-25');

    assert.equal(next.statementDate, '2026-11-24');
    assert.equal(next.dueDate, '2026-12-10');
    assert.equal(next.amount, 1464140);
    // Due today counts as 0 days left.
    assert.equal(due(october, '2026-11-10').daysLeft, 0);

    // No statement day: the whole debt and the next due day.
    const plain = '{name:"Spay",kind:"credit",dueDay:10}';

    assert.deepEqual(due(october, '2026-11-07', plain), {
        name: 'Spay',
        amount: 1464140,
        statementDate: '',
        dueDate: '2026-11-10',
        daysLeft: 3,
    });
    // A positive opening balance offsets the spending, so nothing is owed.
    assert.equal(due(october, '2026-11-07', spay, 5000000), null);
    // Not a card, no due day, or archived: nothing to remind about.
    assert.equal(due(october, '2026-11-07', '{name:"Spay",kind:"bank",dueDay:10}'), null);
    assert.equal(due(october, '2026-11-07', '{name:"Spay",kind:"credit",statementDay:24}'), null);
    assert.equal(
        due(october, '2026-11-07', '{name:"Spay",kind:"credit",dueDay:10,archived:true}'),
        null,
    );
    // Short months: a statement on the 31st falls on the last day of February.
    assert.equal(
        due(
            [row('2027-02-10', 'expense', 100)],
            '2027-03-02',
            '{name:"Spay",kind:"credit",statementDay:31,dueDay:15}',
        ).statementDate,
        '2027-02-28',
    );
});

test('cardDueLevel và cardDuesToRemind: nhắc từ 3 ngày trước hạn, quá hạn là mức 2, gấp nhất trước', () => {
    assert.equal(run('cardDueLevel(null)'), 0);
    assert.equal(run('cardDueLevel({daysLeft:4})'), 0);
    assert.equal(run('cardDueLevel({daysLeft:3})'), 1);
    assert.equal(run('cardDueLevel({daysLeft:0})'), 1);
    assert.equal(run('cardDueLevel({daysLeft:-1})'), 2);

    const sources =
        '[{name:"A",kind:"credit",dueDay:12},{name:"B",kind:"credit",dueDay:9},{name:"C",kind:"credit",dueDay:30},{name:"D",kind:"bank",dueDay:8}]';
    const list =
        '[{date:"2026-11-01",type:"expense",source:"A",amount:10},{date:"2026-11-01",type:"expense",source:"B",amount:20},{date:"2026-11-01",type:"expense",source:"C",amount:30},{date:"2026-11-01",type:"expense",source:"D",amount:40}]';

    // On 7/11: A is due in 5 days (not yet), B in 2 days, C in 23 days, D is not a card.
    assert.equal(
        run(`cardDuesToRemind(${sources},${list},{},"2026-11-07").map((d) => d.name).join("")`),
        'B',
    );
    // On 10/11: B's 9th has passed, so its next due day is 9/12, far away (without a statement day
    // there is no way to tell an unpaid 9/11 from a paid one); A is due in 2 days.
    assert.equal(
        run(`cardDuesToRemind(${sources},${list},{},"2026-11-10").map((d) => d.name).join("")`),
        'A',
    );
});

test('filterTransactions: sources giữ giao dịch chạm vào một trong các nguồn ở cả hai phía', () => {
    const list =
        '[{id:"a",date:"2026-10-01",type:"expense",source:"Spay",category:"x",amount:1,note:""},{id:"b",date:"2026-10-01",type:"expense",source:"Tiền Mặt",category:"x",amount:1,note:""},{id:"c",date:"2026-10-01",type:"transfer",source:"Ngân Hàng",targetSource:"Visa",category:"x",amount:1,note:""}]';
    const ids = (filters) =>
        run(`filterTransactions(${list},${filters}).map((t) => t.id).join("")`);

    assert.equal(ids('{sources:["Spay","Visa"]}'), 'ac');
    assert.equal(ids('{sources:["Visa"],type:"transfer"}'), 'c');
    assert.equal(ids('{sources:[]}'), '');
    // null / missing means no such filter.
    assert.equal(ids('{sources:null}'), 'abc');
    assert.equal(ids('{}'), 'abc');
});

const TAG_ROWS = `[
    {id:"A",date:"2026-10-20",type:"expense",amount:120000,note:"Mua keo #KhachA #dh102"},
    {id:"B",date:"2026-10-21",type:"income",amount:500000,note:"Công sửa bàn #khacha"},
    {id:"C",date:"2026-10-22",type:"expense",amount:30000,note:"Cafe sáng"},
    {id:"D",date:"2026-10-23",type:"expense",amount:80000,note:"Sơn #dh102"},
    {id:"E",date:"2026-09-15",type:"expense",amount:10000,note:"#khachA"},
    {id:"F",date:"2026-10-24",type:"transfer",amount:99999,note:"#khachA"}
]`;

test('computeTagReport: thu, chi, lãi lỗ theo thẻ; khoảng thời gian; chuyển tiền chỉ tính số giao dịch', () => {
    const report = (prefix = '') =>
        JSON.parse(JSON.stringify(run(`computeTagReport(${TAG_ROWS},"${prefix}")`)));

    // KhachA / khacha / khachA are one tag (first spelling stays); the transfer F is only counted.
    assert.deepEqual(report(), [
        {
            tag: 'KhachA',
            count: 4,
            income: 500000,
            expense: 130000,
            last: '2026-10-24',
            net: 370000,
        },
        { tag: 'dh102', count: 2, income: 0, expense: 200000, last: '2026-10-23', net: -200000 },
    ]);
    // A month and a year narrow it down; the transaction without a tag never shows up.
    assert.deepEqual(
        report('2026-10').map((row) => [row.tag, row.count, row.net]),
        [
            ['KhachA', 3, 380000],
            ['dh102', 2, -200000],
        ],
    );
    assert.deepEqual(
        report('2026-09').map((row) => [row.tag, row.count, row.net]),
        [['khachA', 1, -10000]],
    );
    assert.equal(report('2025').length, 0);
    assert.equal(run('computeTagReport([],"").length'), 0);
    // Most recently used first, then by name.
    assert.equal(
        run(
            'computeTagReport([{date:"2026-01-01",type:"expense",amount:1,note:"#b #a"}],"").map((r) => r.tag).join("")',
        ),
        'ab',
    );
});

test('renameTagInNote: đổi tên một thẻ, gộp khi đã có, ghi chú không có thẻ đó giữ nguyên', () => {
    const rename = (note, from, to) =>
        run(`renameTagInNote(${JSON.stringify(note)},${JSON.stringify(from)},"${to}")`);

    assert.equal(rename('Mua keo #KhachA #dh102', 'khachA', 'Khach_A'), 'Mua keo #Khach_A #dh102');
    // Only a change of capitals.
    assert.equal(rename('x #khachA', 'khachA', 'KhachA'), 'x #KhachA');
    // Both tags on the note: they become one.
    assert.equal(rename('x #a #b', 'a', 'b'), 'x #b');
    assert.equal(rename('x #a #B', 'a', 'b'), 'x #b');
    // A note without the tag comes back as the very same text (spacing included).
    assert.equal(rename('Cafe  sáng #z', 'a', 'b'), 'Cafe  sáng #z');
    assert.equal(rename('', 'a', 'b'), '');
    assert.equal(run('renameTagInNote(null,"a","b")'), null);
    // "#12" is not a tag, so it is not touched.
    assert.equal(rename('phòng #12 #a', 'a', 'b'), 'phòng #12 #b');
});

test('planTagRename: tên mới hợp lệ, trùng thẻ đang có thì gộp (dùng cách viết đang có)', () => {
    const plan = (from, input) =>
        JSON.parse(
            JSON.stringify(
                run(`planTagRename(${TAG_ROWS},${JSON.stringify(from)},${JSON.stringify(input)})`),
            ),
        );

    assert.deepEqual(plan('dh102', 'don102'), { tag: 'don102', merge: false });
    assert.deepEqual(plan('dh102', '#don102'), { tag: 'don102', merge: false });
    // Another tag in use: merge, written the way it already is.
    assert.deepEqual(plan('dh102', 'khacha'), { tag: 'KhachA', merge: true });
    // Same tag with other capitals is a rename, never a merge.
    assert.deepEqual(plan('dh102', 'DH102'), { tag: 'DH102', merge: false });
    assert.match(plan('dh102', 'dh102').error, /giống tên cũ/);

    for (const bad of ['', '   ', 'a b', '12ab', 'a@b', '#']) {
        assert.match(plan('dh102', bad).error, /đúng một thẻ/, JSON.stringify(bad));
    }
});

test('buildTransactionsCsv: cột Thẻ liệt kê các thẻ, ghi chú vẫn giữ nguyên', () => {
    const csv = run(
        `buildTransactionsCsv([{id:"1",date:"2026-10-27",type:"expense",source:"Tiền Mặt",category:"Ăn uống",amount:5000,note:"Cafe #a #B"},{id:"2",date:"2026-10-27",type:"expense",source:"Tiền Mặt",category:"Ăn uống",amount:5000,note:"Không thẻ"}])`,
    );

    assert.ok(csv.includes(',Cafe #a #B,#a #B\r\n'));
    assert.ok(csv.includes(',Không thẻ,\r\n'));
});

test('normalizeDebt: lần thanh toán giữ transactionId khi có, không thêm trường khi không có', () => {
    const payments = (list) =>
        JSON.parse(
            JSON.stringify(
                run(
                    `normalizeDebt({id:"d",party:"A",amount:1000,payments:${JSON.stringify(list)}}).payments`,
                ),
            ),
        );

    assert.deepEqual(
        payments([
            { id: 'p1', date: '2026-10-05', amount: 100, transactionId: 'TX_DEBT_p1' },
            { id: 'p2', date: '2026-10-06', amount: 200 },
            { id: 'p3', date: '2026-10-07', amount: 300, transactionId: '' },
        ]),
        [
            { id: 'p1', date: '2026-10-05', amount: 100, transactionId: 'TX_DEBT_p1' },
            { id: 'p2', date: '2026-10-06', amount: 200 },
            { id: 'p3', date: '2026-10-07', amount: 300 },
        ],
    );
});

test('parseCsvText: nháy kép, "" trong ô, xuống dòng trong ô, CRLF / LF / CR, BOM, dòng trống', () => {
    const parse = (text, delimiter = '') =>
        plain(run(`parseCsvText(${JSON.stringify(text)},${JSON.stringify(delimiter)})`));

    assert.deepEqual(parse('a,b,c\r\n1,"x, y",3\r\n'), [
        ['a', 'b', 'c'],
        ['1', 'x, y', '3'],
    ]);
    assert.deepEqual(parse('a,b\n"he said ""hi""","line1\nline2"\n'), [
        ['a', 'b'],
        ['he said "hi"', 'line1\nline2'],
    ]);
    // Old Mac line breaks, a BOM, blank lines, no final line break, padded cells.
    assert.deepEqual(parse('﻿a,b\r\r  1 ,  2  \r\n\r\n3,4'), [
        ['a', 'b'],
        ['1', '2'],
        ['3', '4'],
    ]);
    // Empty cells stay as cells; a row of only empty cells is dropped.
    assert.deepEqual(parse('a,,c\n,,\nd,e,'), [
        ['a', '', 'c'],
        ['d', 'e', ''],
    ]);
    assert.deepEqual(parse(''), []);
    // A quote in the middle of a cell is just text.
    assert.deepEqual(parse('5" pipe,x'), [['5" pipe', 'x']]);
});

test('parseCsvText: nhận dấu phân cách; số "1,234,567" trong file dùng ; không làm nhầm', () => {
    const rows = (text) => plain(run(`parseCsvText(${JSON.stringify(text)})`));

    assert.deepEqual(rows('a;b;c\n1;2;3'), [
        ['a', 'b', 'c'],
        ['1', '2', '3'],
    ]);
    assert.deepEqual(rows('a\tb\n1\t2'), [
        ['a', 'b'],
        ['1', '2'],
    ]);
    assert.deepEqual(rows('a|b\n1|2'), [
        ['a', 'b'],
        ['1', '2'],
    ]);
    assert.deepEqual(
        rows('Ngày;Nội dung;Số tiền\n27/10/2026;Cafe;-1,234,567\n28/10/2026;Cơm;-45,000'),
        [
            ['Ngày', 'Nội dung', 'Số tiền'],
            ['27/10/2026', 'Cafe', '-1,234,567'],
            ['28/10/2026', 'Cơm', '-45,000'],
        ],
    );
    // A comma inside quotes of a semicolon file does not count as a delimiter.
    assert.equal(run('detectCsvDelimiter("a;\\"b,c,d\\";e\\n1;2;3")'), ';');
    assert.equal(run('detectCsvDelimiter("")'), ',');
});

test('parseBankDate: ngày trước tháng, nhiều kiểu ngăn cách, năm 2 chữ số, có giờ, ngày sai', () => {
    const date = (text) => run(`parseBankDate(${JSON.stringify(text)})`);

    assert.equal(date('27/10/2026'), '2026-10-27');
    assert.equal(date('7/1/2026'), '2026-01-07');
    assert.equal(date('27-10-2026'), '2026-10-27');
    assert.equal(date('27.10.2026'), '2026-10-27');
    assert.equal(date('27/10/26'), '2026-10-27');
    assert.equal(date('2026-10-27'), '2026-10-27');
    assert.equal(date('2026/10/27'), '2026-10-27');
    assert.equal(date('27/10/2026 14:30:12'), '2026-10-27');
    assert.equal(date('2026-10-27T03:00:00Z'), '2026-10-27');
    assert.equal(date(' 03/04/2026 '), '2026-04-03'); // day first: the 3rd of April
    assert.equal(date('29/02/2028'), '2028-02-29');

    for (const bad of [
        '',
        'Tổng cộng',
        '31/02/2026',
        '13/13/2026',
        '27/10',
        '2026',
        '27/10/20266',
    ]) {
        assert.equal(date(bad), '', bad);
    }
});

test('parseBankAmount: dấu chấm / phẩy hàng nghìn và thập phân, âm, ngoặc, đơn vị', () => {
    const amount = (text) => run(`parseBankAmount(${JSON.stringify(text)})`);

    assert.equal(amount('1.234.567'), 1234567);
    assert.equal(amount('1,234,567'), 1234567);
    assert.equal(amount('1.234.567,89'), 1234568);
    assert.equal(amount('1,234,567.89'), 1234568);
    assert.equal(amount('250000'), 250000);
    assert.equal(amount('250000.00'), 250000);
    assert.equal(amount('250.000'), 250000);
    assert.equal(amount('250,000'), 250000);
    assert.equal(amount('1.234'), 1234); // a lone separator + 3 digits is a thousands mark
    assert.equal(amount('1234.5'), 1235);
    assert.equal(amount('-1234.5'), -1235); // rounded by size, not toward +infinity
    assert.equal(amount('0,5'), 1);
    assert.equal(amount('-250.000'), -250000);
    assert.equal(amount('−250.000'), -250000); // a real minus sign
    assert.equal(amount('(250.000)'), -250000);
    assert.equal(amount('250.000-'), -250000);
    assert.equal(amount('+1.000.000'), 1000000);
    assert.equal(amount(' 250.000 VND '), 250000);
    assert.equal(amount('250.000 đ'), 250000);
    assert.equal(amount('1 250 000'), 1250000);
    assert.equal(amount('0'), 0);
    assert.equal(amount(1500.4), 1500);

    for (const bad of [
        '',
        '  ',
        'abc',
        '--5',
        '1.2.3',
        '1.234.56',
        '12,34,56',
        '1,2,3,4',
        '1.234,56,7',
    ]) {
        assert.ok(Number.isNaN(amount(bad)), JSON.stringify(bad));
    }
});

test('detectCsvLayout: tìm dòng tiêu đề sau phần giới thiệu tài khoản, nhận cột ghi nợ / ghi có / số tiền', () => {
    const layout = (rows) => plain(run(`detectCsvLayout(${JSON.stringify(rows)})`));

    // A statement with account lines first and separate debit / credit columns.
    assert.deepEqual(
        layout([
            ['SAO KÊ TÀI KHOẢN'],
            ['Số tài khoản', '0011004123456'],
            [
                'Ngày giao dịch',
                'Số tham chiếu',
                'Số tiền ghi nợ',
                'Số tiền ghi có',
                'Số dư',
                'Nội dung',
            ],
            ['27/10/2026', 'FT123', '20.000', '', '1.000.000', 'Cafe'],
        ]),
        {
            headerIndex: 2,
            columns: {
                date: 0,
                description: 5,
                debit: 2,
                credit: 3,
                amount: -1,
                balance: 4,
                reference: 1,
            },
        },
    );
    // Short headers: "Nợ" / "Có" are columns, "Nội dung" is not a debit.
    assert.deepEqual(layout([['Ngày', 'Diễn giải', 'Nợ', 'Có']]).columns, {
        date: 0,
        description: 1,
        debit: 2,
        credit: 3,
        amount: -1,
        balance: -1,
        reference: -1,
    });
    // One signed amount column, headers in English.
    assert.deepEqual(
        layout([
            ['Transaction Date', 'Description', 'Amount', 'Balance'],
            ['27/10/2026', 'x', '-5', '9'],
        ]),
        {
            headerIndex: 0,
            columns: {
                date: 0,
                description: 1,
                debit: -1,
                credit: -1,
                amount: 2,
                balance: 3,
                reference: -1,
            },
        },
    );
    // Accents and case do not matter; "Số tiền" is the amount, "Số tiền ghi nợ" is not.
    assert.equal(layout([['NGÀY', 'MÔ TẢ', 'SỐ TIỀN']]).columns.amount, 2);
});

test('detectCsvLayout: các kiểu tiêu đề sao kê thường gặp (song ngữ, có STT, ngày hiệu lực, một cột số tiền)', () => {
    const columns = (header) =>
        plain(run(`detectCsvLayout(${JSON.stringify([header, ['x']])})`)).columns;

    // Bilingual headers: the long Vietnamese phrase beats the short English word.
    assert.deepEqual(
        columns([
            'Ngày giao dịch / Date',
            'Số tham chiếu / Reference',
            'Số tiền ghi nợ / Debit',
            'Số tiền ghi có / Credit',
            'Số dư / Balance',
            'Mô tả giao dịch / Description',
        ]),
        { date: 0, reference: 1, debit: 2, credit: 3, balance: 4, description: 5, amount: -1 },
    );
    // A running number column, and a value date next to the transaction date.
    assert.deepEqual(
        columns([
            'STT',
            'Ngày giao dịch',
            'Ngày hiệu lực',
            'Nội dung',
            'Ghi nợ',
            'Ghi có',
            'Số dư',
        ]),
        { date: 1, description: 3, debit: 4, credit: 5, balance: 6, reference: -1, amount: -1 },
    );
    // Header cells with a unit or punctuation.
    assert.deepEqual(columns(['Ngày GD', 'Nội dung', 'Số tiền (VND)', 'Số dư (VND)']), {
        date: 0,
        description: 1,
        amount: 2,
        balance: 3,
        debit: -1,
        credit: -1,
        reference: -1,
    });
    // A card statement: "Số tiền" with a transaction date and details.
    assert.deepEqual(columns(['Ngày giao dịch', 'Chi tiết giao dịch', 'Số tiền']), {
        date: 0,
        description: 1,
        amount: 2,
        debit: -1,
        credit: -1,
        balance: -1,
        reference: -1,
    });
});

test('Sao kê thẻ có cột ngoại tệ: lấy cột đồng Việt Nam, không lấy số đô; dòng Claude 22,22 USD', () => {
    const layout = (rows) => plain(run(`detectCsvLayout(${JSON.stringify(rows)})`));
    const claude = [
        '30/09/26',
        '01/10/26',
        'Retail USA SAN FRANCISCO ANTHROPIC* CLAUDE SUB',
        '-22.22',
        'USD',
        '-582,719.50',
    ];
    const coffee = [
        '02/10/26',
        '02/10/26',
        'Retail VN HIGHLANDS COFFEE',
        '-45000',
        'VND',
        '-45,000.00',
    ];

    // By header: "Số tiền ngoại tệ" is not the amount, "Số tiền VND" is.
    const byHeader = layout([
        [
            'Ngày giao dịch',
            'Ngày hạch toán',
            'Nội dung',
            'Số tiền ngoại tệ',
            'Loại tiền',
            'Số tiền VND',
        ],
        claude,
        coffee,
    ]);

    assert.equal(byHeader.columns.amount, 5);
    assert.equal(byHeader.columns.date, 0); // the transaction date, not the posting date
    assert.equal(byHeader.columns.description, 2);

    // Headers that do not say which is which: a column of currency codes (not all VND) after the
    // amount means the amount is in that currency, so the next numeric column is the one in đồng.
    const byContent = layout([
        [
            'Ngày giao dịch',
            'Ngày hạch toán',
            'Nội dung',
            'Số tiền giao dịch',
            'Loại tiền',
            'Số tiền quy đổi',
        ],
        claude,
        coffee,
    ]);

    assert.equal(byContent.columns.amount, 5);

    const onlyDong = layout([
        ['Ngày giao dịch', 'Ngày hạch toán', 'Nội dung', 'Số tiền giao dịch', 'Loại tiền'],
        coffee.slice(0, 5),
    ]);

    // Every purchase in đồng: the detected column stays.
    assert.equal(onlyDong.columns.amount, 3);

    // The row of the screenshot becomes a 582.720 đ expense on 30/9 (the .50 is rounded).
    const built = plain(
        run(
            `buildImportItems(${JSON.stringify([
                [
                    'Ngày giao dịch',
                    'Ngày hạch toán',
                    'Nội dung',
                    'Số tiền ngoại tệ',
                    'Loại tiền',
                    'Số tiền VND',
                ],
                claude,
                coffee,
            ])},${JSON.stringify(byHeader)},{source:"Thẻ Tín Dụng"})`,
        ),
    );

    assert.deepEqual(
        built.items.map((item) => [item.date, item.type, item.amount]),
        [
            ['2026-09-30', 'expense', 582720],
            ['2026-10-02', 'expense', 45000],
        ],
    );
    assert.equal(built.items[0].note, 'Retail USA SAN FRANCISCO ANTHROPIC* CLAUDE SUB');
});

test('detectCsvLayout: bảng giao dịch thật của sao kê thẻ VPBank (tiêu đề song ngữ, cột phí, số tiền thanh toán)', () => {
    const header = [
        'Ngày giao dịch Tnx date',
        'Ngày hạch toán Posting date',
        'Chi tiết giao dịch Tnx details',
        'Số tiền giao dịch Txn amount',
        'Loại tiền CCY',
        'Phí (VND) Fee (VND)',
        'Số tiền thanh toán (VND) Payment amount (VND)',
    ];
    const rows = [
        header,
        [
            '21/09/26',
            '21/09/26',
            'Credit Account I2B Virtual Card payment;',
            '1,614,164.00',
            'VND',
            '',
            '1,614,164.00',
        ],
        [
            '23/09/26',
            '24/09/26',
            'Retail USA SAN FRANCISCO OPENAI *CHATGPT SUBSCR',
            '-132,000.00',
            'VND',
            '',
            '-132,000.00',
        ],
        ['23/09/26', '24/09/26', 'Custom Fee', '0.00', 'VND', '-10,000.00', '-10,000.00'],
        ['23/09/26', '24/09/26', 'VAT', '0.00', 'VND', '-1,000.00', '-1,000.00'],
    ];
    const layout = plain(run(`detectCsvLayout(${JSON.stringify(rows)})`));

    // The amount is the last column ("Số tiền thanh toán (VND)", fee included), not "Số tiền giao dịch":
    // the fee and VAT lines have 0.00 there.
    assert.deepEqual(layout, {
        headerIndex: 0,
        columns: {
            date: 0,
            description: 2,
            amount: 6,
            debit: -1,
            credit: -1,
            balance: -1,
            reference: -1,
        },
    });

    const built = plain(
        run(
            `buildImportItems(${JSON.stringify(rows)},${JSON.stringify(layout)},{source:"Thẻ Tín Dụng"})`,
        ),
    );

    assert.deepEqual(
        built.items.map((item) => [item.date, item.type, item.amount]),
        [
            ['2026-09-21', 'income', 1614164],
            ['2026-09-23', 'expense', 132000],
            ['2026-09-23', 'expense', 10000],
            ['2026-09-23', 'expense', 1000],
        ],
    );
    assert.equal(built.skipped.length, 0);
});

test('guessPositiveIsExpense: dấu mà đa số dòng có là chi (sao kê VPBank ghi chi là số âm)', () => {
    const guess = (amounts, columns = 'amount:1,debit:-1,credit:-1') =>
        run(
            `guessPositiveIsExpense(${JSON.stringify([['h', 'h'], ...amounts.map((value) => ['d', value])])},{headerIndex:0,columns:{${columns}}})`,
        );

    assert.equal(guess(['-10.000', '-20.000', '5.000']), false); // charges are negative
    assert.equal(guess(['10.000', '20.000', '-5.000']), true); // charges are positive
    assert.equal(guess(['10.000', '-20.000']), false); // a tie: the usual bank account
    assert.equal(guess([]), false);
    assert.equal(guess(['abc', '', 'x']), false);
    // Separate debit / credit columns, or no amount column: the sign does not matter.
    assert.equal(guess(['10.000', '20.000'], 'amount:1,debit:1,credit:-1'), false);
    assert.equal(guess(['10.000', '20.000'], 'amount:-1,debit:-1,credit:-1'), false);
});

test('detectCsvLayout: không có dòng tiêu đề thì đoán cột ngày và mô tả theo dữ liệu', () => {
    const found = plain(
        run(
            `detectCsvLayout(${JSON.stringify([
                ['27/10/2026', 'Thanh toan Highlands Coffee Q1', '-45.000'],
                ['28/10/2026', 'Chuyen khoan tien nha', '-3.000.000'],
                ['29/10/2026', 'Luong thang 10', '12.000.000'],
            ])})`,
        ),
    );

    assert.equal(found.headerIndex, -1);
    assert.equal(found.columns.date, 0);
    assert.equal(found.columns.description, 1);
    assert.equal(found.columns.amount, -1); // left for the person to choose
});

const IMPORT_LAYOUT_SPLIT =
    '{headerIndex:0,columns:{date:0,description:1,debit:2,credit:3,amount:-1,balance:-1,reference:-1}}';
const IMPORT_LAYOUT_SIGNED =
    '{headerIndex:0,columns:{date:0,description:1,debit:-1,credit:-1,amount:2,balance:-1,reference:-1}}';

test('buildImportItems: cột ghi nợ / ghi có hoặc dấu của số tiền quyết định chi hay thu', () => {
    const build = (rows, layout, options = '{source:"VCB"}') =>
        plain(run(`buildImportItems(${JSON.stringify(rows)},${layout},${options})`));
    const split = build(
        [
            ['Ngày', 'Nội dung', 'Nợ', 'Có'],
            ['27/10/2026', 'Cafe', '20.000', ''],
            ['28/10/2026', 'Lương', '', '12.000.000'],
            ['29/10/2026', 'Hoàn tiền', '0', '5.000'],
        ],
        IMPORT_LAYOUT_SPLIT,
    );

    assert.deepEqual(
        split.items.map((item) => [item.date, item.type, item.amount, item.note]),
        [
            ['2026-10-27', 'expense', 20000, 'Cafe'],
            ['2026-10-28', 'income', 12000000, 'Lương'],
            ['2026-10-29', 'income', 5000, 'Hoàn tiền'],
        ],
    );
    assert.deepEqual(split.skipped, []);

    const rows = [
        ['Ngày', 'Mô tả', 'Số tiền'],
        ['27/10/2026', 'Mua hàng', '-150.000'],
        ['28/10/2026', 'Nhận tiền', '+2.000.000'],
    ];
    const signed = build(rows, IMPORT_LAYOUT_SIGNED);

    assert.deepEqual(
        signed.items.map((item) => [item.type, item.amount]),
        [
            ['expense', 150000],
            ['income', 2000000],
        ],
    );
    // A card statement lists purchases as positive numbers and refunds as negative ones.
    const card = build(rows, IMPORT_LAYOUT_SIGNED, '{source:"Visa",positiveIsExpense:true}');

    assert.deepEqual(
        card.items.map((item) => [item.type, item.amount]),
        [
            ['income', 150000],
            ['expense', 2000000],
        ],
    );
});

test('buildImportItems: bỏ dòng không có ngày / số tiền kèm lý do, xóa # khỏi mô tả, giới hạn số dòng', () => {
    const build = (rows) =>
        plain(
            run(`buildImportItems(${JSON.stringify(rows)},${IMPORT_LAYOUT_SIGNED},{source:"VCB"})`),
        );
    const result = build([
        ['Ngày', 'Mô tả', 'Số tiền'],
        ['27/10/2026', '  Mua   #keo   dán\n ', '-10.000'],
        ['Tổng cộng', '', '-10.000'],
        ['28/10/2026', 'Phí', '0'],
        ['29/10/2026', 'Phí', 'abc'],
        ['', '', ''],
    ]);

    assert.equal(result.items.length, 1);
    // No "#": a word starting with it would become a tag.
    assert.equal(result.items[0].note, 'Mua keo dán');
    assert.deepEqual(result.skipped, [
        { row: 3, reason: 'Không đọc được ngày' },
        { row: 4, reason: 'Không có số tiền' },
        { row: 5, reason: 'Không có số tiền' },
    ]);
    assert.equal(result.tooMany, false);

    const many = Array.from({ length: 2005 }, (_, index) => [
        '27/10/2026',
        `Giao dịch ${index}`,
        '-1.000',
    ]);
    const capped = plain(
        run(
            `buildImportItems(${JSON.stringify([['Ngày', 'Mô tả', 'Số tiền'], ...many])},${IMPORT_LAYOUT_SIGNED},{source:"VCB"})`,
        ),
    );

    assert.equal(capped.items.length, 2000);
    assert.equal(capped.tooMany, true);
});

test('buildImportItems: id chỉ phụ thuộc nội dung dòng và nguồn; dòng giống hệt nhau trong file có số thứ tự', () => {
    const rows = [
        ['Ngày', 'Mô tả', 'Số tiền'],
        ['27/10/2026', 'Cafe', '-20.000'],
        ['27/10/2026', 'Cafe', '-20.000'],
        ['27/10/2026', 'Cafe', '-25.000'],
    ];
    const ids = (source, list = rows) =>
        plain(
            run(
                `buildImportItems(${JSON.stringify(list)},${IMPORT_LAYOUT_SIGNED},{source:${JSON.stringify(source)}}).items.map((item) => item.id)`,
            ),
        );
    const first = ids('VCB');

    assert.equal(new Set(first).size, 3);
    assert.match(first[0], /^TX_IMP_20261027_[0-9a-f]{8}$/);
    assert.equal(first[1], `${first[0]}_2`);
    // Importing again, or a later statement that repeats a row, gives the same id.
    assert.deepEqual(ids('VCB'), first);
    assert.equal(ids('VCB', [rows[0], rows[1]])[0], first[0]);
    // Another source is another book entry.
    assert.notEqual(ids('Techcombank')[0], first[0]);
    // A different reference is a different row.
    const withReference = (reference) => [
        ['Ngày', 'Mô tả', 'Số tiền', 'Mã giao dịch'],
        ['27/10/2026', 'Cafe', '-20.000', reference],
    ];
    const layoutWithRef =
        '{headerIndex:0,columns:{date:0,description:1,debit:-1,credit:-1,amount:2,balance:-1,reference:3}}';
    const idOf = (reference) =>
        run(
            `buildImportItems(${JSON.stringify(withReference(reference))},${layoutWithRef},{source:"VCB"}).items[0].id`,
        );

    assert.notEqual(idOf('FT1'), idOf('FT2'));
});

test('markImportDuplicates: đã nhập trước đó, trùng với giao dịch gõ tay (lệch tối đa 2 ngày), mỗi giao dịch chỉ giải thích một dòng', () => {
    const item = (id, date, type, amount) => ({ id, date, type, amount, note: id });
    const mark = (items, existing, source = 'VCB') =>
        plain(
            run(
                `markImportDuplicates(${JSON.stringify(items)},${JSON.stringify(existing)},${JSON.stringify(source)})`,
            ),
        );
    const tx = (id, date, type, amount, extra = {}) => ({
        id,
        date,
        type,
        source: 'VCB',
        amount,
        ...extra,
    });
    const status = (marked) =>
        marked.map((entry) => `${entry.id}:${entry.status}:${entry.include}`);

    // Nothing in the book: everything is new and ticked.
    assert.deepEqual(status(mark([item('a', '2026-10-27', 'expense', 20000)], [])), ['a:new:true']);

    // The same id was imported before.
    assert.deepEqual(
        status(
            mark(
                [item('a', '2026-10-27', 'expense', 20000)],
                [tx('a', '2026-10-27', 'expense', 20000)],
            ),
        ),
        ['a:imported:false'],
    );

    // Typed by hand a day earlier; two days off still matches, three days does not.
    const typed = (date) => [tx('T1', date, 'expense', 20000)];

    assert.equal(
        mark([item('a', '2026-10-27', 'expense', 20000)], typed('2026-10-26'))[0].match,
        'T1',
    );
    assert.equal(
        mark([item('a', '2026-10-27', 'expense', 20000)], typed('2026-10-29'))[0].status,
        'duplicate',
    );
    assert.equal(
        mark([item('a', '2026-10-27', 'expense', 20000)], typed('2026-10-30'))[0].status,
        'new',
    );

    // Same amount, but another type, another amount, or another source: not a duplicate.
    assert.equal(
        mark(
            [item('a', '2026-10-27', 'expense', 20000)],
            [tx('T', '2026-10-27', 'income', 20000)],
        )[0].status,
        'new',
    );
    assert.equal(
        mark(
            [item('a', '2026-10-27', 'expense', 20000)],
            [tx('T', '2026-10-27', 'expense', 20001)],
        )[0].status,
        'new',
    );
    assert.equal(
        mark(
            [item('a', '2026-10-27', 'expense', 20000)],
            [tx('T', '2026-10-27', 'expense', 20000, { source: 'Tiền Mặt' })],
        )[0].status,
        'new',
    );

    // Two rows of the same amount and one typed transaction: only one row is explained, the nearer one.
    const two = mark(
        [item('far', '2026-10-25', 'expense', 20000), item('near', '2026-10-27', 'expense', 20000)],
        [tx('T1', '2026-10-27', 'expense', 20000)],
    );

    assert.deepEqual(status(two), ['far:new:true', 'near:duplicate:false']);

    // A transfer out of the bank is the same money as a bank debit; one into it, as a credit.
    const transfer = (extra) => tx('TR', '2026-10-27', 'transfer', 500000, extra);

    assert.equal(
        mark(
            [item('a', '2026-10-27', 'expense', 500000)],
            [transfer({ source: 'VCB', targetSource: 'Tiền Mặt' })],
        )[0].status,
        'duplicate',
    );
    assert.equal(
        mark(
            [item('a', '2026-10-27', 'income', 500000)],
            [transfer({ source: 'Tiền Mặt', targetSource: 'VCB' })],
        )[0].status,
        'duplicate',
    );
    assert.equal(
        mark(
            [item('a', '2026-10-27', 'income', 500000)],
            [transfer({ source: 'VCB', targetSource: 'Tiền Mặt' })],
        )[0].status,
        'new',
    );
});

test('buildCategoryGuesser: học từ giao dịch đã có, rồi tới cửa hàng quen thuộc, rồi danh mục dự phòng', () => {
    const categories =
        '[{name:"Ăn uống",type:"expense"},{name:"Mua sắm",type:"expense"},{name:"Đi lại",type:"expense"},{name:"Lương / Thưởng",type:"income"},{name:"Thu nhập khác",type:"income"},{name:"Khách",type:"expense"}]';
    const history = JSON.stringify([
        { type: 'expense', category: 'Khách', note: 'GRAB*TRIP 4421 HCM' },
        { type: 'expense', category: 'Khách', note: 'Grab trip 1 #khachA' },
        { type: 'expense', category: 'Ăn uống', note: 'ăn trưa' },
        { type: 'expense', category: 'Danh mục đã xóa', note: 'Highlands' },
    ]);
    const guess = (description, type = 'expense', historyList = history) =>
        run(
            `buildCategoryGuesser(${historyList},${categories})(${JSON.stringify(description)},"${type}")`,
        );

    // The same merchant as a past note (numbers and place do not matter).
    assert.equal(guess('GRAB*TRIP 7783 DN'), 'Khách');
    // A note the person wrote that the description contains.
    assert.equal(guess('THANH TOAN AN TRUA CTY ABC'), 'Ăn uống');
    // Common merchants, only when the category exists with that name.
    assert.equal(guess('SHOPEE PAY 12345'), 'Mua sắm');
    assert.equal(guess('GRABFOOD HCM'), 'Ăn uống'); // food before the taxi rule
    assert.equal(guess('XANG PETROLIMEX 12'), 'Đi lại');
    assert.equal(guess('CTY ABC LUONG THANG 10', 'income'), 'Lương / Thưởng');
    // A category in the history that no longer exists is ignored, then the rules and fallback apply.
    assert.equal(guess('Highlands Coffee'), 'Ăn uống');
    // Nothing matches: the fallbacks.
    assert.equal(guess('CHUYEN KHOAN 998877'), 'Chưa phân loại');
    assert.equal(guess('CHUYEN KHOAN 998877', 'income'), 'Thu nhập khác');
    // Without those categories a rule does not apply.
    assert.equal(
        run(`buildCategoryGuesser([],[{name:"Khác",type:"expense"}])("SHOPEE","expense")`),
        'Chưa phân loại',
    );
});

const CARD_20 = '{name:"Thẻ Tín Dụng",kind:"credit",statementDay:20,dueDay:4';
const CARD_ROWS = `[
    {id:"A",date:"2026-10-22",type:"expense",source:"Thẻ Tín Dụng",amount:587160},
    {id:"B",date:"2026-10-23",type:"expense",source:"Thẻ Tín Dụng",amount:73333},
    {id:"C",date:"2026-10-24",type:"expense",source:"Thẻ Tín Dụng",amount:30000},
    {id:"D",date:"2026-11-03",type:"expense",source:"Thẻ Tín Dụng",amount:87778},
    {id:"E",date:"2026-11-05",type:"expense",source:"Thẻ Tín Dụng",amount:604390},
    {id:"P",date:"2026-10-21",type:"transfer",source:"Thẻ NH Vpbank",targetSource:"Thẻ Tín Dụng",amount:1695414}
]`;

test('computeCardDue với mốc sao kê: số cần trả không còn dính số dư ban đầu bị Khớp số dư làm lệch', () => {
    const due = (card, opening, today = '2026-11-07', rows = CARD_ROWS) =>
        plain(run(`computeCardDue(${card},${rows},${opening},"${today}")`));

    // Without the closing balance: the opening balance that "Khớp số dư" pushed to -1.747.180 (the
    // book was missing 51.766 of charges) makes the paid statement look 51.766 short.
    assert.equal(due(`${CARD_20}}`, -1747180).amount, 51766);
    assert.equal(due(`${CARD_20}}`, -1695414), null);

    // With the closing balance of the 20/10 statement the opening balance does not matter.
    const anchored = `${CARD_20},lastStatement:{date:"2026-10-20",balance:1695414}}`;

    assert.equal(due(anchored, -1747180), null);
    assert.equal(due(anchored, -999), null);
    assert.equal(due(anchored, 5000000), null);

    // Not paid yet (the payment is not in the book): the whole statement is due, overdue by 3 days.
    const unpaid = CARD_ROWS.replace(/,\s*\{id:"P"[^}]*\}/, '');

    assert.deepEqual(due(anchored, -1747180, '2026-11-07', unpaid), {
        name: 'Thẻ Tín Dụng',
        amount: 1695414,
        statementDate: '2026-10-20',
        dueDate: '2026-11-04',
        daysLeft: -3,
    });

    // A payment of less than the statement leaves the rest.
    assert.equal(
        due(
            anchored,
            0,
            '2026-11-07',
            '[{id:"P",date:"2026-10-25",type:"transfer",source:"X",targetSource:"Thẻ Tín Dụng",amount:1000000}]',
        ).amount,
        695414,
    );

    // A balance from an older statement is rolled forward by what happened since: 1.614.164 on 20/9,
    // paid on 21/9, then 1.695.414 of charges, makes 1.695.414 owed on 20/10.
    const older = `${CARD_20},lastStatement:{date:"2026-09-20",balance:1614164}}`;
    const cycle = `[
        {id:"P0",date:"2026-09-21",type:"transfer",source:"X",targetSource:"Thẻ Tín Dụng",amount:1614164},
        {id:"C1",date:"2026-09-23",type:"expense",source:"Thẻ Tín Dụng",amount:1000000},
        {id:"C2",date:"2026-10-20",type:"expense",source:"Thẻ Tín Dụng",amount:695414}
    ]`;

    assert.equal(due(older, 0, '2026-11-07', cycle).amount, 1695414);

    // A closing balance dated after the latest statement day is not used (the date was mistyped).
    const future = `${CARD_20},lastStatement:{date:"2026-10-21",balance:1}}`;

    assert.equal(due(future, -1747180).amount, 51766);
});

test('normalizeSource: mốc sao kê chỉ có với thẻ tín dụng, được làm tròn, bỏ khi không hợp lệ', () => {
    const normalize = (raw) => plain(run(`normalizeSource(${JSON.stringify(raw)})`));
    const card = { name: 'Thẻ', kind: 'credit', statementDay: 20 };

    assert.deepEqual(
        normalize({ ...card, lastStatement: { date: '2026-10-20', balance: '1695414.4' } })
            .lastStatement,
        { date: '2026-10-20', balance: 1695414 },
    );
    assert.deepEqual(
        normalize({ ...card, lastStatement: { date: '20/10/2026', balance: 0 } }).lastStatement,
        { date: '2026-10-20', balance: 0 },
    );
    // Not usable: no property at all, so older sources keep their shape.
    for (const bad of [
        null,
        5,
        {},
        { date: '', balance: 5 },
        { date: '2026-10-20', balance: -1 },
        { date: '2026-10-20', balance: 'x' },
    ]) {
        assert.equal(
            Object.hasOwn(normalize({ ...card, lastStatement: bad }), 'lastStatement'),
            false,
        );
    }
    // Only credit cards have a statement.
    assert.equal(
        Object.hasOwn(
            normalize({
                name: 'NH',
                kind: 'bank',
                lastStatement: { date: '2026-10-20', balance: 5 },
            }),
            'lastStatement',
        ),
        false,
    );
});

test('statementCycles: các kỳ sao kê từ kỳ đang mở lùi về trước; ngày chốt thuộc kỳ nó đóng', () => {
    const cycles = (day, today, count) => plain(run(`statementCycles(${day},"${today}",${count})`));

    assert.deepEqual(cycles(20, '2026-11-07', 3), [
        { start: '2026-10-21', end: '2026-11-20', open: true },
        { start: '2026-09-21', end: '2026-10-20', open: false },
        { start: '2026-08-21', end: '2026-09-20', open: false },
    ]);
    // On the statement day itself that cycle is closed and a new one has opened.
    assert.deepEqual(cycles(20, '2026-11-20', 2), [
        { start: '2026-11-21', end: '2026-12-20', open: true },
        { start: '2026-10-21', end: '2026-11-20', open: false },
    ]);
    assert.equal(cycles(20, '2026-11-19', 1)[0].end, '2026-11-20');
    // Short months: a statement on the 31st closes on the last day.
    assert.deepEqual(cycles(31, '2026-03-10', 3), [
        { start: '2026-03-01', end: '2026-03-31', open: true },
        { start: '2026-02-01', end: '2026-02-28', open: false },
        { start: '2026-01-01', end: '2026-01-31', open: false },
    ]);
    // Over a year end, and no statement day means no cycles.
    assert.equal(cycles(24, '2027-01-05', 2)[1].start, '2026-11-25');
    assert.equal(run('statementCycles(null,"2026-11-07").length'), 0);
    assert.equal(run('statementCycles(20,"2026-11-07").length'), 12);
    assert.equal(run('latestStatementDate(20,"2026-11-07")'), '2026-10-20');
    assert.equal(run('latestStatementDate(20,"2026-11-20")'), '2026-11-20');
});

test('computeCardCycleTotals và lọc theo khoảng ngày: phát sinh và đã trả của một kỳ, tính cả hai đầu', () => {
    const totals = plain(
        run(`computeCardCycleTotals(${CARD_ROWS},"Thẻ Tín Dụng","2026-10-21","2026-11-05")`),
    );

    // The 21/10 transfer is the payment; the five expenses are charges.
    assert.deepEqual(totals, { charges: 1382661, payments: 1695414, count: 6 });
    assert.deepEqual(
        plain(run(`computeCardCycleTotals(${CARD_ROWS},"Thẻ Tín Dụng","2026-10-22","2026-10-24")`)),
        { charges: 690493, payments: 0, count: 3 },
    );
    // Cash taken from the card (a transfer out) is a charge; other sources are not counted.
    assert.deepEqual(
        plain(
            run(
                `computeCardCycleTotals([{date:"2026-10-25",type:"transfer",source:"Thẻ Tín Dụng",targetSource:"Tiền Mặt",amount:500000},{date:"2026-10-25",type:"expense",source:"Tiền Mặt",amount:9}],"Thẻ Tín Dụng","2026-10-21","2026-10-25")`,
            ),
        ),
        { charges: 500000, payments: 0, count: 1 },
    );

    const ids = (filters) =>
        run(`filterTransactions(${CARD_ROWS},${filters}).map((t) => t.id).join("")`);

    assert.equal(ids('{from:"2026-10-22",to:"2026-10-24"}'), 'ABC');
    assert.equal(ids('{from:"2026-11-03"}'), 'DE');
    assert.equal(ids('{to:"2026-10-21"}'), 'P');
    assert.equal(ids('{from:"",to:""}'), 'ABCDEP');
});

test('moveInList: đổi chỗ với phần tử kề, giữ nguyên mảng gốc, đứng yên ở hai đầu', () => {
    const move = (list, index, step, predicate = '') =>
        run(`moveInList(${list},${index},${step}${predicate && `,${predicate}`}).join("")`);

    assert.equal(move('["a","b","c","d"]', 2, -1), 'acbd');
    assert.equal(move('["a","b","c","d"]', 1, 1), 'acbd');
    // At either end, or with a bad index or step, the same array comes back.
    assert.equal(move('["a","b","c"]', 0, -1), 'abc');
    assert.equal(move('["a","b","c"]', 2, 1), 'abc');
    assert.equal(move('["a","b","c"]', 5, 1), 'abc');
    assert.equal(move('["a","b","c"]', -1, 1), 'abc');
    assert.equal(move('["a","b","c"]', 1, 2), 'abc');
    assert.equal(
        run('(() => { const l = ["a","b"]; moveInList(l, 1, -1); return l.join(""); })()'),
        'ab',
    );
    assert.equal(
        run('(() => { const l = ["a","b"]; return moveInList(l, 0, -1) === l; })()'),
        true,
    );
});

test('moveInList: chỉ đổi chỗ với phần tử được chấp nhận, những phần tử ở giữa đứng yên', () => {
    // Lower case = hidden (an archived source, or a category of the other type).
    const visible = '(other) => other === other.toUpperCase()';
    const move = (list, index, step) =>
        run(`moveInList(${list},${index},${step},${visible}).join("")`);

    assert.equal(move('["A","x","B","y","C"]', 2, -1), 'BxAyC');
    assert.equal(move('["A","x","B","y","C"]', 2, 1), 'AxCyB');
    assert.equal(move('["A","x","B"]', 0, -1), 'AxB');
    assert.equal(move('["x","A","y"]', 1, 1), 'xAy');
});

test('normalizeSources / normalizeCategories giữ nguyên thứ tự người dùng đã sắp xếp', () => {
    assert.equal(
        run(
            'normalizeSources([{name:"C",kind:"cash"},{name:"A",kind:"bank"},{name:"B"}]).map((s) => s.name).join("")',
        ),
        'CAB',
    );
    assert.equal(
        run(
            'normalizeCategories([{id:3,name:"z",type:"expense"},{id:1,name:"a",type:"income"},{id:2,name:"m",type:"expense"}]).map((c) => c.id).join("")',
        ),
        '312',
    );
});

test('extractTags: thẻ là từ "#chữ…", tách khỏi phần ghi chú còn lại và không lặp (không phân biệt hoa thường)', () => {
    const extract = (note) =>
        JSON.parse(JSON.stringify(run(`extractTags(${JSON.stringify(note)})`)));

    assert.deepEqual(extract('Mua keo #KhachA #dh-102'), {
        text: 'Mua keo',
        tags: ['KhachA', 'dh-102'],
    });
    // The tags can be anywhere in the note; the other words keep their order.
    assert.deepEqual(extract('#khachA mua keo 502 #Đơn_hàng'), {
        text: 'mua keo 502',
        tags: ['khachA', 'Đơn_hàng'],
    });
    // The first spelling stays, the repeat goes.
    assert.deepEqual(extract('a #KhachA b #khacha').tags, ['KhachA']);
    // Not tags: a number ("#12" is a room), a tag with punctuation stuck to it, a lone "#",
    // a "#" inside a word, 31 characters.
    assert.deepEqual(extract('Phòng #12, tầng #3').tags, []);
    assert.deepEqual(extract('xong #khach, #').tags, []);
    assert.deepEqual(extract('mail a#b').tags, []);
    assert.deepEqual(extract(`#${'a'.repeat(31)}`).tags, []);
    assert.equal(extract(`#${'a'.repeat(30)}`).tags.length, 1);
    // No tag: the text comes back with single spaces, empty or missing notes are fine.
    assert.deepEqual(extract('Cafe   sáng'), { text: 'Cafe sáng', tags: [] });
    assert.deepEqual(extract(''), { text: '', tags: [] });
    assert.deepEqual(JSON.parse(JSON.stringify(run('extractTags(null)'))), { text: '', tags: [] });
});

test('parseTagInput / composeNote: đọc ô thẻ (dấu cách, phẩy, # tùy ý), báo từ sai, ghép lại vào ghi chú', () => {
    const parse = (input) =>
        JSON.parse(JSON.stringify(run(`parseTagInput(${JSON.stringify(input)})`)));

    assert.deepEqual(parse('khachA, #dh102  hoa-don;KhachA'), {
        tags: ['khachA', 'dh102', 'hoa-don'],
        invalid: [],
    });
    assert.deepEqual(parse('12abc ok a$b'), { tags: ['ok'], invalid: ['12abc', 'a$b'] });
    assert.deepEqual(parse('  ,  '), { tags: [], invalid: [] });

    assert.equal(run('composeNote("Mua keo", ["khachA","dh102"])'), 'Mua keo #khachA #dh102');
    assert.equal(run('composeNote("", ["khachA"])'), '#khachA');
    assert.equal(run('composeNote("  Mua keo  ", [])'), 'Mua keo');
    // Writing a note and reading it back gives the same text and tags.
    assert.deepEqual(
        JSON.parse(JSON.stringify(run('extractTags(composeNote("Mua keo", ["a","B"]))'))),
        { text: 'Mua keo', tags: ['a', 'B'] },
    );
});

test('collectTags: đếm số giao dịch của mỗi thẻ, thẻ dùng nhiều nhất trước, gộp hoa thường', () => {
    const list =
        '[{note:"a #KhachA #dh1"},{note:"b #khacha"},{note:"c #dh1 #Zeta"},{note:"d"},{note:"e #khacha #dh1"}]';
    const found = JSON.parse(JSON.stringify(run(`collectTags(${list})`)));

    assert.deepEqual(found, [
        { tag: 'dh1', count: 3 },
        { tag: 'KhachA', count: 3 },
        { tag: 'Zeta', count: 1 },
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(run('collectTags([])'))), []);
});

test('filterTransactions: tag giữ giao dịch có đúng thẻ đó (không phân biệt hoa thường, không khớp một phần)', () => {
    const list =
        '[{id:"a",date:"2026-10-01",type:"expense",source:"x",category:"c",amount:1,note:"mua #KhachA"},{id:"b",date:"2026-10-01",type:"income",source:"x",category:"c",amount:1,note:"thu #khach"},{id:"c",date:"2026-10-01",type:"expense",source:"x",category:"c",amount:1,note:"khachA không có dấu #"}]';
    const ids = (filters) =>
        run(`filterTransactions(${list},${filters}).map((t) => t.id).join("")`);

    assert.equal(ids('{tag:"khacha"}'), 'a');
    assert.equal(ids('{tag:"KHACH"}'), 'b');
    assert.equal(ids('{tag:"kha"}'), '');
    assert.equal(ids('{tag:"ALL"}'), 'abc');
    assert.equal(ids('{tag:""}'), 'abc');
    assert.equal(ids('{tag:"khacha",type:"income"}'), '');
});

test('formatMoneyDigits: số 0 đứng đầu bị bỏ khi gõ ở cuối, được giữ khi sửa ở đầu / giữa (keepLeadingZeros)', () => {
    const keep = (text, negative = false) =>
        run(`formatMoneyDigits(${JSON.stringify(text)},${negative},{keepLeadingZeros:true})`);

    // Gõ ở cuối: như cũ.
    assert.equal(run('formatMoneyDigits("007")'), '7');
    assert.equal(run('formatMoneyDigits("0.000")'), '0');
    assert.equal(run('formatMoneyDigits("0")'), '0');
    // Xóa chữ số đầu của "20.000" để lại "0.000": giữ đủ ba số 0 để gõ chữ số mới.
    assert.equal(keep('0.000'), '0.000');
    assert.equal(keep('000'), '000');
    assert.equal(keep('050000'), '050.000');
    assert.equal(keep('-0.000', true), '-0.000');
    // Không có số 0 đứng đầu thì hai cách giống nhau; vẫn cắt ở 15 chữ số và bỏ ký tự lạ.
    assert.equal(keep('1500000'), '1.500.000');
    assert.equal(keep(`${'9'.repeat(20)}`).replace(/\./g, '').length, 15);
    assert.equal(keep('a1b0'), '10');
    // Đọc lại số có số 0 đứng đầu vẫn đúng giá trị.
    assert.equal(run('parseMoneyText("0.000")'), 0);
    assert.equal(run('parseMoneyText("050.000")'), 50000);
});
