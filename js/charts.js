// Chart.js visualizations: this month's expense categories and income/expense by month.

const CHART_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const CHART_MONTH_COUNT = 6;

const moneyTooltip = {
    callbacks: {
        label: (context) => {
            const name = context.dataset.label || context.label;
            const value = typeof context.parsed === 'object' ? context.parsed.y : context.parsed;

            return `${name}: ${formatMoney(value)}`;
        },
    },
};

function showChartUnavailable(canvas) {
    if (canvas && canvas.parentElement) {
        canvas.parentElement.innerHTML =
            '<p style="color:var(--text-muted); font-size:14px;">Không tải được thư viện biểu đồ. Hãy kết nối mạng và tải lại trang.</p>';
    }
}

/** Update an existing chart in place, or create it the first time. */
function upsertChart(chart, canvas, config) {
    if (!chart) {
        return new Chart(canvas.getContext('2d'), config);
    }

    chart.data.labels = config.data.labels;
    chart.data.datasets = config.data.datasets;
    chart.update();

    return chart;
}

function renderCharts() {
    const expenseCanvas = document.getElementById('expenseCategoryChart');
    const monthlyCanvas = document.getElementById('monthlyChart');

    // Chart.js comes from a CDN: the rest of the app must keep working when it is unreachable.
    if (typeof Chart === 'undefined') {
        showChartUnavailable(expenseCanvas);
        showChartUnavailable(monthlyCanvas);
        expenseChart = null;
        monthlyChart = null;
        return;
    }

    const thisMonth = currentMonthKey();

    if (expenseCanvas) {
        const categoryTotals = {};

        transactions
            .filter((transaction) => transaction.type === 'expense')
            .filter((transaction) => transaction.date.startsWith(thisMonth))
            .forEach((transaction) => {
                const name = transaction.category || 'Khác';
                categoryTotals[name] = (categoryTotals[name] || 0) + transaction.amount;
            });

        expenseChart = upsertChart(expenseChart, expenseCanvas, {
            type: 'doughnut',
            data: {
                labels: Object.keys(categoryTotals),
                datasets: [
                    {
                        data: Object.values(categoryTotals),
                        backgroundColor: CHART_COLORS,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { tooltip: moneyTooltip },
            },
        });
    }

    if (monthlyCanvas) {
        const monthKeys = Array.from({ length: CHART_MONTH_COUNT }, (_, index) =>
            shiftMonthKey(thisMonth, index - (CHART_MONTH_COUNT - 1)),
        );
        const totals = monthKeys.map((monthKey) => summarizeMonth(monthKey));

        monthlyChart = upsertChart(monthlyChart, monthlyCanvas, {
            type: 'bar',
            data: {
                labels: monthKeys.map((key) => `${key.slice(5)}/${key.slice(0, 4)}`),
                datasets: [
                    {
                        label: 'Thu',
                        data: totals.map((total) => total.income),
                        backgroundColor: '#10b981',
                    },
                    {
                        label: 'Chi',
                        data: totals.map((total) => total.expense),
                        backgroundColor: '#ef4444',
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { tooltip: moneyTooltip },
            },
        });
    }
}
