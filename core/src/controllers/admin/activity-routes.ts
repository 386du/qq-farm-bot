import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

const { getAccId, checkAccountAccess, handleApiError } = require('./middleware');

function mountActivityRoutes(app: Application, ctx: AdminContext): void {

    // 获取货币余额（点券/金币/背包）
    app.get('/api/activity/currency', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        try {
            const status = await ctx.provider.getStatus(id);
            const bag = await ctx.provider.getBag(id);
            res.json({ ok: true, data: { status, bag } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 获取活动组
    app.get('/api/activity/group/:groupId', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        try {
            const groupId = Number(req.params.groupId) || 0;
            const data = await ctx.provider.getActivityGroup(id, groupId);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 获取活动列表
    app.get('/api/activity/list', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        try {
            const data = await ctx.provider.getActivityList(id);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 动态获取所有活动组的所有活动 (不依赖写死的 groupId)
    app.get('/api/activity/all', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        try {
            const data = await ctx.provider.getAllActivities(id);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 活动操作（抽奖/兑换/领取）
    app.post('/api/activity/operate', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        try {
            const { activityId, operateType, param } = req.body || {};
            const data = await ctx.provider.operateActivity(id, activityId, operateType, param || 0);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 自动抽奖（后端自动探测正确参数组合，无需前端传 operateType/param）
    app.post('/api/activity/draw-auto', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        try {
            const { activityId, count = 1 } = req.body || {};
            if (!activityId) {
                return res.status(400).json({ ok: false, error: '缺少 activityId' });
            }
            const data = await ctx.provider.drawAuto(id, Number(activityId), Number(count) || 1);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 获取节令活动
    app.get('/api/activity/solar-terms', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        try {
            const data = await ctx.provider.getSolarTerms(id);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 获取赛季信息
    app.get('/api/activity/season', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        try {
            const data = await ctx.provider.getSeasonInfo(id);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 领取战令等级奖励
    app.post('/api/activity/battlepass/claim', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        const levelIds = (req.body || {}).levelIds;
        if (!Array.isArray(levelIds) || levelIds.length === 0) {
            return res.status(400).json({ ok: false, error: '缺少有效的 levelIds' });
        }
        try {
            const data = await ctx.provider.claimBattlePassRewards(id, levelIds);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 获取所有商店列表 (ShopService.ShopProfiles)
    app.get('/api/shop/profiles', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        try {
            const data = await ctx.provider.getShopProfiles(id);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 获取商店商品列表 (ShopService.ShopInfo)
    app.get('/api/shop/:shopId', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        try {
            const data = await ctx.provider.getShopInfo(id, Number(req.params.shopId) || 0);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 购买商店商品 (ShopService.BuyGoods)
    app.post('/api/shop/buy', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        const { goodsId, num = 1, price = 0 } = req.body || {};
        if (!goodsId) {
            return res.status(400).json({ ok: false, error: '缺少 goodsId' });
        }
        try {
            const data = await ctx.provider.buyGoods(id, Number(goodsId), Number(num), Number(price));
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });
}

module.exports = { mountActivityRoutes };
