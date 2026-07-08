import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * Mall routes: 道具商城目录、购买、宠物商店、道具商店聚合。
 */
const {
    createAuthRequired,
    getAccId,
    handleApiError,
} = require('./middleware');

function mountMallRoutes(app: Application, ctx: AdminContext): void {
    const authRequired = createAuthRequired(ctx);

    app.get('/api/mall/goods', authRequired, async (req: Request, res: Response) => {
        try {
            const accountId = getAccId(ctx, req);
            const slotType = Number((req.query.slotType as string) || '1') || 1;
            const result = await ctx.provider.callAccountMethod(accountId, 'getMallCatalog', { slotType });
            res.json({ ok: true, data: result });
        } catch (e: any) {
            handleApiError(res, e, '获取商城商品失败');
        }
    });

    app.post('/api/mall/purchase', authRequired, async (req: Request, res: Response) => {
        try {
            const accountId = getAccId(ctx, req);
            const { goodsId, count = 1, slotType = 1, source = 'mall', shopId = 0 } = req.body || {};
            if (!goodsId) {
                res.status(400).json({ ok: false, error: '缺少 goodsId' });
                return;
            }
            const result = await ctx.provider.callAccountMethod(accountId, 'purchaseMallGoods', {
                goodsId: Number(goodsId) || 0,
                count: Math.max(1, Math.min(99, Number(count) || 1)),
                slotType: Math.max(1, Math.min(20, Number(slotType) || 1)),
                source: source === 'shop' ? 'shop' : 'mall',
                shopId: Math.max(0, Number(shopId) || 0),
            });
            res.json({ ok: true, data: result });
        } catch (e: any) {
            handleApiError(res, e, '商城购买失败');
        }
    });
}

module.exports = { mountMallRoutes };
