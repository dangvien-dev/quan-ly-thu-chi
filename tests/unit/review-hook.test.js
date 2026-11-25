// The UserPromptSubmit hook that reminds Claude to read and update docs/review-lessons.md.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { wantsReminder } = require('../../.claude/hooks/review-lessons');

const HOOK = path.join(__dirname, '..', '..', '.claude', 'hooks', 'review-lessons.js');

const run = (input) =>
    spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 10000 });

test('nhắc khi lời nhắn nói về xử lý một vòng review', () => {
    [
        'Có RV vòng 10',
        'có rv 7',
        'Có RV V8, làm kỹ giúp mình',
        'xử lý vòng 5 PR 33',
        'có review vòng 6 rồi',
    ].forEach((prompt) => assert.equal(wantsReminder(prompt), true, prompt));
});

test('nhắc khi lời nhắn báo lỗi, bug hay sự cố', () => {
    ['có lỗi khi nhập CSV', 'Lỗi: mất dữ liệu', 'found a bug in sync', 'sự cố hôm qua'].forEach(
        (prompt) => assert.equal(wantsReminder(prompt), true, prompt),
    );
});

test('không nhắc với lời nhắn không liên quan, kể cả từ chứa chữ tương tự', () => {
    [
        'kiểm tra CI của PR 33',
        'Tạm thời chuyển repo sang prived có ảnh hưởng không',
        'hãy debugging đoạn này',
        'cảm ơn reviewer',
        'sửa chữ lỗiX',
        '',
    ].forEach((prompt) => assert.equal(wantsReminder(prompt), false, prompt));
    assert.equal(wantsReminder(undefined), false);
    assert.equal(wantsReminder(42), false);
});

test('chạy như hook: in additionalContext trỏ tới docs/review-lessons.md khi khớp', () => {
    const result = run(JSON.stringify({ prompt: 'Có RV vòng 11' }));
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 0);
    assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(output.hookSpecificOutput.additionalContext, /docs\/review-lessons\.md/);
});

test('chạy như hook: không in gì và thoát 0 khi không khớp hoặc dữ liệu hỏng', () => {
    [JSON.stringify({ prompt: 'xin chào' }), JSON.stringify({}), 'không phải JSON', ''].forEach(
        (input) => {
            const result = run(input);

            assert.equal(result.status, 0);
            assert.equal(result.stdout, '');
        },
    );
});
