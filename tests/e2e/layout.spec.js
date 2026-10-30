// Layout guard: neighbouring blocks must not overlap (a negative margin once made a hint run over
// the heading above it in the salary groups dialog).

const { test, expect, tx, settle } = require('./helpers');

const NOW = '2026-10-30T03:00:00Z';
const TABS = [
    'overview',
    'transactions',
    'sources',
    'categories',
    'recurring',
    'debts',
    'settings',
];
const DIALOGS = [
    ['giao dịch', () => window.openModal()],
    ['danh mục', () => window.openCategoryModal()],
    ['nguồn tiền', () => window.openSourceModal()],
    ['định kỳ', () => window.openRecurringModal()],
    ['vay nợ', () => window.openDebtModal()],
    ['mức lương', () => window.openSalaryModal()],
    ['chia lương theo nhóm', () => window.openAllocationModal()],
];
const seed = {
    fm_salary: JSON.stringify({ amount: 10000000, warnPercent: 80 }),
    fm_budgets: JSON.stringify({ 'Ăn uống': 1000000 }),
    fm_transactions: JSON.stringify([tx({ id: 'TX_1', note: 'Cafe sáng', amount: 20000 })]),
};

/** Pairs of consecutive in-flow siblings inside `root` where the second starts above the first's end. */
const findOverlaps = (page, rootSelector) =>
    page.evaluate((selector) => {
        const root = document.querySelector(selector);
        // Block-level boxes in normal flow only: inline elements share lines and <br> is not a box.
        const flows = (element) => {
            const style = getComputedStyle(element);

            return (
                element.tagName !== 'BR' &&
                !style.display.startsWith('inline') &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                (style.position === 'static' || style.position === 'relative') &&
                style.float === 'none' &&
                element.getClientRects().length > 0
            );
        };
        const name = (element) =>
            `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${
                element.className && typeof element.className === 'string'
                    ? `.${element.className.trim().split(/\s+/).join('.')}`
                    : ''
            }`;
        const found = [];

        [root, ...root.querySelectorAll('*')].forEach((parent) => {
            const parentDisplay = getComputedStyle(parent).display;

            // Only plain block flow: flex / grid parents place their children side by side.
            if (parentDisplay !== 'block' && parentDisplay !== 'flow-root') return;

            const children = Array.from(parent.children).filter(flows);

            for (let index = 1; index < children.length; index++) {
                const before = children[index - 1].getBoundingClientRect();
                const after = children[index].getBoundingClientRect();

                if (before.height === 0 || after.height === 0) continue;

                if (after.top < before.bottom - 1) {
                    found.push(`${name(children[index - 1])} / ${name(children[index])}`);
                }
            }
        });

        return found;
    }, rootSelector);

for (const [label, viewport] of [
    ['điện thoại', { width: 390, height: 844 }],
    ['máy tính', { width: 1280, height: 800 }],
]) {
    test.describe(`Không có phần tử nào đè lên nhau (${label})`, () => {
        for (const tab of TABS) {
            test(`trang ${tab}`, async ({ app }) => {
                const { page } = await app({ now: NOW, viewport, seed });

                await page.evaluate((name) => switchTab(name), tab);
                await settle(page);

                expect(await findOverlaps(page, `#tab-${tab}`)).toEqual([]);
            });
        }

        for (const [name, open] of DIALOGS) {
            test(`hộp thoại ${name}`, async ({ app }) => {
                const { page } = await app({ now: NOW, viewport, seed });

                await page.evaluate(open);
                await settle(page);

                expect(await findOverlaps(page, '.modal.open .modal-content')).toEqual([]);
            });
        }
    });
}

test.describe('Gợi ý (.hint) dưới tiêu đề', () => {
    test('trong hộp thoại chia lương, dòng gợi ý nằm dưới tiêu đề chứ không chui lên đè', async ({
        app,
    }) => {
        const { page } = await app({
            now: NOW,
            viewport: { width: 390, height: 844 },
            seed,
        });

        await page.evaluate(() => openAllocationModal());
        await settle(page);

        const title = await page.locator('.allocation-title').boundingBox();
        const hint = await page.locator('.allocation-title + .hint').boundingBox();

        expect(hint.y).toBeGreaterThanOrEqual(title.y + title.height);
    });
});
