(function() {
    const vscode = acquireVsCodeApi();

    // 获取画布上下文
    const canvas = document.getElementById('healthChart');
    const ctx = canvas.getContext('2d');

    // 创建图表
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: '饮水量(ml)',
                    data: [],
                    borderColor: 'rgb(75, 192, 192)',
                    tension: 0.1
                },
                {
                    label: '站立次数',
                    data: [],
                    borderColor: 'rgb(255, 99, 132)',
                    tension: 0.1
                }
            ]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });

    // 更新图表数据
    function updateChart(data) {
        chart.data.labels = data.map(d => d.date);
        chart.data.datasets[0].data = data.map(d => d.waterAmount);
        chart.data.datasets[1].data = data.map(d => d.standCount);
        chart.update();
    }

    // 监听来自扩展的消息
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'update':
                updateChart(message.data);
                break;
        }
    });
})(); 