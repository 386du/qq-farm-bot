import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * Activity routes: 荷风游记 整套接口。
 */
const {
    createAuthRequired,
    getAccId,
    handleApiError,
} = require('./middleware');

function mountActivityRoutes(app: Application, ctx: AdminContext): void {
    const authRequired = createAuthRequired(ctx);

    app.get('/api/activity/overview', authRequired, async (req: Request, res: Response) => {
        try {
            const accountId = getAccId(ctx, req);
            const activityName = String((req.query.name as string) || '').trim();
            const result = await ctx.provider.callAccountMethod(accountId, 'getActivityOverview', { activityName });
            res.json({ ok: true, data: result });
        } catch (e: any) {
            handleApiError(res, e, '获取活动概览失败');
        }
    });

    app.post('/api/activity/draw', authRequired, async (req: Request, res: Response) => {
        try {
            const accountId = getAccId(ctx, req);
            const { activityName, mode = 'free', count = 1, allowPaid = false } = req.body || {};
            const result = await ctx.provider.callAccountMethod(accountId, 'drawActivityLottery', {
                activityName: String(activityName || '').trim(),
                mode: String(mode || 'free'),
                count: Math.max(1, Math.min(10, Number(count) || 1)),
                allowPaid: !!allowPaid,
            });
            res.json({ ok: true, data: result });
        } catch (e: any) {
            handleApiError(res, e, '活动抽奖失败');
        }
    });

    app.post('/api/activity/draw-simple', authRequired, async (req: Request, res: Response) => {
        try {
            const accountId = getAccId(ctx, req);
            const { activityName, count = 1 } = req.body || {};
            const result = await ctx.provider.callAccountMethod(accountId, 'drawActivitySimple', {
                activityName: String(activityName || '').trim(),
                count: Math.max(1, Math.min(10, Number(count) || 1)),
            });
            res.json({ ok: true, data: result });
        } catch (e: any) {
            handleApiError(res, e, '活动抽奖失败');
        }
    });

    app.post('/api/activity/exchange', authRequired, async (req: Request, res: Response) => {
        try {
            const accountId = getAccId(ctx, req);
            const { activityName, goodsId, count = 1 } = req.body || {};
            if (!goodsId) {
                res.status(400).json({ ok: false, error: '缺少 goodsId' });
                return;
            }
            const result = await ctx.provider.callAccountMethod(accountId, 'exchangeActivityGoods', {
                activityName: String(activityName || '').trim(),
                goodsId: Number(goodsId) || 0,
                count: Math.max(1, Math.min(99, Number(count) || 1)),
            });
            res.json({ ok: true, data: result });
        } catch (e: any) {
            handleApiError(res, e, '活动兑换失败');
        }
    });

    app.post('/api/activity/daily-signin/claim', authRequired, async (req: Request, res: Response) => {
        try {
            const accountId = getAccId(ctx, req);
            const { activityName, rewardId = 0 } = req.body || {};
            const result = await ctx.provider.callAccountMethod(accountId, 'claimActivityDailySignin', {
                activityName: String(activityName || '').trim(),
                rewardId: Number(rewardId) || 0,
            });
            res.json({ ok: true, data: result });
        } catch (e: any) {
            handleApiError(res, e, '活动每日签到失败');
        }
    });

    app.post('/api/activity/battle-pass/claim', authRequired, async (req: Request, res: Response) => {
        try {
            const accountId = getAccId(ctx, req);
            const result = await ctx.provider.callAccountMethod(accountId, 'claimBattlePass', {});
            res.json({ ok: true, data: result });
        } catch (e: any) {
            handleApiError(res, e, '战令奖励领取失败');
        }
    });

    app.post('/api/activity/tasks/claim', authRequired, async (req: Request, res: Response) => {
        try {
            const accountId = getAccId(ctx, req);
            const { activityName } = req.body || {};
            const result = await ctx.provider.callAccountMethod(accountId, 'claimActivityTasks', {
                activityName: String(activityName || '').trim(),
            });
            res.json({ ok: true, data: result });
        } catch (e: any) {
            handleApiError(res, e, '活动任务领取失败');
        }
    });
}

module.exports = { mountActivityRoutes };
