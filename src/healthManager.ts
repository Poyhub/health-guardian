import * as vscode from 'vscode';
import { DataStorage } from './dataStorage';

interface HistoryQuickPickItem extends vscode.QuickPickItem {
    type?: 'header' | 'history' | 'navigation' | 'separator';
    date?: string;
    html?: string;
}

// 添加统计数据的接口
interface StatsData {
    completionRate: number;
    avgWater: number;
    avgStand: number;
}

export class HealthManager {
    private timer: NodeJS.Timeout | undefined;
    private dataStorage: DataStorage;
    private statusBarTimer: vscode.StatusBarItem;
    private statusBarControl: vscode.StatusBarItem;
    private statusBarWater: vscode.StatusBarItem;
    private statusBarStand: vscode.StatusBarItem;
    private statusBarReminder: vscode.StatusBarItem;
    private nextReminderTime: Date;
    private configListener: vscode.Disposable;
    private isReminding: boolean = false;
    private isPaused: boolean = false;
    private pauseNotification: vscode.StatusBarItem | undefined;

    constructor(context: vscode.ExtensionContext, dataStorage: DataStorage) {
        this.dataStorage = dataStorage;
        
        // 初始化 nextReminderTime
        const config = vscode.workspace.getConfiguration('healthGuardian');
        const interval = config.get<number>('reminderInterval', 30) * 60 * 1000;
        this.nextReminderTime = new Date(Date.now() + interval);
        
        // 创建状态栏项
        this.statusBarTimer = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarControl = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.statusBarWater = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
        this.statusBarStand = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 97);
        this.statusBarReminder = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 96);

        // 配置状态栏项
        this.statusBarTimer.command = 'health-guardian.showHistory';
        this.statusBarControl.command = 'health-guardian.toggleTimer';
        this.statusBarWater.command = 'health-guardian.drinkWater';
        this.statusBarStand.command = 'health-guardian.stand';
        
        // 设置提示信息
        this.statusBarTimer.tooltip = "点击查看详细信息";
        this.statusBarControl.tooltip = "暂停/开始计时";
        this.statusBarWater.tooltip = "点击记录喝水";
        this.statusBarStand.tooltip = "点击记录站立";
        
        // 设置控制按钮初始状态
        this.statusBarControl.text = "$(debug-pause)";
        this.updateControlButton();

        // 注册到context
        context.subscriptions.push(
            this.statusBarTimer,
            this.statusBarControl,
            this.statusBarWater,
            this.statusBarStand,
            this.statusBarReminder
        );

        // 监听配置变化
        this.configListener = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('healthGuardian')) {
                this.onConfigurationChanged();
            }
        });
        context.subscriptions.push(this.configListener);

        // 显示所有状态栏项
        this.statusBarTimer.show();
        this.statusBarControl.show();
        this.statusBarWater.show();
        this.statusBarStand.show();

        this.updateStatusBar();
    }

    private updateControlButton() {
        this.statusBarControl.text = this.isPaused ? "$(debug-start)" : "$(debug-pause)";
    }

    public toggleTimer() {
        this.isPaused = !this.isPaused;
        this.updateControlButton();
        
        // 清除之前的通知（如果存在）
        if (this.pauseNotification) {
            this.pauseNotification.dispose();
            this.pauseNotification = undefined;
        }
        
        if (this.isPaused) {
            this.pauseNotification = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
            this.pauseNotification.text = "$(circle-slash) 计时已暂停";
            this.pauseNotification.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.pauseNotification.show();
            
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = undefined;
            }
        } else {
            const notification = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
            notification.text = "$(play) 计时已开始";
            notification.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            notification.show();
            
            const remaining = this.nextReminderTime.getTime() - Date.now();
            this.nextReminderTime = new Date(Date.now() + remaining);
            this.resetTimer(remaining);
            
            setTimeout(() => notification.dispose(), 2000);
        }
    }

    public async showPanel() {
        const panel = await vscode.window.createWebviewPanel(
            'healthPanel',
            '健康助手',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        const config = vscode.workspace.getConfiguration('healthGuardian');
        const data = this.dataStorage.getHealthData();
        
        panel.webview.html = this.getPanelHtml(config, data);

        panel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'saveSettings':
                    await this.saveSettings(message.settings);
                    vscode.window.showInformationMessage('设置已保存');
                    break;
            }
        });
    }

    private async saveSettings(settings: any) {
        const config = vscode.workspace.getConfiguration('healthGuardian');
        await config.update('reminderInterval', settings.reminderInterval, true);
        await config.update('dailyWaterGoal', settings.dailyWaterGoal, true);
        await config.update('dailyStandGoal', settings.dailyStandGoal, true);
        await config.update('waterPerDrink', settings.waterPerDrink, true);
        this.onConfigurationChanged();
    }

    private showReminder() {
        if (this.isReminding) {
            return;
        }

        this.isReminding = true;
        this.statusBarReminder.text = "$(alert) 该休息啦～";
        this.statusBarReminder.show();

        vscode.window.showInformationMessage(
            '该休息一下了！喝点水，站起来活动活动~',
            '遵守',
            '下次再说'
        ).then(selection => {
            this.statusBarReminder.hide();
            this.isReminding = false;

            if (selection === '遵守') {
                this.drinkWater();
                this.stand();
            }
            
            this.resetTimer(this.getInterval());
        });
    }

    private onConfigurationChanged() {
        const config = vscode.workspace.getConfiguration('healthGuardian');
        const interval = config.get<number>('reminderInterval', 30) * 60 * 1000;

        // 重置定时器
        this.resetTimer(interval);
        
        // 更新显示
        this.updateStatusBar();
    }

    private resetTimer(interval: number) {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }

        this.nextReminderTime = new Date(Date.now() + interval);
        
        this.timer = setInterval(() => {
            if (!this.isReminding) {
                this.showReminder();
            }
        }, interval);
    }

    public start() {
        const config = vscode.workspace.getConfiguration('healthGuardian');
        const interval = config.get<number>('reminderInterval', 30) * 60 * 1000;
        this.resetTimer(interval);
        setInterval(() => this.updateTimerDisplay(), 1000);
    }

    private updateTimerDisplay() {
        if (this.isPaused) {
            this.statusBarTimer.text = `$(clock) 已暂停`;
            return;
        }

        const remaining = this.nextReminderTime.getTime() - Date.now();
        if (remaining <= 0) {
            if (!this.isReminding) {
                this.showReminder();
            }
            return;
        }

        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        this.statusBarTimer.text = `$(clock) ${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    private updateStatusBar() {
        const todayData = this.dataStorage.getTodayData();
        const config = vscode.workspace.getConfiguration('healthGuardian');
        const waterGoal = config.get<number>('dailyWaterGoal', 2000);
        const standGoal = config.get<number>('dailyStandGoal', 12);

        // 使用 beaker 图标
        const waterLevel = Math.min(todayData.waterAmount / waterGoal * 100, 100);
        const waterIcon = waterLevel >= 100 ? '$(beaker)' :      // 满杯
                         waterLevel >= 50 ? '$(beaker)' :        // 半杯
                         '$(beaker)';                            // 空杯
        
        this.statusBarWater.text = `${waterIcon} ${todayData.waterAmount}/${waterGoal}ml`;
        this.statusBarStand.text = `$(person) ${todayData.standCount}/${standGoal}次`;
    }

    private showNotification(title: string, message: string) {
        const notification = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
        notification.text = `$(info) ${title}`;
        notification.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        notification.show();
        
        vscode.window.showInformationMessage(message, { modal: false }, '关闭')
            .then(() => {
                notification.dispose();
            });

        // 2秒后自动关闭
        setTimeout(() => {
            notification.dispose();
        }, 2000);
    }

    public drinkWater() {
        const config = vscode.workspace.getConfiguration('healthGuardian');
        const waterPerDrink = config.get<number>('waterPerDrink', 200);
        this.dataStorage.addWater(waterPerDrink);
        this.updateStatusBar();
        
        const todayData = this.dataStorage.getTodayData();
        const waterGoal = config.get<number>('dailyWaterGoal', 2000);
        const progressValue = Math.round((todayData.waterAmount / waterGoal) * 100);
        
        this.showNotification(
            '已记录饮水',
            `已记录饮水 ${waterPerDrink}ml (完成度: ${progressValue}%)`
        );
    }

    public stand() {
        this.dataStorage.addStand();
        this.updateStatusBar();
        
        const todayData = this.dataStorage.getTodayData();
        const config = vscode.workspace.getConfiguration('healthGuardian');
        const standGoal = config.get<number>('dailyStandGoal', 12);
        const progressValue = Math.round((todayData.standCount / standGoal) * 100);
        
        this.showNotification(
            '已记录站立',
            `已记录站立一次 (完成度: ${progressValue}%)`
        );
    }

    private getInterval(): number {
        const config = vscode.workspace.getConfiguration('healthGuardian');
        return config.get<number>('reminderInterval', 30) * 60 * 1000;
    }

    private getPanelHtml(config: vscode.WorkspaceConfiguration, data: any[]) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        padding: 20px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                    }
                    .container {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 20px;
                        max-width: 800px;
                        margin: 0 auto;
                    }
                    .settings, .history {
                        padding: 20px;
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 6px;
                    }
                    .form-group {
                        margin-bottom: 15px;
                    }
                    label {
                        display: block;
                        margin-bottom: 5px;
                    }
                    input {
                        width: 100%;
                        padding: 5px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                    }
                    button {
                        padding: 8px 16px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    }
                    .history-list {
                        max-height: 300px;
                        overflow-y: auto;
                    }
                    .history-item {
                        padding: 8px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="settings">
                        <h2>设置</h2>
                        <div class="form-group">
                            <label>提醒间隔（分钟）</label>
                            <input type="number" id="reminderInterval" value="${config.get('reminderInterval')}">
                        </div>
                        <div class="form-group">
                            <label>每日饮水目标（毫升）</label>
                            <input type="number" id="dailyWaterGoal" value="${config.get('dailyWaterGoal')}">
                        </div>
                        <div class="form-group">
                            <label>每日站立目标次数</label>
                            <input type="number" id="dailyStandGoal" value="${config.get('dailyStandGoal')}">
                        </div>
                        <div class="form-group">
                            <label>每次饮水量（毫升）</label>
                            <input type="number" id="waterPerDrink" value="${config.get('waterPerDrink')}">
                        </div>
                        <button onclick="saveSettings()">保存设置</button>
                    </div>
                    <div class="history">
                        <h2>历史记录</h2>
                        <div class="history-list">
                            ${data.map(item => `
                                <div class="history-item">
                                    <div>日期：${item.date}</div>
                                    <div>饮水量：${item.waterAmount}ml</div>
                                    <div>站立次数：${item.standCount}次</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    
                    function saveSettings() {
                        const settings = {
                            reminderInterval: parseInt(document.getElementById('reminderInterval').value),
                            dailyWaterGoal: parseInt(document.getElementById('dailyWaterGoal').value),
                            dailyStandGoal: parseInt(document.getElementById('dailyStandGoal').value),
                            waterPerDrink: parseInt(document.getElementById('waterPerDrink').value)
                        };
                        
                        vscode.postMessage({
                            command: 'saveSettings',
                            settings: settings
                        });
                    }
                </script>
            </body>
            </html>
        `;
    }

    public dispose() {
        if (this.timer) {
            clearInterval(this.timer);
        }
        this.statusBarTimer.dispose();
        this.statusBarControl.dispose();
        this.statusBarWater.dispose();
        this.statusBarStand.dispose();
        this.statusBarReminder.dispose();
        this.configListener.dispose();
    }

    public async showHistory() {
        const quickPick = vscode.window.createQuickPick<HistoryQuickPickItem>();
        quickPick.title = "健康记录";
        quickPick.buttons = [
            {
                iconPath: new vscode.ThemeIcon('gear'),
                tooltip: '设置'
            }
        ];

        const data = this.dataStorage.getHealthData();
        const recentData = this.getRecentData(data, 5);
        const stats = this.calculateStats(recentData);

        let currentPage = 0;
        const pageSize = 5;
        const totalPages = Math.ceil(data.length / pageSize);

        const updateItems = () => {
            const start = currentPage * pageSize;
            const pageData = data.slice(start, start + pageSize);

            const items: HistoryQuickPickItem[] = [
                {
                    label: '近期统计',
                    detail: `达标率: ${stats.completionRate}% | 平均饮水: ${stats.avgWater}ml | 平均站立: ${stats.avgStand}次`,
                    type: 'header'
                },
                {
                    label: '─────────────────',
                    kind: vscode.QuickPickItemKind.Separator,
                    type: 'separator'
                },
                ...pageData.map(item => ({
                    label: `$(calendar) ${item.date}`,
                    description: `饮水: ${item.waterAmount}ml | 站立: ${item.standCount}次`,
                    detail: this.getProgressDetail(item),
                    type: 'history' as const,
                    date: item.date
                }))
            ];

            if (totalPages > 1) {
                items.push(
                    {
                        label: '─────────────────',
                        kind: vscode.QuickPickItemKind.Separator,
                        type: 'separator'
                    },
                    {
                        label: `第 ${currentPage + 1}/${totalPages} 页`,
                        description: '使用 ← → 翻页',
                        type: 'navigation'
                    }
                );
            }

            quickPick.items = items;
        };

        updateItems();

        // 处理按钮点击
        quickPick.onDidTriggerButton(button => {
            if (button.tooltip === '设置') {
                this.showSettings();
                quickPick.dispose();
            }
        });

        // 处理项目选择
        quickPick.onDidAccept(async () => {
            const selected = quickPick.selectedItems[0];
            if (selected) {
                switch (selected.type) {
                    case 'header':
                        // 处理头部点击
                        break;
                    case 'history':
                        if (selected.date) {
                            const dayData = data.find(d => d.date === selected.date);
                            if (dayData) {
                                await this.showDayDetail(dayData);
                            }
                        }
                        break;
                }
            }
        });

        // 处理键盘导航
        quickPick.onDidChangeValue(value => {
            if (value === 'ArrowLeft' && currentPage > 0) {
                currentPage--;
                updateItems();
                quickPick.value = '';
            } else if (value === 'ArrowRight' && currentPage < totalPages - 1) {
                currentPage++;
                updateItems();
                quickPick.value = '';
            }
        });

        quickPick.show();
    }

    private getProgressDetail(item: any) {
        const config = vscode.workspace.getConfiguration('healthGuardian');
        const waterGoal = config.get<number>('dailyWaterGoal', 2000);
        const standGoal = config.get<number>('dailyStandGoal', 12);
        
        const waterProgress = Math.round((item.waterAmount / waterGoal) * 100);
        const standProgress = Math.round((item.standCount / standGoal) * 100);
        
        return `饮水完成度: ${waterProgress}% | 站立完成度: ${standProgress}%`;
    }

    public async showSettings() {
        const panel = vscode.window.createWebviewPanel(
            'healthSettings',
            '健康助手设置',
            vscode.ViewColumn.Active,
            {
                enableScripts: true
            }
        );
        
        panel.webview.html = this.getSettingsHtml(
            vscode.workspace.getConfiguration('healthGuardian')
        );
        
        panel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'saveSettings') {
                await this.saveSettings(message.settings);
                vscode.window.showInformationMessage('设置已保存', { modal: false });
                panel.dispose();
            }
        });
    }

    private getSettingsHtml(config: vscode.WorkspaceConfiguration) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        padding: 20px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                    }
                    .container {
                        max-width: 600px;
                        margin: 0 auto;
                    }
                    .form-group {
                        margin-bottom: 15px;
                    }
                    label {
                        display: block;
                        margin-bottom: 5px;
                    }
                    input {
                        width: 100%;
                        padding: 5px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                    }
                    button {
                        padding: 8px 16px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2>健康助手设置</h2>
                    <div class="form-group">
                        <label>提醒间隔（分钟）</label>
                        <input type="number" id="reminderInterval" value="${config.get('reminderInterval')}">
                    </div>
                    <div class="form-group">
                        <label>每日饮水目标（毫升）</label>
                        <input type="number" id="dailyWaterGoal" value="${config.get('dailyWaterGoal')}">
                    </div>
                    <div class="form-group">
                        <label>每日站立目标次数</label>
                        <input type="number" id="dailyStandGoal" value="${config.get('dailyStandGoal')}">
                    </div>
                    <div class="form-group">
                        <label>每次饮水量（毫升）</label>
                        <input type="number" id="waterPerDrink" value="${config.get('waterPerDrink')}">
                    </div>
                    <button onclick="saveSettings()">保存设置</button>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    
                    function saveSettings() {
                        const settings = {
                            reminderInterval: parseInt(document.getElementById('reminderInterval').value),
                            dailyWaterGoal: parseInt(document.getElementById('dailyWaterGoal').value),
                            dailyStandGoal: parseInt(document.getElementById('dailyStandGoal').value),
                            waterPerDrink: parseInt(document.getElementById('waterPerDrink').value)
                        };
                        
                        vscode.postMessage({
                            command: 'saveSettings',
                            settings: settings
                        });
                    }
                </script>
            </body>
            </html>
        `;
    }

    private async showTrendChart(data: any[]) {
        const panel = vscode.window.createWebviewPanel(
            'healthTrend',
            '健康数据趋势',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: []
            }
        );

        const chartHtml = this.getTrendChartHtml(data);
        panel.webview.html = chartHtml;
    }

    private getTrendChartHtml(data: any[]) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
                <style>
                    canvas {
                        max-width: 100%;
                        margin: 20px auto;
                    }
                </style>
            </head>
            <body>
                <canvas id="trendChart"></canvas>
                <script>
                    const ctx = document.getElementById('trendChart').getContext('2d');
                    new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: ${JSON.stringify(data.map(d => d.date))},
                            datasets: [
                                {
                                    label: '饮水量(ml)',
                                    data: ${JSON.stringify(data.map(d => d.waterAmount))},
                                    borderColor: 'rgb(75, 192, 192)',
                                    tension: 0.1
                                },
                                {
                                    label: '站立次数',
                                    data: ${JSON.stringify(data.map(d => d.standCount))},
                                    borderColor: 'rgb(255, 99, 132)',
                                    tension: 0.1
                                }
                            ]
                        },
                        options: {
                            responsive: true,
                            plugins: {
                                title: {
                                    display: true,
                                    text: '健康数据趋势'
                                }
                            },
                            scales: {
                                y: {
                                    beginAtZero: true
                                }
                            }
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }

    private async showDayDetail(dayData: any) {
        const config = vscode.workspace.getConfiguration('healthGuardian');
        const waterGoal = config.get<number>('dailyWaterGoal', 2000);
        const standGoal = config.get<number>('dailyStandGoal', 12);
        
        const waterProgress = Math.round((dayData.waterAmount / waterGoal) * 100);
        const standProgress = Math.round((dayData.standCount / standGoal) * 100);
        
        const message = 
            `日期: ${dayData.date}\n` +
            `饮水量: ${dayData.waterAmount}ml (${waterProgress}%)\n` +
            `站立次数: ${dayData.standCount}次 (${standProgress}%)\n` +
            `总体完成度: ${Math.round((waterProgress + standProgress) / 2)}%`;
        
        await vscode.window.showInformationMessage(message, { modal: true });
    }

    // 添加缺失的辅助方法
    private getRecentData(data: any[], days: number) {
        return data.slice(-days);
    }

    private calculateStats(data: any[]): StatsData {
        if (data.length === 0) {
            return {
                completionRate: 0,
                avgWater: 0,
                avgStand: 0
            };
        }

        const config = vscode.workspace.getConfiguration('healthGuardian');
        const waterGoal = config.get<number>('dailyWaterGoal', 2000);
        const standGoal = config.get<number>('dailyStandGoal', 12);

        const totalDays = data.length;
        const totalWater = data.reduce((sum, item) => sum + item.waterAmount, 0);
        const totalStand = data.reduce((sum, item) => sum + item.standCount, 0);
        const achievedDays = data.filter(item => 
            item.waterAmount >= waterGoal && item.standCount >= standGoal
        ).length;

        return {
            completionRate: Math.round((achievedDays / totalDays) * 100),
            avgWater: Math.round(totalWater / totalDays),
            avgStand: Math.round(totalStand / totalDays)
        };
    }
} 