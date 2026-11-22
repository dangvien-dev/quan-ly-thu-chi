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
 * (FM_TOKEN switches the token on, and server.token then holds it for reading the rows back;
 * without properties the server runs open through FM_ALLOW_OPEN).
 */
function newServer(backend = 'legacy', { rows = [], properties, sheets = {} } = {}) {
    const server = createGas({
        codeFile: backend === 'v2' ? CODE_FILE : USER_SCRIPT_FILE,
        // Without properties Code.gs runs in its explicitly open mode (FM_ALLOW_OPEN).
        properties: properties || { FM_ALLOW_OPEN: 'true' },
        sheets: { Transactions: gridFromRows(rows), ...sheets },
    });

    server.backend = backend;
    server.token = (properties && properties.FM_TOKEN) || '';

    return server;
}

/** Whether a sync body writes (any protocol), as opposed to reading the state. */
const isWriteBody = (body) =>
    Boolean(body) &&
    (Array.isArray(body.transactions) || // the legacy script's write
        body.replace === true ||
        (Array.isArray(body.upserts) && body.upserts.length > 0) ||
        (Array.isArray(body.deletes) && body.deletes.length > 0));

/** Rows currently in the server's Transactions sheet, as objects. */
function serverRows(server) {
    return server.backend === 'v2'
        ? server.get({ v: '2', token: server.token }).transactions
        : server.get({ v: '2' });
}

/**
 * Open the app in a new context.
 * opts: seed (localStorage), remote (rows the spreadsheet starts with), backend ('legacy' | 'v2'),
 *       server (an existing newServer() to share), servers ({[web app URL]: newServer()} for other
 *       Sheets: a request to one of these URLs is answered by that server, any other by `server`),
 *       properties (Script Properties), now (fixed clock),
 *       getDelay, getFails, postFails, postResponse (raw reply text), blockChart,
 *       serviceWorkers, viewport, hasTouch + isMobile (a phone: `pointer: coarse`), promptValue (answers the amount dialog of askMoney() as window.prompt
 *       used to be answered: the text typed into it, null to cancel, left out to accept what is
 *       shown; the question is recorded in state.confirms).
 */
async function openApp(browser, opts = {}) {
    const context = await browser.newContext({
        baseURL: BASE_URL,
        timezoneId: 'Asia/Ho_Chi_Minh',
        locale: 'vi-VN',
        viewport: opts.viewport || { width: 1280, height: 800 },
        hasTouch: Boolean(opts.hasTouch),
        isMobile: Boolean(opts.isMobile),
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
        loseReplies: 0,
        dropRequests: 0,
        // deferReads / deferred / releaseDeferred: a read that has NOT reached the server yet (it is
        // processed, from the spreadsheet as it is then, only when the test releases it).
        deferReads: 0,
        deferred: [],
        releaseDeferred: (index = 0) => state.deferred[index] && state.deferred[index](),
        holdReads: 0,
        heldReads: [],
        // Lets the index-th held read (in the order they were held) be answered.
        releaseRead: (index = 0) => state.heldReads[index] && state.heldReads[index](),
        holdReplies: 0,
        heldReplies: [],
        // Lets the index-th held reply (in the order they were held) arrive.
        releaseReply: (index = 0) => state.heldReplies[index] && state.heldReplies[index](),
        holdWrites: 0,
        held: [],
        // Lets the index-th held write (in the order they were held) reach its server.
        releaseHeld: (index = 0) => state.held[index] && state.held[index](),
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

    // Which spreadsheet answers a request: the one behind its Web App URL (opts.servers) or `gas`.
    const serverAt = (url) => (opts.servers && opts.servers[url.split('?')[0]]) || gas;

    await context.route('https://script.google.com/**', async (route) => {
        const request = route.request();
        const target = serverAt(request.url());

        // Apps Script does not answer a CORS preflight: emulate that.
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 405, body: '' });

        if (request.method() === 'GET') {
            state.gets++;
            state.getUrls.push(request.url());

            // state.dropRequests also covers the GET fallback of a write (it carries the body in
            // `payload`): without a token, a POST that cannot be made is sent that way.
            const carried = new URL(request.url()).searchParams.get('payload');

            if (state.dropRequests > 0 && carried) {
                let body = null;

                try {
                    body = JSON.parse(carried);
                } catch {
                    // not a sync body
                }

                if (isWriteBody(body)) {
                    state.dropRequests--;
                    return route.abort();
                }
            }

            if (opts.getDelay) await wait(opts.getDelay);

            // opts.getFails: reading the default server fails (the others, opts.servers, still work).
            if (opts.getFails && target === gas) return route.abort();

            // state.deferReads: the next N reads are still on their way (a slow network, a wait for
            // the script lock): the server only works on them, and so takes its snapshot, when the
            // test calls state.releaseDeferred(index). Unlike holdReads, the snapshot is NOT taken yet.
            if (state.deferReads > 0) {
                state.deferReads--;
                await new Promise((resolve) => state.deferred.push(resolve));
            }

            const body = target.getText(Object.fromEntries(new URL(request.url()).searchParams));

            // state.holdReads: the next N reads are answered from the spreadsheet as it is NOW, but
            // the answer arrives only when the test calls state.releaseRead(index): a slow read
            // whose snapshot is old by then. (The tokenless GET carries the state of an open server.)
            if (state.holdReads > 0) {
                state.holdReads--;
                await new Promise((resolve) => state.heldReads.push(resolve));
            }

            return route.fulfill({
                status: 200,
                headers: CORS,
                contentType: 'application/json',
                body,
            });
        }

        const raw = request.postData();

        state.posts.push({
            url: request.url(),
            contentType: request.headers()['content-type'] || '',
            raw,
            body: JSON.parse(raw),
        });

        if (opts.postFails) return route.abort();

        // state.loseReplies: the server applies the next N write POSTs (a replace, upserts or
        // deletes; not the empty read) but their replies never arrive.
        const body = state.posts.at(-1).body || {};
        const writes = isWriteBody(body);

        // state.dropRequests: the next N write requests never reach the server (a dropped connection;
        // a POST and then its GET fallback are two requests).
        if (state.dropRequests > 0 && writes) {
            state.dropRequests--;
            return route.abort();
        }

        // state.holdWrites: the next N write POSTs are still on their way (a slow network): they reach
        // the server, and are answered, only when the test calls state.releaseHeld(index).
        if (state.holdWrites > 0 && writes) {
            state.holdWrites--;
            await new Promise((resolve) => state.held.push(resolve));

            return route.fulfill({
                status: 200,
                headers: CORS,
                contentType: 'application/json',
                body: target.postText(raw),
            });
        }

        // state.holdReplies: the next N writes are applied at once, but their replies arrive only
        // when the test calls state.releaseReply(index): a slow reply whose snapshot is old by then.
        if (state.holdReplies > 0 && writes) {
            state.holdReplies--;

            const reply = target.postText(raw);

            await new Promise((resolve) => state.heldReplies.push(resolve));

            return route.fulfill({
                status: 200,
                headers: CORS,
                contentType: 'application/json',
                body: reply,
            });
        }

        if (state.loseReplies > 0 && writes) {
            state.loseReplies--;
            target.postText(raw);
            return route.abort();
        }

        return route.fulfill({
            status: 200,
            headers: CORS,
            contentType: 'application/json',
            body: opts.postResponse || target.postText(raw),
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
