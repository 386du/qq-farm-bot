export {};
/**
 * 游戏化模块 - 跨账号排行、每日日报
 *
 * 数据存储：
 *   data/gamification/leaderboard-{dateKey}.json   每日排行榜
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

function getLeaderboardFile(dateKey: string): string {
    return path.join(GAMIF_DIR, `leaderboard-${dateKey}.json`);
}

function getReportFile(dateKey: string): string {
    return path.join(GAMIF_DIR, `report-${dateKey}.json`);
}

function ensureGamifDir(): void {
    ensureDataDir();
    if (!fs.existsSync(GAMIF_DIR)) {
        fs.mkdirSync(GAMIF_DIR, { recursive: true });
    }
}

// ============== 跨账号排行 ==============

interface AccountSummary {
    accountId: string;
    accountName: string;
    platform: string;
    operations: Record<string, number>;
    gold: number;
    exp: number;
    harvestCount: number;
    stealCount: number;
    fertilizeCount: number;
    plantCount: number;
    score: number;          // 综合得分
}

interface LeaderboardEntry extends AccountSummary {
    rank: number;
}

interface LeaderboardData {
    date: string;
    generatedAt: number;
    accounts: LeaderboardEntry[];
    byGold: LeaderboardEntry[];
    bySteal: LeaderboardEntry[];
    byHarvest: LeaderboardEntry[];
}

function summarizeAccount(accountId: string, accountName: string, platform: string, dateKey: string): AccountSummary {
    const stats = loadPersistedStats(accountId) || {};
    const ops = (stats.date === dateKey && stats.operations) ? stats.operations : {};
    const harvest = Number(ops.harvest) || 0;
    const steal = Number(ops.steal) || 0;
    const fertilize = Number(ops.fertilize) || 0;
    const plant = Number(ops.plant) || 0;
    const gold = Number(ops.gold) || 0;
    const exp = Number(ops.exp) || 0;

    // 综合得分: 收菜 * 10 + 偷菜 * 5 + 化肥 * 1 + 金币 / 100
    const score = harvest * 10 + steal * 5 + fertilize * 1 + Math.floor(gold / 100);

    return {
        accountId: String(accountId),
        accountName: accountName || `账号${accountId}`,
        platform: platform || 'qq',
        operations: ops,
        gold,
        exp,
        harvestCount: harvest,
        stealCount: steal,
        fertilizeCount: fertilize,
        plantCount: plant,
        score,
    };
}

function sortBy<T>(arr: T[], key: (t: T) => number): T[] {
    return [...arr].sort((a, b) => key(b) - key(a));
}

function withRank(sorted: AccountSummary[]): LeaderboardEntry[] {
    return sorted.map((s, i) => ({ ...s, rank: i + 1 }));
}

/**
 * 生成某天的排行榜(基于每个账号的 stats 文件)
 */
function generateLeaderboard(dateKey: string): LeaderboardData {
    ensureGamifDir();
    const accounts = store.getAccounts() || { accounts: [] };
    const summaries: AccountSummary[] = (accounts.accounts || []).map((a: any) =>
        summarizeAccount(a.id, a.name, a.platform, dateKey),
    );

    const byGold = withRank(sortBy(summaries, s => s.gold));
    const bySteal = withRank(sortBy(summaries, s => s.stealCount));
    const byHarvest = withRank(sortBy(summaries, s => s.harvestCount));
    const byScore = withRank(sortBy(summaries, s => s.score));

    const data: LeaderboardData = {
        date: dateKey,
        generatedAt: nowMs(),
        accounts: byScore,
        byGold,
        bySteal,
        byHarvest,
    };

    try {
        writeJsonFileAtomic(getLeaderboardFile(dateKey), data);
    } catch (e: any) {
        gamifLogger.warn('保存排行榜失败', { error: e.message });
    }

    return data;
}

function loadLeaderboard(dateKey: string): LeaderboardData | null {
    const file = getLeaderboardFile(dateKey);
    if (!fs.existsSync(file)) {
        // 尝试即时生成
        try {
            return generateLeaderboard(dateKey);
        } catch {
            return null;
        }
    }
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
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
    gold: number;
    exp: number;
    score: number;
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
        gold: number;
        exp: number;
    };
    mvpAccount: DailyReportAccount | null;
    stealKingAccount: DailyReportAccount | null;
    harvestKingAccount: DailyReportAccount | null;
}

function generateReport(dateKey: string): DailyReport {
    ensureGamifDir();
    const accounts = store.getAccounts() || { accounts: [] };
    const accountReports: DailyReportAccount[] = (accounts.accounts || []).map((a: any) => {
        const s = summarizeAccount(a.id, a.name, a.platform, dateKey);
        return {
            accountId: s.accountId,
            accountName: s.accountName,
            platform: s.platform,
            harvest: s.harvestCount,
            steal: s.stealCount,
            fertilize: s.fertilizeCount,
            plant: s.plantCount,
            sell: Number(s.operations.sell) || 0,
            helpFarming: Number(s.operations.helpFarming) || 0,
            taskClaim: Number(s.operations.taskClaim) || 0,
            gold: s.gold,
            exp: s.exp,
            score: s.score,
        };
    });

    const totals = accountReports.reduce(
        (acc, a) => ({
            harvest: acc.harvest + a.harvest,
            steal: acc.steal + a.steal,
            fertilize: acc.fertilize + a.fertilize,
            plant: acc.plant + a.plant,
            sell: acc.sell + a.sell,
            gold: acc.gold + a.gold,
            exp: acc.exp + a.exp,
        }),
        { harvest: 0, steal: 0, fertilize: 0, plant: 0, sell: 0, gold: 0, exp: 0 },
    );

    const activeAccounts = accountReports.filter(a => a.score > 0).length;
    const sortedByScore = [...accountReports].sort((a, b) => b.score - a.score);
    const sortedBySteal = [...accountReports].sort((a, b) => b.steal - a.steal);
    const sortedByHarvest = [...accountReports].sort((a, b) => b.harvest - a.harvest);

    const report: DailyReport = {
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

    try {
        writeJsonFileAtomic(getReportFile(dateKey), report);
    } catch (e: any) {
        gamifLogger.warn('保存日报失败', { error: e.message });
    }

    return report;
}

function loadReport(dateKey: string): DailyReport | null {
    const file = getReportFile(dateKey);
    if (!fs.existsSync(file)) {
        try {
            return generateReport(dateKey);
        } catch {
            return null;
        }
    }
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
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

// ============== 每日推送 ==============

/**
 * 解析推送渠道配置: 优先日报独立配置, 回退到全局下线提醒, 都没配返回 null
 */
function resolveReportPushConfig(): { channel: string; endpoint: string; token: string; title: string } | null {
    try {
        // 1. 优先: 日报独立推送配置
        const dailyCfg = store.getDailyReportPush ? store.getDailyReportPush() : null;
        if (dailyCfg && dailyCfg.enabled && dailyCfg.channel && (dailyCfg.token || dailyCfg.channel === 'webhook')) {
            return {
                channel: String(dailyCfg.channel).trim().toLowerCase(),
                endpoint: String(dailyCfg.endpoint || '').trim(),
                token: String(dailyCfg.token || '').trim(),
                title: String(dailyCfg.title || '🌾 农场日报').trim(),
            };
        }

        // 2. 回退: 全局下线提醒配置(确保日报到得了)
        const reminder = store.getOfflineReminder ? store.getOfflineReminder('') : null;
        if (reminder && reminder.channel) {
            return {
                channel: String(reminder.channel).trim().toLowerCase(),
                endpoint: String(reminder.endpoint || '').trim(),
                token: String(reminder.token || '').trim(),
                title: '🌾 农场日报',
            };
        }
    } catch (e: any) {
        // 解析配置失败, 当成未配置
    }
    return null;
}

async function pushDailyReport(opts: { force?: boolean; sendPushooMessage?: any; log?: (tag: string, msg: string, extra?: any) => void } = {}): Promise<{ ok: boolean; skipped?: boolean; error?: string; reason?: string }> {
    const log = opts.log || (() => {});
    const sendPush = opts.sendPushooMessage;

    const dateKey = getYesterdayKey();
    const notifKey = `daily-report:${dateKey}`;
    if (!opts.force && hasNotified(notifKey)) {
        return { ok: true, skipped: true, reason: '已推送过该日期的日报' };
    }

    try {
        const report = generateReport(dateKey);
        if (report.totalAccounts === 0) {
            return { ok: true, skipped: true, reason: '账号为空, 无需推送' };
        }

        const cfg = resolveReportPushConfig();
        if (!cfg) {
            log('错误', '日报推送失败: 未配置推送渠道 (请在 设置 → 日报推送 中配置)', { module: 'gamification' });
            return { ok: false, error: '未配置推送渠道, 请在 设置 → 日报推送 中配置 channel/endpoint/token' };
        }

        if (sendPush) {
            try {
                const result = await sendPush({
                    channel: cfg.channel,
                    endpoint: cfg.endpoint,
                    token: cfg.token,
                    title: cfg.title,
                    content: renderReportText(report),
                });
                if (result && result.ok) {
                    markNotified(notifKey);
                    log('系统', `已推送日报 (${dateKey}) -> ${cfg.channel}`, { module: 'gamification' });
                    return { ok: true };
                }
                const errMsg = (result && (result.msg || result.code)) || '推送失败';
                log('错误', `日报推送失败: ${errMsg}`, { module: 'gamification', channel: cfg.channel });
                return { ok: false, error: String(errMsg) };
            } catch (pushErr: any) {
                log('错误', `日报推送异常: ${pushErr && pushErr.message ? pushErr.message : String(pushErr)}`, { module: 'gamification' });
                return { ok: false, error: pushErr && pushErr.message ? pushErr.message : String(pushErr) };
            }
        }

        // 没有 sendPush 函数时, 仅记录
        markNotified(notifKey);
        log('系统', `日报已生成 (${dateKey}),未配置推送渠道`, { module: 'gamification' });
        return { ok: true };
    } catch (e: any) {
        const msg = e && e.message ? e.message : String(e);
        log('错误', `日报推送异常: ${msg}`, { module: 'gamification' });
        return { ok: false, error: msg };
    }
}

// ============== 导出 ==============

module.exports = {
    // 排行
    generateLeaderboard,
    loadLeaderboard,
    summarizeAccount,

    // 日报
    generateReport,
    loadReport,
    renderReportText,
    pushDailyReport,

    // 工具
    getDateKey,
    getYesterdayKey,
    hasNotified,
    markNotified,
};
