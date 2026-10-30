// The app version is a hash of the app shell, stamped into js/version.js, version.json and sw.js by
// `npm run stamp`. These tests fail while the stamp does not match the files.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const stamp = require('../../scripts/stamp-version');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('phiên bản đã đóng dấu khớp với nội dung hiện tại (chạy `npm run stamp` rồi commit nếu lỗi)', () => {
    const current = stamp.readStamp();

    assert.equal(
        stamp.isUpToDate(),
        true,
        `Dấu phiên bản cũ (${current.version}, ${current.cache}). Chạy \`npm run stamp\` rồi commit js/version.js, version.json, sw.js.`,
    );
});

test('hash ổn định, dạng SHA-256, không phụ thuộc vào chính js/version.js', () => {
    const first = stamp.computeBuildHash();

    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(stamp.computeBuildHash(), first);
    assert.equal(stamp.appShell().includes('js/version.js'), false);
});

test('tên cache là fm- cộng 7 ký tự đầu của hash; version là ngày cộng 7 ký tự đó', () => {
    const { version, hash, cache } = stamp.readStamp();

    assert.equal(cache, stamp.cacheName(hash));
    assert.match(cache, /^fm-[0-9a-f]{7}$/);
    assert.match(version, /^\d{4}\.\d{2}\.\d{2}-[0-9a-f]{7}$/);
    assert.equal(version.endsWith(`-${hash.slice(0, 7)}`), true);
});

test('js/version.js nằm trong APP_SHELL và được nạp đầu tiên trong index.html', () => {
    const shell = read('sw.js').match(/const APP_SHELL = (\[[\s\S]*?\]);/)[1];
    const scripts = [...read('index.html').matchAll(/<script src="(js\/[^"]+)"/g)].map(
        (match) => match[1],
    );

    assert.equal(shell.includes("'js/version.js'"), true);
    assert.equal(scripts[0], 'js/version.js');
});

test('version.json không nằm trong APP_SHELL và service worker không bao giờ trả nó từ cache', () => {
    const sw = read('sw.js');
    const shell = sw.match(/const APP_SHELL = (\[[\s\S]*?\]);/)[1];

    assert.equal(shell.includes('version.json'), false);
    assert.match(sw, /pathname\.endsWith\('\/version\.json'\)\) return;/);
    // A release is cached from the server, not from the browser's HTTP cache.
    assert.match(sw, /new Request\(url, \{ cache: 'reload' \}\)/);
});
