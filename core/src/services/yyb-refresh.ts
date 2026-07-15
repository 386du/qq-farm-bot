export {};
/**
 * 应用宝会话续期服务
 *
 * 背景:应用宝登录返回的 code 在网关侧有 TTL(实测 3~5 分钟)。
 * WS 连接还"看似"开着,但服务端已把会话视为失效,
 * 继续发偷菜请求会被忽略或返回空成功。
 *
 * 解决方案:Worker 内部每 2.5 分钟主动拿新 code,调现有 reconnect() 重连,
 * 不重启整个进程,1~2 秒内恢复,无感。
 *
 * 安全网:API 调用失败时绝不触发重连,避免抽风时把还能用的连接搞挂。
 */
const { createScheduler } = require('./scheduler');
const { log, logWarn } = require('../utils/utils');
const { fetchFarmCode } = require('./yyb-login');

const DEFAULT_REFRESH_MS = 2.5 * 60 * 1000;
const TASK_NAME = 'yyb_session_renew';

interface YybContext {
    endpoint: string;
    openid: string;
    apiToken: string;
}

let activeScheduler: any = null;

function readYybContext(): YybContext | null {
    if (String(process.env.FARM_LOGIN_TYPE || '').toLowerCase() !== 'yyb') return null;
    const endpoint = String(process.env.YYB_ENDPOINT || '').trim();
    const openid = String(process.env.FARM_OPENID || '').trim();
    const apiToken = String(process.env.YYB_API_TOKEN || '').trim();
    if (!endpoint || !openid || !apiToken) return null;
    return { endpoint, openid, apiToken };
}

async function refreshAndReconnect(accountName: string): Promise<void> {
    const ctx = readYybContext();
    if (!ctx) return;

    let reconnectFn: ((code: string) => void) | null = null;
    try {
        const network = require('../utils/network');
        reconnectFn = typeof network.reconnect === 'function' ? network.reconnect : null;
    } catch {
        return;
    }
    if (!reconnectFn) return;

    let result: { ok: boolean; code?: string; error?: string };
    try {
        result = await fetchFarmCode({
            endpoint: ctx.endpoint,
            apiToken: ctx.apiToken,
            openid: ctx.openid,
        });
    } catch (e: any) {
        logWarn('YYB', `续期 API 调用异常: ${e && e.message ? e.message : String(e)}`, {
            module: 'yyb',
            event: 'session_renew_error',
        });
        return;
    }

    if (!result.ok || !result.code) {
        logWarn('YYB', `续期失败,保持当前连接: ${result.error || '未知错误'}`, {
            module: 'yyb',
            event: 'session_renew_failed',
        });
        return;
    }

    try {
        log('YYB', `会话续期成功,触发内部重连: ${accountName}`, {
            module: 'yyb',
            event: 'session_renew_ok',
            accountName,
        });
        reconnectFn(result.code);
    } catch (e: any) {
        logWarn('YYB', `触发重连失败: ${e && e.message ? e.message : String(e)}`, {
            module: 'yyb',
            event: 'session_renew_reconnect_error',
        });
    }
}

export function startYybSessionRenewer(accountName: string, intervalMs: number = DEFAULT_REFRESH_MS): void {
    stopYybSessionRenewer();
    if (!readYybContext()) return;

    activeScheduler = createScheduler('yyb_renew');
    activeScheduler.setIntervalTask(TASK_NAME, intervalMs, () => {
        refreshAndReconnect(accountName);
    });
    log('YYB', `会话续期已启动: ${accountName},间隔 ${Math.round(intervalMs / 1000)}s`, {
        module: 'yyb',
        event: 'session_renew_started',
        accountName,
        intervalMs,
    });
}

export function stopYybSessionRenewer(): void {
    if (activeScheduler) {
        activeScheduler.clearAll();
        activeScheduler = null;
    }
}

module.exports = {
    startYybSessionRenewer,
    stopYybSessionRenewer,
};