// Keyboard use, accessible names, automatic accessibility scan, and the phone layout.

const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect, tx, goTab, wait } = require('./helpers');

const TABS = [
    'overview',
    'transactions',
    'sources',
    'categories',
    'recurring',
    'debts',
    'settings',
];
const NOW = '2026-10-28T03:00:00Z';

/** Enough data that every table and list on every tab has content. */
const fullSeed = {
    now: NOW,
    seed: {
        fm_transactions: JSON.stringify([
            tx({ id: 'TX_1', date: '2026-10-27', note: 'Cafe sáng', amount: 20000 }),
            tx({
                id: 'TX_2',
                date: '2026-10-20',
                type: 'income',
                category: 'Lương / Thưởng',
                amount: 15000000,
            }),
            tx({
                id: 'TX_3',
                date: '2026-10-21',
                type: 'transfer',
                source: 'Thẻ Ngân Hàng',
                targetSource: 'Tiền Mặt',
                category: 'Chuyển tiền nội bộ',
                amount: 500000,
            }),
        ]),
        fm_budgets: JSON.stringify({ 'Ăn uống': 100000 }),
        fm_recurring: JSON.stringify([
            {
                id: 'RC_1',
                name: 'Tiền nhà',
                type: 'expense',
                source: 'Tiền Mặt',
                category: 'Hóa đơn & Tiện ích',
                amount: 3000000,
                frequency: 'monthly',
                day: 5,
                startDate: '2026-10-05',
                lastGenerated: '2026-10-05',
            },
        ]),
        fm_debts: JSON.stringify([
            {
                id: 'DB_1',
                party: 'Anh Nam',
                direction: 'owe',
                amount: 1000000,
                date: '2026-10-01',
                dueDate: '2026-10-20',
                payments: [],
            },
        ]),
    },
};

const violationsOf = (results) =>
    results.violations.map(
        (violation) =>
            `${violation.id} (${violation.impact}): ${violation.nodes
                .slice(0, 3)
                .map((node) => node.target.join(' '))
                .join(' | ')}`,
    );

test.describe('Quét trợ năng tự động (axe, WCAG 2 A/AA)', () => {
    for (const tab of TABS) {
        test(`tab ${tab} không có vi phạm`, async ({ app }) => {
            const { page } = await app(fullSeed);

            await goTab(page, tab);
            await wait(200);

            const results = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .analyze();

            expect(violationsOf(results)).toEqual([]);
        });
    }

    for (const modal of [
        ['giao dịch', () => window.openModal()],
        ['danh mục', () => window.openCategoryModal()],
        ['nguồn tiền', () => window.openSourceModal()],
        ['định kỳ', () => window.openRecurringModal()],
        ['vay nợ', () => window.openDebtModal()],
    ]) {
        test(`hộp thoại ${modal[0]} không có vi phạm`, async ({ app }) => {
            const { page } = await app(fullSeed);

            await page.evaluate(modal[1]);
            await wait(200);

            const results = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .analyze();

            expect(violationsOf(results)).toEqual([]);
        });
    }
});

test.describe('Bàn phím', () => {
    test('liên kết "Bỏ qua điều hướng" là mục đầu tiên và chuyển tiêu điểm vào nội dung chính', async ({
        app,
    }) => {
        const { page } = await app();

        await page.keyboard.press('Tab');
        await expect(page.locator('.skip-link')).toBeFocused();
        await page.keyboard.press('Enter');

        await expect(page.locator('main')).toBeFocused();
    });

    test('dùng Tab và Enter để chuyển tab, tab hiện tại có aria-current', async ({ app }) => {
        const { page } = await app();

        await page.locator('.menu-link', { hasText: 'Sổ Giao Dịch' }).focus();
        await page.keyboard.press('Enter');

        await expect(page.locator('#tab-transactions')).toHaveClass(/active/);
        await expect(page.locator('.menu-link', { hasText: 'Sổ Giao Dịch' })).toHaveAttribute(
            'aria-current',
            'page',
        );
        await expect(page.locator('.menu-link', { hasText: 'Tổng Quan' })).not.toHaveAttribute(
            'aria-current',
        );
    });

    test('hộp thoại giữ tiêu điểm bên trong khi bấm Tab / Shift+Tab, Esc đóng và trả tiêu điểm', async ({
        app,
    }) => {
        const { page } = await app();
        const insideDialog = () =>
            page.evaluate(() =>
                document.querySelector('#transactionModal').contains(document.activeElement),
            );

        await page.locator('header .btn').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#transactionModal')).toHaveClass(/open/);
        await expect(page.locator('#txAmount')).toBeFocused();

        for (let step = 0; step < 25; step++) {
            await page.keyboard.press('Tab');
            expect(await insideDialog()).toBe(true);
        }

        for (let step = 0; step < 25; step++) {
            await page.keyboard.press('Shift+Tab');
            expect(await insideDialog()).toBe(true);
        }

        await page.keyboard.press('Escape');
        await expect(page.locator('#transactionModal')).not.toHaveClass(/open/);
        await expect(page.locator('header .btn')).toBeFocused();
    });

    test('chip nhập nhanh là nút bấm được bằng bàn phím', async ({ app }) => {
        const { page } = await app();

        await page.click('header .btn');
        await page.locator('.chip', { hasText: 'Cafe sáng' }).focus();
        await page.keyboard.press('Enter');

        await expect(page.locator('#txAmount')).toHaveValue('20000');
        await expect(page.locator('#txNote')).toHaveValue('Cafe sáng');
    });

    test('mọi nút và ô nhập đều có tên truy cập được', async ({ app }) => {
        const { page } = await app(fullSeed);
        const missing = [];

        for (const tab of TABS) {
            await goTab(page, tab);
            missing.push(
                ...(await page.evaluate((tabName) => {
                    const section = document.getElementById(`tab-${tabName}`);

                    return Array.from(section.querySelectorAll('button, input, select, textarea'))
                        .filter(
                            (element) =>
                                element.getClientRects().length > 0 && element.type !== 'hidden',
                        )
                        .filter((element) => {
                            const name =
                                (element.labels && element.labels.length) ||
                                element.getAttribute('aria-label') ||
                                element.innerText.trim() ||
                                element.title;

                            return !name;
                        })
                        .map((element) => `${tabName}: ${element.outerHTML.slice(0, 80)}`);
                }, tab)),
            );
        }

        expect(missing).toEqual([]);
    });
});

test.describe('Giao diện điện thoại (390 × 844)', () => {
    const phone = { ...fullSeed, viewport: { width: 390, height: 844 } };

    for (const tab of TABS) {
        test(`tab ${tab} không bị tràn ngang`, async ({ app }) => {
            const { page } = await app(phone);

            await page.evaluate((name) => switchTab(name), tab);
            await wait(150);

            const overflow = await page.evaluate(() => ({
                page: document.documentElement.scrollWidth - window.innerWidth,
                wide: Array.from(document.querySelectorAll('.view-section.active *'))
                    .filter(
                        (element) => element.getBoundingClientRect().right > window.innerWidth + 1,
                    )
                    .map((element) => `${element.tagName}.${element.className}`)
                    .slice(0, 5),
            }));

            expect(overflow).toEqual({ page: 0, wide: [] });
        });
    }

    test('bảng hiển thị dạng thẻ có nhãn từng trường', async ({ app }) => {
        const { page } = await app(phone);

        await page.evaluate(() => switchTab('transactions'));

        const card = await page.evaluate(() => {
            const row = document.querySelector('#transaction-table-body tr');
            const cell = row.querySelector('td[data-label="Số tiền"]');

            return {
                headerHidden: getComputedStyle(document.querySelector('#tab-transactions thead'))
                    .display,
                rowDisplay: getComputedStyle(row).display,
                label: getComputedStyle(cell, '::before').content,
            };
        });

        expect(card).toEqual({ headerHidden: 'none', rowDisplay: 'block', label: '"Số tiền"' });
    });

    test('thanh điều hướng dưới cuộn được và với tới tab Vay nợ và Định kỳ', async ({ app }) => {
        const { page } = await app(phone);

        await page.locator('.mobile-nav-item[data-tab="debts"]').click();

        await expect(page.locator('#tab-debts')).toHaveClass(/active/);
        await expect(page.locator('.mobile-nav-item[data-tab="debts"]')).toHaveAttribute(
            'aria-current',
            'page',
        );
        await page.locator('.mobile-nav-item[data-tab="recurring"]').click();
        await expect(page.locator('#tab-recurring')).toHaveClass(/active/);
    });

    test('hộp thoại nằm gọn trong màn hình điện thoại và nút lưu bấm được', async ({ app }) => {
        const { page } = await app(phone);

        await page.locator('.floating-add-btn').click();
        await page.fill('#txAmount', '12000');

        const box = await page.locator('#transactionModal .modal-content').boundingBox();

        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        await page.locator('#transactionForm button[type=submit]').click();

        expect(await page.evaluate(() => transactions.length)).toBe(4);
    });
});
