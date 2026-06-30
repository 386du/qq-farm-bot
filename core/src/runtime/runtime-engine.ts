export {};
const { fork } = require('node:child_process');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const store = require('../models/store');
const { updateRuntimeConfig, getRuntimeConfig, getDefaultSystemConfig } = require('../config/config');
const { sendPushooMessage } = require('../services/push');
const { MiniProgramLoginSession } = require('../services/qrlogin');
const { createDataProvider } = require('./data-provider');
const { createReloginReminderService } = require('./relogin-reminder');
const { createRuntimeState } = require('./runtime-state');
const { createWorkerManager } = require('./worker-manager');
const { createYybReloginService } = require('./yyb-relogin');

const OPERATION_KEYS = ['harvest', 'farming', 'fertilize', 'plant', 'steal', 'helpFarming', 'taskClaim', 'sell', 'upgrade', 'gold', 'exp'];

interface RuntimeEngineOptions {
    processRef?: any;
    mainEntryPath?: string;
    workerScriptPath?: string;
    runtimeMode?: string;
    onStatusSync?: (accountId: string, status: any, accountName?: string) => void;
    onLog?: (entry: any, accountId?: string, accountName?: string) => void;
    onAccountLog?: (entry: any) => void;
    startAdminServer?: (dataProvider: any) => void;
}

function createRuntimeEngine(options: RuntimeEngineOptions = {}) {
    const processRef = options.processRef || process;
    // Detect if running from source (tsx) or compiled (node)
    const isRunningFromSource = __dirname.includes(`${path.sep}src${path.sep}`);
    const fileExt = isRunningFromSource ? '.ts' : '.js';
    const mainEntryPath = options.mainEntryPath || path.join(__dirname, `../../client${fileExt}`);
    const workerScriptPath = options.workerScriptPath || path.join(__dirname, `../core/worker${fileExt}`);
    const runtimeMode = String(options.runtimeMode || processRef.env.FARM_RUNTIME_MODE || 'thread').toLowerCase();
    const onStatusSync = typeof options.onStatusSync === 'function' ? options.onStatusSync : null;
    const onLog = typeof options.onLog === 'function' ? options.onLog : null;
    const onAccountLog = typeof options.onAccountLog === 'function' ? options.onAccountLog : null;
    const startAdminServer = typeof options.startAdminServer === 'function' ? options.startAdminServer : null;

    const workerControls: { startWorker: ((account: any) => boolean) | null; restartWorker: ((account: any) => void) | null } = { startWorker: null, restartWorker: null };
    const runtimeState = createRuntimeState({
        store,
        operationKeys: OPERATION_KEYS,
    });
    const {
        workers,
        globalLogs: GLOBAL_LOGS,
        accountLogs: ACCOUNT_LOGS,
        runtimeEvents,
        nextConfigRevision,
        buildConfigSnapshotForAccount,
        log,
        addAccountLog,
        normalizeStatusForPanel,
        buildDefaultStatus,
        filterLogs,
    } = runtimeState;

    const reloginReminder = createReloginReminderService({
        store,
        miniProgramLoginSession: MiniProgramLoginSession,
        sendPushooMessage,
        log,
        addAccountLog,
        getAccounts: store.getAccounts,
        addOrUpdateAccount: store.addOrUpdateAccount,
        resolveWorkerControls: () => workerControls,
    });

    const {
        getOfflineAutoDeleteMs,
        triggerOfflineReminder,
    } = reloginReminder;

    let yybReloginService: any = null;

    const { startWorker, stopWorker, restartWorker, callWorkerApi } = createWorkerManager({
        fork,
        WorkerThread: Worker,
        runtimeMode,
        processRef,
        mainEntryPath,
        workerScriptPath,
        workers,
        globalLogs: GLOBAL_LOGS,
        log,
        addAccountLog,
        normalizeStatusForPanel,
        buildConfigSnapshotForAccount,
        getOfflineAutoDeleteMs,
        triggerOfflineReminder,
        addOrUpdateAccount: store.addOrUpdateAccount,
        deleteAccount: store.deleteAccount,
        onStatusSync: (accountId: string, status: any, accountName?: string) => {
            runtimeEvents.emit('status', { accountId, status, accountName });
            if (onStatusSync) onStatusSync(accountId, status, accountName);
        },
        onWorkerLog: (entry: any, accountId: string, accountName?: string) => {
            runtimeEvents.emit('worker_log', { entry, accountId, accountName });
            if (onLog) onLog(entry, accountId, accountName);
        },
        onAccountNeedsRelogin: (accountId: string, reason: string) => {
            if (yybReloginService) {
                yybReloginService.handleAccountRelogin(accountId, reason).catch((e: any) => {
                    log('错误', `应用宝重连处理异常: ${e && e.message ? e.message : String(e)}`, { accountId });
                });
            }
        },
    });
    workerControls.startWorker = startWorker;
    workerControls.restartWorker = restartWorker;

    yybReloginService = createYybReloginService({
        store,
        log,
        addAccountLog,
        getAccounts: store.getAccounts,
        addOrUpdateAccount: store.addOrUpdateAccount,
        isAccountRunning: (accountId: string) => !!workers[accountId],
        restartWorker,
        startWorker,
    });

    const dataProvider = createDataProvider({
        workers,
        globalLogs: GLOBAL_LOGS,
        accountLogs: ACCOUNT_LOGS,
        store,
        getAccounts: store.getAccounts,
        callWorkerApi,
        buildDefaultStatus,
        normalizeStatusForPanel,
        filterLogs,
        addAccountLog,
        nextConfigRevision,
        broadcastConfigToWorkers,
        broadcastGameConfigReload,
        startWorker,
        stopWorker,
        restartWorker,
    });

    runtimeEvents.on('log', (entry: any) => {
        if (onLog) onLog(entry, entry && entry.accountId ? entry.accountId : '', entry && entry.accountName ? entry.accountName : '');
    });
    runtimeEvents.on('account_log', (entry: any) => {
        if (onAccountLog) onAccountLog(entry);
    });

    function broadcastConfigToWorkers(targetAccountId = ''): void {
        const targetId = String(targetAccountId || '').trim();
        for (const [accId, worker] of Object.entries(workers)) {
            if (targetId && String(accId) !== targetId) continue;
            const snapshot = buildConfigSnapshotForAccount(accId);
            try {
                (worker as any).process.send({ type: 'config_sync', config: snapshot });
            } catch {
                // ignore IPC failures for exited workers
            }
        }
    }

    function broadcastGameConfigReload(): void {
        for (const worker of Object.values(workers)) {
            try {
                (worker as any).process.send({ type: 'reload_config' });
            } catch {
                // ignore IPC failures for exited workers
            }
        }
    }

    function startAllAccounts(): void {
        const accounts = (store.getAccounts().accounts || []);
        if (accounts.length > 0) {
            log('系统', `发现 ${accounts.length} 个账号，正在启动...`);
            accounts.forEach((acc: any) => startWorker(acc));
        } else {
            log('系统', '未发现账号，请访问管理面板添加账号');
        }
    }

    /**
     * 游戏化定时任务: 每日 9 点推送日报 + 每分钟生成日报
     * 简单的 setInterval 方案,避免引入额外依赖
     */
    function startGamificationScheduler(): void {
        const gamif = require('../services/gamification');
        let lastPushedDate = '';
        let lastReportDate = '';

        async function tick() {
            try {
                const now = new Date();
                const hh = now.getHours();
                const mm = now.getMinutes();
                const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                const yesterdayKey = gamif.getYesterdayKey();

                // 0:05 之后生成昨日日报(每天一次, 落盘)
                if ((hh > 0 || mm >= 5) && lastReportDate !== yesterdayKey) {
                    try {
                        gamif.generateReport(yesterdayKey);
                        lastReportDate = yesterdayKey;
                    } catch (e: any) {
                        log('错误', `生成昨日日报失败: ${e && e.message ? e.message : String(e)}`, { module: 'gamification' });
                    }
                }

                // 9:00 - 9:05 推送昨日日报(防重复: 一天只推一次)
                if (hh === 9 && mm < 5 && lastPushedDate !== yesterdayKey) {
                    const result = await gamif.pushDailyReport({
                        sendPushooMessage,
                        log,
                    });
                    if (result && result.ok && !result.skipped) {
                        lastPushedDate = yesterdayKey;
                        log('系统', `每日日报已推送 (${yesterdayKey})`, { module: 'gamification' });
                    } else if (result && result.skipped) {
                        lastPushedDate = yesterdayKey;
                    } else if (result && result.error) {
                        log('错误', `日报推送失败: ${result.error}`, { module: 'gamification' });
                    }
                }
            } catch (e: any) {
                log('错误', `游戏化定时任务异常: ${e && e.message ? e.message : String(e)}`, { module: 'gamification' });
            }
        }

        // 启动时立即跑一次,然后每分钟检查
        tick();
        setInterval(tick, 60 * 1000);
    }

    async function start(options: { startAdminServer?: boolean; autoStartAccounts?: boolean } = {}): Promise<void> {
        const shouldStartAdminServer = options.startAdminServer !== false;
        const shouldAutoStartAccounts = options.autoStartAccounts !== false;

        const savedSystemConfig = store.getSystemConfig();
        if (savedSystemConfig) {
            updateRuntimeConfig(savedSystemConfig);
            log('系统', `已加载系统配置: serverUrl=${savedSystemConfig.serverUrl}, clientVersion=${savedSystemConfig.clientVersion}, platform=${savedSystemConfig.platform}`);
        }

        if (shouldStartAdminServer && startAdminServer) {
            startAdminServer(dataProvider);
        }

        if (shouldAutoStartAccounts) {
            startAllAccounts();
        }

        if (yybReloginService) {
            yybReloginService.start();
        }

        // 游戏化定时任务(日报推送 + 成就 rollup)
        startGamificationScheduler();
    }

    function stopAllAccounts(): void {
        for (const accountId of Object.keys(workers)) {
            stopWorker(accountId);
        }
    }

    return {
        store,
        runtimeEvents,
        workers,
        dataProvider,
        start,
        startAllAccounts,
        stopAllAccounts,
        broadcastConfigToWorkers,
        broadcastGameConfigReload,
        startWorker,
        stopWorker,
        restartWorker,
        callWorkerApi,
        log,
        addAccountLog,
    };
}

module.exports = {
    createRuntimeEngine,
};
