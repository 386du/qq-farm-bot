export {};
/**
 * 游戏化模块 - 每日日报
 *
 * 数据存储：
 *   data/gamification/reports-{dateKey}.json       每日汇总报告
 *   data/gamification/notif-log.json               推送日志(避免重复推送)
 */

const fs = require('node:fs');
const path = require('node:path');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { writeJsonFileAtomic, readJsonFile } = require('./json-db');
const { createModuleLogger } = require('./logger');
const { getTodayKey, loadPersistedStats } = require('./stats');
const store = require('../models/store');

const gamifLogger = createModuleLogger('gamification');

// ============== 工具函数 ==============

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

function getDateKey(date: Date = new Date()): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getYesterdayKey(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return getDateKey(d);
}

function nowMs(): number {
    return Date.now();
}

// ============== 路径 ==============

const GAMIF_DIR = path.join(path.dirname(getDataFile('store.json')), 'gamification');
const NOTIF_LOG_FILE = path.join(GAMIF_DIR, 'notif-log.json');

function getReportFile(dateKey: string): string {
    return path.join(GAMIF_DIR, `report-${dateKey}.json`);
}

function ensureGamifDir(): void {
    ensureDataDir();
    if (!fs.existsSync(GAMIF_DIR)) {
        fs.mkdirSync(GAMIF_DIR, { recursive: true });
    }
}

// ============== 账号汇总（日报用） ==============

interface AccountSummary {
    accountId: string;
    accountName: string;
    platform: string;
    operations: Record<string, number>;
    harvestCount: number;
    stealCount: number;
    fertilizeCount: number;
    plantCount: number;
    helpFarmingCount: number;
    guardDogDropCount: number;
    taskClaimCount: number;
    sellCount: number;
    gold: number;
    exp: number;
    levelUp: number;
    online: boolean;          // 账号是否在运行
    lastSavedAt: number;      // 该账号最近一次落盘时间
    score: number;            // 综合得分
}

function num(v: any, fallback: number = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function summarizeAccount(
    accountId: string,
    accountName: string,
    platform: string,
    dateKey: string,
    online: boolean = false,
): AccountSummary {
    const stats = loadPersistedStats(accountId) || {};
    // 若磁盘里的数据不是今天的，则视为 0（避免昨日数据混入今日）
    const isToday = stats && stats.date === dateKey;
    const ops = isToday && stats.operations ? stats.operations : {};

    const harvest = num(ops.harvest);
    const steal = num(ops.steal);
    const fertilize = num(ops.fertilize);
    const plant = num(ops.plant);
    const helpFarming = num(ops.helpFarming);
    const guardDogDrop = num(ops.guardDogDrop);
    const taskClaim = num(ops.taskClaim);
    const sell = num(ops.sell);
    const gold = num(ops.gold);
    const exp = num(ops.exp);
    const levelUp = num(ops.levelUp);
    const lastSavedAt = num(stats.savedAt);

    // 综合得分（基于实际产生的「收益型」操作）
    // 收菜权重最高（实际收益）+ 偷菜 + 帮忙 + 同气连枝礼包 + 金币换算
    const score =
        harvest * 10
        + steal * 5
        + helpFarming * 2
        + fertilize * 1
        + plant * 1
        + guardDogDrop * 20   // 护主犬礼包权重较高
        + Math.floor(gold / 100);

    return {
        accountId: String(accountId),
        accountName: accountName || `账号${accountId}`,
        platform: platform || 'qq',
        operations: ops,
        harvestCount: harvest,
        stealCount: steal,
        fertilizeCount: fertilize,
        plantCount: plant,
        helpFarmingCount: helpFarming,
        guardDogDropCount: guardDogDrop,
        taskClaimCount: taskClaim,
        sellCount: sell,
        gold,
        exp,
        levelUp,
        online,
        lastSavedAt,
        score,
    };
}

// ============== 每日日报 ==============

interface DailyReportAccount {
    accountId: string;
    accountName: string;
    platform: string;
    harvest: number;
    steal: number;
    fertilize: number;
    plant: number;
    sell: number;
    helpFarming: number;
    taskClaim: number;
    guardDogDrop: number;
    levelUp: number;
    gold: number;
    exp: number;
    score: number;
    online: boolean;
}

interface DailyReport {
    date: string;
    generatedAt: number;
    totalAccounts: number;
    activeAccounts: number;
    accounts: DailyReportAccount[];
    totals: {
        harvest: number;
        steal: number;
        fertilize: number;
        plant: number;
        sell: number;
        helpFarming: number;
        taskClaim: number;
        guardDogDrop: number;
        gold: number;
        exp: number;
    };
    mvpAccount: DailyReportAccount | null;
    stealKingAccount: DailyReportAccount | null;
    harvestKingAccount: DailyReportAccount | null;
}

function buildReportData(dateKey: string, runningMap: Record<string, boolean> = {}): DailyReport {
    const accounts = store.getAccounts() || { accounts: [] };
    const accountReports: DailyReportAccount[] = (accounts.accounts || []).map((a: any) => {
        const s = summarizeAccount(a.id, a.name, a.platform, dateKey, !!runningMap[String(a.id)]);
        return {
            accountId: s.accountId,
            accountName: s.accountName,
            platform: s.platform,
            harvest: s.harvestCount,
            steal: s.stealCount,
            fertilize: s.fertilizeCount,
            plant: s.plantCount,
            sell: s.sellCount,
            helpFarming: s.helpFarmingCount,
            taskClaim: s.taskClaimCount,
            guardDogDrop: s.guardDogDropCount,
            levelUp: s.levelUp,
            gold: s.gold,
            exp: s.exp,
            score: s.score,
            online: s.online,
        };
    });

    const totals = accountReports.reduce(
        (acc, a) => ({
            harvest: acc.harvest + a.harvest,
            steal: acc.steal + a.steal,
            fertilize: acc.fertilize + a.fertilize,
            plant: acc.plant + a.plant,
            sell: acc.sell + a.sell,
            helpFarming: acc.helpFarming + a.helpFarming,
            taskClaim: acc.taskClaim + a.taskClaim,
            guardDogDrop: acc.guardDogDrop + a.guardDogDrop,
            gold: acc.gold + a.gold,
            exp: acc.exp + a.exp,
        }),
        {
            harvest: 0, steal: 0, fertilize: 0, plant: 0, sell: 0,
            helpFarming: 0, taskClaim: 0, guardDogDrop: 0,
            gold: 0, exp: 0,
        },
    );

    const activeAccounts = accountReports.filter(a => a.score > 0).length;
    const sortedByScore = [...accountReports].sort((a, b) => b.score - a.score);
    const sortedBySteal = [...accountReports].sort((a, b) => b.steal - a.steal);
    const sortedByHarvest = [...accountReports].sort((a, b) => b.harvest - a.harvest);

    return {
        date: dateKey,
        generatedAt: nowMs(),
        totalAccounts: accountReports.length,
        activeAccounts,
        accounts: accountReports,
        totals,
        mvpAccount: sortedByScore[0] && sortedByScore[0].score > 0 ? sortedByScore[0] : null,
        stealKingAccount: sortedBySteal[0] && sortedBySteal[0].steal > 0 ? sortedBySteal[0] : null,
        harvestKingAccount: sortedByHarvest[0] && sortedByHarvest[0].harvest > 0 ? sortedByHarvest[0] : null,
    };
}

/**
 * 仅计算当日/昨日日报，不写盘。
 * 用于 GET /api/report/daily 这种"读取展示"接口，避免读路径产生副作用。
 */
function computeReport(dateKey: string, runningMap: Record<string, boolean> = {}): DailyReport {
    return buildReportData(dateKey, runningMap);
}

/**
 * 计算并落盘日报。用于：
 *   - 每日 0:05 的定时任务
 *   - 管理员手动 POST /api/admin/report/regenerate
 */
function generateReport(dateKey: string, runningMap: Record<string, boolean> = {}): DailyReport {
    ensureGamifDir();
    const report = buildReportData(dateKey, runningMap);
    try {
        writeJsonFileAtomic(getReportFile(dateKey), report);
    } catch (e: any) {
        gamifLogger.warn('保存日报失败', { error: e.message });
    }
    return report;
}

/**
 * 渲染日报为推送文本
 */
function renderReportText(report: DailyReport): string {
    const lines: string[] = [];
    lines.push(`🌾 农场日报 (${report.date})`);
    lines.push('');
    lines.push(`📊 汇总:`);
    lines.push(`  活跃账号: ${report.activeAccounts}/${report.totalAccounts}`);
    lines.push(`  收菜: ${report.totals.harvest} 次`);
    lines.push(`  偷菜: ${report.totals.steal} 次`);
    lines.push(`  化肥: ${report.totals.fertilize} 次`);
    lines.push(`  种植: ${report.totals.plant} 次`);
    lines.push(`  出售: ${report.totals.sell} 次`);
    lines.push(`  金币: +${report.totals.gold}`);
    lines.push(`  经验: +${report.totals.exp}`);
    lines.push('');
    if (report.mvpAccount) {
        lines.push(`🏆 综合冠军: ${report.mvpAccount.accountName} (${report.mvpAccount.score} 分)`);
    }
    if (report.harvestKingAccount) {
        lines.push(`🌾 收菜之王: ${report.harvestKingAccount.accountName} (${report.harvestKingAccount.harvest} 次)`);
    }
    if (report.stealKingAccount) {
        lines.push(`🥷 偷菜之王: ${report.stealKingAccount.accountName} (${report.stealKingAccount.steal} 次)`);
    }
    return lines.join('\n');
}

// ============== 推送日志(防重复) ==============

interface NotifLog {
    [key: string]: number; // key -> timestamp
}

function loadNotifLog(): NotifLog {
    try {
        return readJsonFile(NOTIF_LOG_FILE, () => ({})) || {};
    } catch {
        return {};
    }
}

function saveNotifLog(log: NotifLog): void {
    ensureGamifDir();
    try {
        writeJsonFileAtomic(NOTIF_LOG_FILE, log);
    } catch (e: any) {
        gamifLogger.warn('保存推送日志失败', { error: e.message });
    }
}

function hasNotified(key: string): boolean {
    const log = loadNotifLog();
    return !!log[key];
}

function markNotified(key: string): void {
    const log = loadNotifLog();
    log[key] = nowMs();
    // 保留最近 60 天的记录
    const cutoff = nowMs() - 60 * 24 * 60 * 60 * 1000;
    for (const k of Object.keys(log)) {
        if (log[k] < cutoff) delete log[k];
    }
    saveNotifLog(log);
}

// ============== 每日推送 (已移除) ==============
// 日报推送功能已移除, 仅在 Dashboard 顶栏展示, 不再自动/手动推送到外部渠道

// ============== 导出 ==============

module.exports = {
    // 日报(compute=不落盘, generate=落盘)
    computeReport,
    generateReport,
    renderReportText,

    // 工具
    getDateKey,
    getYesterdayKey,
    hasNotified,
    markNotified,
    summarizeAccount,
};
