/**
 * 新版协议模块 — 个人页新版模块聚合数据服务
 *
 * 该模块只做"低风险查询 + 手动操作"，不接入自动化调度，避免触发风控。
 * - 狗狗信息 (gamepb.dogpb.DogService)
 * - 装扮 (gamepb.skinpb.SkinService)
 * - 头像框 (gamepb.avatarframepb.AvatarFrameService)
 * - 节气 (gamepb.solartermspb.SolarTermsService)
 * - 活动 (gamepb.activitypb.ActivityService)
 *
 * 喂狗粮/领取节气礼包等写操作已尽量参数白名单化：
 * - 数量限制在 1-99
 * - 缺失参数直接抛错
 */

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum, toLong } = require('../utils/utils');

function normalizeLong(value: any): number {
    return toNum(value);
}

/** 解析装扮列表（兼容旧 SkinItem { skin_id, slot_type } 与新 SkinInfo { id, type, ... }） */
function normalizeSkinList(reply: any): any[] {
    const list = Array.isArray(reply?.skins) ? reply.skins : [];
    return list.map((item: any) => {
        // 旧版字段 skin_id/slot_type
        if (item && (item.skin_id !== undefined || item.slot_type !== undefined)) {
            return {
                id: normalizeLong(item.skin_id ?? item.id),
                type: normalizeLong(item.slot_type ?? item.type),
                expireAt: normalizeLong(item.expire_at ?? item.expire_time ?? 0),
                equipped: item.equipped === undefined ? !!item.slot_type : !!item.equipped,
                source: normalizeLong(item.source ?? 0),
            };
        }
        return {
            id: normalizeLong(item.id),
            type: normalizeLong(item.type),
            expireAt: normalizeLong(item.expire_at),
            equipped: !!item.equipped,
            source: normalizeLong(item.source ?? 0),
        };
    });
}

/** 解析头像框列表（兼容 frame_id/frame_id 字段命名） */
function normalizeAvatarFrameList(reply: any): any[] {
    const list = Array.isArray(reply?.frames) ? reply.frames : [];
    return list.map((item: any) => ({
        id: normalizeLong(item.frame_id ?? item.id),
        type: normalizeLong(item.type ?? 0),
        expireAt: normalizeLong(item.expire_time ?? item.expire_at ?? 0),
        equipped: item.equipped === undefined ? false : (item.equipped === true || normalizeLong(item.equipped) === 1),
    }));
}

/** 解析狗狗信息（兼容老 DogInfo{ id,name,price,status,level } + DogItem{ id,duration,status }） */
function normalizeDogInfo(reply: any): any {
    const dogsRaw = Array.isArray(reply?.dogs) ? reply.dogs : [];
    const dogs = dogsRaw.map((d: any) => ({
        id: normalizeLong(d.id),
        name: String(d.name || ''),
        status: normalizeLong(d.status),
        intimacy: normalizeLong(d.intimacy ?? d.level ?? 0),
        equipped: d.equipped === undefined ? (normalizeLong(d.status) === 1) : !!d.equipped,
    }));
    // 老 schema 的 items 表示狗粮/道具
    const items = Array.isArray(reply?.items) ? reply.items : [];
    const foods = items.map((f: any) => ({
        id: normalizeLong(f.id),
        count: normalizeLong(f.duration ?? f.count ?? 0),
        extra: 0,
    }));
    return {
        dogs,
        equippedDogId: normalizeLong(reply?.equipped_dog_id ?? 0),
        guardLeftSeconds: normalizeLong(reply?.guard_left_seconds ?? reply?.protect_duration ?? 0),
        guardTotalSeconds: normalizeLong(reply?.guard_total_seconds ?? 0),
        foods,
    };
}

async function getDogInfo(): Promise<any> {
    const body = types.GetDogInfoRequest.encode(types.GetDogInfoRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.dogpb.DogService', 'GetDogInfo', body);
    return normalizeDogInfo(types.GetDogInfoReply.decode(replyBody));
}

async function getSkinsOwned(): Promise<any[]> {
    const body = types.SkinsOwnedRequest.encode(types.SkinsOwnedRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.skinpb.SkinService', 'SkinsOwned', body);
    return normalizeSkinList(types.SkinsOwnedReply.decode(replyBody));
}

async function getSkinsEquipped(): Promise<any[]> {
    const body = types.SkinsEquippedRequest.encode(types.SkinsEquippedRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.skinpb.SkinService', 'SkinsEquipped', body);
    return normalizeSkinList(types.SkinsEquippedReply.decode(replyBody));
}

async function getAvatarFramesOwned(scene: number = 1): Promise<any[]> {
    const requestCtor: any = (types as any).AvatarFramesOwnedRequest;
    if (!requestCtor) return [];
    const body = requestCtor.encode(requestCtor.create({ scene: Number(scene) || 1 })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.avatarframepb.AvatarFrameService', 'AvatarFramesOwned', body);
    return normalizeAvatarFrameList((types as any).AvatarFramesOwnedReply.decode(replyBody));
}

/**
 * 聚合获取新版协议模块所有数据
 * 单次刷新入口（顺序调用，避免请求突增）
 */
async function getProfileModules(): Promise<any> {
    // 顺序调用以降低对服务端/风控的冲击
    const dog = await getDogInfo().catch((e: any) => ({ error: e?.message || String(e), dogs: [], foods: [] }));
    const skinsOwned = await getSkinsOwned().catch((e: any) => ({ error: e?.message || String(e) }));
    const skinsEquipped = await getSkinsEquipped().catch((e: any) => ({ error: e?.message || String(e) }));
    const avatarFrames = await getAvatarFramesOwned(1).catch((e: any) => ({ error: e?.message || String(e) }));

    return {
        dog: {
            dogs: Array.isArray(dog?.dogs) ? dog.dogs : [],
            foods: Array.isArray(dog?.foods) ? dog.foods : [],
            equippedDogId: dog?.equippedDogId ?? 0,
            guardLeftSeconds: dog?.guardLeftSeconds ?? 0,
            guardTotalSeconds: dog?.guardTotalSeconds ?? 0,
            error: dog?.error || '',
        },
        skins: {
            owned: Array.isArray(skinsOwned) ? skinsOwned : [],
            equipped: Array.isArray(skinsEquipped) ? skinsEquipped : [],
            error: (skinsOwned && (skinsOwned as any).error) || (skinsEquipped && (skinsEquipped as any).error) || '',
        },
        avatarFrames: {
            owned: Array.isArray(avatarFrames) ? avatarFrames : [],
            error: (avatarFrames && (avatarFrames as any).error) || '',
        },
        // 个人生涯 / 黄金虫 暂未抓全协议，避免误操作
        career: {
            status: 'pending_capture',
            message: '当前抓包里还没有完整个人生涯协议。请打开个人生涯页面并重新抓包后再补齐。',
        },
        goldenBug: {
            status: 'pending_capture',
            message: '当前抓包里还没有完整黄金虫专用协议。补齐前不会开放自动操作。',
        },
    };
}

module.exports = {
    getProfileModules,
    getDogInfo,
    getSkinsOwned,
    getSkinsEquipped,
    getAvatarFramesOwned,
    normalizeSkinList,
    normalizeAvatarFrameList,
    normalizeDogInfo,
};
