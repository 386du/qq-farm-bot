export {};
/**
 * 活动服务 - 荷风游记 (Lotus Breeze Travel)
 * 负责：活动聚合、抽奖、商店兑换、每日签到、战令、任务
 */

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { toLong, toNum, log } = require('../utils/utils');
const {
    formatGrowTime,
    getAllItems,
    getAllPlants,
    getItemById,
    getItemImageById,
    getPlantGrowTime,
    getSeedImageBySeedId,
} = require('../config/gameConfig');
const { claimTaskReward, getTaskInfo } = require('./task');
const { getBag, getBagItems } = require('./warehouse');

const DEFAULT_ACTIVITY_NAME = '荷风游记';
const DEFAULT_ACTIVITY_ALIASES = [
    '荷风游记',
    '荷风十里蝉初鸣',
    '荷露',
    '游记积分',
    '枕水听荷',
    '绿荫闲庭',
];
// 活动代币：1018 荷露、1019 游记积分
const CURRENT_ACTIVITY_CURRENCY_IDS = new Set([1018, 1019]);

const ACTIVITY_SERVICE = 'gamepb.activitypb.ActivityService';
const SEASON_SERVICE = 'gamepb.seasonpb.SeasonService';

const ACTIVITY_OPERATE = {
    SHOP_BUY: 1,
    DAILY_SIGNIN_CLAIM: 4,
    DRAW: 5,
    LOTTERY_DRAW: 9,
};

const OTHER_EVENT_NAME_TERMS = [
    '南瓜乐翻天',
    '清明春耕',
    '粽香大比拼',
    '端午粽香',
    '萌宠柯基',
];

function normalizeText(value: string): string {
    return String(value || '').replace(/\s+/g, '');
}

function includesAny(text: string, terms: string[]): boolean {
    const source = normalizeText(text);
    return terms.some((term: string) => source.includes(normalizeText(term)));
}

function buildTerms(activityName: string): string[] {
    const name = String(activityName || DEFAULT_ACTIVITY_NAME).trim();
    const terms: string[] = [...DEFAULT_ACTIVITY_ALIASES];
    if (name && !terms.includes(name)) terms.unshift(name);
    return terms;
}

function getItemText(item: any): string {
    if (!item || typeof item !== 'object') return '';
    return [
        item.name,
        item.desc,
        item.effectDesc,
        item.asset_name,
    ].map((v: any) => String(v || '')).join(' ');
}

function belongsToOtherEventByName(item: any): boolean {
    const name = String((item && item.name) || '');
    return OTHER_EVENT_NAME_TERMS.some((term: string) => name.includes(term));
}

function isDirectActivityItem(item: any, terms: string[]): boolean {
    const id = toNum(item && item.id);
    if (CURRENT_ACTIVITY_CURRENCY_IDS.has(id)) return true;
    const name = String((item && item.name) || '');
    const desc = String((item && item.desc) || '');
    const effectDesc = String((item && item.effectDesc) || '');
    const text = getItemText(item);
    if (desc.includes('游记积分')) return true;
    if (includesAny(name, terms)) return true;
    if (belongsToOtherEventByName(item)) return false;
    return includesAny(`${desc} ${effectDesc} ${text}`, terms);
}

function getPriceUnit(priceId: number): string {
    const id = toNum(priceId);
    if (id === 1005) return '金豆豆';
    if (id === 1002) return '点券';
    if (id === 1001 || id === 1 || id === 0) return '金币';
    const info: any = getItemById(id);
    return info && info.name ? String(info.name) : `物品#${id}`;
}

function buildBagCounts(rawItems: any[]): Map<number, number> {
    const counts: Map<number, number> = new Map();
    for (const it of (rawItems || [])) {
        const id = toNum(it && it.id);
        const count = toNum(it && it.count);
        if (id <= 0 || count <= 0) continue;
        counts.set(id, (counts.get(id) || 0) + count);
    }
    return counts;
}

function itemCategory(item: any, context: { seedIds: Set<number>; fruitIds: Set<number> }): string {
    const id = toNum(item && item.id);
    if (CURRENT_ACTIVITY_CURRENCY_IDS.has(id) || Number(item && item.type) === 19 || Number(item && item.type) === 24) {
        return 'currency';
    }
    if (context.seedIds.has(id)) return 'seed';
    if (context.fruitIds.has(id)) return 'fruit';
    if (Number(item && item.type) === 11) return 'gift';
    if (Number(item && item.type) === 18 || Number(item && item.type) === 10) return 'reward';
    return 'item';
}

function buildItemCard(item: any, bagCounts: Map<number, number>, category: string): any {
    const id = toNum(item && item.id);
    const desc = String((item && (item.desc || item.effectDesc)) || '');
    const price = Number(item && item.price) || 0;
    const priceId = Number(item && item.price_id) || 0;
    return {
        id,
        name: String(item && item.name || `物品#${id}`),
        category,
        count: bagCounts.get(id) || 0,
        image: getItemImageById(id),
        description: desc,
        type: Number(item && item.type) || 0,
        assetName: String(item && item.asset_name || ''),
        price,
        priceId,
        priceUnit: getPriceUnit(priceId),
    };
}

function buildCropCard(plant: any, bagCounts: Map<number, number>): any {
    const seedId = toNum(plant && plant.seed_id);
    const fruitId = toNum(plant && plant.fruit && plant.fruit.id);
    const seedInfo: any = seedId > 0 ? getItemById(seedId) : null;
    const fruitInfo: any = fruitId > 0 ? getItemById(fruitId) : null;
    const growSeconds: number = getPlantGrowTime(toNum(plant && plant.id));
    const priceId: number = Number(fruitInfo && fruitInfo.price_id) || 0;
    return {
        plantId: toNum(plant && plant.id),
        name: String(plant && plant.name || `植物#${toNum(plant && plant.id)}`),
        seedId,
        seedName: seedInfo && seedInfo.name ? String(seedInfo.name) : (seedId > 0 ? `种子#${seedId}` : ''),
        seedCount: seedId > 0 ? (bagCounts.get(seedId) || 0) : 0,
        fruitId,
        fruitName: fruitInfo && fruitInfo.name ? String(fruitInfo.name) : (fruitId > 0 ? `果实#${fruitId}` : ''),
        fruitCount: fruitId > 0 ? (bagCounts.get(fruitId) || 0) : 0,
        image: seedId > 0 ? (getSeedImageBySeedId(seedId) || getItemImageById(seedId)) : getItemImageById(fruitId),
        fruitImage: getItemImageById(fruitId),
        size: Math.max(1, Number(plant && plant.size) || 1),
        requiredLevel: Math.max(0, Number(plant && plant.land_level_need) || 0),
        seasons: Math.max(1, Number(plant && plant.seasons) || 1),
        harvestCount: Math.max(0, Number(plant && plant.fruit && plant.fruit.count) || 0),
        growSeconds,
        growTimeText: growSeconds > 0 ? formatGrowTime(growSeconds) : '',
        exp: Math.max(0, Number(plant && plant.exp) || 0),
        price: Number(fruitInfo && fruitInfo.price) || 0,
        priceId,
        priceUnit: getPriceUnit(priceId),
    };
}

function buildActivityCatalog(activityName: string, rawItems: any[]): any {
    const terms = buildTerms(activityName);
    const bagCounts = buildBagCounts(rawItems);
    const allItems = getAllItems();
    const allPlants = getAllPlants();
    const directActivityItemIds: Set<number> = new Set(
        allItems
            .filter((item: any) => isDirectActivityItem(item, terms))
            .map((item: any) => toNum(item && item.id))
            .filter(Boolean),
    );

    const plants = allPlants.filter((plant: any) => {
        const seedId = toNum(plant && plant.seed_id);
        const fruitId = toNum(plant && plant.fruit && plant.fruit.id);
        return (seedId > 0 && directActivityItemIds.has(seedId))
            || (fruitId > 0 && directActivityItemIds.has(fruitId));
    });

    const seedIds: Set<number> = new Set<number>(plants.map((p: any) => toNum(p && p.seed_id)).filter((n: any) => Boolean(n)) as number[]);
    const fruitIds: Set<number> = new Set<number>(plants.map((p: any) => toNum(p && p.fruit && p.fruit.id)).filter((n: any) => Boolean(n)) as number[]);
    const activityItemIds: Set<number> = new Set([...directActivityItemIds, ...seedIds, ...fruitIds]);
    const itemContext = { seedIds, fruitIds };

    const categoryOrder: Map<string, number> = new Map([
        ['currency', 0],
        ['seed', 1],
        ['fruit', 2],
        ['gift', 3],
        ['reward', 4],
        ['item', 5],
    ]);
    const itemCards: any[] = Array.from(activityItemIds)
        .map((id: number) => getItemById(id))
        .filter(Boolean)
        .map((item: any) => buildItemCard(item, bagCounts, itemCategory(item, itemContext)))
        .sort((a: any, b: any) => {
            const ca = categoryOrder.get(a.category) ?? 99;
            const cb = categoryOrder.get(b.category) ?? 99;
            if (ca !== cb) return ca - cb;
            if ((b.count || 0) !== (a.count || 0)) return (b.count || 0) - (a.count || 0);
            return (a.id || 0) - (b.id || 0);
        });

    const cropCards: any[] = plants
        .map((plant: any) => buildCropCard(plant, bagCounts))
        .sort((a: any, b: any) => {
            if ((b.seedCount || 0) !== (a.seedCount || 0)) return (b.seedCount || 0) - (a.seedCount || 0);
            if ((b.fruitCount || 0) !== (a.fruitCount || 0)) return (b.fruitCount || 0) - (a.fruitCount || 0);
            return (a.plantId || 0) - (b.plantId || 0);
        });

    return {
        activity: {
            name: activityName || DEFAULT_ACTIVITY_NAME,
            aliases: terms,
        },
        updatedAt: Date.now(),
        currencies: itemCards.filter((item: any) => item.category === 'currency'),
        crops: cropCards,
        items: itemCards.filter((item: any) => item.category !== 'currency'),
        seedPriorityIds: cropCards.map((crop: any) => crop.seedId).filter(Boolean),
        summary: {
            currencyCount: itemCards.filter((item: any) => item.category === 'currency').length,
            cropCount: cropCards.length,
            itemCount: itemCards.length,
            heldKinds: itemCards.filter((item: any) => Number(item.count || 0) > 0).length,
        },
    };
}

function normalizeHead(head: any): any {
    if (!head) return null;
    return {
        id: toNum(head.id),
        groupId: toNum(head.group_id),
        type: toNum(head.type),
        name: String(head.name || ''),
        description: String(head.desc || ''),
        startTime: toNum(head.start_time),
        endTime: toNum(head.end_time),
        clientId: toNum(head.client_id),
        status: toNum(head.status),
        hasRedDot: !!head.has_red_dot,
    };
}

function normalizeRewardItem(item: any): any {
    const id = toNum(item && item.id);
    const info: any = id > 0 ? getItemById(id) : null;
    return {
        id,
        name: info && info.name ? String(info.name) : (id > 0 ? `物品#${id}` : ''),
        count: Math.max(0, toNum(item && item.count)),
        uid: toNum(item && item.uid),
        expireTime: toNum(item && item.expire_time),
        image: id > 0 ? getItemImageById(id) : '',
    };
}

function normalizeShopItem(item: any): any {
    const id = toNum(item && item.id);
    const info: any = id > 0 ? getItemById(id) : null;
    return {
        id,
        name: info && info.name ? String(info.name) : (id > 0 ? `物品#${id}` : ''),
        count: Math.max(0, toNum(item && item.count)),
        image: id > 0 ? getItemImageById(id) : '',
    };
}

function normalizeLotteryPreviewGoods(goods: any): any {
    return {
        goodsId: toNum(goods && goods.goods_id),
        quality: toNum(goods && goods.quality),
        poolType: toNum(goods && goods.pool_type),
        displayUpTag: !!(goods && goods.is_display_up_tag),
        displayUpTagValue: String(goods && goods.display_up_tag_value || ''),
        items: (goods && Array.isArray(goods.items) ? goods.items : []).map(normalizeRewardItem),
    };
}

function normalizeLottery(lottery: any): any {
    if (!lottery) return null;
    const freeRemaining = Math.max(0, toNum(lottery.free_draw_remaining));
    const freeDailyLimit = Math.max(0, toNum(lottery.free_draw_daily_limit));
    const paidRemaining = Math.max(0, toNum(lottery.paid_draw_remaining));
    const paidDailyLimit = Math.max(0, toNum(lottery.paid_draw_daily_limit));
    const paidCostId = toNum(lottery.paid_draw_cost_id);
    const costInfo: any = paidCostId > 0 ? getItemById(paidCostId) : null;
    return {
        freeRemaining,
        freeDailyLimit,
        paidRemaining,
        paidDailyLimit,
        totalRemaining: freeRemaining + paidRemaining,
        totalLimit: freeDailyLimit + paidDailyLimit,
        paidCostId,
        paidCostName: costInfo && costInfo.name ? String(costInfo.name) : (paidCostId > 0 ? `物品#${paidCostId}` : ''),
        paidCostImage: paidCostId > 0 ? getItemImageById(paidCostId) : '',
        paidCostCount: Math.max(0, toNum(lottery.paid_draw_cost_count)),
        paidDiamondCost: Math.max(0, toNum(lottery.paid_draw_diamond_cost)),
        previewGoods: (Array.isArray(lottery.preview_goods) ? lottery.preview_goods : []).map(normalizeLotteryPreviewGoods),
    };
}

function normalizeShopGoods(goods: any): any {
    const item = (Array.isArray(goods && goods.item) ? goods.item : []).map(normalizeShopItem);
    const cost = (Array.isArray(goods && goods.cost) ? goods.cost : []).map(normalizeShopItem);
    const purchaseLimit: number = Math.max(0, toNum(goods && goods.purchase_limit));
    const purchasedCount: number = Math.max(0, toNum(goods && goods.purchased_count));
    const remaining: number | null = purchaseLimit > 0 ? Math.max(0, purchaseLimit - purchasedCount) : null;
    return {
        id: toNum(goods && goods.id),
        name: String((goods && goods.name) || (item[0] && item[0].name) || `商品#${toNum(goods && goods.id)}`),
        description: String(goods && goods.desc || ''),
        item,
        cost,
        purchaseLimit,
        purchasedCount,
        remaining,
        soldOut: remaining === 0,
        order: toNum(goods && goods.order),
        diamondCostCount: Math.max(0, toNum(goods && goods.diamond_cost_count)),
        backgroundType: toNum(goods && goods.background_type),
        restrictionType: toNum(goods && goods.restriction_type),
    };
}

function normalizeShop(shop: any): any {
    if (!shop) return null;
    return {
        goods: (Array.isArray(shop.goods) ? shop.goods : [])
            .map(normalizeShopGoods)
            .sort((a: any, b: any) => (a.order || 0) - (b.order || 0) || (a.id || 0) - (b.id || 0)),
    };
}

function normalizeDailySignin(dailySignin: any): any {
    if (!dailySignin) return null;
    return {
        claimedToday: !!dailySignin.claimed_today,
        inferred: false,
        rewards: (Array.isArray(dailySignin.rewards) ? dailySignin.rewards : []).map((reward: any) => ({
            id: toNum(reward && reward.id),
            description: String(reward && reward.desc || ''),
            items: (Array.isArray(reward && reward.item) ? reward.item : []).map(normalizeRewardItem),
        })),
    };
}

function normalizeActivityData(data: any, groupHead: any = null): any {
    if (!data) return null;
    const activity: any = {
        head: normalizeHead(data.head),
        group: normalizeHead(groupHead),
        lottery: normalizeLottery(data.lottery),
        shop: normalizeShop(data.shop),
        dailySignin: normalizeDailySignin(data.daily_signin),
    };
    activity.bodyType = activity.lottery ? 'lottery'
        : activity.shop ? 'shop'
            : activity.dailySignin ? 'dailySignin'
                : data.draw ? 'draw'
                    : data.rand_shop ? 'randShop'
                        : 'other';
    return activity;
}

function activityText(data: any, groupHead: any = null): string {
    const head = data && data.head;
    return [
        head && head.name,
        head && head.desc,
        groupHead && groupHead.name,
        groupHead && groupHead.desc,
    ].map((v: any) => String(v || '')).join(' ');
}

function shopUsesCurrentCurrency(shop: any): boolean {
    const goods = Array.isArray(shop && shop.goods) ? shop.goods : [];
    return goods.some((g: any) => {
        const costs = Array.isArray(g && g.cost) ? g.cost : [];
        return costs.some((cost: any) => CURRENT_ACTIVITY_CURRENCY_IDS.has(toNum(cost && cost.id)));
    });
}

function activityMatchesTerms(data: any, terms: string[], groupHead: any = null): boolean {
    const text = activityText(data, groupHead);
    if (includesAny(text, terms)) return true;
    if (data && data.shop && shopUsesCurrentCurrency(data.shop)) return true;
    return false;
}

function childActivityText(entry: any): string {
    const head = entry && entry.data && entry.data.head;
    return [head && head.name, head && head.desc].map((v: any) => String(v || '')).join(' ');
}

function childActivityName(entry: any): string {
    const head = entry && entry.data && entry.data.head;
    return String((head && head.name) || '');
}

function entryIncludes(entry: any, terms: string[]): boolean {
    return includesAny(childActivityText(entry), terms);
}

function entryNameIncludes(entry: any, terms: string[]): boolean {
    return includesAny(childActivityName(entry), terms);
}

function flattenActivityGroups(reply: any): any[] {
    const entries: any[] = [];
    for (const group of (Array.isArray(reply && reply.groups) ? reply.groups : [])) {
        for (const child of (Array.isArray(group && group.children) ? group.children : [])) {
            entries.push({ data: child, groupHead: group.head || null });
        }
    }
    return entries;
}

function selectActivityEntries(reply: any, activityName: string = DEFAULT_ACTIVITY_NAME): any {
    const terms = buildTerms(activityName);
    const entries = flattenActivityGroups(reply);
    const exact = entries.filter((entry: any) => activityMatchesTerms(entry.data, terms, entry.groupHead));
    const source = exact.length ? exact : entries;

    const findEntryByName = (entryList: any[]) => entryList.find((entry: any) =>
        entry.data && entry.data.head && entry.data.head.name &&
        typeof entry.data.head.name === 'string' &&
        includesAny(entry.data.head.name, terms)
    ) || null;

    const lotteryEntry = source.find((entry: any) => entry.data && entry.data.lottery)
        || entries.find((entry: any) => entry.data && entry.data.lottery)
        || findEntryByName(entries)
        || null;
    const shopEntry = source.find((entry: any) => entry.data && entry.data.shop && shopUsesCurrentCurrency(entry.data.shop))
        || source.find((entry: any) => entry.data && entry.data.shop)
        || entries.find((entry: any) => entry.data && entry.data.shop && shopUsesCurrentCurrency(entry.data.shop))
        || entries.find((entry: any) => entry.data && entry.data.shop)
        || null;
    const dailySigninEntry = source.find((entry: any) => entry.data && entry.data.daily_signin)
        || entries.find((entry: any) => entry.data && entry.data.daily_signin)
        || findEntryByName(entries)
        || null;
    const drawEntry = source.find((entry: any) => entry.data && entry.data.draw)
        || entries.find((entry: any) => entry.data && entry.data.draw)
        || findEntryByName(entries)
        || null;

    return {
        entries,
        matched: exact,
        lotteryEntry,
        shopEntry,
        dailySigninEntry,
        drawEntry,
    };
}

function normalizeBattlePassLevel(level: any): any {
    return {
        level: toNum(level && level.level),
        freeRewards: (Array.isArray(level && level.free_rewards) ? level.free_rewards : []).map(normalizeRewardItem),
        premiumRewards: (Array.isArray(level && level.premium_rewards) ? level.premium_rewards : []).map(normalizeRewardItem),
        isKeyLevel: !!(level && level.is_key_level),
        levelTag: String((level && level.level_tag) || ''),
    };
}

function normalizeBattlePass(battlepass: any): any {
    if (!battlepass) return null;
    const level: number = Math.max(0, toNum(battlepass.level));
    const freeClaimedLevel: number = Math.max(0, toNum(battlepass.free_claimed_level));
    const premiumClaimedLevel: number = Math.max(0, toNum(battlepass.premium_claimed_level));
    const levels: any[] = (Array.isArray(battlepass.levels) ? battlepass.levels : []).map(normalizeBattlePassLevel);
    const claimableFreeLevels: any[] = levels.filter((item: any) => item.level > freeClaimedLevel && item.level <= level);
    const claimablePremiumLevels: any[] = battlepass.is_premium
        ? levels.filter((item: any) => item.level > premiumClaimedLevel && item.level <= level)
        : [];
    return {
        battlepassId: toNum(battlepass.battlepass_id),
        name: String(battlepass.name || ''),
        description: String(battlepass.desc || ''),
        level,
        totalExp: Math.max(0, toNum(battlepass.total_exp)),
        currentLevelExp: Math.max(0, toNum(battlepass.current_level_exp)),
        nextLevelNeedExp: Math.max(0, toNum(battlepass.next_level_need_exp)),
        maxLevel: Math.max(0, toNum(battlepass.max_level)),
        isPremium: !!battlepass.is_premium,
        freeClaimedLevel,
        premiumClaimedLevel,
        premiumPrice: Math.max(0, toNum(battlepass.premium_price)),
        premiumPurchaseWarning: !!battlepass.premium_purchase_warning,
        claimableFreeLevels,
        claimablePremiumLevels,
        claimableCount: claimableFreeLevels.length + claimablePremiumLevels.length,
        levels,
    };
}

function normalizeSeasonInfo(season: any): any {
    if (!season) return null;
    return {
        seasonId: toNum(season.season_id),
        name: String(season.season_name || ''),
        phase: toNum(season.phase),
        preheatStartTime: toNum(season.preheat_start_time),
        activeStartTime: toNum(season.active_start_time),
        activeEndTime: toNum(season.active_end_time),
        serverTime: toNum(season.server_time),
        activities: (Array.isArray(season.activities) ? season.activities : []).map((activity: any) => ({
            id: toNum(activity && activity.activity_id),
            type: toNum(activity && activity.activity_type),
            name: String(activity && activity.activity_name || ''),
            startTime: toNum(activity && activity.start_time),
            endTime: toNum(activity && activity.end_time),
        })),
        battlePass: normalizeBattlePass(season.battlepass),
    };
}

function normalizeActivityList(reply: any, activityName: string): any {
    const selection = selectActivityEntries(reply, activityName);
    return {
        summaries: (Array.isArray(reply && reply.all_activities) ? reply.all_activities : []).map((item: any) => ({
            id: toNum(item && item.id),
            name: String(item && item.name || ''),
            startTime: toNum(item && item.start_time),
            endTime: toNum(item && item.end_time),
        })),
        activities: selection.entries.map((entry: any) => normalizeActivityData(entry.data, entry.groupHead)).filter(Boolean),
        matchedActivities: selection.matched.map((entry: any) => normalizeActivityData(entry.data, entry.groupHead)).filter(Boolean),
        lotteryActivity: selection.lotteryEntry ? normalizeActivityData(selection.lotteryEntry.data, selection.lotteryEntry.groupHead) : null,
        shopActivity: selection.shopEntry ? normalizeActivityData(selection.shopEntry.data, selection.shopEntry.groupHead) : null,
        dailySigninActivity: selection.dailySigninEntry ? normalizeActivityData(selection.dailySigninEntry.data, selection.dailySigninEntry.groupHead) : null,
        drawActivity: selection.drawEntry ? normalizeActivityData(selection.drawEntry.data, selection.drawEntry.groupHead) : null,
    };
}

async function getActivityList(): Promise<any> {
    const body: Uint8Array = types.ActivityListRequest.encode(types.ActivityListRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync(ACTIVITY_SERVICE, 'List', body);
    return types.ActivityListReply.decode(replyBody);
}

async function getSeasonInfo(skipUpdateNotifiedLevel: boolean = true): Promise<any> {
    const body: Uint8Array = types.GetSeasonInfoRequest.encode(types.GetSeasonInfoRequest.create({
        skip_update_notified_level: !!skipUpdateNotifiedLevel,
    })).finish();
    const { body: replyBody } = await sendMsgAsync(SEASON_SERVICE, 'GetSeasonInfo', body);
    return types.GetSeasonInfoReply.decode(replyBody);
}

async function getActivityLiveState(options: any = {}): Promise<any> {
    const activityName = String(options.activityName || DEFAULT_ACTIVITY_NAME).trim() || DEFAULT_ACTIVITY_NAME;
    const live: any = {
        updatedAt: Date.now(),
        activity: null,
        season: null,
        errors: [],
    };

    try {
        const reply = await getActivityList();
        live.activity = normalizeActivityList(reply, activityName);
    } catch (e: any) {
        live.errors.push({ scope: 'activity', message: e && e.message ? e.message : String(e) });
    }

    try {
        const reply = await getSeasonInfo(true);
        live.season = normalizeSeasonInfo(reply && reply.current_season);
    } catch (e: any) {
        live.errors.push({ scope: 'season', message: e && e.message ? e.message : String(e) });
    }

    return live;
}

async function getActivitySelection(activityName: string = DEFAULT_ACTIVITY_NAME): Promise<any> {
    const reply = await getActivityList();
    return selectActivityEntries(reply, activityName);
}

async function operateActivity(activityId: number, cmd: number, payload: any = {}): Promise<any> {
    const req: any = {
        id: toLong(toNum(activityId)),
        cmd: toLong(cmd),
        ...payload,
    };
    const body: Uint8Array = types.ActivityOperateRequest.encode(types.ActivityOperateRequest.create(req)).finish();
    const { body: replyBody } = await sendMsgAsync(ACTIVITY_SERVICE, 'Operate', body);
    return types.ActivityOperateReply.decode(replyBody);
}

async function drawLottery(options: any = {}): Promise<any> {
    const activityName = String(options.activityName || DEFAULT_ACTIVITY_NAME).trim() || DEFAULT_ACTIVITY_NAME;
    const mode = String(options.mode || 'free');
    const count: number = Math.max(1, Math.floor(Number(options.count) || 1));
    if (mode !== 'free' && !options.allowPaid) {
        throw new Error('付费奇遇需要显式确认，本次未执行');
    }

    const selection = await getActivitySelection(activityName);
    const lotteryEntry = selection.lotteryEntry;
    const activityId = toNum(options.activityId) || toNum(lotteryEntry && lotteryEntry.data && lotteryEntry.data.head && lotteryEntry.data.head.id);
    if (!activityId) throw new Error('没有找到奇遇礼莲活动');

    const lottery = normalizeLottery(lotteryEntry && lotteryEntry.data && lotteryEntry.data.lottery);
    const available = mode === 'free' ? Math.max(0, lottery && lottery.freeRemaining) : Math.max(0, lottery && lottery.paidRemaining);
    const drawCount: number = Math.min(count, available || 0);
    if (drawCount <= 0) {
        throw new Error(mode === 'free' ? '今日免费奇遇次数已用完' : '今日付费奇遇次数已用完');
    }

    const reply = await operateActivity(activityId, ACTIVITY_OPERATE.LOTTERY_DRAW, {
        lottery_draw: {
            free_count: toLong(mode === 'free' ? drawCount : 0),
            paid_count: toLong(mode === 'free' ? 0 : drawCount),
        },
    });
    const rsp = reply && reply.lottery_draw ? reply.lottery_draw : {};
    return {
        mode,
        requestedCount: count,
        drawCount,
        activity: normalizeActivityData(reply && reply.activity),
        results: (Array.isArray(rsp.results) ? rsp.results : []).map((result: any) => ({
            goodsId: toNum(result && result.goods_id),
            quality: toNum(result && result.quality),
            isGuarantee: !!(result && result.is_guarantee),
            items: (Array.isArray(result && result.items) ? result.items : []).map(normalizeRewardItem),
        })),
        rewards: (Array.isArray(rsp.total_rewards) ? rsp.total_rewards : []).map(normalizeRewardItem),
        costs: (Array.isArray(rsp.costs) ? rsp.costs : []).map(normalizeRewardItem),
        partialSuccess: !!rsp.partial_success,
        errorCode: toNum(rsp.error_code),
        errorMessage: String(rsp.error_msg || ''),
    };
}

async function drawActivity(options: any = {}): Promise<any> {
    const activityName = String(options.activityName || DEFAULT_ACTIVITY_NAME).trim() || DEFAULT_ACTIVITY_NAME;
    const count: number = Math.max(1, Math.floor(Number(options.count) || 1));
    const selection = await getActivitySelection(activityName);
    const drawEntry = selection.drawEntry;
    const activityId = toNum(options.activityId) || toNum(drawEntry && drawEntry.data && drawEntry.data.head && drawEntry.data.head.id);
    if (!activityId) throw new Error('没有找到可执行的抽奖活动');

    const reply = await operateActivity(activityId, ACTIVITY_OPERATE.DRAW, {
        draw: {
            count: toLong(count),
        },
    });
    const rsp = reply && reply.draw ? reply.draw : {};
    return {
        count,
        activity: normalizeActivityData(reply && reply.activity),
        awards: (Array.isArray(rsp.awards) ? rsp.awards : []).map(normalizeRewardItem),
        costs: (Array.isArray(rsp.costs) ? rsp.costs : []).map(normalizeRewardItem),
    };
}

async function exchangeShopGoods(options: any = {}): Promise<any> {
    const activityName = String(options.activityName || DEFAULT_ACTIVITY_NAME).trim() || DEFAULT_ACTIVITY_NAME;
    const goodsId: number = Math.max(0, toNum(options.goodsId));
    const count: number = Math.max(1, Math.floor(Number(options.count) || 1));
    if (!goodsId) throw new Error('缺少兑换商品 ID');

    const selection = await getActivitySelection(activityName);
    const shopEntry = selection.shopEntry;
    const activityId = toNum(options.activityId) || toNum(shopEntry && shopEntry.data && shopEntry.data.head && shopEntry.data.head.id);
    if (!activityId) throw new Error('没有找到荷露商店活动');

    const reply = await operateActivity(activityId, ACTIVITY_OPERATE.SHOP_BUY, {
        shop_buy: {
            goods_id: toLong(goodsId),
            count: toLong(count),
        },
    });
    const rsp = reply && reply.shop_buy ? reply.shop_buy : {};
    return {
        goodsId,
        count,
        activity: normalizeActivityData(reply && reply.activity),
        awards: (Array.isArray(rsp.awards) ? rsp.awards : []).map(normalizeRewardItem),
        costs: (Array.isArray(rsp.costs) ? rsp.costs : []).map(normalizeRewardItem),
    };
}

async function claimDailySignin(options: any = {}): Promise<any> {
    const activityName = String(options.activityName || DEFAULT_ACTIVITY_NAME).trim() || DEFAULT_ACTIVITY_NAME;
    const selection = await getActivitySelection(activityName);
    const dailyEntry = selection.dailySigninEntry;
    const activityId = toNum(options.activityId) || toNum(dailyEntry && dailyEntry.data && dailyEntry.data.head && dailyEntry.data.head.id);
    if (!activityId) throw new Error('没有找到活动赠礼');

    const daily = normalizeDailySignin(dailyEntry && dailyEntry.data && dailyEntry.data.daily_signin);
    if (daily && daily.claimedToday) throw new Error('今日活动赠礼已领取');
    const rewardId = toNum(options.rewardId) || toNum(daily && daily.rewards && daily.rewards[0] && daily.rewards[0].id);
    if (!rewardId) throw new Error('没有可领取的活动赠礼');

    const reply = await operateActivity(activityId, ACTIVITY_OPERATE.DAILY_SIGNIN_CLAIM, {
        daily_signin_claim: {
            reward_id: toLong(rewardId),
        },
    });
    const rsp = reply && reply.daily_signin_claim ? reply.daily_signin_claim : {};
    return {
        rewardId,
        activity: normalizeActivityData(reply && reply.activity),
        awards: (Array.isArray(rsp.awards) ? rsp.awards : []).map(normalizeRewardItem),
    };
}

async function claimBattlePassRewards(): Promise<any> {
    const body: Uint8Array = types.ClaimBattlePassRewardsRequest.encode(types.ClaimBattlePassRewardsRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync(SEASON_SERVICE, 'ClaimBattlePassRewards', body);
    const reply: any = types.ClaimBattlePassRewardsReply.decode(replyBody);
    return {
        rewards: (Array.isArray(reply && reply.rewards) ? reply.rewards : []).map(normalizeRewardItem),
        claimedLevels: (Array.isArray(reply && reply.claimed_levels) ? reply.claimed_levels : []).map(toNum),
        battlePass: normalizeBattlePass(reply && reply.battlepass),
        bagOverflow: !!(reply && reply.bag_overflow),
    };
}

function isClaimableTask(task: any): boolean {
    const progress = toNum(task && task.progress);
    const total = toNum(task && task.total_progress);
    return !!(task && task.is_unlocked) && !task.is_claimed && total > 0 && progress >= total;
}

function taskLooksActivityRelated(task: any, activityItemIds: Set<number>, terms: string[]): boolean {
    const rewards = Array.isArray(task && task.rewards) ? task.rewards : [];
    if (rewards.some((item: any) => activityItemIds.has(toNum(item && item.id)))) return true;
    return includesAny(String((task && task.desc) || ''), terms);
}

async function claimActivityTasks(options: any = {}): Promise<any> {
    const activityName = String(options.activityName || DEFAULT_ACTIVITY_NAME).trim() || DEFAULT_ACTIVITY_NAME;
    const catalog = await getActivityOverview({ activityName, includeLive: false });
    const activityItemIds: Set<number> = new Set([
        ...(catalog.currencies || []).map((item: any) => item.id),
        ...(catalog.items || []).map((item: any) => item.id),
        ...(catalog.crops || []).flatMap((crop: any) => [crop.seedId, crop.fruitId]),
    ].filter(Boolean));
    const terms = buildTerms(activityName);
    const taskReply = await getTaskInfo();
    const info = taskReply && taskReply.task_info ? taskReply.task_info : {};
    const tasks = [
        ...(Array.isArray(info.daily_tasks) ? info.daily_tasks : []),
        ...(Array.isArray(info.tasks) ? info.tasks : []),
        ...(Array.isArray(info.growth_tasks) ? info.growth_tasks : []),
    ];
    const claimable = tasks.filter((task: any) => isClaimableTask(task) && taskLooksActivityRelated(task, activityItemIds, terms));
    const claimed: any[] = [];
    const rewards: any[] = [];
    for (const task of claimable) {
        const taskId = toNum(task && task.id);
        try {
            const reply = await claimTaskReward(taskId, false);
            const items = (Array.isArray(reply && reply.items) ? reply.items : []).map(normalizeRewardItem);
            claimed.push({
                id: taskId,
                description: String(task && task.desc || `任务#${taskId}`),
                rewards: items,
            });
            rewards.push(...items);
        } catch (e: any) {
            log('活动', `活动任务#${taskId} 领取失败: ${e && e.message ? e.message : e}`);
        }
    }
    return {
        claimableCount: claimable.length,
        claimedCount: claimed.length,
        claimed,
        rewards,
    };
}

async function getActivityOverview(options: any = {}): Promise<any> {
    const activityName = String(options.activityName || DEFAULT_ACTIVITY_NAME).trim() || DEFAULT_ACTIVITY_NAME;
    const bagReply = await getBag();
    const rawItems = getBagItems(bagReply);
    const catalog = buildActivityCatalog(activityName, rawItems);
    if (options.includeLive === false) return catalog;
    try {
        catalog.live = await getActivityLiveState({ activityName });
    } catch (e: any) {
        catalog.live = {
            updatedAt: Date.now(),
            activity: null,
            season: null,
            errors: [{ scope: 'live', message: e && e.message ? e.message : String(e) }],
        };
    }
    return catalog;
}

module.exports = {
    DEFAULT_ACTIVITY_NAME,
    buildActivityCatalog,
    claimActivityTasks,
    claimBattlePassRewards,
    claimDailySignin,
    drawActivity,
    drawLottery,
    exchangeShopGoods,
    getActivityList,
    getActivityLiveState,
    getActivityOverview,
    getSeasonInfo,
};
