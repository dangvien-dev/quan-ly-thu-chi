// Shared helpers for the e2e tests: app launcher, Apps Script mock, and small utilities.
//
// Every test runs in a fresh browser context with no real network: the Google Apps Script URL is
// answered by the owner's real deployed script (tests/gas/fixtures/user-script.gs) running against
// an in-memory spreadsheet, and any other external request is blocked and recorded in
// state.external (the app must not need one).

const { test: base, expect } = require('@playwright/test');
const { createGas, gridFromRows, USER_SCRIPT_FILE } = require('../gas/sandbox');

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
 * Open the app in a new context.
 * opts: seed (localStorage), remote (rows the spreadsheet starts with), now (fixed clock),
 *       getDelay, getFails, postFails, postResponse (raw reply text), blockChart,
 *       serviceWorkers, viewport, promptValue.
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

    const gas = createGas({
        codeFile: USER_SCRIPT_FILE,
        sheets: { Transactions: gridFromRows(opts.remote || []) },
    });

    // The rows currently in the spreadsheet, as the script returns them.
    Object.defineProperty(state, 'remote', { get: () => gas.get({ v: '2' }) });
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
        { ...(opts.remote || opts.getFails ? { fm_script_url: SCRIPT_URL } : {}), ...opts.seed },
    );

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
    test,
    expect,
    openApp,
    SCRIPT_URL,
    CORS,
    wait,
    digits,
    tx,
    syncedSeed,
    goTab,
    goTransactions,
    addExpense,
    rowsText,
};
