export {};
/**
 * 应用宝自动重连服务
 * - 按配置间隔定时刷新运行中账号的 Code
 * - 账号被踢/登录失效时自动获取新 Code 并重连
 */
const { createScheduler } = require('../services/scheduler');
const { fetchFarmCode } = require('../services/yyb-login');

interface YybReloginOptions {
    store: any;
    log: (tag: string, msg: string, extra?: any) => void;
    addAccountLog: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => void;
    getAccounts: () => { accounts?: any[] };
    addOrUpdateAccount: (acc: any) => any;
    isAccountRunning: (accountId: string) => boolean;
    restartWorker: (account: any) => void;
    startWorker: (account: any) => boolean;
}

function createYybReloginService(options: YybReloginOptions) {
    const {
        store,
        log,
        addAccountLog,
        getAccounts,
        addOrUpdateAccount,
        isAccountRunning,
        restartWorker,
        startWorker,
    } = options;

    const scheduler = createScheduler('yyb_relogin');
    const lastRefreshAt = new Map<string, number>();
    let started = false;

    function isYybAccount(account: any): boolean {
        return account && String(account.loginType || '') === 'yyb' && String(account.openid || '').trim().length > 0;
    }

    async function refreshAccountCode(account: any): Promise<{ ok: boolean; code?: string; error?: string }> {
        const username = String(account.username || '');
        const cfg = store.getYybConfig ? store.getYybConfig(username) : null;
        if (!cfg || !cfg.enabled) {
            return { ok: false, error: '应用宝配置未启用' };
        }
        if (!cfg.apiToken) {
            return { ok: false, error: '未配置 API Token' };
        }
        if (!cfg.endpoint) {
            return { ok: false, error: '未配置接口地址' };
        }
        const openid = String(account.openid || '').trim();
        if (!openid) {
            return { ok: false, error: '账号未关联 OpenID' };
        }

        const result = await fetchFarmCode({
            endpoint: cfg.endpoint,
            apiToken: cfg.apiToken,
            openid,
        });

        if (!result.ok || !result.code) {
            return { ok: false, error: result.error || '获取 Code 失败' };
        }

        return { ok: true, code: result.code };
    }

    async function applyCodeRefresh(account: any, reason: string): Promise<boolean> {
        const accountId = String(account.id || '');
        const accountName = String(account.name || accountId);
        const result = await refreshAccountCode(account);
        if (!result.ok) {
            log('错误', `应用宝刷新失败: ${accountName} - ${result.error}`, { accountId });
            return false;
        }

        const newCode = result.code!;
        if (account.code !== newCode) {
            addOrUpdateAccount({
                id: accountId,
                code: newCode,
                updatedAt: Date.now(),
            });
            addAccountLog('update', `应用宝刷新 Code: ${accountName}`, accountId, accountName, { reason });
            log('系统', `应用宝刷新 Code 成功: ${accountName}`, { accountId, reason });
        }
        lastRefreshAt.set(accountId, Date.now());
        return true;
    }

    async function refreshRunningAccounts(): Promise<void> {
        const data = getAccounts();
        const accounts = Array.isArray(data.accounts) ? data.accounts : [];
        const now = Date.now();

        for (const account of accounts) {
            if (!isYybAccount(account)) continue;
            const accountId = String(account.id || '');
            if (!isAccountRunning(accountId)) continue;

            const username = String(account.username || '');
            const cfg = store.getYybConfig ? store.getYybConfig(username) : null;
            if (!cfg || !cfg.enabled) continue;
            const intervalMinutes = Math.max(0, Number(cfg.reconnectIntervalMinutes) || 0);
            if (intervalMinutes <= 0) continue;

            const last = lastRefreshAt.get(accountId) || 0;
            if (now - last < intervalMinutes * 60 * 1000) continue;

            const ok = await applyCodeRefresh(account, 'scheduled');
            if (ok && account.code) {
                const refreshed = { ...account, code: account.code };
                restartWorker(refreshed);
            }
        }
    }

    async function handleAccountRelogin(accountId: string, reason: string): Promise<void> {
        const data = getAccounts();
        const accounts = Array.isArray(data.accounts) ? data.accounts : [];
        const account = accounts.find((a: any) => String(a.id) === String(accountId));
        if (!account || !isYybAccount(account)) return;

        const username = String(account.username || '');
        const cfg = store.getYybConfig ? store.getYybConfig(username) : null;
        if (!cfg || !cfg.enabled || !cfg.autoReconnect) return;

        log('系统', `应用宝离线自动重连: ${account.name} (${reason})`, { accountId });
        const ok = await applyCodeRefresh(account, reason);
        if (!ok) {
            log('错误', `应用宝离线自动重连失败: ${account.name}`, { accountId, reason });
            return;
        }

        const refreshed = { ...account, code: account.code };
        if (isAccountRunning(accountId)) {
            restartWorker(refreshed);
        } else {
            startWorker(refreshed);
        }
    }

    function start(): void {
        if (started) return;
        started = true;
        scheduler.setIntervalTask('periodic_refresh', 60 * 1000, refreshRunningAccounts);
    }

    function stop(): void {
        scheduler.clearAll();
        started = false;
    }

    return {
        start,
        stop,
        refreshAccountCode,
        handleAccountRelogin,
    };
}

module.exports = {
    createYybReloginService,
};
