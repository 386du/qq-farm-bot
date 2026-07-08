export {};
const { fork } = require('node:child_process');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const store = require('../models/store');
const { updateRuntimeConfig } = require('../config/config');
const { sendPushooMessage } = require('../services/push');
const { MiniProgramLoginSession } = require('../services/qrlogin');
const { createDataProvider } = require('./data-provider');
const { createReloginReminderService } = require('./relogin-reminder');
const { createRuntimeState } = require('./runtime-state');
const { createWorkerManager } = require('./worker-manager');
const { createYybReloginService } = require('./yyb-relogin');
const { createGoReloginService } = require('./go-relogin');

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

    const goReloginService = createGoReloginService({
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
        // 全局总开关:管理员可在"系统配置"里临时关闭,关闭后一律不自动恢复
        // 默认 true(向后兼容,旧数据 / 字段缺失都按 true 处理)
        if (typeof store.getAutoResumeEnabled === 'function' && store.getAutoResumeEnabled() === false) {
            const allCount = (store.getAccounts().accounts || []).length;
            log('系统', `全局自动恢复已关闭(系统配置中 autoResumeEnabled=false),共 ${allCount} 个账号均不会自动启动,请在管理后台手动启动`);
            return;
        }
        // 只启动 autoStart===true 的账号（用户在后台点过"启动"的）
        // 容器启动时被调用，避免每个账号都自动启动（包括"加了但不想跑"的）
        const all = (store.getAccounts().accounts || []);
        if (all.length === 0) {
            log('系统', '未发现账号，请访问管理面板添加账号');
            return;
        }
        const autoStartIds = new Set(
            (typeof store.getAutoStartAccountIds === 'function'
                ? store.getAutoStartAccountIds()
                : []).map((x: any) => String(x)),
        );
        const targets = all.filter((acc: any) => autoStartIds.has(String(acc.id)));
        if (targets.length === 0) {
            log('系统', `共 ${all.length} 个账号，无自动启动标记（用户在后台手动点过"启动"才会被自动恢复）`);
            return;
        }
        log('系统', `正在自动启动 ${targets.length}/${all.length} 个已标记自动启动的账号...`);
        targets.forEach((acc: any) => startWorker(acc));
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

        if (goReloginService) {
            goReloginService.start();
        }
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
