#!/usr/bin/env node
// UserPromptSubmit hook: when the owner's message is about handling a review round ("RV vòng 10",
// "xử lý vòng 5") or reports a bug, remind Claude to read docs/review-lessons.md before the fix and
// to record the lesson (bug family, invariant, matrix cell, mutation check) after it.
//
// Reads the hook payload (JSON) on stdin. Prints a JSON object with additionalContext when the
// prompt matches, nothing otherwise. It must never fail or block a prompt: every error exits 0.

const REVIEW_ROUND = [
    /(?<![\p{L}\p{N}])(?:rv|review)(?![\p{L}\p{N}]).{0,12}\d/iu,
    /(?<![\p{L}\p{N}])v[òo]ng\s*\d+/iu,
];
const BUG_REPORT = /(?<![\p{L}\p{N}])(?:lỗi|bug|sự cố)(?![\p{L}\p{N}])/iu;

const REMINDER = [
    '[Nhắc tự động: học từ lỗi / review] Việc này là xử lý review hoặc sửa lỗi.',
    '1) Trước khi sửa: đọc docs/review-lessons.md (họ lỗi, bất biến, ma trận tình huống).',
    '2) Khi sửa: viết test đỏ trên bản chưa sửa, sửa cả họ lỗi (tìm mọi chỗ cùng mẫu, không chỉ chỗ được nêu), rồi kiểm tra đột biến từng cơ chế mới.',
    '3) Sau khi sửa: cập nhật docs/review-lessons.md (biến thể mới của họ lỗi, bất biến nếu đổi, ô ma trận kèm tên nhóm test) và báo rõ điều gì đã kiểm chứng, điều gì chưa.',
].join('\n');

function wantsReminder(prompt) {
    return (
        typeof prompt === 'string' &&
        (REVIEW_ROUND.some((p) => p.test(prompt)) || BUG_REPORT.test(prompt))
    );
}

function main(input) {
    let prompt;

    try {
        prompt = JSON.parse(input).prompt;
    } catch {
        return '';
    }

    if (!wantsReminder(prompt)) return '';

    return JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: REMINDER },
    });
}

if (require.main === module) {
    let input = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (input += chunk));
    process.stdin.on('end', () => {
        let output = '';

        try {
            output = main(input);
        } catch {
            output = '';
        }

        if (output) process.stdout.write(`${output}\n`);
    });
    process.stdin.on('error', () => {});
}

module.exports = { wantsReminder, main };
