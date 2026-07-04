/**
 * 好友 API 底层操作 (protobuf 发送/接收)
 */

const { CONFIG } = require('../../config/config');
const { sendMsgAsync, getUserState } = require('../../utils/network');
const { types } = require('../../utils/proto');
const { toLong, toNum, log, logWarn, sleep, randomDelay } = require('../../utils/utils');
const {
    syncKnownFriendGidsFromRecentVisitors,
    fetchQqFriendsByKnownGids,
    syncKnownFriendGidsFromFriends,
    getEffectiveKnownQqFriendGids,
    fetchQqFriendsByLegacyMethod,
    dedupeFriendsByGid,
    buildFriendReply,
} = require('./gid-manager');

// 延迟引用 scheduler 模块，避免循环依赖
let _scheduler: any = null;
function schedulerRef(): any {
    if (!_scheduler) _scheduler = require('./scheduler');
    return _scheduler;
}

// ============ 好友 API ============
export async function getAllFriends(forceSync: boolean = false): Promise<any> {
    const isQQ: boolean = CONFIG.platform === 'qq';
    if (isQQ) {
        await syncKnownFriendGidsFromRecentVisitors(forceSync);
        const friendsFromKnownGids: any[] = await fetchQqFriendsByKnownGids();
        if (friendsFromKnownGids.length > 0) {
            syncKnownFriendGidsFromFriends(friendsFromKnownGids);
            return buildFriendReply(friendsFromKnownGids);
        }

        try {
            const legacyFriends: any[] = dedupeFriendsByGid(await fetchQqFriendsByLegacyMethod());
            if (legacyFriends.length > 0) {
                syncKnownFriendGidsFromFriends(legacyFriends);
            } else if (getEffectiveKnownQqFriendGids().length === 0) {
                logWarn('好友', 'QQ 好友列表为空；若近期接口已切到 GetGameFriends，请先在好友页维护已知好友 GID 列表', {
                    module: 'friend',
                    event: '好友列表接口',
                    result: 'empty',
                });
            }
            return buildFriendReply(legacyFriends);
        } catch (e: any) {
            if (getEffectiveKnownQqFriendGids().length === 0) {
                throw new Error(`QQ 好友列表获取失败，请先在好友页维护已知好友 GID 列表。${e.message}`);
            }
            throw e;
        }
    }

    const body: Uint8Array = types.GetAllFriendsRequest.encode(types.GetAllFriendsRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.friendpb.FriendService', 'GetAll', body);
    return types.GetAllFriendsReply.decode(replyBody);
}

export async function acceptFriends(gids: number[]): Promise<any> {
    const body: Uint8Array = types.AcceptFriendsRequest.encode(types.AcceptFriendsRequest.create({
        friend_gids: gids.map((g: number) => toLong(g)),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.friendpb.FriendService', 'AcceptFriends', body);
    return types.AcceptFriendsReply.decode(replyBody);
}

export async function rejectFriends(gids: number[]): Promise<any> {
    const body: Uint8Array = types.RejectFriendsRequest.encode(types.RejectFriendsRequest.create({
        friend_gids: gids.map((g: number) => toLong(g)),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.friendpb.FriendService', 'RejectFriends', body);
    return types.RejectFriendsReply.decode(replyBody);
}

export async function getApplications(): Promise<any> {
    const body: Uint8Array = types.GetApplicationsRequest.encode(types.GetApplicationsRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.friendpb.FriendService', 'GetApplications', body);
    return types.GetApplicationsReply.decode(replyBody);
}

/**
 * 屏蔽/允许他人加好友申请（全局开关，对应游戏内"屏蔽加好友申请"）。
 * 注：游戏未提供按好友粒度的拉黑 API，此为唯一真正由游戏支持的"屏蔽"功能。
 */
export async function setBlockApplications(block: boolean): Promise<any> {
    if (!types.SetBlockApplicationsRequest || !types.SetBlockApplicationsReply) {
        throw new Error('SetBlockApplications 协议未注册');
    }
    const body: Uint8Array = types.SetBlockApplicationsRequest.encode(types.SetBlockApplicationsRequest.create({
        block: !!block,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.friendpb.FriendService', 'SetBlockApplications', body);
    if (replyBody.length === 0) {
        return { block: !!block };
    }
    const reply: any = types.SetBlockApplicationsReply.decode(replyBody);
    return { block: !!reply.block };
}

/**
 * 【实验性】尝试调用游戏服务端的"删好友" RPC。
 * 已知 friendpb.proto 未定义 DeleteFriend/RemoveFriend/BlockFriend 等方法，
 * 本函数按常见命名猜几个方法名逐一尝试，看游戏服务端是否真的实现过。
 * 成功即赚到，失败也不破坏主流程（捕获错误后返回 null）。
 */
export async function tryDeleteFriend(gid: number): Promise<{ method: string; ok: boolean; error?: string }> {
    if (!gid) throw new Error('gid 无效');
    // 按 protobuf 编码规则，int64 字段 (field_number=1, wire_type=0/varint)
    // 构造 { friend_gid: <int64> } 的 body；用 long 编码 8 字节大端。
    const buf: Buffer = encodeInt64Field(1, gid);
    const candidates: string[] = ['DeleteFriend', 'RemoveFriend', 'DeleteGameFriend', 'KickFriend'];
    const tried: Array<{ method: string; ok: boolean; error?: string }> = [];
    for (const method of candidates) {
        try {
            const { body: replyBody } = await sendMsgAsync('gamepb.friendpb.FriendService', method, buf);
            return { method, ok: true, error: replyBody.length === 0 ? '调用成功（响应体为空）' : undefined };
        } catch (e: any) {
            tried.push({ method, ok: false, error: e && e.message ? String(e.message) : String(e) });
        }
    }
    const err = tried.map(t => `${t.method}: ${t.error}`).join(' | ');
    return { method: candidates[candidates.length - 1], ok: false, error: `所有候选方法均失败 → ${err}` };
}

/**
 * 【实验性】尝试调用游戏服务端的"拉黑好友" RPC。
 * 协议里未定义 BlockFriend，按常见命名猜。请求体同样猜 { friend_gid: int64 }。
 */
export async function tryBlockFriend(gid: number): Promise<{ method: string; ok: boolean; error?: string }> {
    if (!gid) throw new Error('gid 无效');
    const buf: Buffer = encodeInt64Field(1, gid);
    const candidates: string[] = ['BlockFriend', 'AddBlacklist', 'SetBlacklist', 'BlockGameFriend'];
    const tried: Array<{ method: string; ok: boolean; error?: string }> = [];
    for (const method of candidates) {
        try {
            const { body: replyBody } = await sendMsgAsync('gamepb.friendpb.FriendService', method, buf);
            return { method, ok: true, error: replyBody.length === 0 ? '调用成功（响应体为空）' : undefined };
        } catch (e: any) {
            tried.push({ method, ok: false, error: e && e.message ? String(e.message) : String(e) });
        }
    }
    const err = tried.map(t => `${t.method}: ${t.error}`).join(' | ');
    return { method: candidates[candidates.length - 1], ok: false, error: `所有候选方法均失败 → ${err}` };
}

/**
 * 把 int64 字段按 protobuf 规则编码为 buffer：
 *   tag = (field_number << 3) | wire_type
 *   wire_type=0 (varint)：tag 后接变长整数（小端）
 * 注意：protobuf int64 是 64 位有符号；gid 一般 < 2^53，可直接当正数编码。
 */
function encodeInt64Field(fieldNumber: number, value: number): Buffer {
    const tag = (fieldNumber << 3) | 0; // wire_type=0 = varint
    const tagBuf: number[] = [];
    let t = tag;
    while (t > 0x7f) { tagBuf.push((t & 0x7f) | 0x80); t >>>= 7; }
    tagBuf.push(t & 0x7f);
    // varint for int64 (大值情况手动拆 8 字节小端)
    const val = BigInt(value);
    const valBytes: number[] = [];
    let v = val >= 0n ? val : (1n << 64n) + val; // 二补码
    while (v > 0x7fn) { valBytes.push(Number(v & 0x7fn) | 0x80); v >>= 7n; }
    valBytes.push(Number(v & 0x7fn));
    return Buffer.from([...tagBuf, ...valBytes]);
}

export async function enterFriendFarm(friendGid: number): Promise<any> {
    const body: Uint8Array = types.VisitEnterRequest.encode(types.VisitEnterRequest.create({
        host_gid: toLong(friendGid),
        reason: 2,  // ENTER_REASON_FRIEND
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.visitpb.VisitService', 'Enter', body);
    return types.VisitEnterReply.decode(replyBody);
}

export async function leaveFriendFarm(friendGid: number): Promise<void> {
    const body: Uint8Array = types.VisitLeaveRequest.encode(types.VisitLeaveRequest.create({
        host_gid: toLong(friendGid),
    })).finish();
    try {
        await sendMsgAsync('gamepb.visitpb.VisitService', 'Leave', body);
    } catch { /* 离开失败不影响主流程 */ }
}

export async function helpWater(friendGid: number, landIds: number[], stopWhenExpLimit: boolean = false): Promise<any> {
    const beforeExp: number = toNum((getUserState() || {}).exp);
    const body: Uint8Array = types.WaterLandRequest.encode(types.WaterLandRequest.create({
        land_ids: landIds,
        host_gid: toLong(friendGid),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'WaterLand', body);
    const reply: any = types.WaterLandReply.decode(replyBody);
    schedulerRef().updateOperationLimits(reply.operation_limits);
    if (stopWhenExpLimit) {
        await sleep(200);
        const afterExp: number = toNum((getUserState() || {}).exp);
        if (afterExp <= beforeExp) schedulerRef().autoDisableHelpByExpLimit();
    }
    return reply;
}

export async function helpFarming(friendGid: number, landIds: number[], stopWhenExpLimit: boolean = false): Promise<any> {
    const beforeExp: number = toNum((getUserState() || {}).exp);
    const body: Uint8Array = types.FarmingRequest.encode(types.FarmingRequest.create({
        land_ids: landIds,
        host_gid: toLong(friendGid),
    })).finish();

    let reply: any;
    try {
        const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Farming', body);
        reply = types.FarmingReply.decode(replyBody);
    } catch (e: any) {
        if (e.message && e.message.includes('请求超时')) {
            await sleep(300);
            const afterExp: number = toNum((getUserState() || {}).exp);
            if (afterExp > beforeExp) {
                reply = { operation_limits: [] };
            } else {
                throw e;
            }
        } else {
            throw e;
        }
    }

    schedulerRef().updateOperationLimits(reply.operation_limits);
    if (stopWhenExpLimit) {
        await sleep(200);
        const afterExp: number = toNum((getUserState() || {}).exp);
        if (afterExp <= beforeExp) schedulerRef().autoDisableHelpByExpLimit();
    }
    return reply;
}

export async function stealHarvest(friendGid: number, landIds: number[]): Promise<any> {
    const body: Uint8Array = types.HarvestRequest.encode(types.HarvestRequest.create({
        land_ids: landIds,
        host_gid: toLong(friendGid),
        is_all: true,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Harvest', body);
    const reply: any = types.HarvestReply.decode(replyBody);
    schedulerRef().updateOperationLimits(reply.operation_limits);
    return reply;
}

export async function putPlantItems(friendGid: number, landIds: number[], RequestType: any, ReplyType: any, method: string): Promise<number> {
    const ids: number[] = Array.isArray(landIds) ? landIds : [];
    if (ids.length === 0) return 0;
    try {
        const body: Uint8Array = RequestType.encode(RequestType.create({
            land_ids: ids.map((id: number) => toLong(id)),
            host_gid: toLong(friendGid),
        })).finish();
        const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', method, body);
        const reply: any = ReplyType.decode(replyBody);
        schedulerRef().updateOperationLimits(reply.operation_limits);
        return ids.length;
    } catch (e: any) {
        if (e.message && e.message.includes('1001046')) {
            log('好友', `放虫/放草次数已达上限`, { module: 'friend', event: '放虫放草次数上限' });
        } else {
            log('好友', `放虫/放草失败: ${e.message}`, { module: 'friend', event: '放虫放草失败', error: e.message });
        }
        return 0;
    }
}

export async function putPlantItemsDetailed(friendGid: number, landIds: number[], RequestType: any, ReplyType: any, method: string): Promise<{ ok: number; failed: any[] }> {
    const ids: number[] = Array.isArray(landIds) ? landIds : [];
    if (ids.length === 0) return { ok: 0, failed: [] };
    try {
        const body: Uint8Array = RequestType.encode(RequestType.create({
            land_ids: ids.map((id: number) => toLong(id)),
            host_gid: toLong(friendGid),
        })).finish();
        const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', method, body);
        const reply: any = ReplyType.decode(replyBody);
        schedulerRef().updateOperationLimits(reply.operation_limits);
        return { ok: ids.length, failed: [] };
    } catch (e: any) {
        return { ok: 0, failed: ids.map((id: number) => ({ landId: id, reason: e && e.message ? e.message : '未知错误' })) };
    }
}

export async function putInsects(friendGid: number, landIds: number[]): Promise<number> {
    return putPlantItems(friendGid, landIds, types.PutInsectsRequest, types.PutInsectsReply, 'PutInsects');
}

export async function putWeeds(friendGid: number, landIds: number[]): Promise<number> {
    return putPlantItems(friendGid, landIds, types.PutWeedsRequest, types.PutWeedsReply, 'PutWeeds');
}

export async function putInsectsDetailed(friendGid: number, landIds: number[]): Promise<{ ok: number; failed: any[] }> {
    return putPlantItemsDetailed(friendGid, landIds, types.PutInsectsRequest, types.PutInsectsReply, 'PutInsects');
}

export async function putWeedsDetailed(friendGid: number, landIds: number[]): Promise<{ ok: number; failed: any[] }> {
    return putPlantItemsDetailed(friendGid, landIds, types.PutWeedsRequest, types.PutWeedsReply, 'PutWeeds');
}

// 使用社交道具（如友谊果实）
export async function putSocialItem(friendGid: number, landId: number, itemId: number): Promise<any> {
    const body: Uint8Array = types.PutSocialItemRequest.encode(types.PutSocialItemRequest.create({
        host_gid: toLong(friendGid),
        land_id: toLong(landId),
        item_id: toLong(itemId),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'PutSocialItem', body);
    return types.PutSocialItemReply.decode(replyBody);
}

export async function checkCanOperateRemote(friendGid: number, operationId: number): Promise<{ canOperate: boolean; canStealNum: number }> {
    if (!types.CheckCanOperateRequest || !types.CheckCanOperateReply) {
        return { canOperate: true, canStealNum: 0 };
    }
    try {
        const body: Uint8Array = types.CheckCanOperateRequest.encode(types.CheckCanOperateRequest.create({
            host_gid: toLong(friendGid),
            operation_id: toLong(operationId),
        })).finish();
        const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'CheckCanOperate', body);
        // 服务器返回空 body 时降级为不拦截（proto3 默认 bool=false 会导致误判）
        if (replyBody.length === 0) {
            return { canOperate: true, canStealNum: 0 };
        }
        const reply: any = types.CheckCanOperateReply.decode(replyBody);
        return {
            canOperate: !!reply.can_operate,
            canStealNum: toNum(reply.can_steal_num),
        };
    } catch (e: any) {
        // 预检查失败时降级为不拦截，避免因协议抖动导致完全不操作
        // 服务端可能不支持某些操作的预检查（如紫金土地除草 opId=10003 返回 1000020），静默降级
        return { canOperate: true, canStealNum: 0 };
    }
}

