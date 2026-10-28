const { defineConfig } = require('@playwright/test');

const PORT = Number(process.env.PORT) || 4173;

module.exports = defineConfig({
    testDir: 'tests/e2e',
    timeout: 30_000,
    fullyParallel: true,
    workers: process.env.CI ? 2 : undefined,
    reporter: [['list']],
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
        serviceWorkers: 'block',
    },
    webServer: {
        command: 'node tests/serve.js',
        url: `http://127.0.0.1:${PORT}/index.html`,
        reuseExistingServer: !process.env.CI,
        env: { PORT: String(PORT) },
    },
});
