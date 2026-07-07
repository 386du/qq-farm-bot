export {};
/**
 * 应用宝一键登录服务 - 通过外部 API 根据 OpenID 获取 QQ 农场登录 Code
 */
const axios = require('axios');

export interface YybFetchCodeOptions {
    endpoint: string;
    apiToken: string;
    openid: string;
}

export interface YybFetchCodeResult {
    ok: boolean;
    code?: string;
    error?: string;
}

async function fetchFarmCode(options: YybFetchCodeOptions): Promise<YybFetchCodeResult> {
    const endpoint = String(options.endpoint || '').trim();
    const apiToken = String(options.apiToken || '').trim();
    const openid = String(options.openid || '').trim();

    if (!endpoint) {
        return { ok: false, error: '接口地址不能为空' };
    }
    if (!apiToken) {
        return { ok: false, error: 'API Token 不能为空' };
    }
    if (!openid) {
        return { ok: false, error: 'OpenID 不能为空' };
    }

    try {
        const response = await axios.post(
            endpoint,
            { openid },
            {
                headers: {
                    'Authorization': `Bearer ${apiToken}`,
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
                validateStatus: () => true,
            },
        );

        const data = response.data;
        if (data && data.code) {
            return { ok: true, code: String(data.code) };
        }
        if (data && data.ok === false && data.error) {
            return { ok: false, error: String(data.error) };
        }
        if (data && data.message) {
            return { ok: false, error: String(data.message) };
        }
        if (data && data.msg) {
            return { ok: false, error: String(data.msg) };
        }
        return { ok: false, error: `获取 Code 失败: ${JSON.stringify(data)}` };
    } catch (e: any) {
        return { ok: false, error: `请求失败: ${e.message}` };
    }
}

module.exports = {
    fetchFarmCode,
};
