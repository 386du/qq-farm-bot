export {};
const { Buffer } = require('node:buffer');
/**
 * 商城自动购买
 */

const { sendMsgAsync, getUserState } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum, log, sleep } = require('../utils/utils');
const { getItemById, getItemByName, getItemImageById } = require('../config/gameConfig');

const ORGANIC_FERTILIZER_MALL_GOODS_ID: number = 1002;
const INORGANIC_FERTILIZER_MALL_GOODS_ID: number = 1003;
const BUY_COOLDOWN_MS: number = 10 * 60 * 1000;
const MAX_ROUNDS: number = 100;
const BUY_PER_ROUND: number = 10;
const FREE_GIFTS_DAILY_KEY: string = 'mall_free_gifts';

let lastBuyAt: number = 0;
let buyDoneDateKey: string = '';
let buyLastSuccessAt: number = 0;
let buyPausedNoGoldDateKey: string = '';
let freeGiftDoneDateKey: string = '';
let freeGiftLastAt: number = 0;
let freeGiftLastCheckAt: number = 0;

function getDateKey(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

async function getMallListBySlotType(slotType: number = 1): Promise<any> {
    const body: Uint8Array = types.GetMallListBySlotTypeRequest.encode(types.GetMallListBySlotTypeRequest.create({
        slot_type: Number(slotType) || 1,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.mallpb.MallService', 'GetMallListBySlotType', body);
    return types.GetMallListBySlotTypeResponse.decode(replyBody);
}

async function purchaseMallGoods(goodsId: number, count: number = 1): Promise<any> {
    const body: Uint8Array = types.PurchaseRequest.encode(types.PurchaseRequest.create({
        goods_id: Number(goodsId) || 0,
        count: Number(count) || 1,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.mallpb.MallService', 'Purchase', body);
    return types.PurchaseResponse.decode(replyBody);
}

async function getMallGoodsList(slotType: number = 1): Promise<any[]> {
    const mall: any = await getMallListBySlotType(slotType);
    const raw: any[] = Array.isArray(mall && mall.goods_list) ? mall.goods_list : [];
    const goods: any[] = [];
    for (const b of raw) {
        try {
            goods.push(types.MallGoods.decode(b));
        } catch {
            // ignore
        }
    }
    return goods;
}

function parseMallPriceValue(priceField: any): number {
    if (priceField == null) return 0;
    if (typeof priceField === 'number') return Math.max(0, Math.floor(priceField));
    const bytes: Buffer = Buffer.isBuffer(priceField) ? priceField : Buffer.from(priceField || []);
    if (!bytes.length) return 0;
    // 从 bytes 中读取 field=2 的 varint 作为价格
    let idx: number = 0;
    let parsed: number = 0;
    while (idx < bytes.length) {
        const key: number = bytes[idx++];
        const field: number = key >> 3;
        const wire: number = key & 0x07;
        if (wire !== 0) break;
        let val: number = 0;
        let shift: number = 0;
        while (idx < bytes.length) {
            const b: number = bytes[idx++];
            val |= (b & 0x7F) << shift;
            if ((b & 0x80) === 0) break;
            shift += 7;
        }
        if (field === 2) parsed = val;
    }
    return Math.max(0, Math.floor(parsed || 0));
}

function findOrganicFertilizerMallGoods(goodsList: any[]): any {
    const list: any[] = Array.isArray(goodsList) ? goodsList : [];
    return list.find((g: any) => toNum(g && g.goods_id) === ORGANIC_FERTILIZER_MALL_GOODS_ID) || null;
}

function findInorganicFertilizerMallGoods(goodsList: any[]): any {
    const list: any[] = Array.isArray(goodsList) ? goodsList : [];
    return list.find((g: any) => toNum(g && g.goods_id) === INORGANIC_FERTILIZER_MALL_GOODS_ID) || null;
}

function findFertilizerMallGoods(goodsList: any[], type: string = 'organic'): any {
    if (type === 'normal') {
        return findInorganicFertilizerMallGoods(goodsList);
    }
    return findOrganicFertilizerMallGoods(goodsList);
}

async function autoBuyOrganicFertilizerViaMall(): Promise<number> {
    const goodsList: any[] = await getMallGoodsList(1);
    const goods: any = findOrganicFertilizerMallGoods(goodsList);
    if (!goods) return 0;

    const goodsId: number = toNum(goods.goods_id);
    if (goodsId <= 0) return 0;
    const singlePrice: number = parseMallPriceValue(goods.price);
    let ticket: number = Math.max(0, toNum((getUserState() || {}).ticket));
    let totalBought: number = 0;
    let perRound: number = BUY_PER_ROUND;
    if (singlePrice > 0 && ticket > 0) {
        perRound = Math.max(1, Math.min(BUY_PER_ROUND, Math.floor(ticket / singlePrice) || 1));
    }

    for (let i = 0; i < MAX_ROUNDS; i++) {
        if (singlePrice > 0 && ticket > 0 && ticket < singlePrice) {
            buyPausedNoGoldDateKey = getDateKey();
            break;
        }
        try {
            await purchaseMallGoods(goodsId, perRound);
            totalBought += perRound;
            if (singlePrice > 0 && ticket > 0) {
                ticket = Math.max(0, ticket - (singlePrice * perRound));
                if (ticket < singlePrice) break;
            }
            await sleep(120);
        } catch (e: any) {
            const msg: string = String((e && e.message) || '');
            log('商城', `购买化肥失败: ${msg}`, {
                module: 'warehouse',
                event: '购买化肥',
                result: 'error',
                error: msg,
            });
            if (msg.includes('余额不足') || msg.includes('点券不足') || msg.includes('code=1000019')) {
                if (perRound > 1) {
                    perRound = 1;
                    continue;
                }
                buyPausedNoGoldDateKey = getDateKey();
            }
            break;
        }
    }

    if (totalBought > 0) {
        log('商城', `购买化肥成功，共购买 ${totalBought} 个`, {
            module: 'warehouse',
            event: '购买化肥',
            result: 'ok',
            count: totalBought,
            type: 'organic',
        });
    }

    return totalBought;
}

async function autoBuyFertilizerViaMall(type: string = 'organic', targetCount: number = 0): Promise<number> {
    log('商城', `开始购买化肥, 类型: ${type === 'normal' ? '无机化肥' : '有机化肥'}, 数量: ${targetCount || '不限'}`, {
        module: 'warehouse',
        event: '购买化肥',
        type,
        targetCount,
    });

    const goodsList: any[] = await getMallGoodsList(1);
    const goods: any = findFertilizerMallGoods(goodsList, type);
    if (!goods) {
        log('商城', `未找到化肥商品`, {
            module: 'warehouse',
            event: '购买化肥',
            result: 'error',
            type,
            error: '商品不存在',
        });
        return 0;
    }

    const goodsId: number = toNum(goods.goods_id);
    if (goodsId <= 0) return 0;
    const singlePrice: number = parseMallPriceValue(goods.price);
    let ticket: number = Math.max(0, toNum((getUserState() || {}).ticket));
    let totalBought: number = 0;
    let perRound: number = BUY_PER_ROUND;
    if (singlePrice > 0 && ticket > 0) {
        perRound = Math.max(1, Math.min(BUY_PER_ROUND, Math.floor(ticket / singlePrice) || 1));
    }

    log('商城', `准备购买化肥: goodsId=${goodsId}, 单价=${singlePrice}`, {
        module: 'warehouse',
        event: '购买化肥',
        goodsId,
        singlePrice,
        ticket,
        perRound,
    });

    const remainingToBuy: number = targetCount > 0 ? targetCount : Infinity;

    for (let i = 0; i < MAX_ROUNDS; i++) {
        if (targetCount > 0 && totalBought >= remainingToBuy) break;
        if (singlePrice > 0 && ticket > 0 && ticket < singlePrice) {
            buyPausedNoGoldDateKey = getDateKey();
            break;
        }
        const buyCount: number = targetCount > 0 ? Math.min(perRound, remainingToBuy - totalBought) : perRound;
        try {
            await purchaseMallGoods(goodsId, buyCount);
            totalBought += buyCount;
            if (singlePrice > 0 && ticket > 0) {
                ticket = Math.max(0, ticket - (singlePrice * buyCount));
                if (ticket < singlePrice) break;
            }
            await sleep(120);
        } catch (e: any) {
            const msg: string = String((e && e.message) || '');
            log('商城', `购买化肥失败: ${msg}`, {
                module: 'warehouse',
                event: '购买化肥',
                result: 'error',
                error: msg,
                type,
            });
            if (msg.includes('余额不足') || msg.includes('点券不足') || msg.includes('code=1000019')) {
                if (perRound > 1) {
                    perRound = 1;
                    continue;
                }
                buyPausedNoGoldDateKey = getDateKey();
            }
            break;
        }
    }

    if (totalBought > 0) {
        log('商城', `购买化肥成功，共购买 ${totalBought} 个`, {
            module: 'warehouse',
            event: '购买化肥',
            result: 'ok',
            count: totalBought,
            type,
        });
    }

    return totalBought;
}

async function autoBuyOrganicFertilizer(force: boolean = false): Promise<number> {
    const now: number = Date.now();
    if (!force && now - lastBuyAt < BUY_COOLDOWN_MS) return 0;
    lastBuyAt = now;

    try {
        const totalBought: number = await autoBuyOrganicFertilizerViaMall();
        if (totalBought > 0) {
            buyDoneDateKey = getDateKey();
            buyLastSuccessAt = Date.now();
            log('商城', `自动购买有机化肥 x${totalBought}`, {
                module: 'warehouse',
                event: '购买化肥',
                result: 'ok',
                count: totalBought,
            });
        }
        return totalBought;
    } catch {
        return 0;
    }
}

async function autoBuyFertilizer(force: boolean = false, type: string = 'organic', targetCount: number = 0): Promise<number> {
    const now: number = Date.now();
    if (!force && now - lastBuyAt < BUY_COOLDOWN_MS) return 0;
    lastBuyAt = now;

    try {
        const totalBought: number = await autoBuyFertilizerViaMall(type, targetCount);
        if (totalBought > 0) {
            buyDoneDateKey = getDateKey();
            buyLastSuccessAt = Date.now();
            const typeName: string = type === 'normal' ? '无机化肥' : '有机化肥';
            log('商城', `自动购买${typeName} x${totalBought}`, {
                module: 'warehouse',
                event: '购买化肥',
                result: 'ok',
                count: totalBought,
                type,
            });
        }
        return totalBought;
    } catch {
        return 0;
    }
}

function isDoneTodayByKey(key: string): boolean {
    return String(key || '') === getDateKey();
}

async function buyFreeGifts(force: boolean = false): Promise<number> {
    const now: number = Date.now();
    if (!force && isDoneTodayByKey(freeGiftDoneDateKey)) return 0;
    if (!force && now - freeGiftLastCheckAt < BUY_COOLDOWN_MS) return 0;
    freeGiftLastCheckAt = now;

    try {
        const mall: any = await getMallListBySlotType(1);
        const raw: any[] = Array.isArray(mall && mall.goods_list) ? mall.goods_list : [];
        const goods: any[] = [];
        for (const b of raw) {
            try {
                goods.push(types.MallGoods.decode(b));
            } catch {
                // ignore
            }
        }
        const free: any[] = goods.filter((g: any) => !!g && g.is_free === true && Number(g.goods_id || 0) > 0);
        if (!free.length) {
            freeGiftDoneDateKey = getDateKey();
            log('商城', '今日暂无可领取免费礼包', {
                module: 'task',
                event: FREE_GIFTS_DAILY_KEY,
                result: 'none',
            });
            return 0;
        }

        let bought: number = 0;
        for (const g of free) {
            try {
                await purchaseMallGoods(Number(g.goods_id || 0), 1);
                bought += 1;
            } catch {
                // 单个失败跳过
            }
        }
        freeGiftDoneDateKey = getDateKey();
        if (bought > 0) {
            freeGiftLastAt = Date.now();
            log('商城', `自动购买免费礼包 x${bought}`, {
                module: 'task',
                event: FREE_GIFTS_DAILY_KEY,
                result: 'ok',
                count: bought,
            });
        } else {
            log('商城', '本次未成功领取免费礼包', {
                module: 'task',
                event: FREE_GIFTS_DAILY_KEY,
                result: 'none',
            });
        }
        return bought;
    } catch (e: any) {
        log('商城', `领取免费礼包失败: ${e.message}`, {
            module: 'task',
            event: FREE_GIFTS_DAILY_KEY,
            result: 'error',
        });
        return 0;
    }
}

async function checkAndBuyFertilizerByThreshold(type: string, count: number, thresholdHours: number): Promise<any> {
    const { getBag, getBagItems, getContainerHoursFromBagItems } = require('./warehouse');

    if (count <= 0 || thresholdHours <= 0) {
        return { bought: 0, message: '参数无效' };
    }

    try {
        const bagReply: any = await getBag();
        const bagItems: any[] = getBagItems(bagReply);
        const containerHours: { normal: number; organic: number } = getContainerHoursFromBagItems(bagItems);

        const currentHours: number = type === 'normal' ? containerHours.normal : containerHours.organic;
        const typeName: string = type === 'normal' ? '无机化肥' : '有机化肥';

        log('商城', `检测${typeName}容器: 剩余 ${currentHours.toFixed(1)} 小时，阈值 ${thresholdHours} 小时`, {
            module: 'mall',
            event: 'check_fertilizer',
            type,
            currentHours,
            thresholdHours,
        });

        if (currentHours < thresholdHours) {
            const bought: number = await autoBuyFertilizer(true, type, count);
            return { bought, currentHours, thresholdHours, needed: true };
        }

        return { bought: 0, currentHours, thresholdHours, needed: false };
    } catch (e: any) {
        log('商城', `检测化肥容器失败: ${e.message}`, {
            module: 'mall',
            event: 'check_fertilizer',
            result: 'error',
            error: e.message,
        });
        return { bought: 0, error: e.message };
    }
}

async function checkAndBuyFertilizerBoth(options: any): Promise<any> {
    const { getBag, getBagItems, getContainerHoursFromBagItems } = require('./warehouse');
    const { sleep } = require('../utils/utils');

    const {
        buyOrganic = false,
        buyNormal = false,
        organicCount = 0,
        organicThresholdHours = 0,
        normalCount = 0,
        normalThresholdHours = 0,
    } = options || {};

    const result: any = {
        organicBought: 0,
        normalBought: 0,
        organicCurrentHours: 0,
        normalCurrentHours: 0,
    };

    if (!buyOrganic && !buyNormal) {
        return result;
    }

    try {
        const bagReply: any = await getBag();
        const bagItems: any[] = getBagItems(bagReply);
        const containerHours: { normal: number; organic: number } = getContainerHoursFromBagItems(bagItems);

        result.organicCurrentHours = containerHours.organic;
        result.normalCurrentHours = containerHours.normal;

        // 优先购买有机化肥
        if (buyOrganic && organicCount > 0 && organicThresholdHours > 0) {
            log('商城', `检测有机化肥容器: 剩余 ${containerHours.organic.toFixed(1)} 小时，阈值 ${organicThresholdHours} 小时`, {
                module: 'mall',
                event: 'check_fertilizer_organic',
                currentHours: containerHours.organic,
                thresholdHours: organicThresholdHours,
            });

            if (containerHours.organic < organicThresholdHours) {
                result.organicBought = await autoBuyFertilizer(true, 'organic', organicCount);
            }
        }

        // 如果同时购买两种化肥，添加随机延迟
        if (buyOrganic && buyNormal && result.organicBought > 0) {
            const delay: number = 1000 + Math.random() * 1000; // 1000-2000ms
            await sleep(delay);
        }

        // 购买无机化肥
        if (buyNormal && normalCount > 0 && normalThresholdHours > 0) {
            log('商城', `检测无机化肥容器: 剩余 ${containerHours.normal.toFixed(1)} 小时，阈值 ${normalThresholdHours} 小时`, {
                module: 'mall',
                event: 'check_fertilizer_normal',
                currentHours: containerHours.normal,
                thresholdHours: normalThresholdHours,
            });

            if (containerHours.normal < normalThresholdHours) {
                result.normalBought = await autoBuyFertilizer(true, 'normal', normalCount);
            }
        }

        return result;
    } catch (e: any) {
        log('商城', `检测化肥容器失败: ${e.message}`, {
            module: 'mall',
            event: 'check_fertilizer',
            result: 'error',
            error: e.message,
        });
        return { ...result, error: e.message };
    }
}

// ============================================================
// 商城目录与手动购买 (页面前端使用)
// ============================================================

function readWireVarint(bytes: any, offset: number): { value: number; offset: number } {
    let index: number = offset;
    let value: number = 0;
    let shift: number = 0;
    while (index < bytes.length) {
        const b: number = bytes[index++];
        value |= (b & 0x7F) << shift;
        if ((b & 0x80) === 0) {
            return { value, offset: index };
        }
        shift += 7;
    }
    throw new Error('无效的 protobuf varint');
}

function decodeWireFields(input: any): any[] {
    const bytes: any = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
    const fields: any[] = [];
    let offset: number = 0;
    while (offset < bytes.length) {
        const key = readWireVarint(bytes, offset);
        offset = key.offset;
        const field: number = key.value >> 3;
        const wire: number = key.value & 0x07;
        if (field <= 0) break;
        if (wire === 0) {
            const parsed = readWireVarint(bytes, offset);
            fields.push({ field, wire, value: parsed.value });
            offset = parsed.offset;
        } else if (wire === 2) {
            const length = readWireVarint(bytes, offset);
            offset = length.offset;
            const end: number = offset + length.value;
            if (length.value < 0 || end > bytes.length) break;
            fields.push({ field, wire, value: bytes.subarray(offset, end) });
            offset = end;
        } else {
            break;
        }
    }
    return fields;
}

function decodeItemCandidates(input: any, depth: number = 0): { id: number; count: number }[] {
    if (depth > 3) return [];
    let fields: any[] = [];
    try {
        fields = decodeWireFields(input);
    } catch {
        return [];
    }
    const items: { id: number; count: number }[] = [];
    const idField = fields.find((entry: any) => entry.field === 1 && entry.wire === 0);
    const countField = fields.find((entry: any) => entry.field === 2 && entry.wire === 0);
    if (idField && Number(idField.value) > 0) {
        const id: number = Number(idField.value);
        const known: boolean = !!getItemById(id) || [1, 1001, 1002, 1005, 1101].includes(id);
        if (known) items.push({ id, count: Math.max(1, Number(countField && countField.value) || 1) });
    }
    for (const entry of fields) {
        if (entry.wire !== 2 || !entry.value || !entry.value.length) continue;
        items.push(...decodeItemCandidates(entry.value, depth + 1));
    }
    const merged: Map<number, { id: number; count: number }> = new Map();
    for (const item of items) {
        const previous = merged.get(item.id);
        if (!previous || item.count > previous.count) merged.set(item.id, item);
    }
    return Array.from(merged.values());
}

function getCurrencyMeta(itemId: number): { id: number; unit: string; balanceKey: string } {
    const id: number = Number(itemId) || 0;
    if (id === 1 || id === 1001) return { id, unit: '金币', balanceKey: 'gold' };
    if (id === 1002) return { id, unit: '点券', balanceKey: 'coupon' };
    if (id === 1004) return { id, unit: '钻石', balanceKey: 'diamond' };
    if (id === 1005) return { id, unit: '金豆豆', balanceKey: 'goldBean' };
    const info: any = getItemById(id);
    return { id, unit: info && info.name ? String(info.name) : `货币#${id || '?'}`, balanceKey: '' };
}

function parseMallPrice(priceField: any, isFree: boolean = false): { itemId: number; amount: number; unit: string; balanceKey: string } {
    if (isFree) return { itemId: 0, amount: 0, unit: '免费', balanceKey: '' };
    const candidates = decodeItemCandidates(priceField);
    const priceItem = candidates.find((item: any) => [1, 1001, 1002, 1005].includes(item.id)) || candidates[0];
    const amount: number = priceItem ? Math.max(0, Number(priceItem.count) || 0) : parseMallPriceValue(priceField);
    const meta = getCurrencyMeta(priceItem && priceItem.id);
    return { itemId: meta.id, amount, unit: meta.unit, balanceKey: meta.balanceKey };
}

function normalizeMallItem(item: any): any {
    const id: number = Number(item && item.id) || 0;
    const info: any = getItemById(id) || {};
    return {
        id,
        count: Math.max(1, Number(item && item.count) || 1),
        name: info.name ? String(info.name) : `物品#${id}`,
        description: String(info.desc || info.effectDesc || ''),
        image: getItemImageById(id),
    };
}

function inferGoodsItem(goods: any): { id: number; count: number } | null {
    const goodsId: number = Number(goods && goods.goods_id) || 0;
    const knownGoodsItems: Map<number, number> = new Map([
        [ORGANIC_FERTILIZER_MALL_GOODS_ID, 100004],
        [INORGANIC_FERTILIZER_MALL_GOODS_ID, 100003],
    ]);
    const knownItemId: number | undefined = knownGoodsItems.get(goodsId);
    if (knownItemId) return { id: knownItemId, count: 1 };
    const info: any = getItemByName(goods && goods.name);
    return info && Number(info.id) > 0 ? { id: Number(info.id), count: 1 } : null;
}

function inferLimitType(name: string, typeValue: number, fallback: string = 'permanent'): string {
    const text: string = String(name || '');
    if (/每日|今日/.test(text)) return 'daily';
    if (/永久/.test(text)) return 'permanent';
    if (typeValue === 1) return 'daily';
    if (typeValue === 2) return 'permanent';
    return fallback;
}

function collectWireNumericMessages(input: any, depth: number = 0): any[] {
    if (depth > 3) return [];
    let fields: any[] = [];
    try {
        fields = decodeWireFields(input);
    } catch {
        return [];
    }
    const messages: any[] = [];
    const numeric = fields
        .filter((entry: any) => entry.wire === 0)
        .map((entry: any) => ({ field: entry.field, value: Math.max(0, Math.floor(Number(entry.value) || 0)) }));
    if (numeric.length) messages.push(numeric);
    for (const entry of fields) {
        if (entry.wire !== 2 || !entry.value || !entry.value.length) continue;
        messages.push(...collectWireNumericMessages(entry.value, depth + 1));
    }
    return messages;
}

function parseMallLimit(limitField: any, goodsName: string): any {
    const bytes: any = Buffer.isBuffer(limitField) ? limitField : Buffer.from(limitField || []);
    if (!bytes.length) return null;
    const candidates: any[] = [];
    const messages = collectWireNumericMessages(bytes);
    const addBoughtCandidate = (values: Map<number, number>, boughtField: number, limitFieldId: number, typeField: number, score: number) => {
        if (!values.has(boughtField) || !values.has(limitFieldId)) return;
        const limitCount: number = values.get(limitFieldId) || 0;
        const boughtNum: number = values.get(boughtField) || 0;
        if (limitCount <= 0 || boughtNum < 0 || boughtNum > limitCount) return;
        candidates.push({
            limitCount,
            remaining: Math.max(0, limitCount - boughtNum),
            typeValue: typeField && values.has(typeField) ? values.get(typeField) : 0,
            score,
        });
    };
    const addCandidate = (values: Map<number, number>, remainingField: number, limitFieldId: number, typeField: number, score: number) => {
        if (!values.has(remainingField) || !values.has(limitFieldId)) return;
        const limitCount: number = values.get(limitFieldId) || 0;
        const remaining: number = values.get(remainingField) || 0;
        if (limitCount <= 0 || remaining < 0 || remaining > limitCount) return;
        candidates.push({
            limitCount,
            remaining,
            typeValue: typeField && values.has(typeField) ? values.get(typeField) : 0,
            score,
        });
    };
    for (const numeric of messages) {
        const values: Map<number, number> = new Map();
        for (const entry of numeric) {
            if (!values.has(entry.field) || entry.value > (values.get(entry.field) || 0)) {
                values.set(entry.field, entry.value);
            }
        }
        addBoughtCandidate(values, 1, 2, 3, 140);
        addBoughtCandidate(values, 2, 3, 1, 120);
        addCandidate(values, 2, 3, 1, 80);
        addCandidate(values, 1, 2, 3, 60);
        addCandidate(values, 3, 4, 1, 90);
        addCandidate(values, 4, 5, 1, 80);
    }
    if (!candidates.length) return null;
    candidates.sort((a: any, b: any) => b.score - a.score);
    const best: any = candidates[0];
    return {
        limitCount: best.limitCount,
        boughtNum: Math.max(0, best.limitCount - best.remaining),
        remaining: best.remaining,
        limitType: inferLimitType(goodsName, best.typeValue, 'permanent'),
    };
}

function normalizeMallGoods(goods: any, slotType: number): any {
    const decodedItems = decodeItemCandidates(goods && goods.item_ids);
    if (!decodedItems.length) {
        const inferred = inferGoodsItem(goods);
        if (inferred) decodedItems.push(inferred);
    }
    const items = decodedItems.map(normalizeMallItem);
    const primary = items[0] || null;
    const isFree: boolean = !!(goods && goods.is_free);
    const limit = parseMallLimit(goods && goods.limit, goods && goods.name);
    const limitCount: number = limit ? limit.limitCount : 0;
    const boughtNum: number = limit ? limit.boughtNum : 0;
    return {
        goodsId: Number(goods && goods.goods_id) || 0,
        source: 'mall',
        shopId: 0,
        shopName: '道具商城',
        slotType: Number(slotType) || 1,
        name: String((goods && goods.name) || (primary && primary.name) || '未知商品'),
        type: Number(goods && goods.type) || 0,
        isFree,
        isLimited: !!(goods && goods.is_limited) || limitCount > 0,
        discount: String(goods && goods.discount || ''),
        price: parseMallPrice(goods && goods.price, isFree),
        items,
        image: primary ? primary.image : '',
        description: primary ? primary.description : '',
        unlocked: true,
        boughtNum,
        limitCount,
        limitType: limit ? limit.limitType : inferLimitType(goods && goods.name, 0, 'permanent'),
        remaining: limit ? limit.remaining : null,
    };
}

function normalizeShopGoods(goods: any, shopId: number): any {
    const itemId: number = Number(goods && goods.item_id) || 0;
    const item: any = normalizeMallItem({ id: itemId, count: Number(goods && goods.item_count) || 1 });
    const limitCount: number = Math.max(0, Math.floor(Number(goods && goods.limit_count) || 0));
    const boughtNum: number = Math.max(0, Math.floor(Number(goods && goods.bought_num) || 0));
    return {
        goodsId: Number(goods && goods.id) || 0,
        source: 'shop',
        shopId: Number(shopId) || 0,
        shopName: Number(shopId) === 3 ? '宠物商店' : '道具商店',
        slotType: 0,
        name: item.name,
        type: 0,
        isFree: Number(goods && goods.price) <= 0,
        isLimited: limitCount > 0,
        discount: '',
        price: Number(goods && goods.price) <= 0
            ? { itemId: 0, amount: 0, unit: '免费', balanceKey: '' }
            : { itemId: 1001, amount: Math.max(0, Number(goods && goods.price) || 0), unit: '金币', balanceKey: 'gold' },
        items: [item],
        image: item.image,
        description: item.description,
        unlocked: goods && goods.unlocked !== false,
        boughtNum,
        limitCount,
        limitType: 'permanent',
        remaining: limitCount > 0 ? Math.max(0, limitCount - boughtNum) : null,
    };
}

async function getShopGoodsList(shopId: number): Promise<any[]> {
    const body: Uint8Array = types.ShopInfoRequest.encode(types.ShopInfoRequest.create({
        shop_id: Number(shopId) || 0,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.shoppb.ShopService', 'ShopInfo', body);
    const reply: any = types.ShopInfoReply.decode(replyBody);
    return Array.isArray(reply && reply.goods_list) ? reply.goods_list : [];
}

async function purchaseShopGoods(goodsId: number, count: number, price: number): Promise<any> {
    const body: Uint8Array = types.BuyGoodsRequest.encode(types.BuyGoodsRequest.create({
        goods_id: Number(goodsId) || 0,
        num: Number(count) || 1,
        price: Number(price) || 0,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.shoppb.ShopService', 'BuyGoods', body);
    return types.BuyGoodsReply.decode(replyBody);
}

async function getMallCatalog(slotType: number = 1): Promise<any[]> {
    const normalizedSlotType: number = Math.max(1, Math.min(20, Number(slotType) || 1));
    const mallSlotTypes: number[] = Array.from(new Set<number>([normalizedSlotType, 1, 2, 3, 4, 5]));
    const mallResults: any[] = await Promise.allSettled(mallSlotTypes.map((type: number) => getMallGoodsList(type)));
    const [itemShopResult, petShopResult]: any[] = await Promise.allSettled([
        getShopGoodsList(1),
        getShopGoodsList(3),
    ]);
    if (mallResults.every((r: any) => r.status === 'rejected') && itemShopResult.status === 'rejected' && petShopResult.status === 'rejected') {
        throw mallResults[0].reason;
    }
    const mallGoods: any[] = [];
    for (let i = 0; i < mallResults.length; i++) {
        const result: any = mallResults[i];
        if (result.status !== 'fulfilled') continue;
        mallGoods.push(...result.value.map((g: any) => normalizeMallGoods(g, mallSlotTypes[i])));
    }
    const itemShopGoods: any[] = itemShopResult.status === 'fulfilled' ? itemShopResult.value : [];
    const petShopGoods: any[] = petShopResult.status === 'fulfilled' ? petShopResult.value : [];
    const merged: Map<string, any> = new Map();
    for (const goods of [
        ...mallGoods,
        ...itemShopGoods.map((g: any) => normalizeShopGoods(g, 1)),
        ...petShopGoods.map((g: any) => normalizeShopGoods(g, 3)),
    ].filter((g: any) => g.goodsId > 0)) {
        const key: string = `${goods.source}-${goods.shopId}-${goods.slotType}-${goods.goodsId}`;
        if (!merged.has(key)) merged.set(key, goods);
    }
    return Array.from(merged.values());
}

async function purchaseCatalogGoods(goodsId: number, count: number = 1, slotType: number = 1, source: string = 'mall', shopId: number = 0): Promise<any> {
    const normalizedGoodsId: number = Number(goodsId) || 0;
    const normalizedCount: number = Math.max(1, Math.min(99, Math.floor(Number(count) || 1)));
    const normalizedSource: string = source === 'shop' ? 'shop' : 'mall';
    const normalizedShopId: number = Number(shopId) || 0;
    if (normalizedGoodsId <= 0) throw new Error('无效的商城商品 ID');

    const catalog: any[] = await getMallCatalog(slotType);
    const goods: any = catalog.find((item: any) => item.goodsId === normalizedGoodsId
        && item.source === normalizedSource
        && (normalizedSource !== 'shop' || item.shopId === normalizedShopId));
    if (!goods) throw new Error('该商品当前不在官方商城中');
    if (goods.unlocked === false) throw new Error('该商品尚未解锁');
    if (goods.remaining !== null && normalizedCount > goods.remaining) {
        throw new Error(`该商品最多还可购买 ${goods.remaining} 个`);
    }

    let reply: any;
    let rewards: any[] = [];
    if (normalizedSource === 'shop') {
        reply = await purchaseShopGoods(normalizedGoodsId, normalizedCount, goods.price.amount);
        rewards = Array.isArray(reply && reply.get_items) ? reply.get_items.map(normalizeMallItem) : [];
    } else {
        reply = await purchaseMallGoods(normalizedGoodsId, normalizedCount);
        rewards = decodeItemCandidates(reply && reply.reward_info).map(normalizeMallItem);
    }
    log('商城', `购买 ${goods.name} x${normalizedCount} 成功`, {
        module: 'mall',
        event: '手动购买道具',
        result: 'ok',
        goodsId: normalizedGoodsId,
        count: normalizedCount,
    });
    return {
        goodsId: normalizedGoodsId,
        count: normalizedSource === 'mall' ? (Number(reply && reply.count) || normalizedCount) : normalizedCount,
        name: goods.name,
        rewards,
    };
}

module.exports = {
    autoBuyOrganicFertilizer,
    autoBuyFertilizer,
    checkAndBuyFertilizerByThreshold,
    checkAndBuyFertilizerBoth,
    buyFreeGifts,
    getMallCatalog,
    purchaseCatalogGoods,
    getFertilizerBuyDailyState: () => ({
        key: 'fertilizer_buy',
        doneToday: buyDoneDateKey === getDateKey(),
        pausedNoGoldToday: buyPausedNoGoldDateKey === getDateKey(),
        lastSuccessAt: buyLastSuccessAt,
    }),
    getFreeGiftDailyState: () => ({
        key: FREE_GIFTS_DAILY_KEY,
        doneToday: freeGiftDoneDateKey === getDateKey(),
        lastCheckAt: freeGiftLastCheckAt,
        lastClaimAt: freeGiftLastAt,
    }),
};
