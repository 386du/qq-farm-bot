export {};
/**
 * Go 扫码账号自动重连服务
 *
 * 背景:Go 服务返回的 code 也有 TTL(取决于具体 Go 实现)。
 * 通过账号设置里的 `codeRefreshIntervalMinutes`,在 worker 运行期间
 * 周期性拉取新 code 并触发内部重连,避免因 code 失效掉线。
 *
 * 与 yyb-relogin 的区别:
 * - yyb-relogin 监听"账号被踢"事件触发;go-relogin 纯按时间轮询。
 * - 复用同一个 yybReloginService.handleAccountRelogin 兜底:被踢时也走相同流程。
 */
const { fetchGoCode } = require('../services/go-login');

const TICK_INTERVAL_MS = 30 * 1000; // 每 30 秒检查一次

interface GoReloginOptions {
    store: any;
    log: (tag: string, msg: string, extra?: any) => void;
    addAccountLog: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => void;
    getAccounts: () => { accounts?: any[] };
    addOrUpdateAccount: (acc: any) => any;
    isAccountRunning: (accountId: string) => boolean;
    restartWorker: (account: any) => void;
    startWorker: (account: any) => boolean;
}

function createGoReloginService(options: GoReloginOptions) {
    const {
        store,
        log,
        addAccountLog,
        getAccounts,
        addOrUpdateAccount,
        isAccountRunning,
        restartWorker,
    } = options;

    const lastRefreshAt = new Map<string, number>();
    let timer: NodeJS.Timeout | null = null;
    let started = false;

    function isGoAccount(account: any): boolean {
        if (!account) return false;
        if (String(account.loginType || '') !== 'go_scan') return false;
        const interval = Math.max(0, Number.parseInt(String(account.codeRefreshIntervalMinutes ?? 0), 10) || 0);
        return interval > 0;
    }

    function resolveGoConfig(account: any): { apiBase: string, appId: string } | null {
        const username = String(account.username || '');
        const cfg = store.getGoConfig ? store.getGoConfig(username) : null;
        if (!cfg || !cfg.enabled) return null;
        const apiBase = String(cfg.apiBase || '').trim();
        const appId = String(cfg.appId || '').trim();
        if (!apiBase) return null;
        return { apiBase, appId };
    }

    async function refreshOne(account: any): Promise<void> {
        const accountId = String(account.id || '');
        if (!accountId) return;
        const accountName = String(account.name || accountId);
        const interval = Math.max(1, Math.floor(Number(account.codeRefreshIntervalMinutes) || 1));
        const intervalMs = interval * 60 * 1000;
        const last = lastRefreshAt.get(accountId) || 0;
        const now = Date.now();
        if (now - last < intervalMs) return;

        const cfg = resolveGoConfig(account);
        if (!cfg) {
            log('GO', `账号 ${accountName} 启用了定时刷新,但 Go 服务未配置或未启用,跳过`, {
                module: 'go',
                event: 'refresh_skip_no_config',
                accountId,
            });
            return;
        }

        const wxid = String(account.openid || '').trim();
        if (!wxid) {
            log('GO', `账号 ${accountName} 缺少 wxid(openid),无法刷新 Code`, {
                module: 'go',
                event: 'refresh_skip_no_wxid',
                accountId,
            });
            return;
        }

        let result: { ok: boolean, code?: string, error?: string };
        try {
            result = await fetchGoCode(cfg.apiBase, cfg.appId, wxid);
        } catch (e: any) {
            log('GO', `刷新 Code 异常: ${e && e.message ? e.message : String(e)}`, {
                module: 'go',
                event: 'refresh_error',
                accountId,
            });
            return;
        }

        if (!result.ok || !result.code) {
            log('GO', `刷新 Code 失败,保持当前连接: ${result.error || '未知错误'}`, {
                module: 'go',
                event: 'refresh_failed',
                accountId,
            });
            return;
        }

        // 1) 持久化新 code(账号级),失败也不影响内存中的 reconnect
        try {
            addOrUpdateAccount({ id: accountId, code: result.code });
        } catch (e: any) {
            log('GO', `持久化新 code 失败: ${e && e.message ? e.message : String(e)}`, {
                module: 'go',
                event: 'refresh_persist_error',
                accountId,
            });
        }

        // 2) 触发内部重连(优先,避免重启进程)
        let reconnectOk = false;
        try {
            const network = require('../utils/network');
            const reconnectFn = typeof network.reconnect === 'function' ? network.reconnect : null;
            if (reconnectFn) {
                reconnectFn(result.code);
                reconnectOk = true;
            }
        } catch {
            // 忽略
        }

        // 3) 兜底:如果内存 reconnect 不可用(可能 worker 已退出),重启 worker
        if (!reconnectOk) {
            if (isAccountRunning(accountId)) {
                try {
                    restartWorker(account);
                } catch (e: any) {
                    log('GO', `重启账号失败: ${e && e.message ? e.message : String(e)}`, {
                        module: 'go',
                        event: 'restart_error',
                        accountId,
                    });
                }
            }
        }

        lastRefreshAt.set(accountId, now);
        addAccountLog(
            'update',
            `Go 扫码账号 Code 已刷新(${interval} 分钟间隔)${reconnectOk ? ' (内部重连)' : ' (重启账号)'}`,
            accountId,
            accountName,
        );
        log('GO', `账号 ${accountName} Code 刷新成功`, {
            module: 'go',
            event: 'refresh_ok',
            accountId,
            interval,
        });
    }

    async function tick(): Promise<void> {
        const all = (getAccounts().accounts || []);
        for (const acc of all) {
            if (!isGoAccount(acc)) continue;
            if (!isAccountRunning(String(acc.id || ''))) continue;
            // 串行处理,避免一次性打爆 Go 服务
            try {
                await refreshOne(acc);
            } catch (e: any) {
                log('GO', `处理账号刷新时异常: ${e && e.message ? e.message : String(e)}`, {
                    module: 'go',
                    event: 'refresh_tick_error',
                });
            }
        }
    }

    function start(): void {
        if (started) return;
        started = true;
        if (timer) clearInterval(timer);
        timer = setInterval(() => {
            tick().catch((e: any) => {
                log('GO', `轮询任务异常: ${e && e.message ? e.message : String(e)}`, {
                    module: 'go',
                    event: 'tick_error',
                });
            });
        }, TICK_INTERVAL_MS);
        log('GO', `Go 扫码定时刷新已启动 (轮询间隔 ${TICK_INTERVAL_MS / 1000}s)`, {
            module: 'go',
            event: 'service_started',
        });
    }

    function stop(): void {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        started = false;
    }

    return {
        start,
        stop,
        refreshOne,
        isGoAccount,
    };
}

module.exports = {
    createGoReloginService,
};
