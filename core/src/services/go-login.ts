export {};
/**
 * Go 扫码登录服务
 * 调用独立的 Go 服务(用户/管理员在「Go 服务配置」中配置 apiBase)
 * 实现:获取二维码 / 检查扫码状态 / 拉取登录 Code
 *
 * 重构说明 (2026-07):
 * 不同 fork 的 Go 微信 iPad 协议服务路径并不统一,旧实现只硬编码了一套
 * `/Login/LoginGetQRCar` 等路径,导致大量部署取不到二维码。新实现:
 *   1. 维护多套候选路径(含 `/api` 前缀及常见变体 GetQrCode/GetQRx/CheckLogin/CheckQR),
 *      首次调用时按序探测,命中后缓存到 per-apiBase 的 Map,后续直接复用,避免每秒轮询打爆服务。
 *   2. 响应解析兼容 PascalCase({Success,Data}) 与 lowercase({code,data}) 两种信封,
 *      以及扁平 WxId/NickName/State 与旧的嵌套 acctSectResp.userName/nickName 两种结构。
 *   3. 错误信息携带 HTTP 状态码 + 响应体片段 + 已尝试的 URL,便于前端排障。
 */

const axios = require('axios');

export interface GoFetchQRResult {
    ok: boolean;
    uuid?: string;
    qrBase64?: string;
    error?: string;
}

export interface GoCheckStatusResult {
    ok: boolean;
    // 0 = 等待扫码, 1 = 已扫码待确认, 2 = 登录成功(同时有 wxid)
    qrStatus?: number;
    wxid?: string;
    nickname?: string;
    error?: string;
}

export interface GoFetchCodeResult {
    ok: boolean;
    code?: string;
    error?: string;
}

// 默认请求超时(毫秒)
const DEFAULT_TIMEOUT_MS = 15000;
// 错误信息中保留的响应体长度
const ERR_BODY_PREVIEW_LEN = 300;

function normalizeApiBase(apiBase: string): string {
    return String(apiBase || '').trim().replace(/\/+$/, '');
}

function truncate(s: string, n: number): string {
    const str = String(s == null ? '' : s);
    return str.length > n ? `${str.slice(0, n)}…` : str;
}

/** 拼接 apiBase + path,确保恰好一个斜杠分隔 */
function buildUrl(apiBase: string, path: string): string {
    const base = apiBase.replace(/\/+$/, '');
    const tail = String(path || '').replace(/^\/+/, '');
    return `${base}/${tail}`;
}

/**
 * 从任意对象中按多个候选键取值(大小写不敏感),第一个非空即返回。
 * 用于兼容 PascalCase/camelCase/不同命名的响应字段。
 */
function pickFirst(obj: any, keys: string[]): any {
    if (!obj || typeof obj !== 'object') return undefined;
    // 先精确匹配
    for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
            const v = obj[k];
            if (v !== undefined && v !== null && v !== '') return v;
        }
    }
    // 再大小写不敏感匹配
    const lower = keys.map(k => String(k).toLowerCase());
    for (const key of Object.keys(obj)) {
        const lk = String(key).toLowerCase();
        const idx = lower.indexOf(lk);
        if (idx >= 0) {
            const v = obj[key];
            if (v !== undefined && v !== null && v !== '') return v;
        }
    }
    return undefined;
}

/** 判断响应是否为「成功」信封,返回 { success, envelope, data, msg } */
function parseEnvelope(respData: any): {
    success: boolean;
    hasEnvelope: boolean;
    data: any;
    message: string;
} {
    const d = respData && typeof respData === 'object' ? respData : {};
    // PascalCase: { Success: true, Data, Message }
    if (Object.prototype.hasOwnProperty.call(d, 'Success')) {
        const data = d.Data != null ? d.Data : {};
        return {
            success: !!d.Success,
            hasEnvelope: true,
            data,
            message: String(d.Message || d.message || d.Msg || d.msg || ''),
        };
    }
    // lowercase: { code: 0, data, msg }
    if (Object.prototype.hasOwnProperty.call(d, 'code') || Object.prototype.hasOwnProperty.call(d, 'Code')) {
        const code = d.code != null ? d.code : d.Code;
        const codeNum = Number(code);
        return {
            // code === 0 视为成功;非数字也允许 truthy 字符串 "0"/"ok"/"success"
            success: codeNum === 0 || code === '0' || code === 'ok' || code === 'success',
            hasEnvelope: true,
            data: d.data != null ? d.data : (d.Data != null ? d.Data : {}),
            message: String(d.msg || d.Msg || d.message || d.Message || ''),
        };
    }
    // 无信封字段,返回原对象当作 data
    return { success: false, hasEnvelope: false, data: d, message: '' };
}

/** 从响应体里提取错误信息(用于无信封或失败信封时) */
function extractErrorMessage(respData: any, fallback: string): string {
    if (!respData) return fallback;
    if (typeof respData === 'string') return truncate(respData, ERR_BODY_PREVIEW_LEN) || fallback;
    if (typeof respData === 'object') {
        const candidates = ['error', 'Error', 'message', 'Message', 'msg', 'Msg', 'errmsg', 'ErrMsg'];
        for (const k of candidates) {
            if (respData[k] != null && respData[k] !== '') return String(respData[k]);
        }
        try {
            return truncate(JSON.stringify(respData), ERR_BODY_PREVIEW_LEN) || fallback;
        } catch {
            return fallback;
        }
    }
    return fallback;
}

function describeAxiosError(e: any, url: string): string {
    if (e?.response) {
        const status = e.response.status;
        let body = '';
        const d = e.response.data;
        if (d == null) body = '';
        else if (typeof d === 'string') body = d;
        else { try { body = JSON.stringify(d); } catch { body = String(d); } }
        return `HTTP ${status} @ ${url}${body ? ` - ${truncate(body, ERR_BODY_PREVIEW_LEN)}` : ''}`;
    }
    if (e?.code === 'ECONNABORTED') return `请求超时 @ ${url}`;
    if (e?.message) return `${e.message} @ ${url}`;
    return `请求失败 @ ${url}`;
}

// ============ 路径候选与缓存 ============

// GetQrCode 候选(按命中可能性排序)
const QR_PATH_CANDIDATES: string[] = [
    'api/Login/GetQrCode',
    'api/Login/GetQRx',
    'api/Login/GetQRCode',
    'api/login/getqrcode',
    'Login/GetQrCode',
    'Login/GetQRx',
    'Login/GetQRCode',
    'Login/LoginGetQRCar', // 旧路径,向后兼容
];

// CheckLogin 候选模板,`{uuid}` 占位符
const CHECK_PATH_TEMPLATES: string[] = [
    'api/Login/CheckLogin/{uuid}',
    'api/Login/CheckQR?uuid={uuid}',
    'api/Login/CheckLogin?uuid={uuid}',
    'Login/CheckLogin/{uuid}',
    'Login/CheckQR?uuid={uuid}',
    'Login/LoginCheckQR?uuid={uuid}', // 旧路径,向后兼容
];

// JSLogin 候选
const JSLOGIN_PATH_CANDIDATES: string[] = [
    'api/Wxapp/JSLogin',
    'Wxapp/JSLogin', // 旧路径,向后兼容
];

interface PathCacheEntry {
    qrPath?: string;
    checkTemplate?: string;
    jsLoginPath?: string;
}

const pathCache = new Map<string, PathCacheEntry>();

function getPathCache(apiBase: string): PathCacheEntry {
    const key = normalizeApiBase(apiBase);
    let entry = pathCache.get(key);
    if (!entry) {
        entry = {};
        pathCache.set(key, entry);
    }
    return entry;
}

/**
 * 判断 HTTP 响应是否「该路径不存在」(应继续尝试下一个候选)。
 * - 404 / 405:明确不存在
 * - 200 但响应既非 JSON 也非可识别信封:大概率不是该路径
 */
function isPathNotFound(status: number, respData: any): boolean {
    if (status === 404 || status === 405) return true;
    if (status >= 200 && status < 300) {
        // 200 但内容像 HTML 错误页/空响应
        if (respData == null) return true;
        if (typeof respData === 'string') {
            const s = respData.trim();
            if (!s) return true;
            if (/^\s*<(?:!doctype|html|head|body)/i.test(s)) return true;
            return false;
        }
        return false;
    }
    return false;
}

// ============ 三个对外函数 ============

async function fetchGoQR(apiBase: string): Promise<GoFetchQRResult> {
    const base = normalizeApiBase(apiBase);
    if (!base) {
        return { ok: false, error: 'Go 服务地址未配置' };
    }
    const cache = getPathCache(base);

    // 1) 若已有缓存路径,先尝试缓存
    const candidates = cache.qrPath
        ? [cache.qrPath, ...QR_PATH_CANDIDATES.filter(p => p !== cache.qrPath)]
        : QR_PATH_CANDIDATES;

    const triedUrls: string[] = [];
    let lastErr = '';
    let lastBadEnvelope: { url: string, status: number, body: any } | null = null;

    for (const path of candidates) {
        const url = buildUrl(base, path);
        triedUrls.push(url);
        try {
            const response = await axios.post(
                url,
                {},
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: DEFAULT_TIMEOUT_MS,
                    validateStatus: () => true,
                    // 让 axios 不要把 HTML 错误页当 JSON 解析
                    transformResponse: [(data: any) => {
                        if (typeof data !== 'string') return data;
                        const s = data.trim();
                        if (!s) return '';
                        if (s.startsWith('{') || s.startsWith('[')) {
                            try { return JSON.parse(s); } catch { return s; }
                        }
                        return s;
                    }],
                },
            );
            const status = response.status;
            const data = response.data;
            if (isPathNotFound(status, data)) {
                // 该路径不存在,继续尝试下一个
                continue;
            }
            if (status >= 400) {
                lastErr = `HTTP ${status} @ ${url} - ${truncate(typeof data === 'string' ? data : JSON.stringify(data), ERR_BODY_PREVIEW_LEN)}`;
                continue;
            }
            const env = parseEnvelope(data);
            if (!env.hasEnvelope) {
                // 200 但不是可识别信封,记录后继续尝试
                lastBadEnvelope = { url, status, body: data };
                continue;
            }
            // 命中可识别信封 —— 缓存该路径
            cache.qrPath = path;
            if (!env.success) {
                return { ok: false, error: env.message || extractErrorMessage(data, '获取二维码失败') };
            }
            const uuid = String(pickFirst(env.data, ['Uuid', 'uuid', 'UUID']) || '').trim();
            const qrBase64 = String(pickFirst(env.data, ['QrBase64', 'qrBase64', 'QrCode', 'qrCode', 'Base64', 'base64', 'Image', 'image', 'QrUrl', 'qrUrl']) || '').trim();
            if (!uuid) {
                return { ok: false, error: `Go 服务返回的 Uuid 为空 @ ${url}` };
            }
            return { ok: true, uuid, qrBase64 };
        } catch (e: any) {
            lastErr = describeAxiosError(e, url);
            // 网络错误也可能是路径无关的(比如 DNS),但仍然继续尝试下一个候选
            continue;
        }
    }

    // 全部候选均失败
    if (lastBadEnvelope) {
        const body = typeof lastBadEnvelope.body === 'string'
            ? lastBadEnvelope.body
            : (() => { try { return JSON.stringify(lastBadEnvelope.body); } catch { return String(lastBadEnvelope.body); } })();
        return {
            ok: false,
            error: `Go 服务返回了无法识别的响应(HTTP ${lastBadEnvelope.status} @ ${lastBadEnvelope.url}): ${truncate(body, ERR_BODY_PREVIEW_LEN)}`,
        };
    }
    return {
        ok: false,
        error: lastErr || `获取二维码失败,已尝试 ${triedUrls.length} 个候选路径均无效`,
    };
}

async function checkGoStatus(apiBase: string, uuid: string): Promise<GoCheckStatusResult> {
    const base = normalizeApiBase(apiBase);
    if (!base) {
        return { ok: false, error: 'Go 服务地址未配置' };
    }
    if (!uuid) {
        return { ok: false, error: '缺少 uuid' };
    }
    const cache = getPathCache(base);

    const candidates = cache.checkTemplate
        ? [cache.checkTemplate, ...CHECK_PATH_TEMPLATES.filter(p => p !== cache.checkTemplate)]
        : CHECK_PATH_TEMPLATES;

    const triedUrls: string[] = [];
    let lastErr = '';
    let lastBadEnvelope: { url: string, status: number, body: any } | null = null;

    for (const tpl of candidates) {
        const path = tpl.replace('{uuid}', encodeURIComponent(uuid));
        const url = buildUrl(base, path);
        triedUrls.push(url);
        try {
            const response = await axios.post(
                url,
                {},
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: DEFAULT_TIMEOUT_MS,
                    validateStatus: () => true,
                    transformResponse: [(data: any) => {
                        if (typeof data !== 'string') return data;
                        const s = data.trim();
                        if (!s) return '';
                        if (s.startsWith('{') || s.startsWith('[')) {
                            try { return JSON.parse(s); } catch { return s; }
                        }
                        return s;
                    }],
                },
            );
            const status = response.status;
            const data = response.data;
            if (isPathNotFound(status, data)) continue;
            if (status >= 400) {
                lastErr = `HTTP ${status} @ ${url} - ${truncate(typeof data === 'string' ? data : JSON.stringify(data), ERR_BODY_PREVIEW_LEN)}`;
                continue;
            }
            const env = parseEnvelope(data);
            if (!env.hasEnvelope) {
                lastBadEnvelope = { url, status, body: data };
                continue;
            }
            cache.checkTemplate = tpl;
            if (!env.success) {
                return { ok: false, error: env.message || extractErrorMessage(data, '检查扫码状态失败') };
            }
            // 提取 wxid / nickname —— 兼容扁平结构与旧嵌套 acctSectResp
            const acctResp = pickFirst(env.data, ['acctSectResp', 'AcctSectResp', 'AcctSect']) || {};
            const wxid = String(
                pickFirst(env.data, ['WxId', 'Wxid', 'wxid', 'WxID', 'UserName', 'userName', 'username', 'Uid', 'uid'])
                || pickFirst(acctResp, ['userName', 'UserName', 'wxid', 'WxId', 'Wxid'])
                || ''
            ).trim();
            const nickname = String(
                pickFirst(env.data, ['NickName', 'nickName', 'nickname', 'Nick'])
                || pickFirst(acctResp, ['nickName', 'NickName', 'nickname', 'Nick'])
                || ''
            ).trim() || '微信用户';
            const stateRaw = pickFirst(env.data, ['State', 'state', 'Status', 'status', 'qrStatus', 'QrStatus']);
            const stateNum = Number(stateRaw);

            if (wxid) {
                return { ok: true, qrStatus: 2, wxid, nickname };
            }
            // 未拿到 wxid,根据 state 推断:1 = 已扫码待确认,0 = 等待扫码
            let qrStatus = 0;
            if (Number.isFinite(stateNum)) {
                qrStatus = stateNum === 1 ? 1 : 0;
            }
            return { ok: true, qrStatus };
        } catch (e: any) {
            lastErr = describeAxiosError(e, url);
            continue;
        }
    }

    if (lastBadEnvelope) {
        const body = typeof lastBadEnvelope.body === 'string'
            ? lastBadEnvelope.body
            : (() => { try { return JSON.stringify(lastBadEnvelope.body); } catch { return String(lastBadEnvelope.body); } })();
        return {
            ok: false,
            error: `Go 服务返回了无法识别的响应(HTTP ${lastBadEnvelope.status} @ ${lastBadEnvelope.url}): ${truncate(body, ERR_BODY_PREVIEW_LEN)}`,
        };
    }
    return {
        ok: false,
        error: lastErr || `检查扫码状态失败,已尝试 ${triedUrls.length} 个候选路径均无效`,
    };
}

async function fetchGoCode(apiBase: string, appId: string, wxid: string): Promise<GoFetchCodeResult> {
    const base = normalizeApiBase(apiBase);
    if (!base) {
        return { ok: false, error: 'Go 服务地址未配置' };
    }
    if (!appId) {
        return { ok: false, error: 'AppID 未配置' };
    }
    if (!wxid) {
        return { ok: false, error: '缺少 wxid' };
    }
    const cache = getPathCache(base);

    const candidates = cache.jsLoginPath
        ? [cache.jsLoginPath, ...JSLOGIN_PATH_CANDIDATES.filter(p => p !== cache.jsLoginPath)]
        : JSLOGIN_PATH_CANDIDATES;

    // 同时发送 PascalCase 与 lowercase 字段,兼容不同 Go 服务
    const body = {
        Wxid: wxid,
        Appid: appId,
        AppID: appId,
        wxid,
        appId,
        appid: appId,
    };

    const triedUrls: string[] = [];
    let lastErr = '';
    let lastBadEnvelope: { url: string, status: number, body: any } | null = null;

    for (const path of candidates) {
        const url = buildUrl(base, path);
        triedUrls.push(url);
        try {
            const response = await axios.post(
                url,
                body,
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: DEFAULT_TIMEOUT_MS,
                    validateStatus: () => true,
                    transformResponse: [(data: any) => {
                        if (typeof data !== 'string') return data;
                        const s = data.trim();
                        if (!s) return '';
                        if (s.startsWith('{') || s.startsWith('[')) {
                            try { return JSON.parse(s); } catch { return s; }
                        }
                        return s;
                    }],
                },
            );
            const status = response.status;
            const data = response.data;
            if (isPathNotFound(status, data)) continue;
            if (status >= 400) {
                lastErr = `HTTP ${status} @ ${url} - ${truncate(typeof data === 'string' ? data : JSON.stringify(data), ERR_BODY_PREVIEW_LEN)}`;
                continue;
            }
            const env = parseEnvelope(data);
            if (!env.hasEnvelope) {
                lastBadEnvelope = { url, status, body: data };
                continue;
            }
            cache.jsLoginPath = path;
            if (!env.success) {
                // 失败信封 —— 尝试从 Data 里挖更具体的错误(如 jsapiBaseresponse.errmsg)
                const jsapiErr = pickFirst(env.data, ['jsapiBaseresponse', 'JsapiBaseResponse', 'JsapiBaseresponse']);
                const specific = pickFirst(jsapiErr || {}, ['errmsg', 'ErrMsg', 'errMsg', 'ret', 'Ret']) || env.message;
                return { ok: false, error: String(specific || extractErrorMessage(data, '获取 Code 失败')) };
            }
            const code = String(
                pickFirst(env.data, ['Code', 'code', 'JsCode', 'jsCode', 'JsapiCode', 'jsapiCode', 'AuthCode', 'authCode'])
                || ''
            ).trim();
            if (!code) {
                return { ok: false, error: `Go 服务返回的 Code 为空 @ ${url}` };
            }
            return { ok: true, code };
        } catch (e: any) {
            lastErr = describeAxiosError(e, url);
            continue;
        }
    }

    if (lastBadEnvelope) {
        const body = typeof lastBadEnvelope.body === 'string'
            ? lastBadEnvelope.body
            : (() => { try { return JSON.stringify(lastBadEnvelope.body); } catch { return String(lastBadEnvelope.body); } })();
        return {
            ok: false,
            error: `Go 服务返回了无法识别的响应(HTTP ${lastBadEnvelope.status} @ ${lastBadEnvelope.url}): ${truncate(body, ERR_BODY_PREVIEW_LEN)}`,
        };
    }
    return {
        ok: false,
        error: lastErr || `获取 Code 失败,已尝试 ${triedUrls.length} 个候选路径均无效`,
    };
}

/** 清除指定 apiBase 的路径缓存(用于配置变更或排障) */
function clearPathCache(apiBase?: string): void {
    if (!apiBase) {
        pathCache.clear();
        return;
    }
    pathCache.delete(normalizeApiBase(apiBase));
}

module.exports = {
    fetchGoQR,
    checkGoStatus,
    fetchGoCode,
    clearPathCache,
};
