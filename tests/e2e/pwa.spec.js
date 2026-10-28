// PWA: manifest, icons, service worker cache and offline start.

const fs = require('fs');
const path = require('path');
const { test, expect, openApp, wait } = require('./helpers');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const appShell = () =>
    Function(`return ${read('sw.js').match(/const APP_SHELL = (\[[\s\S]*?\]);/)[1]}`)();

test.describe('PWA', () => {
    test('sw.js APP_SHELL liệt kê mọi file nội bộ mà index.html nạp và các file đó tồn tại', () => {
        const references = [...read('index.html').matchAll(/(?:src|href)="([^"#?]+)"/g)]
            .map((match) => match[1])
            .filter((url) => !/^(https?:|data:|mailto:)/.test(url));
        const shell = appShell();

        expect(references.length).toBeGreaterThan(10);

        for (const reference of references) {
            expect(shell, `${reference} thiếu trong APP_SHELL của sw.js`).toContain(reference);
        }

        for (const entry of shell.filter((item) => item !== './')) {
            expect(fs.existsSync(path.join(ROOT, entry)), `${entry} không tồn tại`).toBe(true);
        }
    });

    test('manifest hợp lệ và icon tồn tại', () => {
        const manifest = JSON.parse(read('manifest.json'));

        expect(manifest).toMatchObject({ display: 'standalone', lang: 'vi', start_url: './' });
        expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
            expect.arrayContaining(['192x192', '512x512']),
        );
        expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

        for (const icon of manifest.icons) {
            expect(fs.existsSync(path.join(ROOT, icon.src)), icon.src).toBe(true);
        }
    });

    test('mở lại được khi offline sau lần tải đầu, biểu đồ và dữ liệu vẫn còn', async ({
        browser,
    }) => {
        const { context, page } = await openApp(browser, {
            serviceWorkers: 'allow',
            seed: {
                fm_transactions: JSON.stringify([
                    {
                        id: 'TX_1',
                        date: '2026-10-27',
                        type: 'income',
                        source: 'Tiền Mặt',
                        category: 'Lương / Thưởng',
                        amount: 5000000,
                        note: '',
                    },
                ]),
            },
        });

        try {
            await page.evaluate(() => navigator.serviceWorker.ready);
            await page.reload(); // from now on the page is controlled by the service worker
            await wait(300);
            expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(
                true,
            );

            await context.setOffline(true);
            await page.reload();

            await expect(page.locator('#sources-grid .card').first()).toContainText('5.000.000');
            expect(await page.evaluate(() => Boolean(Chart.getChart('monthlyChart')))).toBe(true);
            await expect(page.locator('i.fa-wallet').first()).toBeVisible();
        } finally {
            await context.close();
        }
    });
});
