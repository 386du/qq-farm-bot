export {};
/**
 * 推送接口封装（基于 pushoo）
 */

const pushoo = require('pushoo').default;

function assertRequiredText(name: string, value: any): string {
    const text: string = String(value || '').trim();
    if (!text) {
        throw new Error(`${name} 不能为空`);
    }
    return text;
}

/**
 * 规范化 webhook URL: 解决 Node http.request 抛 "Request path contains unescaped characters" 的问题
 *  - 用 new URL() 解析后重写, 自动 percent-encode 中文、空格、`{` `}` `[` `]` 等
 *  - 保留协议、host、port、query 结构
 *  - 输入不是合法 URL 时抛错
 *  - 先 decode 再 encode, 避免重复编码
 */
function normalizeWebhookUrl(rawUrl: string): string {
    const url = String(rawUrl || '').trim();
    if (!url) {
        throw new Error('endpoint 不能为空');
    }
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        throw new Error(`endpoint 不是合法 URL: ${url}`);
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error(`endpoint 协议必须是 http(s): ${url}`);
    }
    // 对 path 中的每一段先 decode 再 encode, 解决 [brackets]/pipe 等
    // new URL() 没自动编码的特殊字符, 同时避免重复编码
    const segments = u.pathname.split('/');
    const safeSegments = segments.map((seg) => {
        if (!seg) return seg;
        try {
            const decoded = decodeURIComponent(seg);
            return encodeURIComponent(decoded);
        } catch {
            return encodeURIComponent(seg);
        }
    });
    u.pathname = safeSegments.join('/');
    return u.toString();
}

/**
 * 发送推送
 * @param payload
 * @param payload.channel 必填 推送渠道（pushoo 平台名，如 webhook）
 * @param payload.endpoint webhook 接口地址（channel=webhook 时使用）
 * @param payload.token 必填 推送 token
 * @param payload.title 必填 推送标题
 * @param payload.content 必填 推送内容
 * @returns 推送结果
 */
async function sendPushooMessage(payload: any = {}): Promise<{ ok: boolean; code: string; msg: string; raw: any }> {
    const channel: string = assertRequiredText('channel', payload.channel);
    const endpoint: string = String(payload.endpoint || '').trim();
    const rawToken: string = String(payload.token || '').trim();
    const token: string = channel === 'webhook' ? rawToken : assertRequiredText('token', rawToken);
    const title: string = assertRequiredText('title', payload.title);
    const content: string = assertRequiredText('content', payload.content);

    const options: any = {};
    if (channel === 'webhook') {
        const url: string = normalizeWebhookUrl(assertRequiredText('endpoint', endpoint));
        options.webhook = { url, method: 'POST' };
    }

    const request: any = { title, content };
    if (token) request.token = token;
    if (channel === 'webhook') request.options = options;

    let result: any;
    try {
        result = await pushoo(channel, request);
    } catch (pushErr: any) {
        // 推送过程中抛错(如 URL 解析失败、网络错误), 转成统一返回结构
        return {
            ok: false,
            code: 'exception',
            msg: pushErr && pushErr.message ? String(pushErr.message) : String(pushErr),
            raw: { error: pushErr },
        };
    }

    const raw: any = (result && typeof result === 'object') ? result : { data: result };
    const hasError: boolean = !!(raw && raw.error);
    const code: string = String(raw.code || raw.errcode || (hasError ? 'error' : 'ok'));
    const message: string = String(raw.msg || raw.message || (hasError ? (raw.error.message || 'push failed') : 'ok'));
    const ok: boolean = !hasError && (code === 'ok' || code === '0' || code === '' || String(raw.status || '').toLowerCase() === 'success');

    return {
        ok,
        code,
        msg: message,
        raw,
    };
}

module.exports = {
    sendPushooMessage,
};
