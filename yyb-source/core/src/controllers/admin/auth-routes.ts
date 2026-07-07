import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * Auth-related routes: login, register, login-logs, card info, user renew,
 * change-password, auth gate, utility routes, user/me, QR.
 */

const fetch = require('node-fetch');
const { version } = require('../../../package.json');
const { getRuntimeConfig } = require('../../config/config');
const { getSchedulerRegistrySnapshot } = require('../../services/scheduler');
const { createModuleLogger } = require('../../services/logger');
const { MiniProgramLoginSession } = require('../../services/qrlogin');
const { fetchFarmCode } = require('../../services/yyb-login');
const { fetchGoQR, checkGoStatus, fetchGoCode } = require('../../services/go-login');
const store = require('../../models/store');
const userStore = require('../../models/user-store');
const tokenStore = require('../../models/user-store/token-store');
const auditLog = require('../../models/audit-log');
const ipBlacklist = require('../../models/ip-blacklist');
const auth = require('../../models/user-store/auth');

const {
    getClientIp,
    issueToken,
    createAuthRequired,
    createCheckUserAccess,
    adminRequired,
    requirePermission,
    getAccId,
    checkAccountAccess,
    handleApiError,
} = require('./middleware');
const { getRoles, getRolePermissions } = require('./permissions');

const adminLogger = createModuleLogger('admin');

function mountAuthRoutes(app: Application, ctx: AdminContext): void {
    const authRequired = createAuthRequired(ctx);
    const checkUserAccess = createCheckUserAccess(ctx);

    function audit(event: string, req: Request, details?: Record<string, any>): void {
        const username = (req as any).currentUser?.username || 'unknown';
        auditLog.log(event, username, getClientIp(req), details);
    }

    // 登录与鉴权
    app.post('/api/login', (req: Request, res: Response) => {
        const { username, password } = req.body || {};
        const clientIp = getClientIp(req);
        const userAgent = req.headers['user-agent'] || 'unknown';

        if (username && password) {
            const user = userStore.validateUser(username, password, clientIp);

            if (user && user.error) {
                const statusCode = user.error === 'rate_limit' ? 429 :
                                   user.error === 'locked' ? 423 : 401;

                adminLogger.warn('登录失败', {
                    username,
                    error: user.error,
                    ip: clientIp,
                    message: user.message
                });

                userStore.addLoginLog({
                    event: 'login_failed',
                    username,
                    errorType: user.error,
                    ip: clientIp,
                    userAgent
                });

                auditLog.log('login_failed', username, clientIp, {
                    errorType: user.error,
                    message: user.message,
                    userAgent,
                });
                ipBlacklist.recordFailedLogin(clientIp);

                return res.status(statusCode).json({
                    ok: false,
                    error: user.message,
                    errorType: user.error,
                    remainingMs: user.remainingMs
                });
            }

            if (!user) {
                adminLogger.warn('登录失败', { username, ip: clientIp, reason: 'invalid_credentials' });

                userStore.addLoginLog({
                    event: 'login_failed',
                    username,
                    errorType: 'invalid_credentials',
                    ip: clientIp,
                    userAgent
                });

                auditLog.log('login_failed', username, clientIp, {
                    errorType: 'invalid_credentials',
                    userAgent,
                });
                ipBlacklist.recordFailedLogin(clientIp);

                return res.status(401).json({ ok: false, error: '用户名或密码错误' });
            }

            adminLogger.info('登录检查', { username, role: user.role, cardInfo: user.card ? 'exists' : 'none' });

            if (user.role !== 'admin') {
                if (user.card && user.card.enabled === false) {
                    adminLogger.warn('登录拒绝', { username, reason: 'banned' });
                    auditLog.log('login_failed', username, clientIp, {
                        errorType: 'banned',
                        reason: '账号已被封禁',
                        userAgent,
                    });
                    return res.status(403).json({ ok: false, error: '账号已被封禁，请联系管理员' });
                }

                if (user.card && user.card.expiresAt) {
                    const now = Date.now();
                    if (user.card.expiresAt < now) {
                        adminLogger.warn('登录拒绝', { username, reason: 'expired' });
                        auditLog.log('login_failed', username, clientIp, {
                            errorType: 'expired',
                            reason: '账号已过期',
                            userAgent,
                        });
                        return res.status(403).json({ ok: false, error: '账号已过期，请续费后重新登录' });
                    }
                }
            }

            const tokenUser = { ...user, ip: clientIp, userAgent };
            const entry = tokenStore.addToken(tokenUser);
            const token = entry.token;
            ctx.tokens.add(token);
            ctx.tokenUserMap.set(token, tokenUser);

            adminLogger.info('登录成功', { username, role: user.role, ip: clientIp });

            userStore.addLoginLog({
                event: 'login_success',
                username,
                errorType: null,
                ip: clientIp,
                userAgent
            });

            auditLog.log('login_success', username, clientIp, {
                role: user.role,
                userAgent,
            });
            ipBlacklist.clearFailedAttempts(clientIp);

            return res.json({
                ok: true,
                data: {
                    token,
                    expiresAt: entry.expiresAt,
                    role: user.role,
                    card: user.card,
                    accountLimit: user.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2,
                    user: {
                        username: user.username,
                        nickname: user.nickname || '',
                        avatar: user.avatar || ''
                    },
                    nickname: user.nickname || '',
                    avatar: user.avatar || '',
                    mustChangePassword: user.mustChangePassword || false
                }
            });
        }

        return res.status(401).json({ ok: false, error: '请输入用户名和密码' });
    });

    // 注册接口
    app.post('/api/register', (req: Request, res: Response) => {
        const { username, password, cardCode, inviteCode } = req.body || {};
        if (!username || !password || !cardCode) {
            return res.status(400).json({ ok: false, error: '请填写完整信息' });
        }
        const result = userStore.registerUser(username, password, cardCode, inviteCode);
        if (!result.ok) {
            return res.status(400).json(result);
        }
        res.json({ ok: true, data: result.user, inviteError: result.inviteError });
    });

    // 获取登录日志
    app.get('/api/admin/login-logs', authRequired, requirePermission('log:read'), (req: Request, res: Response) => {
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit as string) || 100, 1), 500);
        const offset = Math.max(Number.parseInt(req.query.offset as string) || 0, 0);

        const result = userStore.getLoginLogs(limit, offset);
        res.json({ ok: true, data: result });
    });

    // 清空登录日志
    app.delete('/api/admin/login-logs', authRequired, requirePermission('system:*'), (req: Request, res: Response) => {
        const result = userStore.clearLoginLogs();
        adminLogger.info('登录日志已清空', { admin: (req as any).currentUser.username });
        res.json(result);
    });

    // 查询卡密信息接口（用于续费前预览）
    app.get('/api/card/info/:code', (req: Request, res: Response) => {
        try {
            const { code } = req.params;
            const cards = userStore.getAllCards();
            const card = cards.find((c: any) => c.code === code);

            if (!card) {
                return res.status(404).json({ ok: false, error: '卡密不存在' });
            }

            if (!card.enabled) {
                return res.status(400).json({ ok: false, error: '卡密已被禁用' });
            }

            if (card.usedBy) {
                return res.status(400).json({ ok: false, error: '卡密已被使用' });
            }

            res.json({
                ok: true,
                data: {
                    type: card.type || 'time',
                    days: card.days,
                    description: card.description
                }
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 用户续费接口
    app.post('/api/user/renew', checkUserAccess, (req: Request, res: Response) => {
        const { cardCode } = req.body || {};
        const username = (req as any).currentUser?.username;

        if (!username) {
            return res.status(401).json({ ok: false, error: '未登录' });
        }

        if (!cardCode) {
            return res.status(400).json({ ok: false, error: '请提供卡密' });
        }

        const result = userStore.renewUser(username, cardCode);
        if (!result.ok) {
            return res.status(400).json(result);
        }

        auditLog.log('user_renewed', username, getClientIp(req), {
            cardCode,
            cardType: result.cardType,
        });

        // 更新 token 中的用户信息
        for (const [token, user] of ctx.tokenUserMap.entries()) {
            if (user.username === username) {
                user.card = result.card;
                user.accountLimit = result.accountLimit;
                ctx.tokenUserMap.set(token, user);
                tokenStore.updateTokenUser(token, user);
                break;
            }
        }

        res.json({ ok: true, data: { card: result.card, accountLimit: result.accountLimit, cardType: result.cardType } });
    });

    // 公开账号续费接口（登录页使用，无需登录）
    app.post('/api/user/renew-public', (req: Request, res: Response) => {
        const { username, cardCode } = req.body || {};
        const clientIp = getClientIp(req);

        if (!username || !cardCode) {
            return res.status(400).json({ ok: false, error: '请填写用户名和卡密' });
        }

        auth.loadLoginAttempts();
        const rateLimitResult = auth.checkRateLimit(clientIp);
        if (!rateLimitResult.allowed) {
            return res.status(429).json({
                ok: false,
                error: rateLimitResult.message || '请求过于频繁，请稍后重试',
                errorType: 'rate_limit',
                remainingMs: rateLimitResult.remainingMs
            });
        }

        const result = userStore.renewUser(username, cardCode);
        if (!result.ok) {
            return res.status(400).json(result);
        }

        adminLogger.info('账号续费成功', { username, ip: clientIp, cardType: result.cardType });
        auditLog.log('user_renewed_public', username, clientIp, {
            cardCode,
            cardType: result.cardType,
        });

        res.json({ ok: true, data: { card: result.card, accountLimit: result.accountLimit, cardType: result.cardType } });
    });

    // 修改密码接口
    app.post('/api/user/change-password', checkUserAccess, (req: Request, res: Response) => {
        const { oldPassword, newPassword } = req.body || {};
        const username = (req as any).currentUser?.username;

        if (!username) {
            return res.status(401).json({ ok: false, error: '未登录' });
        }

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ ok: false, error: '请提供原密码和新密码' });
        }

        const result = userStore.changePassword(username, oldPassword, newPassword);
        if (result.ok) {
            auditLog.log('password_changed', username, getClientIp(req));
        }
        res.json(result);
    });

    // 忘记密码：通过卡密重置密码
    app.post('/api/user/reset-password', (req: Request, res: Response) => {
        const { username, cardCode, newPassword } = req.body || {};

        if (!username || !cardCode || !newPassword) {
            return res.status(400).json({ ok: false, error: '请填写完整信息' });
        }

        const result = userStore.resetPasswordByCard(username, cardCode, newPassword);
        if (!result.ok) {
            return res.status(400).json(result);
        }

        adminLogger.info('密码重置成功', { username, ip: getClientIp(req) });
        auditLog.log('password_reset', username, getClientIp(req));
        res.json(result);
    });

    app.use('/api', (req: Request, res: Response, next: any) => {
        if (req.path === '/login' || req.path === '/qr/create' || req.path === '/qr/check' || req.path === '/card-claim/status' || req.path === '/card-claim/claim' || req.path === '/game-version' || req.path === '/user/renew-public') return next();
        return authRequired(req, res, next);
    });

    // 管理员密码修改已移除，统一使用 /api/user/change-password 接口

    app.get('/api/ping', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version } });
    });

    app.get('/api/game-version', (_req: Request, res: Response) => {
        const runtimeConfig = getRuntimeConfig();
        res.json({ ok: true, clientVersion: runtimeConfig.clientVersion });
    });

    app.get('/api/auth/validate', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { valid: true } });
    });

    // API: 调度任务快照（用于调度收敛排查）
    app.get('/api/scheduler', async (req: Request, res: Response) => {
        try {
            const id = getAccId(ctx, req);

            // 检查权限（如果指定了账号ID）
            if (id && !checkAccountAccess(ctx, req as any, id)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            if (ctx.provider && typeof ctx.provider.getSchedulerStatus === 'function') {
                const data = await ctx.provider.getSchedulerStatus(id);
                return res.json({ ok: true, data });
            }
            return res.json({ ok: true, data: { runtime: getSchedulerRegistrySnapshot(), worker: null, workerError: 'DataProvider does not support scheduler status' } });
        } catch (e: any) {
            return handleApiError(res, e);
        }
    });

    app.post('/api/logout', (req: Request, res: Response) => {
        const token = (req as any).adminToken;
        if (token) {
            ctx.tokens.delete(token);
            ctx.tokenUserMap.delete(token);
            tokenStore.removeToken(token);
            if (ctx.io) {
                for (const socket of ctx.io.sockets.sockets.values()) {
                    if (String((socket.data as any).adminToken || '') === String(token)) {
                        socket.disconnect(true);
                    }
                }
            }
        }
        res.json({ ok: true });
    });

    // 获取当前登录用户信息
    app.get('/api/user/me', authRequired, (req: Request, res: Response) => {
        try {
            const user = (req as any).currentUser;
            if (!user) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }
            res.json({
                ok: true,
                data: {
                    username: user.username,
                    nickname: user.nickname || '',
                    avatar: user.avatar || '',
                    role: user.role,
                    card: user.card,
                    accountLimit: user.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2
                }
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 修改自己的昵称/头像（不影响登录用户名）
    app.put('/api/user/profile', authRequired, (req: Request, res: Response) => {
        try {
            const username = (req as any).currentUser?.username;
            if (!username) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const updates: { nickname?: string | null, avatar?: string | null } = {};
            if (Object.prototype.hasOwnProperty.call(body, 'nickname')) {
                updates.nickname = body.nickname == null ? '' : String(body.nickname);
            }
            if (Object.prototype.hasOwnProperty.call(body, 'avatar')) {
                updates.avatar = body.avatar == null ? '' : String(body.avatar);
            }
            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ ok: false, error: '请提供要修改的字段' });
            }
            const result = userStore.updateUserProfile(username, updates);
            if (!result.ok) {
                return res.status(400).json(result);
            }
            // 同步更新内存中的当前用户与所有同账号 token
            const currentUser = (req as any).currentUser;
            if (currentUser) {
                currentUser.nickname = result.user?.nickname || '';
                currentUser.avatar = result.user?.avatar || '';
            }
            for (const [token, u] of ctx.tokenUserMap.entries()) {
                if (u.username === username) {
                    u.nickname = result.user?.nickname || '';
                    u.avatar = result.user?.avatar || '';
                    ctx.tokenUserMap.set(token, u);
                    tokenStore.updateTokenUser(token, u);
                }
            }
            auditLog.log('user_profile_updated', username, getClientIp(req), {
                hasNickname: updates.nickname !== undefined,
                hasAvatar: updates.avatar !== undefined,
            });
            res.json({ ok: true, data: result.user });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ QR Code Login APIs (无需账号选择) ============
    // 这些接口不需要 authRequired 也能调用（用于登录流程）
    app.post('/api/qr/create', async (_req: Request, res: Response) => {
        try {
            const result = await MiniProgramLoginSession.requestLoginCode();
            res.json({ ok: true, data: result });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/qr/check', async (req: Request, res: Response) => {
        const { code } = req.body || {};
        if (!code) {
            return res.status(400).json({ ok: false, error: 'Missing code' });
        }

        try {
            const result = await MiniProgramLoginSession.queryStatus(code);

            if (result.status === 'OK') {
                const ticket = result.ticket;
                const uin = result.uin || '';
                const nickname = result.nickname || ''; // 获取昵称
                const appid = '1112386029'; // Farm appid

                const authCode = await MiniProgramLoginSession.getAuthCode(ticket, appid);

                let avatar = '';
                if (uin) {
                    avatar = `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640`;
                }

                res.json({ ok: true, data: { status: 'OK', code: authCode, uin, avatar, nickname } });
            } else if (result.status === 'Used') {
                res.json({ ok: true, data: { status: 'Used' } });
            } else if (result.status === 'Wait') {
                res.json({ ok: true, data: { status: 'Wait' } });
            } else {
                res.json({ ok: true, data: { status: 'Error', error: result.msg } });
            }
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 应用宝一键登录配置 ============
    app.get('/api/user/yyb-config', authRequired, (req: Request, res: Response) => {
        try {
            const username = (req as any).currentUser?.username;
            const cfg = store.getYybConfig ? store.getYybConfig(username) : null;
            res.json({ ok: true, config: cfg || {} });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/user/yyb-config', authRequired, (req: Request, res: Response) => {
        try {
            const username = (req as any).currentUser?.username;
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const cfg = store.setYybConfig
                ? store.setYybConfig(body, username)
                : {};
            res.json({ ok: true, config: cfg || {} });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/yyb/code', authRequired, async (req: Request, res: Response) => {
        try {
            const username = (req as any).currentUser?.username;
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const openid = String(body.openid || '').trim();
            if (!openid) {
                return res.status(400).json({ ok: false, error: '缺少 openid' });
            }

            const cfg = store.getYybConfig ? store.getYybConfig(username) : null;
            if (!cfg || !cfg.enabled) {
                return res.status(400).json({ ok: false, error: '应用宝配置未启用' });
            }
            if (!cfg.endpoint) {
                return res.status(400).json({ ok: false, error: '未配置接口地址' });
            }
            // 优先从 accounts[].apiToken 读取;旧数据兼容 (openIds + 顶层 apiToken)
            let apiToken = '';
            if (Array.isArray(cfg.accounts)) {
                const entry = cfg.accounts.find((a: any) => a && String(a.openid || '').trim() === openid);
                if (entry && entry.apiToken) apiToken = String(entry.apiToken).trim();
            }
            // 旧数据兜底:从 (cfg as any).openIds + (cfg as any).apiToken 推导
            if (!apiToken && (cfg as any).apiToken) {
                const legacyOpenIds = Array.isArray((cfg as any).openIds) ? (cfg as any).openIds : [];
                if (legacyOpenIds.map((x: any) => String(x).trim()).includes(openid)) {
                    apiToken = String((cfg as any).apiToken).trim();
                }
            }
            if (!apiToken) {
                return res.status(400).json({ ok: false, error: `OpenID ${openid} 未配置 Token,请在应用宝配置中补充` });
            }

            const result = await fetchFarmCode({
                endpoint: cfg.endpoint,
                apiToken,
                openid,
            });

            if (result.ok && result.code) {
                return res.json({ ok: true, code: result.code });
            }
            return res.status(400).json({ ok: false, error: result.error || '获取 Code 失败' });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ Go 扫码登录配置 ============
    app.get('/api/user/go-config', authRequired, (req: Request, res: Response) => {
        try {
            const username = (req as any).currentUser?.username;
            const cfg = store.getGoConfig ? store.getGoConfig(username) : null;
            res.json({ ok: true, config: cfg || {} });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/user/go-config', authRequired, (req: Request, res: Response) => {
        try {
            const username = (req as any).currentUser?.username;
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const cfg = store.setGoConfig
                ? store.setGoConfig(body, username)
                : {};
            res.json({ ok: true, config: cfg || {} });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ Go 扫码：获取二维码 ============
    app.post('/api/go/qrcode', authRequired, async (req: Request, res: Response) => {
        try {
            const username = (req as any).currentUser?.username;
            const cfg = store.getGoConfig ? store.getGoConfig(username) : null;
            if (!cfg || !cfg.enabled) {
                return res.status(400).json({ ok: false, error: 'Go 服务未配置或未启用' });
            }
            if (!cfg.apiBase) {
                return res.status(400).json({ ok: false, error: 'Go 服务地址未配置' });
            }
            const result = await fetchGoQR(cfg.apiBase);
            if (!result.ok) {
                return res.status(400).json({ ok: false, error: result.error || '获取二维码失败' });
            }
            res.json({
                ok: true,
                data: {
                    uuid: result.uuid,
                    qrBase64: result.qrBase64 || '',
                    apiBase: cfg.apiBase,
                    appId: cfg.appId,
                },
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ Go 扫码：检查扫码状态 ============
    app.post('/api/go/check', authRequired, async (req: Request, res: Response) => {
        try {
            const username = (req as any).currentUser?.username;
            const cfg = store.getGoConfig ? store.getGoConfig(username) : null;
            if (!cfg || !cfg.enabled || !cfg.apiBase) {
                return res.status(400).json({ ok: false, error: 'Go 服务未配置或未启用' });
            }
            const uuid = String((req.body && req.body.uuid) || '').trim();
            if (!uuid) {
                return res.status(400).json({ ok: false, error: '缺少 uuid' });
            }
            const result = await checkGoStatus(cfg.apiBase, uuid);
            if (!result.ok) {
                return res.status(400).json({ ok: false, error: result.error || '检查扫码状态失败' });
            }
            res.json({
                ok: true,
                data: {
                    status: result.qrStatus || 0,
                    wxid: result.wxid || '',
                    nickname: result.nickname || '',
                },
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ Go 扫码：拉取登录 Code ============
    app.post('/api/go/code', authRequired, async (req: Request, res: Response) => {
        try {
            const username = (req as any).currentUser?.username;
            const cfg = store.getGoConfig ? store.getGoConfig(username) : null;
            if (!cfg || !cfg.enabled || !cfg.apiBase) {
                return res.status(400).json({ ok: false, error: 'Go 服务未配置或未启用' });
            }
            const wxid = String((req.body && req.body.wxid) || '').trim();
            if (!wxid) {
                return res.status(400).json({ ok: false, error: '缺少 wxid' });
            }
            const appId = String(cfg.appId || '').trim() || 'wx5306c5978fdb76e4';
            const result = await fetchGoCode(cfg.apiBase, appId, wxid);
            if (!result.ok || !result.code) {
                return res.status(400).json({ ok: false, error: result.error || '获取 Code 失败' });
            }
            res.json({ ok: true, code: result.code, wxid, appId });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取角色列表（登录即可查看，用于前端展示）
    app.get('/api/admin/roles', authRequired, (req: Request, res: Response) => {
        try {
            const currentUser = (req as any).currentUser;
            const roles = getRoles();
            // 非超级管理员只能看到非 admin 角色
            const visibleRoles = currentUser?.role === 'admin'
                ? roles
                : roles.filter((r: any) => r.value !== 'admin');
            res.json({ ok: true, data: visibleRoles });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取当前用户权限
    app.get('/api/admin/me/permissions', authRequired, (req: Request, res: Response) => {
        try {
            const currentUser = (req as any).currentUser;
            res.json({
                ok: true,
                data: {
                    role: currentUser?.role,
                    permissions: getRolePermissions(currentUser?.role),
                },
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 在线会话管理 API ============

    // 获取会话列表
    app.get('/api/admin/sessions', authRequired, requirePermission('session:read'), (req: Request, res: Response) => {
        try {
            const sessions = tokenStore.getActiveSessions();
            res.json({ ok: true, data: sessions });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 强制下线单个会话
    app.delete('/api/admin/sessions/:token', authRequired, requirePermission('session:delete'), (req: Request, res: Response) => {
        try {
            const token = String(req.params.token);
            const currentUser = (req as any).currentUser;
            const session = tokenStore.getToken(token);

            if (!session) {
                return res.status(404).json({ ok: false, error: '会话不存在或已过期' });
            }

            // 不能踢自己当前会话
            if (token === (req as any).adminToken) {
                return res.status(400).json({ ok: false, error: '不能强制下线当前会话' });
            }

            // 不能强制下线最高管理员会话（用户名 admin）
            if (session.user?.username === 'admin' && currentUser?.username !== 'admin') {
                return res.status(403).json({ ok: false, error: '不能强制下线最高管理员' });
            }

            tokenStore.revokeToken(token);
            ctx.tokens.delete(token);
            ctx.tokenUserMap.delete(token);

            // 断开相关 socket 连接
            if (ctx.io) {
                for (const socket of ctx.io.sockets.sockets.values()) {
                    if (String((socket.data as any).adminToken || '') === String(token)) {
                        socket.disconnect(true);
                    }
                }
            }

            audit('session_revoked', req, { targetUser: session.user?.username, targetRole: session.user?.role });
            res.json({ ok: true });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 批量强制下线某用户所有会话
    app.post('/api/admin/sessions/revoke-user', authRequired, requirePermission('session:delete'), (req: Request, res: Response) => {
        try {
            const { username } = req.body || {};
            const currentUser = (req as any).currentUser;
            if (!username) {
                return res.status(400).json({ ok: false, error: '缺少用户名' });
            }

            if (username === currentUser?.username) {
                return res.status(400).json({ ok: false, error: '不能强制下线自己的全部会话' });
            }

            // 不能强制下线最高管理员（用户名 admin）
            if (username === 'admin' && currentUser?.username !== 'admin') {
                return res.status(403).json({ ok: false, error: '不能强制下线最高管理员' });
            }

            const count = tokenStore.revokeTokensByUser(username);

            // 同步清理内存和 socket
            for (const token of ctx.tokens) {
                const entry = tokenStore.getToken(token);
                if (!entry || entry.user?.username === username) {
                    ctx.tokens.delete(token);
                    ctx.tokenUserMap.delete(token);
                    if (ctx.io) {
                        for (const socket of ctx.io.sockets.sockets.values()) {
                            if (String((socket.data as any).adminToken || '') === String(token)) {
                                socket.disconnect(true);
                            }
                        }
                    }
                }
            }

            audit('user_sessions_revoked', req, { targetUser: username, count });
            res.json({ ok: true, data: { count } });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
}

module.exports = { mountAuthRoutes };
