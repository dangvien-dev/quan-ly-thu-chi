// Shared helpers for the e2e tests: app launcher, Apps Script mock, and small utilities.
//
// Every test runs in a fresh browser context with no real network: the Google Apps Script URL is
// answered by a real Apps Script running against an in-memory spreadsheet - by default the owner's
// deployed script (tests/gas/fixtures/user-script.gs, "legacy"), or apps-script/Code.gs ("v2") -
// and any other external request is blocked and recorded in state.external (the app must not need
// one). Several apps can share one server to act as several devices.

const { test: base, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { createGas, gridFromRows, USER_SCRIPT_FILE, CODE_FILE } = require('../gas/sandbox');

const BASE_URL = `http://127.0.0.1:${process.env.PORT || 4173}`;
const SCRIPT_URL = 'https://script.google.com/macros/s/TEST/exec';
const CORS = { 'access-control-allow-origin': '*' };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Digits (and a minus sign) of the first number in a text, e.g. "-1.234 đ" -> "-1234". */
const digits = (text) => (String(text).match(/-?[\d.,]+/) || [''])[0].replace(/[.,\s]/g, '');

const tx = (overrides = {}) => ({
    id: 'TX_1',
    date: '2026-10-27',
    type: 'expense',
    source: 'Tiền Mặt',
    category: 'Ăn uống',
    amount: 1000,
    note: '',
    ...overrides,
});

/** Seed for an app that has already synced with SCRIPT_URL (a clean device). */
const syncedSeed = (rows, extra = {}) => ({
    fm_script_url: SCRIPT_URL,
    fm_transactions: JSON.stringify(rows),
    fm_sync_baseline: SCRIPT_URL,
    ...extra,
});

/**
 * An Apps Script server on an in-memory spreadsheet. backend: 'legacy' (the owner's script) or
 * 'v2' (apps-script/Code.gs). rows seed the Transactions sheet; properties are Script Properties
 * (FM_TOKEN switches the token on, and server.token then holds it for reading the rows back).
 */
function newServer(backend = 'legacy', { rows = [], properties = {}, sheets = {} } = {}) {
    const server = createGas({
        codeFile: backend === 'v2' ? CODE_FILE : USER_SCRIPT_FILE,
        properties,
        sheets: { Transactions: gridFromRows(rows), ...sheets },
    });

    server.backend = backend;
    server.token = properties.FM_TOKEN || '';

    return server;
}

/** Rows currently in the server's Transactions sheet, as objects. */
function serverRows(server) {
    return server.backend === 'v2'
        ? server.get({ v: '2', token: server.token }).transactions
        : server.get({ v: '2' });
}

/**
 * Open the app in a new context.
 * opts: seed (localStorage), remote (rows the spreadsheet starts with), backend ('legacy' | 'v2'),
 *       server (an existing newServer() to share), properties (Script Properties), now (fixed clock),
 *       getDelay, getFails, postFails, postResponse (raw reply text), blockChart,
 *       serviceWorkers, viewport, promptValue (answers the amount dialog of askMoney() as window.prompt
 *       used to be answered: the text typed into it, null to cancel, left out to accept what is
 *       shown; the question is recorded in state.confirms).
 */
async function openApp(browser, opts = {}) {
    const context = await browser.newContext({
        baseURL: BASE_URL,
        timezoneId: 'Asia/Ho_Chi_Minh',
        locale: 'vi-VN',
        viewport: opts.viewport || { width: 1280, height: 800 },
        serviceWorkers: opts.serviceWorkers || 'block',
    });
    const state = {
        posts: [],
        gets: 0,
        getUrls: [],
        alerts: [],
        confirms: [],
        errors: [],
        external: [],
    };

    // Registered first = lowest priority: block everything that is not local or the mock Sheet.
    await context.route('**/*', (route) => {
        const { hostname } = new URL(route.request().url());

        if (hostname === '127.0.0.1' || hostname === 'localhost') return route.continue();

        state.external.push(route.request().url());

        return route.abort();
    });

    if (opts.blockChart) {
        await context.route('**/vendor/chart.umd.js', (route) => route.abort());
    }

    const gas =
        opts.server ||
        newServer(opts.backend || 'legacy', {
            rows: opts.remote || [],
            properties: opts.properties,
        });

    // The rows currently in the spreadsheet, as the script returns them.
    Object.defineProperty(state, 'remote', { get: () => serverRows(gas) });
    state.gas = gas;

    await context.route('https://script.google.com/**', async (route) => {
        const request = route.request();

        // Apps Script does not answer a CORS preflight: emulate that.
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 405, body: '' });

        if (request.method() === 'GET') {
            state.gets++;
            state.getUrls.push(request.url());

            if (opts.getDelay) await wait(opts.getDelay);

            if (opts.getFails) return route.abort();

            return route.fulfill({
                status: 200,
                headers: CORS,
                contentType: 'application/json',
                body: gas.getText(Object.fromEntries(new URL(request.url()).searchParams)),
            });
        }

        const raw = request.postData();

        state.posts.push({
            contentType: request.headers()['content-type'] || '',
            raw,
            body: JSON.parse(raw),
        });

        if (opts.postFails) return route.abort();

        return route.fulfill({
            status: 200,
            headers: CORS,
            contentType: 'application/json',
            body: opts.postResponse || gas.postText(raw),
        });
    });

    await context.addInitScript(
        (seed) => {
            if (sessionStorage.__seeded) return;

            sessionStorage.__seeded = '1';
            Object.entries(seed).forEach(([key, value]) => localStorage.setItem(key, value));
        },
        {
            ...(opts.remote || opts.getFails || opts.server || opts.backend
                ? { fm_script_url: SCRIPT_URL }
                : {}),
            ...opts.seed,
        },
    );

    if (opts.promptValue !== undefined || opts.acceptAmounts) {
        await context.exposeFunction('__recordAmountQuestion', (question) =>
            state.confirms.push(question),
        );
        await context.addInitScript((answer) => {
            // A test may change the answer in the middle: window.__amountAnswer = '600000'.
            window.__amountAnswer = answer;
            window.addEventListener('DOMContentLoaded', () => {
                const modal = document.getElementById('moneyPromptModal');
                let answered = false;

                new MutationObserver(() => {
                    const open = modal.classList.contains('open');

                    if (!open) {
                        answered = false;
                        return;
                    }

                    if (answered) return;

                    answered = true;
                    window.__recordAmountQuestion(
                        document.getElementById('moneyPromptMessage').textContent,
                    );

                    if (window.__amountAnswer === null) {
                        modal.querySelector('.close-btn').click();
                        return;
                    }

                    if (window.__amountAnswer !== undefined) {
                        const input = document.getElementById('moneyPromptInput');

                        input.value = String(window.__amountAnswer);
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }

                    document.getElementById('moneyPromptForm').requestSubmit();
                }).observe(modal, { attributes: true, attributeFilter: ['class'] });
            });
        }, opts.promptValue);
    }

    const page = await context.newPage();

    if (opts.now) await page.clock.setFixedTime(new Date(opts.now));

    page.on('dialog', async (dialog) => {
        (dialog.type() === 'alert' ? state.alerts : state.confirms).push(dialog.message());
        await dialog.accept(dialog.type() === 'prompt' ? opts.promptValue : undefined);
    });
    page.on('pageerror', (error) => state.errors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
            state.errors.push(message.text());
        }
    });

    await page.goto('/index.html');
    await page.waitForLoadState('load');
    await wait(opts.settle ?? 150);

    return { context, page, state };
}

const test = base.extend({
    /** app(opts) opens the app; every context it opened is closed after the test. */
    app: async ({ browser }, use) => {
        const opened = [];

        await use(async (opts) => {
            const app = await openApp(browser, opts);

            opened.push(app);

            return app;
        });

        for (const app of opened) await app.context.close();
    },
});

/**
 * Wait until every finite CSS animation / transition has finished. axe reads colours as they are
 * at that moment, so a scan during the 0.3s tab fade-in or the dialog transition can report a
 * false "color-contrast" (it showed up on the slower CI runner).
 */
const settle = (page) =>
    page.evaluate(() =>
        Promise.race([
            Promise.all(
                document
                    .getAnimations()
                    .filter(
                        (animation) => animation.effect.getComputedTiming().iterations !== Infinity,
                    )
                    .map((animation) => animation.finished.catch(() => {})),
            ),
            new Promise((resolve) => setTimeout(resolve, 3000)),
        ]),
    );

/** WCAG 2 A/AA scan of the page (or of one part of it) once animations have finished. */
async function scanA11y(page, include) {
    await settle(page);

    const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);

    if (include) builder.include(include);

    return builder.analyze();
}

const goTab = (page, tab) => page.click(`aside .menu li[data-tab="${tab}"]`);
const goTransactions = (page) => goTab(page, 'transactions');

/** Add an expense through the form. */
async function addExpense(page, amount, note = '') {
    await page.click('header .btn');
    await page.fill('#txAmount', String(amount));

    if (note) await page.fill('#txNote', note);

    await page.click('#transactionForm button[type=submit]');
    await wait(120);
}

const rowsText = (page) =>
    page.$$eval('#transaction-table-body tr', (rows) =>
        rows.map((row) => row.innerText.replace(/\s+/g, ' ').trim()),
    );

module.exports = {
    newServer,
    serverRows,
    test,
    expect,
    openApp,
    SCRIPT_URL,
    CORS,
    wait,
    digits,
    tx,
    syncedSeed,
    settle,
    scanA11y,
    goTab,
    goTransactions,
    addExpense,
    rowsText,
};
