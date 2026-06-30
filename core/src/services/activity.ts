/**
 * 活动服务 - 获取活动列表、参与活动、领取奖励
 */

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { log, toNum, sleep } = require('../utils/utils');

// 活动类型常量
const ACTIVITY_TYPE_LOTTERY = 8;   // 抽奖类
const ACTIVITY_TYPE_SHOP = 3;      // 商店类
const ACTIVITY_TYPE_DAILY = 1;     // 每日任务类

// 操作类型常量
const OPERATE_CLAIM = 1;           // 领取奖励
const OPERATE_DRAW = 7;            // 抽奖
const OPERATE_DRAW_MULTI = 9;      // 十连抽
const OPERATE_VIEW = 10;           // 查看/进入活动

/**
 * 获取活动列表
 */
async function getActivityList(): Promise<any> {
    const body: Uint8Array = types.ActivityListRequest.encode(types.ActivityListRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'List', body);
    return types.ActivityListReply.decode(replyBody);
}

/**
 * 获取活动组详情
 */
async function getActivityGroup(groupId: number): Promise<any> {
    const body: Uint8Array = types.ActivityGetGroupRequest.encode(types.ActivityGetGroupRequest.create({
        group_id: Number(groupId) || 0,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'GetGroup', body);
    return types.ActivityGetGroupReply.decode(replyBody);
}

/**
 * 扫描 protobuf 原始字节，列出所有顶层字段
 * 用于调试服务器返回的真实结构
 */
function scanProtoFields(buf: Buffer): any[] {
    const fields: any[] = [];
    let off = 0;
    while (off < buf.length) {
        const tag = readVarint(buf, off);
        if (!tag) break;
        const fieldNum = tag.value >> 3;
        const wireType = tag.value & 0x7;
        const field: any = { field: fieldNum, wireType, offset: off };
        if (wireType === 0) {
            // varint
            const v = readVarint(buf, tag.next);
            if (!v) break;
            field.value = v.value;
            field.valueStr = v.value <= 0xFFFFFFFF ? v.value : `0x${  v.value.toString(16)}`;
            off = v.next;
        } else if (wireType === 2) {
            // length-delimited
            const len = readVarint(buf, tag.next);
            if (!len) break;
            const data = buf.slice(len.next, len.next + len.value);
            field.length = len.value;
            // 尝试当字符串
            try {
                const str = data.toString('utf8');
                if (/^[\x20-\x7E]+$/.test(str)) {
                    field.value = str;
                } else {
                    field.value = `<bytes len=${  len.value  }>`;
                }
            } catch {
                field.value = `<bytes len=${  len.value  }>`;
            }
            off = len.next + len.value;
        } else if (wireType === 5) {
            // 32-bit
            field.value = buf.readUInt32LE(tag.next);
            off = tag.next + 4;
        } else if (wireType === 1) {
            // 64-bit
            field.value = `0x${  buf.slice(tag.next, tag.next + 8).toString('hex')}`;
            off = tag.next + 8;
        } else {
            break;
        }
        fields.push(field);
    }
    return fields;
}

/**
 * 活动操作
 */
async function operateActivity(activityId: number, operateType: number = 0, param: number = 0): Promise<any> {
    const body: Uint8Array = types.ActivityOperateRequest.encode(types.ActivityOperateRequest.create({
        activity_id: Number(activityId) || 0,
        operate_type: Number(operateType) || 0,
        param: Number(param) || 0,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'Operate', body);
    const reply = types.ActivityOperateReply.decode(replyBody);
    // 解析 data 字段中的抽奖信息
    const drawInfo = parseDrawInfo(reply.data);
    // 解析 rewards 字段中的实际中奖奖品
    const rewards = parseRewards(reply.rewards);
    const result = Number(reply.result) || 0;
    // 扫描原始字节，列出所有字段
    const scannedFields = scanProtoFields(Buffer.isBuffer(replyBody) ? replyBody : Buffer.from(replyBody));
    console.log('[Activity] operateActivity:', {
        activityId, operateType, param, result,
        dataLen: reply.data?.length,
        dataHex: reply.data ? reply.data.toString('hex').slice(0, 200) : '',
        drawInfo,
        rewardCount: rewards.length,
        rewards,
        scannedFields,
    });
    // 失败时输出更多上下文帮助定位
    if (result !== 0) {
        console.warn(`[Activity] 抽奖/操作失败 result=${result} activityId=${activityId} operateType=${operateType} param=${param} drawInfo=`, drawInfo);
    }
    return { ...reply.toJSON(), drawInfo, rewards, _scannedFields: scannedFields };
}

// 缓存：activityId -> 成功的 (operateType, param) 组合
const drawParamCache: Map<number, { operateType: number, param: number }> = new Map();

/**
 * 自动抽奖
 *
 * 重要发现(2026-06-29): 服务器返回的 OperateReply 没有"结果码"字段。
 * 字段 f1=activityId, f2=echo 的 operate_type(值=7/9/10), f3=抽奖配置 data。
 * 之前误把 f2 当成 result，导致所有抽奖都被判失败。
 *
 * 真正的成功标志:
 *  - rewards 字段(field 108) 有内容 = 抽到了
 *  - 或 drawInfo.freeRemaining 减少 = 免费次数扣减成功
 * 真正的失败标志:
 *  - rewards 为空 且 freeRemaining 没扣减 且 drawInfo 无 freeRemaining 字段
 *    (说明服务器拒绝: 免费次数用完,点券不足等)
 */
async function drawAuto(activityId: number, count: number = 1): Promise<any> {
    const tryCount = count > 1 ? 4 : 1;
    let lastResult: any = null;
    let successCount = 0;

    // 已知正确的参数: op=7 param=0 (单抽) / op=9 param=0 (十连)
    // param=0 让服务器自动用免费次数
    const candidates: { operateType: number, param: number }[] = [
        { operateType: 7, param: 0 },
        { operateType: 9, param: 0 },
        { operateType: 7, param: 1 },
    ];

    // 优先用缓存的参数
    const cached = drawParamCache.get(activityId);
    if (cached) {
        candidates.unshift(cached);
    }

    // 连抽: 逐次执行,实时检查 drawInfo 中的剩余次数
    for (let i = 0; i < tryCount; i++) {
        let drewSomething = false;
        for (const c of candidates) {
            try {
                const reply = await operateActivity(activityId, c.operateType, c.param);
                lastResult = reply;
                const rewards = reply.rewards || [];
                const di = reply.drawInfo || {};
                // 成功标准 (按可靠性排序):
                // 1. rewards 非空 = 确实抽到奖励
                // 2. drawInfo 含 freeRemaining = 免费抽接口正常 (服务器返回了当前免费次数状态)
                //    注意: 失败时(如免费次数用完+点券不足) drawInfo 里没有 freeRemaining 字段
                const hasRewards = rewards.length > 0;
                const hasFreeState = di.freeRemaining !== undefined;
                if (hasRewards || hasFreeState) {
                    drawParamCache.set(activityId, { operateType: c.operateType, param: c.param });
                    drewSomething = true;
                    successCount++;
                    console.log(`[Activity] drawAuto 成功: op=${c.operateType} param=${c.param} rewards=${rewards.length} freeRemaining=${di.freeRemaining}`);
                    break;
                }
                console.log(`[Activity] drawAuto 失败(无freeRemaining): op=${c.operateType} param=${c.param} drawInfo=`, di);
            } catch (e: any) {
                console.warn(`[Activity] drawAuto 异常: op=${c.operateType} param=${c.param} err=${e.message}`);
            }
        }
        // 接口拒绝 → 停止连抽
        if (!drewSomething) {
            console.warn(`[Activity] drawAuto 第${i + 1}次抽奖失败,停止连抽`);
            break;
        }
    }

    // 标准化返回: successCount>0 即视为本次抽奖成功
    if (lastResult) {
        lastResult.result = successCount > 0 ? 0 : 7; // 0=成功, 7=失败
        lastResult._successCount = successCount;
        lastResult._triedCount = tryCount;
    }
    return lastResult;
}

/**
 * 解析 varint
 */
function readVarint(buf: Buffer, offset: number): { value: number; next: number } | null {
    let result = 0; let shift = 0; let pos = offset;
    while (pos < buf.length) {
        const b = buf[pos]; pos++;
        result |= (b & 0x7F) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
    }
    return pos <= buf.length ? { value: result >>> 0, next: pos } : null;
}

/**
 * 解析 OperateReply.data 中的抽奖信息 (field 105)
 */
function parseDrawInfo(data: Buffer | null): any {
    if (!data || data.length === 0) return null;

    try {
        // 找 field 105
        let off = 0;
        while (off < data.length) {
            const tag = readVarint(data, off);
            if (!tag) break;
            const fn = tag.value >> 3; const wt = tag.value & 0x7;
            if (fn === 105 && wt === 2) {
                const len = readVarint(data, tag.next);
                if (!len) break;
                return parseDrawConfig(data, len.next, len.next + len.value);
            }
            if (wt === 0) { const v = readVarint(data, tag.next); if (!v) break; off = v.next; }
            else if (wt === 2) { const v = readVarint(data, tag.next); if (!v) break; off = v.next + v.value; }
            else if (wt === 5) { off = tag.next + 4; }
            else if (wt === 1) { off = tag.next + 8; }
            else break;
        }
    } catch {}
    return null;
}

/**
 * 解析 field 105 的内容
 */
function parseDrawConfig(buf: Buffer, start: number, end: number): any {
    const config: any = { prizes: [] };
    let off = start;

    while (off < end) {
        const tag = readVarint(buf, off);
        if (!tag) break;
        const fn = tag.value >> 3; const wt = tag.value & 0x7;

        if (wt === 0) {
            const v = readVarint(buf, tag.next);
            if (!v) break;
            if (fn === 1) config.freeRemaining = v.value;
            else if (fn === 2) config.freeLimit = v.value;
            else if (fn === 3) config.paidRemaining = v.value;
            else if (fn === 4) config.paidLimit = v.value;
            else if (fn === 5) config.ticketItemId = v.value;
            off = v.next;
        } else if (wt === 2) {
            const len = readVarint(buf, tag.next);
            if (!len) break;
            if (fn === 8) {
                const prize = parsePrizeItem(buf, len.next, len.next + len.value);
                if (prize) config.prizes.push(prize);
            }
            off = len.next + len.value;
        } else if (wt === 5) { off = tag.next + 4; }
        else if (wt === 1) { off = tag.next + 8; }
        else break;
    }

    return config;
}

/**
 * 解析奖品项 (field 105.field 8 / rewards field 108)
 */
function parsePrizeItem(buf: Buffer, start: number, end: number): any {
    const prize: any = {};
    let off = start;

    while (off < end) {
        const tag = readVarint(buf, off);
        if (!tag) break;
        const fn = tag.value >> 3; const wt = tag.value & 0x7;

        if (wt === 0) {
            const v = readVarint(buf, tag.next);
            if (!v) break;
            if (fn === 1) prize.prizeId = v.value;
            else if (fn === 2) prize.quality = v.value;
            else if (fn === 4) prize.count = v.value;
            off = v.next;
        } else if (wt === 2) {
            const len = readVarint(buf, tag.next);
            if (!len) break;
            const sub = buf.slice(len.next, len.next + len.value);
            if (fn === 3) {
                // 种子信息: field 1 = seed_id, field 2 = count
                const seedTag = readVarint(sub, 0);
                if (seedTag) {
                    const seedVal = readVarint(sub, seedTag.next);
                    if (seedVal) prize.seedId = seedVal.value;
                }
            } else if (fn === 6) {
                // 概率字符串
                prize.probability = sub.toString();
            }
            off = len.next + len.value;
        } else if (wt === 5) { off = tag.next + 4; }
        else if (wt === 1) { off = tag.next + 8; }
        else break;
    }

    // 解析种子名称
    if (prize.seedId) {
        try {
            const { getPlantNameBySeedId } = require('../config/gameConfig');
            prize.seedName = getPlantNameBySeedId(prize.seedId);
        } catch {
            prize.seedName = `种子${prize.seedId}`;
        }
    }

    return prize.seedId ? prize : null;
}

/**
 * 解析 rewards 字段 (field 108) — 实际抽奖获得的奖品列表
 * rewards 是 repeated message，每个 item 结构与 parsePrizeItem 相同
 */
function parseRewards(rewards: Buffer | null): any[] {
    if (!rewards || rewards.length === 0) return [];

    const items: any[] = [];
    try {
        let off = 0;
        while (off < rewards.length) {
            const tag = readVarint(rewards, off);
            if (!tag) break;
            const fn = tag.value >> 3; const wt = tag.value & 0x7;
            if (wt === 2) {
                const len = readVarint(rewards, tag.next);
                if (!len) break;
                const item = parsePrizeItem(rewards, len.next, len.next + len.value);
                if (item) items.push(item);
                off = len.next + len.value;
            } else if (wt === 0) {
                const v = readVarint(rewards, tag.next);
                if (!v) break;
                off = v.next;
            } else if (wt === 5) { off = tag.next + 4; }
            else if (wt === 1) { off = tag.next + 8; }
            else break;
        }
    } catch {}
    return items;
}

/**
 * 解析 SeasonInfo.battle_pass (protobuf 二进制)
 * field 1: season_id / group_id
 * field 2: current_level
 * field 3: current_score
 * field 4: current_level_score
 * field 5: level_up_score
 * field 6: max_level
 * field 7: is_premium
 * field 8: levels[]
 */
function parseBattlePass(buf: Buffer | string | null): any {
    if (!buf) return null;
    const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf as string, 'hex');
    if (data.length === 0) return null;

    function readVarint(b: Buffer, off: number) {
        let result = 0; let shift = 0; let pos = off;
        while (pos < b.length) {
            const byte = b[pos]; pos++;
            result |= (byte & 0x7F) << shift;
            if ((byte & 0x80) === 0) break;
            shift += 7;
        }
        return pos <= b.length ? { value: result >>> 0, next: pos } : null;
    }

    function parseRewardItem(b: Buffer, start: number, end: number): any {
        const item: any = {};
        let off = start;
        while (off < end) {
            const tag = readVarint(b, off);
            if (!tag) break;
            const fn = tag.value >> 3; const wt = tag.value & 0x7;
            if (wt === 0) {
                const v = readVarint(b, tag.next);
                if (!v) break;
                if (fn === 1) item.itemId = v.value;
                else if (fn === 2) item.count = v.value;
                off = v.next;
            } else if (wt === 2) {
                const len = readVarint(b, tag.next);
                if (!len) break;
                off = len.next + len.value;
            } else if (wt === 5) { off = tag.next + 4; }
            else if (wt === 1) { off = tag.next + 8; }
            else break;
        }
        return item;
    }

    function parseLevel(b: Buffer, start: number, end: number): any {
        const level: any = { level: 0, freeReward: null, premiumRewards: [] };
        let off = start;
        while (off < end) {
            const tag = readVarint(b, off);
            if (!tag) break;
            const fn = tag.value >> 3; const wt = tag.value & 0x7;
            if (wt === 0) {
                const v = readVarint(b, tag.next);
                if (!v) break;
                if (fn === 1) level.level = v.value;
                off = v.next;
            } else if (wt === 2) {
                const len = readVarint(b, tag.next);
                if (!len) break;
                if (fn === 2) {
                    level.freeReward = parseRewardItem(b, len.next, len.next + len.value);
                } else if (fn === 3) {
                    level.premiumRewards.push(parseRewardItem(b, len.next, len.next + len.value));
                }
                off = len.next + len.value;
            } else if (wt === 5) { off = tag.next + 4; }
            else if (wt === 1) { off = tag.next + 8; }
            else break;
        }
        return level;
    }

    const config: any = { levels: [] };
    let off = 0;
    while (off < data.length) {
        const tag = readVarint(data, off);
        if (!tag) break;
        const fn = tag.value >> 3; const wt = tag.value & 0x7;
        if (wt === 0) {
            const v = readVarint(data, tag.next);
            if (!v) break;
            if (fn === 1) config.seasonId = v.value;
            else if (fn === 2) config.currentLevel = v.value;
            else if (fn === 3) config.currentScore = v.value;
            else if (fn === 4) config.currentLevelScore = v.value;
            else if (fn === 5) config.levelUpScore = v.value;
            else if (fn === 6) config.maxLevel = v.value;
            else if (fn === 7) config.isPremium = v.value;
            off = v.next;
        } else if (wt === 2 && fn === 8) {
            const len = readVarint(data, tag.next);
            if (!len) break;
            config.levels.push(parseLevel(data, len.next, len.next + len.value));
            off = len.next + len.value;
        } else if (wt === 2) {
            const len = readVarint(data, tag.next);
            if (!len) break;
            off = len.next + len.value;
        } else if (wt === 5) { off = tag.next + 4; }
        else if (wt === 1) { off = tag.next + 8; }
        else break;
    }

    return config;
}

/**
 * 获取活动组中的所有活动
 */
async function getActivitiesInGroup(groupId: number): Promise<any[]> {
    try {
        const reply = await getActivityGroup(groupId);
        const group = reply.group;
        if (!group) return [];

        const activities = group.activities || [];
        const result: any[] = [];

        for (const item of activities) {
            const content = item.content;
            if (!content) continue;
            const extra = content.extra;
            let extraJson = null;
            if (extra && extra.length > 0) {
                try { extraJson = JSON.parse(extra.toString()); } catch {}
            }
            // 解析 field 105 (抽奖信息) - item.field_105 已经是 field 105 的内容
            const drawInfo = parseDrawConfig(item.field_105, 0, item.field_105?.length || 0);
            result.push({
                activityId: toNum(content.activity_id),
                groupId: toNum(content.group_id),
                type: toNum(content.type),
                name: content.name || '未知活动',
                beginTime: toNum(content.begin_time),
                endTime: toNum(content.end_time),
                sortOrder: toNum(content.sort_order),
                extra: extraJson,
                drawInfo,
            });
        }

        return result;
    } catch (e: any) {
        log('活动', `获取活动组失败: ${e.message}`);
        return [];
    }
}

/**
 * 获取所有活动组的所有活动 (动态遍历所有 group_id)
 * 用于新活动自动显示 - 不再依赖写死的 groupId
 */
async function getAllActivities(): Promise<any[]> {
    try {
        const listReply = await getActivityList();
        const listActivities = listReply.activities || [];
        // 收集所有 group_id (去重)
        const groupIds = new Set<number>();
        for (const act of listActivities) {
            const gid = toNum(act.group_id);
            if (gid > 0) groupIds.add(gid);
        }
        console.log(`[Activity] getAllActivities: 发现 ${listActivities.length} 个活动, ${groupIds.size} 个 group_id`);

        // 并发拉取每个 group 的详情
        const allResults: any[] = [];
        const groupArr = Array.from(groupIds);
        const groupDetails = await Promise.all(
            groupArr.map(gid => getActivitiesInGroup(gid).catch(() => []))
        );
        for (const acts of groupDetails) {
            allResults.push(...acts);
        }

        // 按 sortOrder 排序
        allResults.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        console.log(`[Activity] getAllActivities: 共获取 ${allResults.length} 个活动详情`);
        return allResults;
    } catch (e: any) {
        log('活动', `获取所有活动失败: ${e.message}`);
        return [];
    }
}

/**
 * 领取活动奖励 (operate_type=1)
 */
async function claimActivityReward(activityId: number): Promise<{ success: boolean; rewardCount: number }> {
    try {
        const reply = await operateActivity(activityId, OPERATE_CLAIM);
        const result = toNum(reply.result);
        const hasRewards = reply.rewards && reply.rewards.length > 0;
        return { success: result > 0 || hasRewards, rewardCount: hasRewards ? 1 : 0 };
    } catch {
        return { success: false, rewardCount: 0 };
    }
}

/**
 * 自动领取所有可领取的活动奖励
 */
async function autoClaimActivityRewards(): Promise<{ claimed: number; errors: number }> {
    let claimed = 0;
    let errors = 0;

    try {
        // 获取当前活动组
        const listReply = await getActivityList();
        const activities = listReply.activities || [];

        if (activities.length === 0) {
            return { claimed: 0, errors: 0 };
        }

        for (const activity of activities) {
            const activityId = toNum(activity.activity_id);
            if (activityId <= 0) continue;

            try {
                const reply = await operateActivity(activityId, OPERATE_CLAIM);
                const result = toNum(reply.result);
                if (result > 0) {
                    claimed++;
                    log('活动', `领取奖励成功: ${activity.name || activityId}`);
                }
                await sleep(500);
            } catch {
                errors++;
            }
        }
    } catch (e: any) {
        log('活动', `自动领取奖励失败: ${e.message}`);
    }

    return { claimed, errors };
}

module.exports = {
    getActivityList,
    getActivityGroup,
    operateActivity,
    drawAuto,
    getActivitiesInGroup,
    getAllActivities,
    claimActivityReward,
    autoClaimActivityRewards,
    parseBattlePass,
    // 常量
    ACTIVITY_TYPE_LOTTERY,
    ACTIVITY_TYPE_SHOP,
    ACTIVITY_TYPE_DAILY,
    OPERATE_CLAIM,
    OPERATE_DRAW,
    OPERATE_DRAW_MULTI,
    OPERATE_VIEW,
};
