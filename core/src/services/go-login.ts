export {};
/**
 * Go 扫码登录服务
 * 调用独立的 Go 服务(用户/管理员在「Go 服务配置」中配置 apiBase)
 * 实现:获取二维码 / 检查扫码状态 / 拉取登录 Code
 *
 * 接口路径与原 WeChat 本地 API 保持一致:
 *   POST {apiBase}/Login/LoginGetQRCar       -> { Success, Data: { Uuid, QrBase64 } }
 *   POST {apiBase}/Login/LoginCheckQR?uuid=  -> { Success, Data: { status, acctSectResp{userName,nickName} } }
 *   POST {apiBase}/Wxapp/JSLogin             -> { Success, Data: { code } }
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
    // 0 = 等待扫码, 1 = 已扫码待确认, 2 = 登录成功(同时有 userName)
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

function normalizeApiBase(apiBase: string): string {
    return String(apiBase || '').trim().replace(/\/+$/, '');
}

async function fetchGoQR(apiBase: string): Promise<GoFetchQRResult> {
    const base = normalizeApiBase(apiBase);
    if (!base) {
        return { ok: false, error: 'Go 服务地址未配置' };
    }
    try {
        const response = await axios.post(
            `${base}/Login/LoginGetQRCar`,
            {},
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000,
                validateStatus: () => true,
            },
        );
        const data = response.data || {};
        if (data.Success && data.Data) {
            const uuid = String(data.Data.Uuid || '').trim();
            const qrBase64 = String(data.Data.QrBase64 || data.Data.qrBase64 || '');
            if (!uuid) {
                return { ok: false, error: 'Go 服务返回的 Uuid 为空' };
            }
            return { ok: true, uuid, qrBase64 };
        }
        return { ok: false, error: data.Message || data.message || data.msg || '获取二维码失败' };
    } catch (e: any) {
        return { ok: false, error: `请求 Go 服务失败: ${e.message}` };
    }
}

async function checkGoStatus(apiBase: string, uuid: string): Promise<GoCheckStatusResult> {
    const base = normalizeApiBase(apiBase);
    if (!base) {
        return { ok: false, error: 'Go 服务地址未配置' };
    }
    if (!uuid) {
        return { ok: false, error: '缺少 uuid' };
    }
    try {
        const response = await axios.post(
            `${base}/Login/LoginCheckQR?uuid=${encodeURIComponent(uuid)}`,
            {},
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000,
                validateStatus: () => true,
            },
        );
        const data = response.data || {};
        if (!data.Success) {
            return { ok: false, error: data.Message || data.message || data.msg || '检查扫码状态失败' };
        }
        const acctResp = data.Data?.acctSectResp || data.Data?.AcctSectResp;
        const userName = acctResp?.userName || acctResp?.UserName;
        const nickName = acctResp?.nickName || acctResp?.NickName;
        const qrStatus = data.Data?.status;
        if (userName) {
            return {
                ok: true,
                qrStatus: 2,
                wxid: String(userName),
                nickname: nickName ? String(nickName) : '微信用户',
            };
        }
        return {
            ok: true,
            qrStatus: typeof qrStatus === 'number' ? qrStatus : 0,
        };
    } catch (e: any) {
        return { ok: false, error: `请求 Go 服务失败: ${e.message}` };
    }
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
    try {
        const response = await axios.post(
            `${base}/Wxapp/JSLogin`,
            { Wxid: wxid, Appid: appId },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000,
                validateStatus: () => true,
            },
        );
        const data = response.data || {};
        if (data.Success && data.Data && data.Data.code) {
            return { ok: true, code: String(data.Data.code) };
        }
        const errMsg = data.Data?.jsapiBaseresponse?.errmsg
            || data.Message
            || data.message
            || data.msg
            || '获取 Code 失败';
        return { ok: false, error: String(errMsg) };
    } catch (e: any) {
        return { ok: false, error: `请求 Go 服务失败: ${e.message}` };
    }
}

module.exports = {
    fetchGoQR,
    checkGoStatus,
    fetchGoCode,
};
