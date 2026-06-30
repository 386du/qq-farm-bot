import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 邀请码相关路由：我的邀请、领取奖励、管理员配置。
 */

const userStore = require('../../models/user-store');
const auditLog = require('../../models/audit-log');

const {
    createAuthRequired,
    requirePermission,
    getClientIp,
} = require('./middleware');

function mountInviteRoutes(app: Application, ctx: AdminContext): void {
    const authRequired = createAuthRequired(ctx);

    function audit(event: string, req: Request, details?: Record<string, any>): void {
        const username = (req as any).currentUser?.username || 'unknown';
        auditLog.log(event, username, getClientIp(req), details);
    }

    // 获取当前用户邀请信息（邀请码、已邀请人数、可领取奖励）
    app.get('/api/invite/me', authRequired, (req: Request, res: Response) => {
        try {
            const username = (req as any).currentUser?.username;
            if (!username) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }

            const info = userStore.getUserInviteInfo(username);
            const available = userStore.getAvailableRewards(username);
            const state = userStore.getRewardState(username);
            const config = userStore.getInviteConfig();

            res.json({
                ok: true,
                data: {
                    code: info.code,
                    count: info.count,
                    invitees: info.invitees,
                    availableRewards: available.rules,
                    claimed: state.claimed,
                    totalRewardDays: state.totalRewardDays,
                    totalRewardAccountLimit: state.totalRewardAccountLimit,
                    enabled: config.enabled,
                    rules: config.rules,
                },
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 领取邀请奖励
    app.post('/api/invite/claim', authRequired, (req: Request, res: Response) => {
        try {
            const username = (req as any).currentUser?.username;
            if (!username) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }

            const { count } = req.body || {};
            const countNum = Number.parseInt(String(count), 10);
            if (!Number.isFinite(countNum) || countNum <= 0) {
                return res.status(400).json({ ok: false, error: '请提供有效的奖励档位' });
            }

            const result = userStore.claimInviteReward(username, countNum);
            if (!result.ok) {
                return res.status(400).json(result);
            }

            audit('invite_reward_claimed', req, { count: countNum, reward: result.reward });

            const state = userStore.getRewardState(username);
            res.json({
                ok: true,
                data: {
                    reward: result.reward,
                    claimed: state.claimed,
                    totalRewardDays: state.totalRewardDays,
                    totalRewardAccountLimit: state.totalRewardAccountLimit,
                },
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 公开：查询邀请码是否存在（注册页校验用，可选）
    app.get('/api/invite/check/:code', (req: Request, res: Response) => {
        try {
            const config = userStore.getInviteConfig();
            if (!config.enabled) {
                return res.json({ ok: true, valid: false, error: '邀请功能未开启' });
            }

            const code = req.params.code;
            const inviter = userStore.findUserByInviteCode(code);
            res.json({ ok: true, valid: !!inviter });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 管理员：获取邀请配置
    app.get('/api/admin/invite/config', authRequired, requirePermission('invite:*'), (req: Request, res: Response) => {
        try {
            const config = userStore.getInviteConfig();
            res.json({ ok: true, data: config });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 管理员：保存邀请配置
    app.post('/api/admin/invite/config', authRequired, requirePermission('invite:*'), (req: Request, res: Response) => {
        try {
            const { enabled, rules } = req.body || {};
            const normalizedRules = Array.isArray(rules)
                ? rules.map((r: any) => ({
                    count: Math.max(1, Number.parseInt(String(r.count), 10) || 1),
                    rewardDays: Number.parseInt(String(r.rewardDays), 10) || 0,
                    rewardAccountLimit: Number.parseInt(String(r.rewardAccountLimit), 10) || 0,
                    description: String(r.description || '').trim(),
                })).filter((r: any) => r.count > 0 && (r.rewardDays > 0 || r.rewardAccountLimit > 0))
                : [];

            const config = userStore.setInviteConfig({
                enabled: enabled !== false,
                rules: normalizedRules,
            });

            audit('invite_config_updated', req, { enabled: config.enabled, rules: config.rules });
            res.json({ ok: true, data: config });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 管理员：获取所有邀请记录
    app.get('/api/admin/invite/records', authRequired, requirePermission('invite:*'), (_req: Request, res: Response) => {
        try {
            const records = userStore.getAllInviteRecords();
            res.json({ ok: true, data: records });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
}

module.exports = { mountInviteRoutes };
