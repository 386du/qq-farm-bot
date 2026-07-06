export {};
const { findAccountByRef, normalizeAccountRef, resolveAccountId: resolveAccountIdByList } = require('../services/account-resolver');
const { getSchedulerRegistrySnapshot } = require('../services/scheduler');
const { getScanStatus, setScanStatus, clearScanStatus } = require('./scan-status');

interface DataProviderOptions {
    workers: Record<string, any>;
    globalLogs: any[];
    accountLogs: any[];
    store: any;
    getAccounts: () => any;
    callWorkerApi: (accountId: string, method: string, ...args: any[]) => Promise<any>;
    buildDefaultStatus: (accountId: string) => any;
    normalizeStatusForPanel: (data: any, accountId: string, accountName: string) => any;
    filterLogs: (list: any[], filters?: any) => any[];
    addAccountLog: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => void;
    nextConfigRevision: () => number;
    broadcastConfigToWorkers: (accountId?: string) => void;
    broadcastGameConfigReload?: () => void;
    startWorker: (account: any) => boolean;
    stopWorker: (accountId: string) => void;
    restartWorker: (account: any) => void;
}

function createDataProvider(options: DataProviderOptions) {
    const {
        workers,
        globalLogs,
        accountLogs,
        store,
        getAccounts,
        callWorkerApi,
        buildDefaultStatus,
        normalizeStatusForPanel,
        filterLogs,
        addAccountLog,
        nextConfigRevision,
        broadcastConfigToWorkers,
        broadcastGameConfigReload: broadcastGameConfigReloadOpt,
        startWorker,
        stopWorker,
        restartWorker,
    } = options;

    function getStoredAccountsList(): any[] {
        const data = getAccounts();
        return Array.isArray(data.accounts) ? data.accounts : [];
    }

    function resolveAccountRefId(accountRef: string): string {
        const raw = normalizeAccountRef(accountRef);
        if (!raw) return '';
        const resolved = resolveAccountIdByList(getStoredAccountsList(), raw);
        return resolved || raw;
    }

    function findAccountByAnyRef(accountRef: string): any {
        return findAccountByRef(getStoredAccountsList(), accountRef);
    }

    return {
        resolveAccountId: (accountRef: string) => resolveAccountRefId(accountRef),

        getStatus: (accountRef: string) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) return buildDefaultStatus('');
            const w = workers[accountId];
            if (!w || !w.status) return buildDefaultStatus(accountId);
            return {
                ...buildDefaultStatus(accountId),
                ...normalizeStatusForPanel(w.status, accountId, w.name),
                wsError: w.wsError || null,
            };
        },

        getLogs: (accountRef: string, optionsOrLimit?: any) => {
            const opts = (typeof optionsOrLimit === 'object' && optionsOrLimit) ? optionsOrLimit : { limit: optionsOrLimit };
            const max = Math.max(1, Number(opts.limit) || 100);
            const rawRef = normalizeAccountRef(accountRef);
            const accountId = resolveAccountRefId(accountRef);
            if (!rawRef || rawRef === 'all') {
                return filterLogs(globalLogs, opts).slice(-max);
            }
            if (!accountId) return [];
            const accId = String(accountId || '');
            return filterLogs(globalLogs.filter(l => String(l.accountId || '') === accId), opts).slice(-max);
        },

        getAccountLogs: (limit: number) => accountLogs.slice(-limit).reverse(),
        addAccountLog: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => addAccountLog(action, msg, accountId, accountName, extra),

        clearLogs: (accountRef: string) => {
            const rawRef = normalizeAccountRef(accountRef);
            const accountId = resolveAccountRefId(accountRef);

            if (!rawRef || rawRef === 'all') {
                globalLogs.length = 0;
                return { cleared: 'all' };
            }

            if (!accountId) return { cleared: 0 };

            const accId = String(accountId || '');
            const before = globalLogs.length;
            for (let i = globalLogs.length - 1; i >= 0; i--) {
                if (String(globalLogs[i].accountId || '') === accId) {
                    globalLogs.splice(i, 1);
                }
            }
            const after = globalLogs.length;
            return { cleared: before - after, accountId };
        },

        getLands: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getLands'),
        getFriends: (accountRef: string, forceSync = false) => callWorkerApi(resolveAccountRefId(accountRef), 'getFriends', forceSync),
        clearFriendsCache: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'clearFriendsCache'),
        getInteractRecords: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getInteractRecords'),
        getFriendLands: (accountRef: string, gid: number) => callWorkerApi(resolveAccountRefId(accountRef), 'getFriendLands', gid),
        doFriendOp: (accountRef: string, gid: number, opType: string) => callWorkerApi(resolveAccountRefId(accountRef), 'doFriendOp', gid, opType),
        getFriendApplications: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getFriendApplications'),
        acceptFriendApplications: (accountRef: string, gids: number[]) => callWorkerApi(resolveAccountRefId(accountRef), 'acceptFriendApplications', gids),
        rejectFriendApplications: (accountRef: string, gids: number[]) => callWorkerApi(resolveAccountRefId(accountRef), 'rejectFriendApplications', gids),
        setFriendBlockApplications: (accountRef: string, block: boolean) => callWorkerApi(resolveAccountRefId(accountRef), 'setFriendBlockApplications', block),
        blockFriend: (accountRef: string, gid: number) => callWorkerApi(resolveAccountRefId(accountRef), 'blockFriend', gid),
        scanGuardDogFriends: (accountRef: string, options?: any) => {
            const opts = (options && typeof options === 'object') ? options : {};
            const accountId = resolveAccountRefId(accountRef);
            // 入口处立刻标记为 running，避免 yyb-relogin 等定时任务在
            // worker 还没发出第一条 progress 之前抢先把 worker 重启。
            setScanStatus(accountId, {
                status: 'running',
                index: 0,
                total: 0,
                friendName: '',
                friendGid: 0,
                scanStatus: '',
                message: '',
            });
            return callWorkerApi(accountId, 'scanGuardDogFriends', accountId, { ...opts, __apiTimeoutMs: 120000 });
        },
        getScanGuardDogStatus: (accountRef: string) => {
            const accountId = resolveAccountRefId(accountRef);
            return getScanStatus(accountId);
        },
        clearScanGuardDogStatus: (accountRef: string) => {
            const accountId = resolveAccountRefId(accountRef);
            clearScanStatus(accountId);
            return { ok: true };
        },
        getBag: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getBag'),
        getBagSeeds: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getBagSeeds'),
        useItem: (accountRef: string, itemId: number, count: number) => callWorkerApi(resolveAccountRefId(accountRef), 'useItem', itemId, count),
        sellItems: (accountRef: string, items: any[]) => callWorkerApi(resolveAccountRefId(accountRef), 'sellItems', items),
        getDailyGifts: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getDailyGiftOverview'),
        getSeeds: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getSeeds'),

        setAutomation: async (accountRef: string, key: string, value: any) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) {
                throw new Error('Missing x-account-id');
            }
            store.setAutomation(key, value, accountId);
            const rev = nextConfigRevision();
            broadcastConfigToWorkers(accountId);
            return { automation: store.getAutomation(accountId), configRevision: rev };
        },

        doFarmOp: (accountRef: string, opType: string) => callWorkerApi(resolveAccountRefId(accountRef), 'doFarmOp', opType),

        getShopProfiles: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getShopProfiles'),
        getShopInfo: (accountRef: string, shopId: number) => callWorkerApi(resolveAccountRefId(accountRef), 'getShopInfo', shopId),
        buyGoods: (accountRef: string, goodsId: number, num: number, price: number) => callWorkerApi(resolveAccountRefId(accountRef), 'buyGoods', goodsId, num, price),
        doAnalytics: (accountRef: string, sortBy: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getAnalytics', sortBy),
        buyFertilizer: (accountRef: string, type: string, count: number) => callWorkerApi(resolveAccountRefId(accountRef), 'buyFertilizer', type, count),
        checkAndBuyFertilizer: (accountRef: string, options: any) => callWorkerApi(resolveAccountRefId(accountRef), 'checkAndBuyFertilizer', options),
        saveSettings: async (accountRef: string, payload: any) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) {
                throw new Error('Missing x-account-id');
            }
            const body = (payload && typeof payload === 'object') ? payload : {};
            const plantingStrategy = (body.plantingStrategy !== undefined) ? body.plantingStrategy : body.strategy;
            const preferredSeedId = (body.preferredSeedId !== undefined) ? body.preferredSeedId : body.seedId;
            const snapshot = {
                plantingStrategy,
                preferredSeedId,
                intervals: body.intervals,
                friendQuietHours: body.friendQuietHours,
                stealDelaySeconds: body.stealDelaySeconds,
                plantOrderRandom: body.plantOrderRandom,
                plantDelaySeconds: body.plantDelaySeconds,
                fertilizerBuyOrganicCount: body.fertilizerBuyOrganicCount,
                fertilizerBuyOrganicThresholdHours: body.fertilizerBuyOrganicThresholdHours,
                fertilizerBuyNormalCount: body.fertilizerBuyNormalCount,
                fertilizerBuyNormalThresholdHours: body.fertilizerBuyNormalThresholdHours,
                fertilizerBuyCheckIntervalMinutes: body.fertilizerBuyCheckIntervalMinutes,
                bagSeedPriority: body.bagSeedPriority,
                bagSeedFallbackStrategy: body.bagSeedFallbackStrategy,
            };
            store.applyConfigSnapshot(snapshot, { accountId });
            const rev = nextConfigRevision();
            broadcastConfigToWorkers(accountId);
            return {
                strategy: store.getPlantingStrategy(accountId),
                preferredSeed: store.getPreferredSeed(accountId),
                intervals: store.getIntervals(accountId),
                friendQuietHours: store.getFriendQuietHours(accountId),
                stealDelaySeconds: store.getStealDelaySeconds(accountId),
                plantOrderRandom: store.getPlantOrderRandom(accountId),
                plantDelaySeconds: store.getPlantDelaySeconds(accountId),
                fertilizerBuyOrganicCount: store.getFertilizerBuyOrganicCount(accountId),
                fertilizerBuyOrganicThresholdHours: store.getFertilizerBuyOrganicThresholdHours(accountId),
                fertilizerBuyNormalCount: store.getFertilizerBuyNormalCount(accountId),
                fertilizerBuyNormalThresholdHours: store.getFertilizerBuyNormalThresholdHours(accountId),
                fertilizerBuyCheckIntervalMinutes: store.getFertilizerBuyCheckIntervalMinutes(accountId),
                bagSeedPriority: store.getBagSeedPriority(accountId),
                bagSeedFallbackStrategy: store.getBagSeedFallbackStrategy(accountId),
                configRevision: rev,
            };
        },

        setUITheme: async (theme: string) => {
            const snapshot = store.setUITheme(theme);
            return { ui: snapshot.ui || store.getUI() };
        },

        broadcastConfig: (accountId: string) => {
            broadcastConfigToWorkers(accountId);
        },

        broadcastGameConfigReload: () => {
            if (typeof broadcastGameConfigReloadOpt === 'function') broadcastGameConfigReloadOpt();
        },

        setRuntimeAccountName: (accountRef: string, accountName: string) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) return;
            const worker = workers[accountId];
            if (worker) {
                worker.name = String(accountName || worker.name || accountId);
            }
        },

        getAccounts: () => {
            const data = getAccounts();
            data.accounts.forEach((a: any) => {
                const worker = workers[a.id];
                a.running = !!worker;
                if (worker && worker.status && worker.status.status && worker.status.status.name) {
                    a.nick = worker.status.status.name;
                }
            });
            return data;
        },

        startAccount: (accountRef: string) => {
            const accountId = resolveAccountRefId(accountRef);
            const acc = findAccountByAnyRef(accountId || accountRef);
            if (!acc) return false;
            // 标记 autoStart=true：用户主动启动 → 下次容器启动时也要拉起
            try {
                if (store && typeof store.setAccountAutoStart === 'function') {
                    store.setAccountAutoStart(String(acc.id), true);
                }
            } catch (e: any) {
                // 标记失败不阻塞启动（极端情况：磁盘满 / store.json 写失败）
            }
            startWorker(acc);
            return true;
        },

        stopAccount: (accountRef: string) => {
            const accountId = resolveAccountRefId(accountRef);
            const acc = findAccountByAnyRef(accountId || accountRef);
            if (!acc) return false;
            // 标记 autoStart=false：用户主动停止 → 下次容器启动时不再拉起
            try {
                if (store && typeof store.setAccountAutoStart === 'function') {
                    store.setAccountAutoStart(String(acc.id), false);
                }
            } catch (e: any) {
                // 标记失败不阻塞停止
            }
            if (accountId) stopWorker(accountId);
            return true;
        },

        restartAccount: (accountRef: string) => {
            const accountId = resolveAccountRefId(accountRef);
            const acc = findAccountByAnyRef(accountId || accountRef);
            if (!acc) return false;
            restartWorker(acc);
            return true;
        },

        isAccountRunning: (accountRef: string) => {
            const accountId = resolveAccountRefId(accountRef);
            return !!(accountId && workers[accountId]);
        },

        getSchedulerStatus: async (accountRef: string) => {
            const accountId = resolveAccountRefId(accountRef);
            const runtime = getSchedulerRegistrySnapshot();
            let worker = null;
            let workerError = '';

            if (!accountId) {
                return { accountId: '', runtime, worker, workerError };
            }

            if (!workers[accountId]) {
                return { accountId, runtime, worker, workerError: '账号未运行' };
            }

            try {
                worker = await callWorkerApi(accountId, 'getSchedulers');
            } catch (e: any) {
                workerError = (e && e.message) ? e.message : String(e || 'unknown');
            }
            return { accountId, runtime, worker, workerError };
        },
    };
}

module.exports = {
    createDataProvider,
};
