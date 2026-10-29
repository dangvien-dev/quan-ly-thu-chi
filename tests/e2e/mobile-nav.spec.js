// Phone navigation: a bottom bar with four pages and the add button in the middle, and the other
// pages in the menu that slides in from the left (the sidebar).

const { test, expect, tx, scanA11y, settle } = require('./helpers');

const NOW = '2026-10-28T03:00:00Z';
const phone = { now: NOW, viewport: { width: 390, height: 844 } };
const desktop = { now: NOW, viewport: { width: 1280, height: 800 } };
const PAGES = [
    ['overview', 'Tổng Quan Dòng Tiền'],
    ['transactions', 'Sổ Giao Dịch'],
    ['sources', 'Nguồn Tiền & Tài Khoản'],
    ['categories', 'Danh Mục Thu / Chi'],
    ['recurring', 'Giao Dịch Định Kỳ'],
    ['debts', 'Vay Nợ & Công Ty'],
    ['settings', 'Cài Đặt & Dữ Liệu'],
];

const menuItem = (page, tab) => page.locator(`aside [data-tab="${tab}"] button`);
const insideMenu = (page) =>
    page.evaluate(() => document.getElementById('sidebar').contains(document.activeElement));

test.describe('Thanh dưới trên điện thoại', () => {
    test('có đúng 4 trang theo thứ tự Tổng quan, Sổ GD, Nguồn, Vay nợ', async ({ app }) => {
        const { page } = await app(phone);
        const items = page.locator('.mobile-nav-item');

        await expect(items).toHaveCount(4);
        await expect(items.locator('span')).toHaveText(['Tổng quan', 'Sổ GD', 'Nguồn', 'Vay nợ']);
        expect(await items.evaluateAll((nodes) => nodes.map((node) => node.dataset.tab))).toEqual([
            'overview',
            'transactions',
            'sources',
            'debts',
        ]);
    });

    test('thanh không cuộn ngang, không tràn màn hình, mọi mục thấy được cùng lúc', async ({
        app,
    }) => {
        const { page } = await app(phone);
        const sizes = await page.evaluate(() => {
            const nav = document.querySelector('.mobile-nav');

            return {
                scrolls: nav.scrollWidth > nav.clientWidth,
                page: document.documentElement.scrollWidth - window.innerWidth,
            };
        });

        expect(sizes).toEqual({ scrolls: false, page: 0 });

        for (const item of await page.locator('.mobile-nav-item').all()) {
            const box = await item.boundingBox();

            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(390);
        }
    });

    test('bấm một mục thì chuyển trang, đánh dấu trang hiện tại (aria-current) và đồng bộ với menu trái', async ({
        app,
    }) => {
        const { page } = await app(phone);

        await page.click('.mobile-nav-item[data-tab="sources"]');

        await expect(page.locator('#tab-sources')).toHaveClass(/active/);
        await expect(page.locator('.mobile-nav-item[data-tab="sources"]')).toHaveAttribute(
            'aria-current',
            'page',
        );
        await expect(page.locator('.mobile-nav-item[aria-current]')).toHaveCount(1);
        await expect(menuItem(page, 'sources')).toHaveAttribute('aria-current', 'page');
        await expect(menuItem(page, 'overview')).not.toHaveAttribute('aria-current');
    });

    test('đang ở trang chỉ có trong menu trái (Định kỳ) thì thanh dưới không mục nào được đánh dấu', async ({
        app,
    }) => {
        const { page } = await app(phone);

        await page.evaluate(() => switchTab('recurring'));

        await expect(page.locator('.mobile-nav-item[aria-current]')).toHaveCount(0);
        await expect(page.locator('.mobile-nav-item.active')).toHaveCount(0);
        await expect(menuItem(page, 'recurring')).toHaveAttribute('aria-current', 'page');
    });
});

test.describe('Nút thêm ở giữa thanh dưới', () => {
    test('nằm trong thanh, đúng giữa màn hình, giữa mục thứ 2 và mục thứ 3', async ({ app }) => {
        const { page } = await app(phone);
        const fab = page.locator('.mobile-nav .floating-add-btn');

        await expect(fab).toBeVisible();
        await expect(page.locator('.floating-add-btn')).toHaveCount(1);

        const box = await fab.boundingBox();
        const second = await page.locator('.mobile-nav-item').nth(1).boundingBox();
        const third = await page.locator('.mobile-nav-item').nth(2).boundingBox();

        expect(Math.abs(box.x + box.width / 2 - 195)).toBeLessThanOrEqual(1);
        expect(box.x).toBeGreaterThanOrEqual(second.x + second.width);
        expect(box.x + box.width).toBeLessThanOrEqual(third.x);
    });

    test('nhô lên khỏi thanh khoảng 1/4 nút và có viền trắng 6px liền với thanh', async ({
        app,
    }) => {
        const { page } = await app(phone);
        const fab = page.locator('.floating-add-btn');
        const nav = await page.locator('.mobile-nav').boundingBox();
        const box = await fab.boundingBox();
        const style = await fab.evaluate((node) => {
            const css = getComputedStyle(node);

            return {
                width: css.borderTopWidth,
                color: css.borderTopColor,
                radius: css.borderTopLeftRadius,
                background: css.backgroundColor,
            };
        });
        const raised = nav.y - box.y;

        // About a quarter of the 56px circle (14px) plus the part of the ring that was already above.
        expect(raised).toBeGreaterThanOrEqual(12);
        expect(raised).toBeLessThanOrEqual(24);
        expect(box.y + box.height).toBeLessThanOrEqual(nav.y + nav.height);
        expect(style.width).toBe('6px');
        expect(style.color).toBe('rgb(255, 255, 255)');
        expect(style.background).not.toBe('rgb(255, 255, 255)');
        expect(parseFloat(style.radius)).toBeGreaterThanOrEqual(34);
    });

    test('bấm nút mở hộp thoại thêm giao dịch, ô số tiền được focus, lưu được', async ({ app }) => {
        const { page } = await app(phone);

        await page.click('.floating-add-btn');

        await expect(page.locator('#transactionModal')).toHaveClass(/open/);
        await expect(page.locator('#txAmount')).toBeFocused();

        await page.locator('#txAmount').pressSequentially('45000');
        await page.click('#transactionForm button[type=submit]');

        expect(await page.evaluate(() => transactions.map((t) => t.amount))).toContain(45000);
    });

    test('nút "Nhập Giao Dịch" ở đầu trang ẩn trên điện thoại (đã có nút ở thanh dưới)', async ({
        app,
    }) => {
        const { page } = await app(phone);

        await expect(page.locator('header .header-add')).toBeHidden();
    });

    test('nút có tên truy cập và bấm được bằng bàn phím', async ({ app }) => {
        const { page } = await app(phone);
        const fab = page.locator('.floating-add-btn');

        await expect(fab).toHaveAccessibleName('Thêm giao dịch');
        await fab.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#transactionModal')).toHaveClass(/open/);
    });

    test('thứ tự Tab đi đúng thứ tự nhìn thấy: Tổng quan, Sổ GD, nút thêm, Nguồn, Vay nợ', async ({
        app,
    }) => {
        const { page } = await app(phone);
        const order = [];

        await page.locator('.mobile-nav-item').first().focus();

        for (let step = 0; step < 5; step++) {
            order.push(
                await page.evaluate(
                    () =>
                        document.activeElement.getAttribute('aria-label') ||
                        document.activeElement.innerText.trim(),
                ),
            );
            await page.keyboard.press('Tab');
        }

        expect(order).toEqual(['Tổng quan', 'Sổ GD', 'Thêm giao dịch', 'Nguồn', 'Vay nợ']);
    });
});

test.describe('Menu trái trên điện thoại', () => {
    test('đóng sẵn: ẩn khỏi màn hình và khỏi bàn phím; nút menu có tên và aria-expanded=false', async ({
        app,
    }) => {
        const { page } = await app(phone);
        const toggle = page.locator('#menu-toggle');

        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveAccessibleName('Mở menu');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#sidebar')).toBeHidden();
        await expect(page.locator('.drawer-backdrop')).toHaveCSS('pointer-events', 'none');
    });

    test('mở bằng nút menu: hiện đủ 7 trang, focus vào trang hiện tại, có lớp nền mờ, khóa cuộn', async ({
        app,
    }) => {
        const { page } = await app(phone);

        await page.click('#menu-toggle');

        await expect(page.locator('#sidebar')).toBeVisible();
        await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#menu-toggle')).toHaveAccessibleName('Đóng menu');
        await expect(page.locator('aside .menu-link')).toHaveCount(7);
        await expect(menuItem(page, 'overview')).toBeFocused();
        await expect(page.locator('.drawer-backdrop')).toHaveCSS('opacity', '1');
        await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

        const box = await page.locator('#sidebar').boundingBox();

        expect(box.x).toBe(0);
        expect(box.width).toBeLessThanOrEqual(300);
        expect(box.width).toBeLessThan(390);
    });

    test('mở khi đang ở trang khác thì focus vào đúng trang đó', async ({ app }) => {
        const { page } = await app(phone);

        await page.evaluate(() => switchTab('debts'));
        await page.click('#menu-toggle');

        await expect(menuItem(page, 'debts')).toBeFocused();
        await expect(page.locator('aside [data-tab="debts"]')).toHaveClass(/active/);
    });

    for (const [tab, title] of PAGES) {
        test(`chọn "${title}" trong menu: chuyển trang, đóng menu, focus vào nội dung`, async ({
            app,
        }) => {
            const { page } = await app(phone);

            await page.click('#menu-toggle');
            await menuItem(page, tab).click();

            await expect(page.locator(`#tab-${tab}`)).toHaveClass(/active/);
            await expect(page.locator('#page-title')).toHaveText(title);
            await expect(page.locator('#sidebar')).toBeHidden();
            await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-expanded', 'false');
            await expect(page.locator('#main-content')).toBeFocused();
            await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
        });
    }

    test('Esc đóng menu và trả focus về nút menu', async ({ app }) => {
        const { page } = await app(phone);

        await page.click('#menu-toggle');
        await page.keyboard.press('Escape');

        await expect(page.locator('#sidebar')).toBeHidden();
        await expect(page.locator('#menu-toggle')).toBeFocused();
        await expect(page.locator('#menu-toggle')).toHaveAccessibleName('Mở menu');
    });

    test('bấm nền mờ hoặc nút × đóng menu', async ({ app }) => {
        const { page } = await app(phone);

        await page.click('#menu-toggle');
        await page.locator('.drawer-backdrop').click({ position: { x: 350, y: 400 } });
        await expect(page.locator('#sidebar')).toBeHidden();
        await expect(page.locator('#menu-toggle')).toBeFocused();

        await page.click('#menu-toggle');
        await page.click('.drawer-close');
        await expect(page.locator('#sidebar')).toBeHidden();
        await expect(page.locator('#menu-toggle')).toBeFocused();
    });

    test('bấm nút menu lần nữa cũng đóng; Tab / Shift+Tab giữ focus trong menu', async ({
        app,
    }) => {
        const { page } = await app(phone);

        await page.click('#menu-toggle');

        for (let step = 0; step < 12; step++) {
            await page.keyboard.press('Tab');
            expect(await insideMenu(page)).toBe(true);
        }

        for (let step = 0; step < 12; step++) {
            await page.keyboard.press('Shift+Tab');
            expect(await insideMenu(page)).toBe(true);
        }

        await page.evaluate(() => toggleMenu());
        await expect(page.locator('#sidebar')).toBeHidden();
    });

    test('nội dung phía sau không bấm được khi menu đang mở (nền mờ chặn)', async ({ app }) => {
        const { page } = await app({
            ...phone,
            seed: { fm_transactions: JSON.stringify([tx({ id: 'TX_1', note: 'Cafe sáng' })]) },
        });

        await page.evaluate(() => switchTab('transactions'));
        await page.click('#menu-toggle');

        const covered = await page.evaluate(() => {
            const element = document.elementFromPoint(360, 400);

            return element.classList.contains('drawer-backdrop');
        });

        expect(covered).toBe(true);
    });

    test('phóng to qua độ rộng điện thoại (xoay máy tính bảng) thì menu tự đóng, sidebar hiện bình thường', async ({
        app,
    }) => {
        const { page } = await app(phone);

        await page.click('#menu-toggle');
        await page.setViewportSize({ width: 1100, height: 800 });

        // The browser reports the width change asynchronously.
        await expect(page.locator('body')).not.toHaveClass(/menu-open/);
        await expect(page.locator('#sidebar')).toBeVisible();
        await expect(page.locator('#menu-toggle')).toBeHidden();
    });

    test('máy tính: không có thanh dưới và nút menu, sidebar luôn hiện, nút Nhập Giao Dịch vẫn ở đầu trang', async ({
        app,
    }) => {
        const { page } = await app(desktop);

        await expect(page.locator('.mobile-nav')).toBeHidden();
        await expect(page.locator('#menu-toggle')).toBeHidden();
        await expect(page.locator('#sidebar')).toBeVisible();
        await expect(page.locator('header .header-add')).toBeVisible();
        await expect(page.locator('aside .menu-link')).toHaveCount(7);
    });
});

test.describe('Trợ năng và bố cục', () => {
    test('thanh dưới và đầu trang trên điện thoại không có vi phạm axe', async ({ app }) => {
        const { page } = await app(phone);
        const results = await scanA11y(page);

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    test('menu đang mở không có vi phạm axe', async ({ app }) => {
        const { page } = await app(phone);

        await page.click('#menu-toggle');

        const results = await scanA11y(page);

        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    test('tiêu đề dài và nhãn đồng bộ không đẩy nút menu ra khỏi màn hình', async ({ app }) => {
        const { page } = await app(phone);

        await page.evaluate(() => switchTab('sources')); // "Nguồn Tiền & Tài Khoản"

        const toggle = await page.locator('#menu-toggle').boundingBox();
        const badge = await page.locator('#sync-status').boundingBox();

        expect(toggle.x).toBeGreaterThanOrEqual(0);
        expect(badge.x + badge.width).toBeLessThanOrEqual(390);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);
    });

    test('nội dung cuối trang không bị thanh dưới và nút thêm che mất', async ({ app }) => {
        const { page } = await app({
            ...phone,
            seed: {
                fm_transactions: JSON.stringify(
                    Array.from({ length: 12 }, (_, index) =>
                        tx({ id: `TX_${index}`, note: `Giao dịch ${index}` }),
                    ),
                ),
            },
        });

        await page.evaluate(() => switchTab('transactions'));
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

        const last = await page.locator('#transaction-table-body tr').last().boundingBox();
        const nav = await page.locator('.mobile-nav').boundingBox();

        expect(last.y + last.height).toBeLessThanOrEqual(nav.y);
    });
});

test.describe('Đầu trang trên điện thoại có chiều cao cố định', () => {
    test('đổi qua lại giữa 7 trang: đầu trang luôn cao như nhau, nội dung luôn bắt đầu cùng một chỗ', async ({
        app,
    }) => {
        const { page } = await app(phone);
        const measured = [];

        for (const [tab] of [...PAGES, ...PAGES.slice().reverse()]) {
            await page.evaluate((name) => switchTab(name), tab);
            await settle(page);

            measured.push({
                tab,
                header: (await page.locator('header').boundingBox()).height,
                top: (await page.locator(`#tab-${tab}`).boundingBox()).y,
            });
        }

        expect(new Set(measured.map((item) => item.header)).size).toBe(1);
        expect(new Set(measured.map((item) => item.top)).size).toBe(1);
        expect(measured[0].header).toBe(56);
    });

    test('nhãn đồng bộ dài hay ngắn cũng không làm đổi chiều cao đầu trang', async ({ app }) => {
        const { page } = await app(phone);
        const heights = new Set();
        const states = await page.evaluate(() => Object.keys(SYNC_BADGES));

        for (const state of states) {
            await page.evaluate((name) => setSyncBadge(name, ''), state);
            heights.add((await page.locator('header').boundingBox()).height);

            const badge = await page.locator('#sync-status').boundingBox();

            expect(badge.x + badge.width).toBeLessThanOrEqual(390);
            expect(badge.height).toBeLessThanOrEqual(56);
        }

        expect(states.length).toBeGreaterThanOrEqual(6);
        expect([...heights]).toEqual([56]);
    });

    test('mọi tiêu đề trang vừa trong đầu trang (tối đa 2 dòng), không tràn ra ngoài', async ({
        app,
    }) => {
        const { page } = await app(phone);

        for (const [tab] of PAGES) {
            await page.evaluate((name) => switchTab(name), tab);

            const sizes = await page.evaluate(() => {
                const title = document.getElementById('page-title');
                const header = document.querySelector('header').getBoundingClientRect();
                const box = title.getBoundingClientRect();
                const line = parseFloat(getComputedStyle(title).lineHeight);

                return {
                    lines: Math.round(box.height / line),
                    inside: box.top >= header.top && box.bottom <= header.bottom,
                    clipped: title.scrollHeight > title.clientHeight + 1,
                };
            });

            expect(sizes.lines, tab).toBeLessThanOrEqual(2);
            expect(sizes.inside, tab).toBe(true);
            expect(sizes.clipped, tab).toBe(false);
        }
    });

    test('dòng phụ tĩnh ẩn trên điện thoại, vẫn hiện trên máy tính', async ({ app }) => {
        const mobile = await app(phone);
        const wide = await app(desktop);

        await expect(mobile.page.locator('#current-date-label')).toBeHidden();
        await expect(wide.page.locator('#current-date-label')).toBeVisible();
    });

    test('đổi trang chỉ mờ dần, không trượt lên xuống', async ({ app }) => {
        const { page } = await app(phone);

        await page.evaluate(() => switchTab('sources'));

        const properties = await page.evaluate(() =>
            document
                .getAnimations()
                .filter((animation) => animation.animationName === 'fadeIn')
                .flatMap((animation) => animation.effect.getKeyframes())
                .flatMap((frame) => Object.keys(frame)),
        );

        expect(properties).toContain('opacity');
        expect(properties).not.toContain('transform');
    });
});
