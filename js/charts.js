// Chart.js visualizations for expense categories and income/expense totals.

function renderCharts() {
    const categoryTotals = {};

    transactions
        .filter((transaction) => transaction.type === 'expense')
        .forEach((transaction) => {
            categoryTotals[transaction.category] =
                (categoryTotals[transaction.category] || 0) + transaction.amount;
        });

    const expenseCanvas = document.getElementById('expenseCategoryChart');

    if (expenseCanvas) {
        if (expenseChart) {
            expenseChart.destroy();
        }

        expenseChart = new Chart(expenseCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: Object.keys(categoryTotals),
                datasets: [
                    {
                        data: Object.values(categoryTotals),
                        backgroundColor: [
                            '#4f46e5',
                            '#10b981',
                            '#f59e0b',
                            '#ef4444',
                            '#8b5cf6',
                            '#ec4899',
                        ],
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
            },
        });
    }

    const monthlyCanvas = document.getElementById('monthlyChart');

    if (monthlyCanvas) {
        if (monthlyChart) {
            monthlyChart.destroy();
        }

        const totalIncome = transactions
            .filter((transaction) => transaction.type === 'income')
            .reduce((total, transaction) => total + transaction.amount, 0);
        const totalExpense = transactions
            .filter((transaction) => transaction.type === 'expense')
            .reduce((total, transaction) => total + transaction.amount, 0);

        monthlyChart = new Chart(monthlyCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Tổng Thu', 'Tổng Chi'],
                datasets: [
                    {
                        label: 'VNĐ',
                        data: [totalIncome, totalExpense],
                        backgroundColor: ['#10b981', '#ef4444'],
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
            },
        });
    }
}
