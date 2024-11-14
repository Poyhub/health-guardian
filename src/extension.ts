import * as vscode from 'vscode';
import { HealthManager } from './healthManager';
import { DataStorage } from './dataStorage';

let healthManager: HealthManager;

export function activate(context: vscode.ExtensionContext) {
    const dataStorage = new DataStorage(context.globalState);
    healthManager = new HealthManager(context, dataStorage);

    // 注册命令
    context.subscriptions.push(
        vscode.commands.registerCommand('health-guardian.drinkWater', () => {
            healthManager.drinkWater();
        }),
        vscode.commands.registerCommand('health-guardian.stand', () => {
            healthManager.stand();
        }),
        vscode.commands.registerCommand('health-guardian.showHistory', () => {
            healthManager.showHistory();
        }),
        vscode.commands.registerCommand('health-guardian.showSettings', () => {
            healthManager.showSettings();
        }),
        vscode.commands.registerCommand('health-guardian.toggleTimer', () => {
            healthManager.toggleTimer();
        })
    );

    // 启动健康管理器
    healthManager.start();
}

export function deactivate() {
    if (healthManager) {
        healthManager.dispose();
    }
} 