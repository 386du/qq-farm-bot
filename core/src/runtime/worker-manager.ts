export {};
const { createScheduler } = require('../services/scheduler');
const store = require('../models/store');
const { setScanStatus, getScanStatus, clearScanStatus } = require('./scan-status');

interface WorkerManagerOptions {
    fork: any;
    WorkerThread: any;
    runtimeMode?: string;
    processRef: any;
    mainEntryPath: string;
    workerScriptPath: string;
    workers: Record<string, any>;
    globalLogs: any[];
    log: (tag: string, msg: string, extra?: any) => void;
    addAccountLog: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => void;
    normalizeStatusForPanel: (data: any, accountId: string, accountName: string) => any;
    buildConfigSnapshotForAccount: (accountId: string) => any;
    getOfflineAutoDeleteMs: (username?: string) => number;
    triggerOfflineReminder: (payload: any) => void;
    addOrUpdateAccount: (acc: any) => any;
    deleteAccount: (id: string) => void;
    onStatusSync?: (accountId: string, status: any, accountName?: string) => void;
    onWorkerLog?: (entry: any, accountId: string, accountName?: string) => void;
    onAccountNeedsRelogin?: (accountId: string, reason: string) => void;
}

function createWorkerManager(options: WorkerManagerOptions) {
    const {
        fork,
        WorkerThread,
        runtimeMode = 'thread',
        processRef,
        mainEntryPath,
        workerScriptPath,
        workers,
        globalLogs,
        log,
        addAccountLog,
        normalizeStatusForPanel,
        buildConfigSnapshotForAccount,
        getOfflineAutoDeleteMs,
        triggerOfflineReminder,
        addOrUpdateAccount,
        deleteAccount,
        onStatusSync,
        onWorkerLog,
        onAccountNeedsRelogin,
    } = options;
    const managerScheduler = createScheduler('worker_manager');
    const useThreadRuntime = runtimeMode === 'thread' && !(processRef as any).pkg && typeof WorkerThread === 'function';

    /**
     * 拒绝 worker 上的所有挂起 API 请求（防止调用方长时间等待）
     * 用于在 worker 即将被销毁（force_kill / killIfStale / 异常退出）时调用。
     * 即便 workers[accountId] 已被并发删除，这里仍可通过闭包中的 worker 引用清理掉请求。
     */
    function rejectPendingApiRequests(workerRecord: any, accountId: string): void {
        if (!workerRecord || !workerRecord.requests) return;
        for (const [reqId, req] of workerRecord.requests.entries()) {
            managerScheduler.clear(`api_timeout_${accountId}_${reqId}`);
            try {
                req.reject(new Error('Worker exited'));
            } catch {}
        }
        workerRecord.requests.clear();
    }

    /**
     * 若该账号有进行中的护主犬扫描，将其标记为已中断。
     * 避免应用宝自动重连等场景下，扫描状态长期停留在 "扫描中 39/260" 死锁状态。
     */
    function interruptInProgressScan(accountId: string): void {
        try {
            if (typeof getScanStatus !== 'function') return;
            const st: any = getScanStatus(accountId);
            if (!st) return;
            // 只有 running 状态才需要中断；done / error / interrupted 已经是终态
            if (st.status !== 'running') return;
            setScanStatus(accountId, {
                ...st,
                status: 'interrupted',
                message: '扫描被中断：账号已重启（应用宝自动重连等场景）',
                updatedAt: Date.now(),
            });
            // 与 done/error 保持一致：保留 5 分钟供前端轮询，然后允许被下次扫描覆盖
            setTimeout(() => clearScanStatus(accountId), 300000);
        } catch { /* ignore */ }
    }

    function buildYybEnv(account: any): Record<string, string> {
        const env: Record<string, string> = {};
        if (!account || String(account.loginType || '').toLowerCase() !== 'yyb') return env;
        if (!account.openid) return env;
        try {
            const username = String(account.username || '');
            const cfg = store.getYybConfig ? store.getYybConfig(username) : null;
            if (!cfg || !cfg.enabled) return env;
            const entry = Array.isArray(cfg.accounts)
                ? cfg.accounts.find((a: any) => a && String(a.openid || '').trim() === String(account.openid || '').trim())
                : null;
            if (!entry || !entry.apiToken || !cfg.endpoint) return env;
            env.FARM_LOGIN_TYPE = 'yyb';
            env.FARM_OPENID = String(account.openid).trim();
            env.YYB_API_TOKEN = String(entry.apiToken).trim();
            env.YYB_ENDPOINT = String(cfg.endpoint).trim();
        } catch {
            // 静默:获取失败时不透传 env,Worker 内不会启动续期
        }
        return env;
    }

    function createThreadWorker(account: any): any {
        const workerOptions: any = {
            workerData: {
                accountId: String(account.id || ''),
                channel: 'thread',
            },
        };
        // When running from source with tsx, configure worker to use tsx
        if (workerScriptPath.endsWith('.ts')) {
            workerOptions.execArgv = ['--require', 'tsx/cjs'];
        }
        const worker = new WorkerThread(workerScriptPath, workerOptions);
        worker.send = (payload: any) => worker.postMessage(payload);
        worker.kill = () => worker.terminate();
        return worker;
    }

    function createForkWorker(account: any): any {
        const yybEnv = buildYybEnv(account);
        if ((processRef as any).pkg) {
            return fork(mainEntryPath, [], {
                execPath: processRef.execPath,
                stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
                env: { ...processRef.env, FARM_WORKER: '1', FARM_ACCOUNT_ID: String(account.id || ''), ...yybEnv },
            });
        }
        const forkOptions: any = {
            stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
            env: { ...processRef.env, FARM_ACCOUNT_ID: String(account.id || ''), ...yybEnv },
        };
        if (workerScriptPath.endsWith('.ts')) {
            forkOptions.execArgv = ['--require', 'tsx/cjs'];
        }
        return fork(workerScriptPath, [], forkOptions);
    }

    function createWorkerProcess(account: any): any {
        if (useThreadRuntime) return createThreadWorker(account);
        return createForkWorker(account);
    }

    function startWorker(account: any): boolean {
        if (!account || !account.id) return false;
        if (workers[account.id]) return false;

        log('系统', `正在启动账号: ${account.name}`, { accountId: String(account.id), accountName: account.name });

        let child: any = null;
        try {
            child = createWorkerProcess(account);
        } catch (err: any) {
            const reason = err && err.message ? err.message : String(err || 'unknown error');
            log('错误', `账号 ${account.name} 启动失败: ${reason}`, { accountId: String(account.id), accountName: account.name });
            addAccountLog('start_failed', `账号 ${account.name} 启动失败`, account.id, account.name, { reason });
            return false;
        }

        workers[account.id] = {
            process: child,
            status: null,
            logs: [],
            requests: new Map(),
            reqId: 1,
            name: account.name,
            username: account.username || '',
            stopping: false,
            disconnectedSince: 0,
            autoDeleteTriggered: false,
            wsError: null,
        };

        child.send({
            type: 'start',
            config: {
                code: account.code,
                platform: account.platform,
            },
        });
        child.send({ type: 'config_sync', config: buildConfigSnapshotForAccount(account.id) });

        child.on('message', (msg: any) => {
            handleWorkerMessage(account.id, msg);
        });

        child.on('error', (err: any) => {
            log('系统', `账号 ${account.name} 子进程启动失败: ${err && err.message ? err.message : err}`, { accountId: String(account.id), accountName: account.name });
        });

        child.on('exit', (code: number, signal: string) => {
            const current = workers[account.id];
            const displayName = (current && current.name) || account.name;
            log('系统', `账号 ${displayName} 进程退出 (code=${code}, signal=${signal || 'none'})`, {
                accountId: String(account.id),
                accountName: displayName,
                runtimeMode: useThreadRuntime ? 'thread' : 'fork',
            });

            managerScheduler.clear(`force_kill_${account.id}`);
            managerScheduler.clear(`restart_fallback_${account.id}`);

            // 拒绝 worker 上的所有挂起 API 请求（防止调用方长时间等待）。
            // 注意：force_kill / killIfStale 可能在 exit 之前就已删除 workers[account.id]，
            // 所以这里也用闭包中的 current 做防御性清理，避免卡住超时（120s）。
            if (current) {
                rejectPendingApiRequests(current, String(account.id));
            }

            // 若该账号的护主犬扫描仍处于 running 状态，标记为 interrupted，
            // 避免前端一直显示 "扫描中 X/Y" 且按钮无法再次点击。
            interruptInProgressScan(String(account.id));

            if (current && current.process === child) {
                delete workers[account.id];
            }
        });
        return true;
    }

    function stopWorker(accountId: string): void {
        const worker = workers[accountId];
        if (!worker) return;

        const proc = worker.process;
        worker.stopping = true;
        worker.process.send({ type: 'stop' });
        managerScheduler.setTimeoutTask(`force_kill_${accountId}`, 1000, () => {
            const current = workers[accountId];
            if (current && current.process === proc) {
                current.process.kill();
                // 在删除 workers 记录前先拒绝挂起的 API 请求，
                // 避免调用方（包括扫描等长任务）卡到 120s 等待超时。
                rejectPendingApiRequests(current, accountId);
                delete workers[accountId];
            }
        });
    }

    function restartWorker(account: any): void {
        if (!account) return;
        const accountId = account.id;
        const worker = workers[accountId];
        if (!worker) { startWorker(account); return; }
        const proc = worker.process;
        let started = false;
        const startOnce = () => {
            if (started) return;
            started = true;
            managerScheduler.clear(`restart_fallback_${accountId}`);
            const current = workers[accountId];
            if (!current) { startWorker(account); return; }
            if (current.process !== proc) return;
            delete workers[accountId];
            startWorker(account);
        };
        const killIfStale = () => {
            const current = workers[accountId];
            if (!current || current.process !== proc) return false;
            try {
                current.process.kill();
            } catch {}
            // 同样需要在删除 workers 记录前拒绝挂起的 API 请求
            rejectPendingApiRequests(current, accountId);
            delete workers[accountId];
            return true;
        };
        if (typeof proc.exitCode === 'number' || proc.signalCode) {
            startOnce();
            return;
        }
        proc.once('exit', startOnce);
        stopWorker(accountId);
        managerScheduler.setTimeoutTask(`restart_fallback_${accountId}`, 1500, () => {
            if (started) return;
            killIfStale();
            startOnce();
        });
    }

    function handleWorkerMessage(accountId: string, msg: any): void {
        const worker = workers[accountId];
        if (!worker) return;

        if (msg.type === 'status_sync') {
            worker.status = normalizeStatusForPanel(msg.data, accountId, worker.name);
            if (typeof onStatusSync === 'function') {
                onStatusSync(accountId, worker.status, worker.name);
            }

            if (msg.data && msg.data.status && msg.data.status.name) {
                const newNick = String(msg.data.status.name).trim();
                const newAvatar = String(msg.data.status.avatar || '').trim();
                const updates: any = {};
                let needUpdate = false;

                if (newNick && newNick !== '未知' && newNick !== '未登录') {
                    if (worker.nick !== newNick) {
                        worker.nick = newNick;
                        updates.nick = newNick;
                        needUpdate = true;
                    }
                }

                if (newAvatar) {
                    if (worker.avatar !== newAvatar) {
                        worker.avatar = newAvatar;
                        updates.avatar = newAvatar;
                        needUpdate = true;
                    }
                }

                if (needUpdate) {
                    updates.id = accountId;
                    addOrUpdateAccount(updates);
                    const changes: string[] = [];
                    if (updates.nick) changes.push(`昵称: ${worker.nick || 'None'} -> ${updates.nick}`);
                    if (updates.avatar) changes.push('头像已更新');
                    log('系统', `已同步账号信息: ${changes.join(', ')}`, { accountId, accountName: worker.name });
                }
            }

            const connected = !!(msg.data && msg.data.connection && msg.data.connection.connected);
            if (connected) {
                worker.disconnectedSince = 0;
                worker.autoDeleteTriggered = false;
                worker.wsError = null;
            } else if (!worker.stopping) {
                const now = Date.now();
                if (!worker.disconnectedSince) worker.disconnectedSince = now;
                const offlineMs = now - worker.disconnectedSince;
                const autoDeleteMs = getOfflineAutoDeleteMs(worker.username);
                if (!worker.autoDeleteTriggered && offlineMs >= autoDeleteMs) {
                    worker.autoDeleteTriggered = true;
                    const offlineMin = Math.floor(offlineMs / 60000);
                    log('系统', `账号 ${worker.name} 持续离线 ${offlineMin} 分钟，自动删除账号信息`);
                    triggerOfflineReminder({
                        accountId,
                        accountName: worker.name,
                        username: worker.username,
                        reason: 'offline_timeout',
                        offlineMs,
                    });
                    addAccountLog(
                        'offline_delete',
                        `账号 ${worker.name} 持续离线 ${offlineMin} 分钟，已自动删除`,
                        accountId,
                        worker.name,
                        { reason: 'offline_timeout', offlineMs },
                    );
                    stopWorker(accountId);
                    try {
                        deleteAccount(accountId);
                    } catch (e: any) {
                        log('错误', `删除离线账号失败: ${e.message}`);
                    }
                }
            }
        } else if (msg.type === 'log') {
            const logEntry = {
                ...msg.data,
                accountId,
                accountName: worker.name,
                ts: Date.now(),
                meta: msg.data && msg.data.meta ? msg.data.meta : {},
            };
            logEntry._searchText = `${logEntry.msg || ''} ${logEntry.tag || ''} ${JSON.stringify(logEntry.meta || {})}`.toLowerCase();
            worker.logs.push(logEntry);
            if (worker.logs.length > 1000) worker.logs.shift();
            globalLogs.push(logEntry);
            if (globalLogs.length > 1000) globalLogs.shift();
            if (typeof onWorkerLog === 'function') {
                onWorkerLog(logEntry, accountId, worker.name);
            }
        } else if (msg.type === 'error') {
            log('错误', `账号[${accountId}]进程报错: ${msg.error}`, { accountId: String(accountId), accountName: worker.name });
        } else if (msg.type === 'ws_error') {
            const code = Number(msg.code) || 0;
            const message = msg.message || '';
            worker.wsError = { code, message, at: Date.now() };
            if (code === 400) {
                addAccountLog(
                    'ws_400',
                    `账号 ${worker.name} 登录失效，请更新 Code`,
                    accountId,
                    worker.name,
                );
                if (typeof onAccountNeedsRelogin === 'function') {
                    onAccountNeedsRelogin(accountId, 'ws_400');
                }
            }
        } else if (msg.type === 'account_kicked') {
            const reason = msg.reason || '未知';
            log('系统', `账号 ${worker.name} 被踢下线，已自动停止账号`, { accountId: String(accountId), accountName: worker.name });
            triggerOfflineReminder({
                accountId,
                accountName: worker.name,
                reason: `kickout:${reason}`,
                offlineMs: 0,
            });
            addAccountLog('kickout_stop', `账号 ${worker.name} 被踢下线，已自动停止`, accountId, worker.name, { reason });
            stopWorker(accountId);
            if (typeof onAccountNeedsRelogin === 'function') {
                onAccountNeedsRelogin(accountId, `kickout:${reason}`);
            }
        } else if (msg.type === 'api_response') {
            const { id, result, error } = msg;
            managerScheduler.clear(`api_timeout_${accountId}_${id}`);
            const req = worker.requests.get(id);
            if (req) {
                if (error) req.reject(new Error(error));
                else req.resolve(result);
                worker.requests.delete(id);
            }
        } else if (msg.type === 'friend_blacklist_add') {
            const gid = Number(msg.gid) || 0;
            if (gid > 0) {
                const { addFriendToBlacklist: addToBlacklist } = require('../models/store');
                addToBlacklist(accountId, gid);
                log('好友', `已将好友 ${msg.friendName || `GID:${gid}`} 加入黑名单`, {
                    accountId: String(accountId),
                    accountName: worker.name,
                    friendGid: gid,
                    friendName: msg.friendName,
                    reason: msg.reason,
                });
                const worker_process = workers[accountId];
                if (worker_process && worker_process.process) {
                    worker_process.process.send({ type: 'config_sync', config: buildConfigSnapshotForAccount(accountId) });
                }
            }
        } else if (msg.type === 'friend_guard_dog_add') {
            // 扫描过程中实时同步：worker 扫到一个护主犬就立即送过来，
            // 主进程 store 同步写入，避免 scan 末尾 api_response 丢失时主进程漏登。
            const gid = Number(msg.gid) || 0;
            if (gid > 0) {
                try {
                    const { addFriendGuardDogGid: addGd } = require('../models/store');
                    addGd(accountId, gid);
                } catch { /* ignore */ }
            }
        } else if (msg.type === 'guard_dog_scan_progress') {
            const payload: any = {
                status: msg.status || 'running',
                index: Number(msg.index) || 0,
                total: Number(msg.total) || 0,
                friendName: msg.friendName || '',
                friendGid: Number(msg.friendGid) || 0,
                scanStatus: msg.scanStatus || '',
                message: msg.message || '',
            };
            if (msg.result && typeof msg.result === 'object') {
                payload.result = msg.result;
            }
            setScanStatus(accountId, payload);
            if (msg.status === 'done' || msg.status === 'error') {
                // 结果保留 5 分钟供前端轮询；之后允许被下一次扫描覆盖
                setTimeout(() => {
                    clearScanStatus(accountId);
                }, 300000);
            }
        }
    }

    function callWorkerApi(accountId: string, method: string, ...args: any[]): Promise<any> {
        const worker = workers[accountId];
        if (!worker) return Promise.reject(new Error('账号未运行'));

        return new Promise((resolve, reject) => {
            const id = worker.reqId++;
            const timeoutMs = (() => {
                if (args.length > 0 && args[args.length - 1] && typeof args[args.length - 1] === 'object' && args[args.length - 1].__apiTimeoutMs) {
                    return Math.max(1000, Number(args[args.length - 1].__apiTimeoutMs) || 10000);
                }
                return 10000;
            })();
            worker.requests.set(id, { resolve, reject });

            managerScheduler.setTimeoutTask(`api_timeout_${accountId}_${id}`, timeoutMs, () => {
                if (worker.requests.has(id)) {
                    worker.requests.delete(id);
                    reject(new Error('API Timeout'));
                }
            });

            worker.process.send({ type: 'api_call', id, method, args });
        });
    }

    return {
        startWorker,
        stopWorker,
        restartWorker,
        callWorkerApi,
    };
}

module.exports = {
    createWorkerManager,
};
