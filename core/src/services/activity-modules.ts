/**
 * 新版活动模块 — 个人页"新活动模块"面板的数据服务
 *
 * 包含两个面板：
 *  - 节气礼包（仅展示活动配置 + term 数量；领取走 ClaimSolarTerms，proto 缺失时降级为只读）
 *  - 活动 / 助威（活动数量 + 活动组 payload 长度）
 *
 * 抓包完善前只做"展示 + 手动触发"，不开放自动助威。
 */

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum } = require('../utils/utils');

// 当前生效的节气 ID（按协议抓包动态调整；101=端午）
const DEFAULT_SOLAR_TERM_ID = 101;

function normalizeSolarTerms(reply: any): any {
    const terms = Array.isArray(reply?.terms) ? reply.terms : [];
    return {
        serverTime: toNum(reply?.server_time),
        termCount: terms.length,
        terms: terms.map((t: any) => ({
            termId: toNum(t?.term_id),
            status: toNum(t?.status),
            name: String(t?.name || ''),
            startTime: toNum(t?.start_time),
            endTime: toNum(t?.end_time),
        })),
        hasActivityPayload: !!(reply?.config && reply.config.length) || !!(reply?.activity && reply.activity.length),
        currentSolarTermId: DEFAULT_SOLAR_TERM_ID,
    };
}

async function getSolarTerms(): Promise<any> {
    const body = types.GetSolarTermsRequest.encode(types.GetSolarTermsRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.solartermspb.SolarTermsService', 'GetSolarTerms', body);
    return normalizeSolarTerms(types.GetSolarTermsReply.decode(replyBody));
}

/**
 * 领取节气礼包 — 仅在 proto 含 ClaimSolarTermsRequest 时才暴露
 * 用户当前 proto 暂未包含该消息，所以默认抛"未实现"。
 */
async function claimSolarTerms(_solarTermId: number = DEFAULT_SOLAR_TERM_ID): Promise<any> {
    const claimCtor: any = (types as any).ClaimSolarTermsRequest;
    if (!claimCtor) {
        throw new Error('当前 proto 未包含 ClaimSolarTermsRequest，请先在 solartermspb.proto 中补齐后再启用');
    }
    const safeId = Number(_solarTermId) || DEFAULT_SOLAR_TERM_ID;
    const body = claimCtor.encode(claimCtor.create({ solar_term_id: safeId })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.solartermspb.SolarTermsService', 'ClaimSolarTerms', body);
    const reply = (types as any).ClaimSolarTermsReply.decode(replyBody);
    return {
        solarTermId: safeId,
        rewardCount: Array.isArray(reply.rewards) ? reply.rewards.length : 0,
        hasTermPayload: !!(reply.term && reply.term.length),
    };
}

function normalizeActivityList(reply: any): any {
    // 兼容老 schema: ActivityListReply.activities (field 1) — ActivityContent 列表
    const activities = Array.isArray(reply?.activities) ? reply.activities : [];
    return {
        activityCount: activities.length,
        activities: activities.map((a: any) => ({
            activityId: toNum(a?.activity_id),
            groupId: toNum(a?.group_id),
            type: toNum(a?.type),
            name: String(a?.name || ''),
            beginTime: toNum(a?.begin_time),
            endTime: toNum(a?.end_time),
        })),
        // 用户当前 proto ActivityListReply 没有 red_dots 字段
        redDotCount: 0,
    };
}

async function getActivityList(): Promise<any> {
    const body = types.ActivityListRequest.encode(types.ActivityListRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'List', body);
    return normalizeActivityList(types.ActivityListReply.decode(replyBody));
}

async function getActivityGroup(groupId: number): Promise<any> {
    const safeGroupId = Number(groupId) || 0;
    if (!safeGroupId) {
        throw new Error('Missing activity group id');
    }
    const body = types.ActivityGetGroupRequest.encode(types.ActivityGetGroupRequest.create({
        group_id: safeGroupId,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'GetGroup', body);
    const reply = types.ActivityGetGroupReply.decode(replyBody);
    const group = reply?.group;
    const groupObj: any = group ? (group.toJSON ? group.toJSON() : { ...group }) : {};
    // 计算 payload 长度
    let payloadLength = 0;
    if (group && group.activities) {
        for (const item of group.activities) {
            const bytes = item?.field_105;
            if (Buffer.isBuffer(bytes)) payloadLength += bytes.length;
        }
    }
    return {
        groupId: safeGroupId,
        group: groupObj,
        payloadLength,
    };
}

/**
 * 聚合获取活动模块数据（用于新版模块页"新活动模块"面板）
 */
async function getActivityModules(): Promise<any> {
    const [solarTerms, list] = await Promise.all([
        getSolarTerms().catch((e: any) => ({ error: e?.message || String(e) })),
        getActivityList().catch((e: any) => ({ error: e?.message || String(e) })),
    ]);
    // 额外抓一个"夏季活动组"作为示例 (groupId 1)，失败不影响主流程
    let summerGroup: any = null;
    try {
        const g = await getActivityGroup(1);
        summerGroup = { groupId: g.groupId, payloadLength: g.payloadLength };
    } catch {
        summerGroup = { groupId: 1, payloadLength: 0, error: 'group 1 not available' };
    }
    return {
        solarTerms,
        list: {
            activityCount: (list && list.activityCount) || 0,
            activities: (list && list.activities) || [],
            error: (list && list.error) || '',
        },
        summerGroup,
    };
}

module.exports = {
    DEFAULT_SOLAR_TERM_ID,
    getSolarTerms,
    claimSolarTerms,
    getActivityList,
    getActivityGroup,
    getActivityModules,
};
