import * as vscode from 'vscode';

interface DailyData {
    date: string;
    waterAmount: number;
    standCount: number;
}

export class DataStorage {
    private storage: vscode.Memento;

    constructor(storage: vscode.Memento) {
        this.storage = storage;
    }

    public getTodayData(): DailyData {
        const data = this.storage.get<DailyData[]>('healthData', []);
        const today = new Date().toISOString().split('T')[0];
        
        let todayData = data.find(d => d.date === today);
        if (!todayData) {
            todayData = {
                date: today,
                waterAmount: 0,
                standCount: 0
            };
            data.push(todayData);
            this.storage.update('healthData', data);
        }
        
        return todayData;
    }

    public getHealthData(): DailyData[] {
        return this.storage.get<DailyData[]>('healthData', [])
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    public addWater(amount: number) {
        const data = this.storage.get<DailyData[]>('healthData', []);
        const today = new Date().toISOString().split('T')[0];
        let todayData = data.find(d => d.date === today);
        
        if (!todayData) {
            todayData = {
                date: today,
                waterAmount: amount,
                standCount: 0
            };
            data.push(todayData);
        } else {
            todayData.waterAmount += amount;
        }
        
        this.storage.update('healthData', data);
    }

    public addStand() {
        const data = this.storage.get<DailyData[]>('healthData', []);
        const today = new Date().toISOString().split('T')[0];
        let todayData = data.find(d => d.date === today);
        
        if (!todayData) {
            todayData = {
                date: today,
                waterAmount: 0,
                standCount: 1
            };
            data.push(todayData);
        } else {
            todayData.standCount += 1;
        }
        
        this.storage.update('healthData', data);
    }

    public clearData() {
        this.storage.update('healthData', []);
    }

    public exportData(): string {
        const data = this.storage.get<DailyData[]>('healthData', []);
        return JSON.stringify(data, null, 2);
    }

    public importData(jsonData: string) {
        try {
            const data = JSON.parse(jsonData) as DailyData[];
            this.storage.update('healthData', data);
            return true;
        } catch {
            return false;
        }
    }
} 