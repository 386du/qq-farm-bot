import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * Admin-only routes: announcement, system-config, cards,
 * card-claim, user management.
 */

const fs = require('node:fs');
const { getDataFile, ensureDataDir } = require('../../config/runtime-paths');
const { writeTextFileAtomic } = require('../../services/json-db');
const { updateRuntimeConfig, getRuntimeConfig, getDefaultSystemConfig, getDevicePresets } = require('../../config/config');
const store = require('../../models/store');
const userStore = require('../../models/user-store');
const tokenStore = require('../../models/user-store/token-store');
const auditLog = require('../../models/audit-log');
const ipBlacklist = require('../../models/ip-blacklist');

const {
    createAuthRequired,
    adminRequired,
    getClientIp,
} = require('./middleware');

function mountAdminRoutes(app: Application, ctx: AdminContext): void {
    const authRequired = createAuthRequired(ctx);

    function audit(event: string, req: Request, details?: Record<string, any>): void {
        const username = (req as any).currentUser?.username || 'unknown';
        auditLog.log(event, username, getClientIp(req), details);
    }

    // ============ 公告管理 API ============
    // 获取公告（所有用户可访问）
    app.get('/api/announcement', authRequired, (req: Request, res: Response) => {
        try {
            const currentUser = (req as any).currentUser;
            const announcement = store.getAnnouncement();
            const shouldShow = store.shouldShowAnnouncement(currentUser?.username);
            res.json({
                ok: true,
                data: {
                    ...announcement,
                    shouldShow,
                },
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 标记公告已读
    app.post('/api/announcement/read', authRequired, (req: Request, res: Response) => {
        try {
            const currentUser = (req as any).currentUser;
            if (currentUser?.username) {
                store.markAnnouncementRead(currentUser.username);
            }
            res.json({ ok: true });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 设置公告（仅管理员）
    app.post('/api/admin/announcement', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { content, showOnce } = req.body || {};
            const announcement = store.setAnnouncement(content, showOnce);
            audit('announcement_updated', req, { content: String(content || '').slice(0, 200), showOnce });
            res.json({ ok: true, data: announcement });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 设备预设 API（仅管理员） ============

    // 获取设备预设列表
    app.get('/api/admin/device-presets', authRequired, adminRequired, (_req: Request, res: Response) => {
        try {
            const presets = getDevicePresets();
            res.json({ ok: true, data: presets });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 系统配置 API（仅管理员） ============

    // 获取系统配置
    app.get('/api/admin/system-config', authRequired, adminRequired, (_req: Request, res: Response) => {
        try {
            const savedConfig = store.getSystemConfig();
            const defaultConfig = getDefaultSystemConfig();
            const currentRuntime = getRuntimeConfig();
            res.json({
                ok: true,
                data: {
                    saved: savedConfig,
                    default: defaultConfig,
                    current: currentRuntime,
                },
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 保存系统配置
    app.post('/api/admin/system-config', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { serverUrl, clientVersion, platform, os, deviceInfo } = req.body || {};
            const newConfig = { serverUrl, clientVersion, platform, os, deviceInfo };
            const saved = store.setSystemConfig(newConfig);
            updateRuntimeConfig(saved);
            const current = getRuntimeConfig();
            audit('system_config_updated', req, { serverUrl, clientVersion, platform, os });
            res.json({ ok: true, data: { saved, current } });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 重置系统配置为默认值
    app.post('/api/admin/system-config/reset', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const defaultConfig = getDefaultSystemConfig();
            store.setSystemConfig(defaultConfig);
            updateRuntimeConfig(defaultConfig);
            const current = getRuntimeConfig();
            audit('system_config_reset', req);
            res.json({ ok: true, data: { saved: defaultConfig, current } });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 卡密管理 API（仅管理员） ============

    // 获取所有卡密
    app.get('/api/admin/cards', authRequired, adminRequired, (_req: Request, res: Response) => {
        try {
            const cards = userStore.getAllCards();
            res.json({ ok: true, data: cards });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 创建卡密
    app.post('/api/admin/cards', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { description, days, count, type } = req.body || {};
            if (!description || days === undefined) {
                return res.status(400).json({ ok: false, error: '请提供描述和天数' });
            }

            const cardType = type === 'quota' ? 'quota' : 'time';

            // 批量创建
            if (count && Number.parseInt(count, 10) > 1) {
                const cards = userStore.createCardsBatch(description, days, count, cardType);
                audit('cards_created_batch', req, { description, days, count: cards.length, type: cardType });
                return res.json({ ok: true, data: cards, batch: true, count: cards.length });
            }

            const card = userStore.createCard(description, days, cardType);
            audit('card_created', req, { code: card.code, description, days, type: cardType });
            res.json({ ok: true, data: card });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 批量删除卡密（必须放在 /:code 路由之前，避免被当作 code 参数）
    app.post('/api/admin/cards/batch-delete', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { codes } = req.body || {};
            if (!Array.isArray(codes) || codes.length === 0) {
                return res.status(400).json({ ok: false, error: '请提供要删除的卡密列表' });
            }
            const result = userStore.deleteCardsBatch(codes);
            audit('cards_deleted_batch', req, { count: codes.length, codes });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 更新卡密
    app.post('/api/admin/cards/:code', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { code } = req.params;
            const updates = req.body || {};
            const card = userStore.updateCard(code, updates);
            if (!card) {
                return res.status(404).json({ ok: false, error: '卡密不存在' });
            }
            audit('card_updated', req, { code, updates });
            res.json({ ok: true, data: card });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 删除卡密
    app.delete('/api/admin/cards/:code', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { code } = req.params;
            const ok = userStore.deleteCard(code);
            if (!ok) {
                return res.status(404).json({ ok: false, error: '卡密不存在' });
            }
            audit('card_deleted', req, { code });
            res.json({ ok: true });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 卡密领取功能 API ============
    // 获取卡密领取功能状态
    app.get('/api/card-claim/status', (_req: Request, res: Response) => {
        try {
            const status = userStore.getCardClaimStatus();
            res.json({ ok: true, enabled: status.enabled });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 设置卡密领取功能状态（仅管理员）
    app.post('/api/admin/card-claim/status', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { enabled } = req.body;
            const status = userStore.setCardClaimStatus(enabled);
            audit('card_claim_status_changed', req, { enabled });
            res.json({ ok: true, enabled: status.enabled });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 用户领取卡密
    app.post('/api/card-claim/claim', (req: Request, res: Response) => {
        try {
            const ua = req.headers['user-agent'] || '';
            const username = req.body?.username || null;

            // 清理过期记录
            userStore.clearExpiredClaimRecords();

            const result = userStore.claimCardByUA(ua, username);

            if (!result.ok) {
                const response: any = { ok: false, error: result.error };
                if (result.remainingMs) {
                    response.remainingMs = result.remainingMs;
                }
                return res.status(400).json(response);
            }

            res.json({
                ok: true,
                cardCode: result.cardCode,
                days: result.days,
                description: result.description
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取卡密领取记录（仅管理员）
    app.get('/api/admin/card-claim/records', authRequired, adminRequired, (_req: Request, res: Response) => {
        try {
            const records = userStore.getCardClaimRecords();
            res.json({ ok: true, data: records });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 仪表盘 API（仅管理员） ============
    app.get('/api/admin/dashboard', authRequired, adminRequired, (_req: Request, res: Response) => {
        try {
            const allUsers = userStore.getAllUsers();
            const onlineUsers = allUsers.filter((u: any) => tokenStore.isUserOnline(u.username)).length;
            const accountData = ctx.provider && typeof ctx.provider.getAccounts === 'function'
                ? ctx.provider.getAccounts()
                : store.getAccounts();
            const accounts = accountData?.accounts || [];
            const onlineAccounts = accounts.filter((a: any) => a.running).length;
            const mem = process.memoryUsage();

            res.json({
                ok: true,
                data: {
                    totalUsers: allUsers.length,
                    onlineUsers,
                    totalAccounts: accounts.length,
                    onlineAccounts,
                    uptime: process.uptime(),
                    memory: {
                        used: mem.heapUsed,
                        total: mem.heapTotal,
                        rss: mem.rss,
                    },
                    version: process.env.npm_package_version || '',
                },
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 账号全局管理 API（仅管理员） ============
    // 获取所有账号
    app.get('/api/admin/accounts', authRequired, adminRequired, (_req: Request, res: Response) => {
        try {
            const accountData = ctx.provider && typeof ctx.provider.getAccounts === 'function'
                ? ctx.provider.getAccounts()
                : store.getAccounts();
            res.json({ ok: true, data: accountData?.accounts || [] });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 启动指定账号
    app.post('/api/admin/accounts/:id/start', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            if (ctx.provider && typeof ctx.provider.startAccount === 'function') {
                ctx.provider.startAccount(id);
                audit('account_started', req, { accountId: id });
                res.json({ ok: true });
            } else {
                res.status(500).json({ ok: false, error: '账号启动功能不可用' });
            }
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 停止指定账号
    app.post('/api/admin/accounts/:id/stop', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            if (ctx.provider && typeof ctx.provider.stopAccount === 'function') {
                ctx.provider.stopAccount(id);
                audit('account_stopped', req, { accountId: id });
                res.json({ ok: true });
            } else {
                res.status(500).json({ ok: false, error: '账号停止功能不可用' });
            }
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 删除指定账号
    app.delete('/api/admin/accounts/:id', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            store.deleteAccount(id);
            audit('account_deleted', req, { accountId: id });
            res.json({ ok: true });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 用户管理 API（仅管理员） ============
    // 获取所有用户
    app.get('/api/admin/users', authRequired, adminRequired, (_req: Request, res: Response) => {
        try {
            const users = userStore.getAllUsers().map((u: any) => ({
                ...u,
                online: tokenStore.isUserOnline(u.username),
                lastActivityAt: tokenStore.getUserLastActivity(u.username),
            }));
            res.json({ ok: true, data: users });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取所有用户（带密码，仅管理员）
    app.get('/api/admin/users-with-password', authRequired, adminRequired, (_req: Request, res: Response) => {
        try {
            const users = userStore.getAllUsersWithPassword();
            res.json({ ok: true, data: users });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 更新用户
    app.post('/api/admin/users/:username', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { username } = req.params;
            const updates = req.body || {};
            const user = userStore.updateUser(username, updates);
            if (!user) {
                return res.status(404).json({ ok: false, error: '用户不存在' });
            }
            audit('user_updated', req, { targetUser: username, updates });
            res.json({ ok: true, data: user });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 编辑用户（管理员编辑用户信息）
    app.post('/api/admin/users/:username/edit', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { username } = req.params;
            const { newUsername, password, accountLimit, expiresAt, isPermanent } = req.body || {};

            const result = userStore.editUser(username, {
                newUsername,
                password,
                accountLimit,
                expiresAt,
                isPermanent
            });

            if (!result.ok) {
                return res.status(400).json(result);
            }

            // 更新该用户所有会话中的信息
            for (const [token, user] of ctx.tokenUserMap.entries()) {
                if (user.username === username || user.username === newUsername) {
                    user.username = result.user.username;
                    user.card = result.user.card;
                    user.accountLimit = result.user.accountLimit;
                    ctx.tokenUserMap.set(token, user);
                }
            }

            audit('user_edited', req, {
                targetUser: username,
                newUsername: result.user.username,
                changedPassword: !!password,
                accountLimit,
            });

            res.json({ ok: true, data: result.user });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 删除用户
    app.delete('/api/admin/users/:username', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { username } = req.params;
            const currentUser = (req as any).currentUser;

            // 不能删除自己
            if (currentUser && currentUser.username === username) {
                return res.status(400).json({ ok: false, error: '不能删除自己的账号' });
            }

            // 管理员可以删除其他管理员
            const result = userStore.deleteUser(username, true);
            if (!result.ok) {
                return res.status(400).json(result);
            }
            // 强制下线该用户的所有会话
            for (const [token, user] of ctx.tokenUserMap.entries()) {
                if (user.username === username) {
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
            audit('user_deleted', req, { targetUser: username });
            res.json({ ok: true });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 管理员为用户续费
    app.post('/api/admin/users/:username/renew', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { username } = req.params;
            const { cardCode } = req.body || {};

            if (!cardCode) {
                return res.status(400).json({ ok: false, error: '请提供卡密' });
            }

            const result = userStore.renewUser(username, cardCode);
            if (!result.ok) {
                return res.status(400).json(result);
            }

            // 更新该用户所有会话中的卡密信息
            for (const [token, user] of ctx.tokenUserMap.entries()) {
                if (user.username === username) {
                    user.card = result.card;
                    user.accountLimit = result.accountLimit;
                    ctx.tokenUserMap.set(token, user);
                }
            }

            audit('user_renewed_by_admin', req, {
                targetUser: username,
                cardCode,
                cardType: result.cardType,
            });

            res.json({ ok: true, data: { card: result.card, accountLimit: result.accountLimit, cardType: result.cardType } });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 操作日志/审计 API（仅管理员） ============
    app.get('/api/admin/audit-logs', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const limit = Math.min(Math.max(Number.parseInt(req.query.limit as string) || 100, 1), 500);
            const offset = Math.max(Number.parseInt(req.query.offset as string) || 0, 0);
            const logs = auditLog.getLogs(limit, offset);
            res.json({ ok: true, data: { logs, total: auditLog.getLogCount() } });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.delete('/api/admin/audit-logs', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            auditLog.clearLogs();
            audit('audit_logs_cleared', req);
            res.json({ ok: true });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 数据备份与恢复 API（仅管理员） ============
    const BACKUP_FILES = [
        'users.json',
        'cards.json',
        'accounts.json',
        'store.json',
        'tokens.json',
        'audit-logs.json',
        'login-logs.json',
        'login-attempts.json',
    ];

    app.get('/api/admin/backup/export', authRequired, adminRequired, (_req: Request, res: Response) => {
        try {
            ensureDataDir();
            const files: Record<string, string> = {};
            for (const name of BACKUP_FILES) {
                const filePath = getDataFile(name);
                if (fs.existsSync(filePath)) {
                    files[name] = fs.readFileSync(filePath, 'utf8');
                } else {
                    files[name] = '{}';
                }
            }
            res.json({
                ok: true,
                data: {
                    createdAt: Date.now(),
                    version: process.env.npm_package_version || '',
                    files,
                },
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/admin/backup/import', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { files } = req.body || {};
            if (!files || typeof files !== 'object') {
                return res.status(400).json({ ok: false, error: '请提供要恢复的数据文件' });
            }

            ensureDataDir();
            for (const name of BACKUP_FILES) {
                if (files[name] !== undefined) {
                    const filePath = getDataFile(name);
                    const content = typeof files[name] === 'string' ? files[name] : JSON.stringify(files[name], null, 2);
                    writeTextFileAtomic(filePath, content);
                }
            }

            audit('backup_imported', req, { files: Object.keys(files) });
            res.json({ ok: true, message: '数据已导入，建议重启服务以完全生效' });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 黑名单/IP 限制 API（仅管理员） ============
    app.get('/api/admin/ip-blacklist', authRequired, adminRequired, (_req: Request, res: Response) => {
        try {
            const list = ipBlacklist.getList();
            res.json({ ok: true, data: list });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/admin/ip-blacklist', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { ip, reason, durationMinutes } = req.body || {};
            if (!ip) {
                return res.status(400).json({ ok: false, error: '请提供 IP 地址' });
            }
            const expiresAt = durationMinutes && Number.isFinite(Number(durationMinutes))
                ? Date.now() + Number(durationMinutes) * 60 * 1000
                : null;
            ipBlacklist.add(ip, reason || '管理员手动封禁', expiresAt, false);
            audit('ip_blacklisted', req, { ip, reason, durationMinutes });
            res.json({ ok: true });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.delete('/api/admin/ip-blacklist', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { ip } = req.body || {};
            if (!ip) {
                return res.status(400).json({ ok: false, error: '请提供 IP 地址' });
            }
            const ok = ipBlacklist.remove(ip);
            audit('ip_unblocked', req, { ip });
            res.json({ ok, message: ok ? '已解封' : 'IP 不存在' });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.delete('/api/admin/ip-blacklist/all', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            ipBlacklist.clear();
            audit('ip_blacklist_cleared', req);
            res.json({ ok: true });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
}

module.exports = { mountAdminRoutes };
