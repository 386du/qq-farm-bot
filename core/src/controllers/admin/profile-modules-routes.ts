import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

const { getAccId, checkAccountAccess, handleApiError } = require('./middleware');

/**
 * 新版协议模块路由
 *
 * 所有接口都基于"x-account-id"定位账号，使用 ctx.provider 调用后端服务。
 * 写操作（喂狗粮 / 领取节气）有参数白名单和数量上限，避免被风控。
 */
function mountProfileModulesRoutes(app: Application, ctx: AdminContext): void {
    // 1) 聚合拉取新版协议模块（狗狗/装扮/头像框/生涯/黄金虫）
    app.get('/api/profile/modules', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        try {
            const data = await ctx.provider.getProfileModules(id);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 2) 喂狗粮（仅在 proto 含 AddFoodRequest 时才暴露）
    app.post('/api/profile/dog-food', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        try {
            const foodId = Number(req.body?.foodId);
            const count = Math.max(1, Math.min(99, Number(req.body?.count) || 1));
            if (!foodId) {
                return res.status(400).json({ ok: false, error: '缺少 foodId' });
            }
            const data = await ctx.provider.addDogFood(id, foodId, count);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 3) 获取节气信息
    app.get('/api/solar-terms', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        try {
            const data = await ctx.provider.getSolarTermsModule(id);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 4) 领取节气礼包
    app.post('/api/solar-terms/claim', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        try {
            const solarTermId = Number(req.body?.solarTermId) || undefined;
            const data = await ctx.provider.claimSolarTermsModule(id, solarTermId);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 5) 聚合获取活动模块（活动列表 + 节气 + 活动组）
    app.get('/api/activity/modules', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        if (!checkAccountAccess(ctx, req as any, id)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        try {
            const data = await ctx.provider.getActivityModules(id);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });
}

module.exports = { mountProfileModulesRoutes };
