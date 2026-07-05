import type { AccountConfig, AutomationConfig, BagSeedFallbackStrategy, IntervalConfig, PlantingStrategy, QuietHoursConfig } from '../../types/config';
export {};

const sharedState = require('./shared-state');
const { readKnownFriendGidsCache, writeKnownFriendGidsCache } = require('./gid-cache');

const {
    globalConfig,
    normalizeAccountConfig,
    cloneAccountConfig,
    normalizeFertilizerLandTypes,
    normalizeKnownFriendGids,
    normalizeKnownFriendGidSyncCooldownSec,
    normalizeFriendsListCacheTtlSec,
    normalizeNoGuardDogAt,
    normalizeNoGuardDogCacheTtlSec,
    normalizeBagSeedPriority,
    normalizeBagSeedFallbackStrategy,
    normalizeIntervals,
    normalizeTimeString,
    ALLOWED_PLANTING_STRATEGIES,
} = sharedState;

function getAccountConfigSnapshot(accountId?: unknown): AccountConfig {
    const id = sharedState.resolveAccountId(accountId);
    if (!id) return cloneAccountConfig(sharedState.accountFallbackConfig);
    return normalizeAccountConfig(globalConfig.accountConfigs[id], sharedState.accountFallbackConfig);
}

function setAccountConfigSnapshot(accountId: unknown, nextConfig: Partial<AccountConfig>, persist: boolean = true): AccountConfig {
    const id = sharedState.resolveAccountId(accountId);
    if (!id) {
        sharedState.accountFallbackConfig = normalizeAccountConfig(nextConfig, sharedState.accountFallbackConfig);
        globalConfig.defaultAccountConfig = cloneAccountConfig(sharedState.accountFallbackConfig);
        if (persist) { require('./global-config').saveGlobalConfig(); }
        return cloneAccountConfig(sharedState.accountFallbackConfig);
    }
    globalConfig.accountConfigs[id] = normalizeAccountConfig(nextConfig, sharedState.accountFallbackConfig);
    if (persist) { require('./global-config').saveGlobalConfig(); }
    return cloneAccountConfig(globalConfig.accountConfigs[id]);
}

function removeAccountConfig(accountId: unknown): void {
    const id = sharedState.resolveAccountId(accountId);
    if (!id) return;
    if (globalConfig.accountConfigs[id]) {
        delete globalConfig.accountConfigs[id];
        require('./global-config').saveGlobalConfig();
    }
}

function ensureAccountConfig(accountId: unknown, options: { persist?: boolean } = {}): AccountConfig | null {
    const id = sharedState.resolveAccountId(accountId);
    if (!id) return null;
    if (globalConfig.accountConfigs[id]) {
        return cloneAccountConfig(globalConfig.accountConfigs[id]);
    }
    globalConfig.accountConfigs[id] = cloneAccountConfig(sharedState.DEFAULT_ACCOUNT_CONFIG);
    if (options.persist !== false) require('./global-config').saveGlobalConfig();
    return cloneAccountConfig(globalConfig.accountConfigs[id]);
}

function getAutomation(accountId?: unknown): AutomationConfig {
    const automation = { ...getAccountConfigSnapshot(accountId).automation };
    automation.fertilizer_land_types = normalizeFertilizerLandTypes(automation.fertilizer_land_types);
    return automation;
}

function getConfigSnapshot(accountId?: unknown): AccountConfig & { ui: typeof globalConfig.ui } {
    const cfg = getAccountConfigSnapshot(accountId);
    return {
        automation: { ...cfg.automation },
        plantingStrategy: cfg.plantingStrategy,
        preferredSeedId: cfg.preferredSeedId,
        intervals: { ...cfg.intervals },
        friendQuietHours: { ...cfg.friendQuietHours },
        knownFriendGids: [...(cfg.knownFriendGids || [])],
        knownFriendGidSyncCooldownSec: cfg.knownFriendGidSyncCooldownSec,
        friendsListCacheTtlSec: cfg.friendsListCacheTtlSec,
        friendBlacklist: [...(cfg.friendBlacklist || [])],
        friendGuardDogGids: [...(cfg.friendGuardDogGids || [])],
        friendGuardDogBlacklist: [...(cfg.friendGuardDogBlacklist || [])],
        friendGuardDogWhitelist: [...(cfg.friendGuardDogWhitelist || [])],
        plantBlacklist: [...(cfg.plantBlacklist || [])],
        stealDelaySeconds: Math.max(0, Math.min(300, Number(cfg.stealDelaySeconds) || 0)),
        plantOrderRandom: !!cfg.plantOrderRandom,
        plantDelaySeconds: Math.max(0, Math.min(60, Number(cfg.plantDelaySeconds) || 0)),
        fertilizerBuyOrganicCount: Math.max(0, Math.min(10000, Number(cfg.fertilizerBuyOrganicCount) || 0)),
        fertilizerBuyOrganicThresholdHours: Math.max(0, Math.min(990, Number(cfg.fertilizerBuyOrganicThresholdHours) || 0)),
        fertilizerBuyNormalCount: Math.max(0, Math.min(10000, Number(cfg.fertilizerBuyNormalCount) || 0)),
        fertilizerBuyNormalThresholdHours: Math.max(0, Math.min(990, Number(cfg.fertilizerBuyNormalThresholdHours) || 0)),
        fertilizerBuyCheckIntervalMinutes: Math.max(1, Math.min(1440, Number(cfg.fertilizerBuyCheckIntervalMinutes) || 30)),
        bagSeedPriority: [...(cfg.bagSeedPriority || [])],
        bagSeedFallbackStrategy: cfg.bagSeedFallbackStrategy,
        ui: { ...globalConfig.ui },
    } as any;
}

interface ApplyConfigSnapshotOptions {
    persist?: boolean;
    accountId?: unknown;
}

function applyConfigSnapshot(snapshot: Record<string, any> | undefined, options: ApplyConfigSnapshotOptions = {}): ReturnType<typeof getConfigSnapshot> {
    const cfg: Record<string, any> = snapshot || {};
    const persist = options.persist !== false;
    const accountId = options.accountId;

    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, sharedState.accountFallbackConfig);

    if (cfg.automation && typeof cfg.automation === 'object') {
        for (const [k, v] of Object.entries(cfg.automation)) {
            if ((next.automation as any)[k] === undefined) continue;
            if (k === 'fertilizer') {
                const allowed = ['both', 'normal', 'organic', 'smart', 'none'];
                (next.automation as any)[k] = allowed.includes(v as string) ? v : (next.automation as any)[k];
            } else if (k === 'fertilizer_land_types') {
                (next.automation as any)[k] = normalizeFertilizerLandTypes(v, next.automation.fertilizer_land_types);
            } else if (k === 'fertilizer_smart_seconds') {
                (next.automation as any)[k] = Math.max(30, Math.min(3600, Number(v) || 300));
            } else if (k === 'friend_auto_accept_min_level') {
                (next.automation as any)[k] = Math.max(0, Number.parseInt(v as string, 10) || 0);
            } else {
                (next.automation as any)[k] = !!v;
            }
        }
    }

    if (cfg.plantingStrategy && ALLOWED_PLANTING_STRATEGIES.includes(cfg.plantingStrategy)) {
        next.plantingStrategy = cfg.plantingStrategy;
    }

    if (cfg.preferredSeedId !== undefined && cfg.preferredSeedId !== null) {
        next.preferredSeedId = Math.max(0, Number.parseInt(cfg.preferredSeedId, 10) || 0);
    }

    if (cfg.intervals && typeof cfg.intervals === 'object') {
        for (const [type, sec] of Object.entries(cfg.intervals)) {
            if ((next.intervals as any)[type] === undefined) continue;
            (next.intervals as any)[type] = Math.max(1, Number.parseInt(sec as string, 10) || (next.intervals as any)[type] || 1);
        }
        next.intervals = normalizeIntervals(next.intervals);
    }

    if (cfg.friendQuietHours && typeof cfg.friendQuietHours === 'object') {
        const old = next.friendQuietHours || {};
        next.friendQuietHours = {
            enabled: cfg.friendQuietHours.enabled !== undefined ? !!cfg.friendQuietHours.enabled : !!old.enabled,
            start: normalizeTimeString(cfg.friendQuietHours.start, old.start || '23:00'),
            end: normalizeTimeString(cfg.friendQuietHours.end, old.end || '07:00'),
        };
    }

    if (Array.isArray(cfg.friendBlacklist)) {
        next.friendBlacklist = cfg.friendBlacklist.map(Number).filter((n: number) => Number.isFinite(n) && n > 0);
    }

    if (Array.isArray(cfg.friendGuardDogGids)) {
        next.friendGuardDogGids = cfg.friendGuardDogGids.map(Number).filter((n: number) => Number.isFinite(n) && n > 0);
    }

    if (Array.isArray(cfg.friendGuardDogBlacklist)) {
        next.friendGuardDogBlacklist = cfg.friendGuardDogBlacklist.map(Number).filter((n: number) => Number.isFinite(n) && n > 0);
    }

    if (Array.isArray(cfg.friendGuardDogWhitelist)) {
        next.friendGuardDogWhitelist = cfg.friendGuardDogWhitelist.map(Number).filter((n: number) => Number.isFinite(n) && n > 0);
    }

    if (cfg.knownFriendGids !== undefined) {
        next.knownFriendGids = normalizeKnownFriendGids(cfg.knownFriendGids, next.knownFriendGids);
        if (accountId) {
            writeKnownFriendGidsCache(accountId, next.knownFriendGids);
        }
    }

    if (cfg.knownFriendGidSyncCooldownSec !== undefined) {
        next.knownFriendGidSyncCooldownSec = normalizeKnownFriendGidSyncCooldownSec(
            cfg.knownFriendGidSyncCooldownSec,
            next.knownFriendGidSyncCooldownSec,
        );
    }

    if (cfg.friendsListCacheTtlSec !== undefined) {
        next.friendsListCacheTtlSec = normalizeFriendsListCacheTtlSec(
            cfg.friendsListCacheTtlSec,
            next.friendsListCacheTtlSec,
        );
    }

    if (Array.isArray(cfg.plantBlacklist)) {
        next.plantBlacklist = cfg.plantBlacklist.map(Number).filter((n: number) => Number.isFinite(n) && n > 0);
    }

    if (cfg.stealDelaySeconds !== undefined && cfg.stealDelaySeconds !== null) {
        next.stealDelaySeconds = Math.max(0, Math.min(300, Number(cfg.stealDelaySeconds) || 0));
    }

    if (cfg.plantOrderRandom !== undefined && cfg.plantOrderRandom !== null) {
        next.plantOrderRandom = !!cfg.plantOrderRandom;
    }

    if (cfg.plantDelaySeconds !== undefined && cfg.plantDelaySeconds !== null) {
        next.plantDelaySeconds = Math.max(0, Math.min(60, Number(cfg.plantDelaySeconds) || 0));
    }

    if (cfg.fertilizerBuyOrganicCount !== undefined && cfg.fertilizerBuyOrganicCount !== null) {
        next.fertilizerBuyOrganicCount = Math.max(0, Math.min(10000, Number(cfg.fertilizerBuyOrganicCount) || 0));
    }

    if (cfg.fertilizerBuyOrganicThresholdHours !== undefined && cfg.fertilizerBuyOrganicThresholdHours !== null) {
        next.fertilizerBuyOrganicThresholdHours = Math.max(0, Math.min(990, Number(cfg.fertilizerBuyOrganicThresholdHours) || 0));
    }

    if (cfg.fertilizerBuyNormalCount !== undefined && cfg.fertilizerBuyNormalCount !== null) {
        next.fertilizerBuyNormalCount = Math.max(0, Math.min(10000, Number(cfg.fertilizerBuyNormalCount) || 0));
    }

    if (cfg.fertilizerBuyNormalThresholdHours !== undefined && cfg.fertilizerBuyNormalThresholdHours !== null) {
        next.fertilizerBuyNormalThresholdHours = Math.max(0, Math.min(990, Number(cfg.fertilizerBuyNormalThresholdHours) || 0));
    }

    if (cfg.fertilizerBuyCheckIntervalMinutes !== undefined && cfg.fertilizerBuyCheckIntervalMinutes !== null) {
        next.fertilizerBuyCheckIntervalMinutes = Math.max(1, Math.min(1440, Number(cfg.fertilizerBuyCheckIntervalMinutes) || 30));
    }

    if (cfg.bagSeedPriority !== undefined && cfg.bagSeedPriority !== null) {
        next.bagSeedPriority = normalizeBagSeedPriority(cfg.bagSeedPriority);
    }

    if (cfg.bagSeedFallbackStrategy !== undefined && cfg.bagSeedFallbackStrategy !== null) {
        next.bagSeedFallbackStrategy = normalizeBagSeedFallbackStrategy(cfg.bagSeedFallbackStrategy, next.bagSeedFallbackStrategy);
    }

    if (cfg.ui && typeof cfg.ui === 'object') {
        const theme = String(cfg.ui.theme || '').toLowerCase();
        if (theme === 'dark' || theme === 'light') {
            globalConfig.ui.theme = theme;
        }
    }

    setAccountConfigSnapshot(accountId, next, false);
    if (persist) require('./global-config').saveGlobalConfig();
    return getConfigSnapshot(accountId);
}

function setAutomation(key: string, value: unknown, accountId?: unknown): ReturnType<typeof applyConfigSnapshot> {
    return applyConfigSnapshot({ automation: { [key]: value } }, { accountId });
}

function isAutomationOn(key: string, accountId?: unknown): boolean {
    return !!(getAccountConfigSnapshot(accountId).automation as any)[key];
}

function getPreferredSeed(accountId?: unknown): number {
    return getAccountConfigSnapshot(accountId).preferredSeedId;
}

function getPlantingStrategy(accountId?: unknown): PlantingStrategy {
    return getAccountConfigSnapshot(accountId).plantingStrategy;
}

function getBagSeedPriority(accountId?: unknown): number[] {
    return [...(getAccountConfigSnapshot(accountId).bagSeedPriority || [])];
}

function getBagSeedFallbackStrategy(accountId?: unknown): BagSeedFallbackStrategy {
    return normalizeBagSeedFallbackStrategy(getAccountConfigSnapshot(accountId).bagSeedFallbackStrategy);
}

function getIntervals(accountId?: unknown): IntervalConfig {
    return { ...getAccountConfigSnapshot(accountId).intervals };
}

function getFriendQuietHours(accountId?: unknown): QuietHoursConfig {
    return { ...getAccountConfigSnapshot(accountId).friendQuietHours };
}

function getKnownFriendGids(accountId?: unknown): number[] {
    const config = getAccountConfigSnapshot(accountId);
    const configGids = config.knownFriendGids || [];

    if (configGids.length > 0) {
        return [...configGids];
    }

    const cachedGids = readKnownFriendGidsCache(accountId);
    if (cachedGids && cachedGids.length > 0) {
        return [...cachedGids];
    }

    return [];
}

function setKnownFriendGids(accountId: unknown, list: unknown[]): number[] {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, sharedState.accountFallbackConfig);
    const normalizedGids = normalizeKnownFriendGids(list, next.knownFriendGids);
    next.knownFriendGids = normalizedGids;
    setAccountConfigSnapshot(accountId, next);

    writeKnownFriendGidsCache(accountId, normalizedGids);

    return [...normalizedGids];
}

function getKnownFriendGidSyncCooldownSec(accountId?: unknown): number {
    return normalizeKnownFriendGidSyncCooldownSec(getAccountConfigSnapshot(accountId).knownFriendGidSyncCooldownSec);
}

function setKnownFriendGidSyncCooldownSec(accountId: unknown, sec: unknown): number {
    const current = getAccountConfigSnapshot(accountId);
    const normalized = normalizeKnownFriendGidSyncCooldownSec(sec, current.knownFriendGidSyncCooldownSec);
    const next = normalizeAccountConfig({
        ...current,
        knownFriendGidSyncCooldownSec: normalized,
    }, sharedState.accountFallbackConfig);
    setAccountConfigSnapshot(accountId, next, true);
    return next.knownFriendGidSyncCooldownSec;
}

function getFriendsListCacheTtlSec(accountId?: unknown): number {
    return normalizeFriendsListCacheTtlSec(getAccountConfigSnapshot(accountId).friendsListCacheTtlSec);
}

function setFriendsListCacheTtlSec(accountId: unknown, sec: unknown): number {
    const current = getAccountConfigSnapshot(accountId);
    const normalized = normalizeFriendsListCacheTtlSec(sec, current.friendsListCacheTtlSec);
    const next = normalizeAccountConfig({
        ...current,
        friendsListCacheTtlSec: normalized,
    }, sharedState.accountFallbackConfig);
    setAccountConfigSnapshot(accountId, next, true);
    return next.friendsListCacheTtlSec;
}

function getFriendBlacklist(accountId?: unknown): number[] {
    return [...(getAccountConfigSnapshot(accountId).friendBlacklist || [])];
}

function setFriendBlacklist(accountId: unknown, list: unknown[]): number[] {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, sharedState.accountFallbackConfig);
    next.friendBlacklist = Array.isArray(list) ? list.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
    setAccountConfigSnapshot(accountId, next);
    return [...next.friendBlacklist];
}

function addFriendToBlacklist(accountId: unknown, gid: unknown): boolean {
    const gidNum = Number(gid);
    if (!gidNum || gidNum <= 0) return false;
    const current = getFriendBlacklist(accountId);
    if (current.includes(gidNum)) return false;
    const newList = [...current, gidNum];
    setFriendBlacklist(accountId, newList);
    return true;
}

function getFriendGuardDogGids(accountId?: unknown): number[] {
    return [...(getAccountConfigSnapshot(accountId).friendGuardDogGids || [])];
}

function setFriendGuardDogGids(accountId: unknown, list: unknown[]): number[] {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, sharedState.accountFallbackConfig);
    next.friendGuardDogGids = Array.isArray(list) ? list.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
    setAccountConfigSnapshot(accountId, next);
    return [...next.friendGuardDogGids];
}

function addFriendGuardDogGid(accountId: unknown, gid: unknown): boolean {
    const gidNum = Number(gid);
    if (!gidNum || gidNum <= 0) return false;
    const current = getFriendGuardDogGids(accountId);
    if (current.includes(gidNum)) return false;
    const newList = [...current, gidNum];
    setFriendGuardDogGids(accountId, newList);
    // 该 gid 确认为携带护主犬 → 失效负缓存
    try { unmarkNoGuardDog(accountId, gidNum); } catch { /* ignore */ }
    return true;
}

function removeFriendGuardDogGid(accountId: unknown, gid: unknown): boolean {
    const gidNum = Number(gid);
    if (!gidNum || gidNum <= 0) return false;
    const current = getFriendGuardDogGids(accountId);
    if (!current.includes(gidNum)) return false;
    const newList = current.filter((g: number) => g !== gidNum);
    setFriendGuardDogGids(accountId, newList);
    return true;
}

function getFriendGuardDogBlacklist(accountId?: unknown): number[] {
    return [...(getAccountConfigSnapshot(accountId).friendGuardDogBlacklist || [])];
}

function setFriendGuardDogBlacklist(accountId: unknown, list: unknown[]): number[] {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, sharedState.accountFallbackConfig);
    next.friendGuardDogBlacklist = Array.isArray(list) ? list.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
    setAccountConfigSnapshot(accountId, next);
    return [...next.friendGuardDogBlacklist];
}

function addFriendGuardDogBlacklistGid(accountId: unknown, gid: unknown): boolean {
    const gidNum = Number(gid);
    if (!gidNum || gidNum <= 0) return false;
    const current = getFriendGuardDogBlacklist(accountId);
    if (current.includes(gidNum)) return false;
    const newList = [...current, gidNum];
    setFriendGuardDogBlacklist(accountId, newList);
    // 加入"不帮"黑名单 → 失效负缓存,避免下个循环又跳过
    try { unmarkNoGuardDog(accountId, gidNum); } catch { /* ignore */ }
    return true;
}

function removeFriendGuardDogBlacklistGid(accountId: unknown, gid: unknown): boolean {
    const gidNum = Number(gid);
    if (!gidNum || gidNum <= 0) return false;
    const current = getFriendGuardDogBlacklist(accountId);
    if (!current.includes(gidNum)) return false;
    const newList = current.filter((g: number) => g !== gidNum);
    setFriendGuardDogBlacklist(accountId, newList);
    return true;
}

function getFriendGuardDogWhitelist(accountId?: unknown): number[] {
    return [...(getAccountConfigSnapshot(accountId).friendGuardDogWhitelist || [])];
}

function setFriendGuardDogWhitelist(accountId: unknown, list: unknown[]): number[] {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, sharedState.accountFallbackConfig);
    next.friendGuardDogWhitelist = Array.isArray(list) ? list.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
    setAccountConfigSnapshot(accountId, next);
    return [...next.friendGuardDogWhitelist];
}

function addFriendGuardDogWhitelistGid(accountId: unknown, gid: unknown): boolean {
    const gidNum = Number(gid);
    if (!gidNum || gidNum <= 0) return false;
    const current = getFriendGuardDogWhitelist(accountId);
    if (current.includes(gidNum)) return false;
    const newList = [...current, gidNum];
    setFriendGuardDogWhitelist(accountId, newList);
    return true;
}

function removeFriendGuardDogWhitelistGid(accountId: unknown, gid: unknown): boolean {
    const gidNum = Number(gid);
    if (!gidNum || gidNum <= 0) return false;
    const current = getFriendGuardDogWhitelist(accountId);
    if (!current.includes(gidNum)) return false;
    const newList = current.filter((g: number) => g !== gidNum);
    setFriendGuardDogWhitelist(accountId, newList);
    return true;
}

// ============ "无护主犬"负缓存 ============

/**
 * 获取指定账号的"无护主犬"缓存表 (gid → timestamp 毫秒)。
 * 不可变副本。
 */
function getNoGuardDogAtMap(accountId?: unknown): Record<number, number> {
    const raw = getAccountConfigSnapshot(accountId).friendNoGuardDogAt;
    return normalizeNoGuardDogAt(raw, {});
}

/**
 * 获取指定账号的 TTL(秒),默认 1800。
 */
function getNoGuardDogCacheTtlSec(accountId?: unknown): number {
    return normalizeNoGuardDogCacheTtlSec(getAccountConfigSnapshot(accountId).friendNoGuardDogCacheTtlSec);
}

function setNoGuardDogCacheTtlSec(accountId: unknown, sec: unknown): number {
    const current = getAccountConfigSnapshot(accountId);
    const normalized = normalizeNoGuardDogCacheTtlSec(sec, current.friendNoGuardDogCacheTtlSec);
    const next = normalizeAccountConfig({
        ...current,
        friendNoGuardDogCacheTtlSec: normalized,
    }, sharedState.accountFallbackConfig);
    setAccountConfigSnapshot(accountId, next, true);
    return next.friendNoGuardDogCacheTtlSec;
}

/**
 * 标记该 gid 当前未携带护主犬,写入当前时间。
 * 返回是否真的写入了(true = 新增, false = 已有更新记录)。
 * 同时清理超过 1 天的过期项,防止数据无限增长。
 */
function markNoGuardDog(accountId: unknown, gid: unknown, now: number = Date.now()): boolean {
    const gidNum = Number(gid);
    if (!gidNum || gidNum <= 0) return false;
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, sharedState.accountFallbackConfig);
    const map = normalizeNoGuardDogAt(next.friendNoGuardDogAt, {});

    // 清理 1 天以前的过期项
    const expireBefore = now - 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const [k, ts] of Object.entries(map)) {
        if (Number(ts) < expireBefore) {
            delete map[Number(k)];
            removed++;
        }
    }
    void removed;

    if (map[gidNum] === now) return false;
    map[gidNum] = now;
    next.friendNoGuardDogAt = map;
    setAccountConfigSnapshot(accountId, next);
    return true;
}

/**
 * 移除该 gid 的负缓存(在确认该 gid 携带护主犬、或主动清缓存时使用)。
 */
function unmarkNoGuardDog(accountId: unknown, gid: unknown): boolean {
    const gidNum = Number(gid);
    if (!gidNum || gidNum <= 0) return false;
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, sharedState.accountFallbackConfig);
    const map = normalizeNoGuardDogAt(next.friendNoGuardDogAt, {});
    if (!(gidNum in map)) return false;
    delete map[gidNum];
    next.friendNoGuardDogAt = map;
    setAccountConfigSnapshot(accountId, next);
    return true;
}

/**
 * 清空负缓存。指定 gid 时只清一项,否则全清。
 * 返回清除的条数。
 */
function clearNoGuardDogCache(accountId: unknown, gid?: unknown): number {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, sharedState.accountFallbackConfig);
    if (gid !== undefined && gid !== null) {
        const gidNum = Number(gid);
        if (!gidNum || gidNum <= 0) return 0;
        const map = normalizeNoGuardDogAt(next.friendNoGuardDogAt, {});
        if (!(gidNum in map)) return 0;
        delete map[gidNum];
        next.friendNoGuardDogAt = map;
        setAccountConfigSnapshot(accountId, next);
        return 1;
    }
    const old = normalizeNoGuardDogAt(next.friendNoGuardDogAt, {});
    const count = Object.keys(old).length;
    next.friendNoGuardDogAt = {};
    setAccountConfigSnapshot(accountId, next);
    return count;
}

/**
 * 判断该 gid 的负缓存是否还在 TTL 内。
 * 命中 = 缓存说"该好友未携带护主犬",可以直接跳过 enterReply。
 */
function isNoGuardDogCacheFresh(accountId: unknown, gid: unknown, now: number = Date.now()): boolean {
    const gidNum = Number(gid);
    if (!gidNum || gidNum <= 0) return false;
    const cfg = getAccountConfigSnapshot(accountId);
    const map = normalizeNoGuardDogAt(cfg.friendNoGuardDogAt, {});
    const ts = map[gidNum];
    if (!ts) return false;
    const ttl = normalizeNoGuardDogCacheTtlSec(cfg.friendNoGuardDogCacheTtlSec);
    return (now - ts) < ttl * 1000;
}

/**
 * 获取缓存统计信息(用于 UI/API 展示)。
 */
function getNoGuardDogCacheStats(accountId?: unknown): { count: number; ttlSec: number; oldestAt: number | null; newestAt: number | null } {
    const cfg = getAccountConfigSnapshot(accountId);
    const map = normalizeNoGuardDogAt(cfg.friendNoGuardDogAt, {});
    const values: number[] = Object.values(map).map((v) => Number(v)).filter((n) => Number.isFinite(n));
    return {
        count: values.length,
        ttlSec: normalizeNoGuardDogCacheTtlSec(cfg.friendNoGuardDogCacheTtlSec),
        oldestAt: values.length > 0 ? Math.min(...values) : null,
        newestAt: values.length > 0 ? Math.max(...values) : null,
    };
}

function getStealDelaySeconds(accountId?: unknown): number {
    return Math.max(0, Math.min(300, Number(getAccountConfigSnapshot(accountId).stealDelaySeconds) || 0));
}

function getPlantOrderRandom(accountId?: unknown): boolean {
    return !!getAccountConfigSnapshot(accountId).plantOrderRandom;
}

function getPlantDelaySeconds(accountId?: unknown): number {
    return Math.max(0, Math.min(60, Number(getAccountConfigSnapshot(accountId).plantDelaySeconds) || 0));
}

function getFertilizerBuyOrganicCount(accountId?: unknown): number {
    return Math.max(0, Math.min(10000, Number(getAccountConfigSnapshot(accountId).fertilizerBuyOrganicCount) || 0));
}

function getFertilizerBuyOrganicThresholdHours(accountId?: unknown): number {
    return Math.max(0, Math.min(990, Number(getAccountConfigSnapshot(accountId).fertilizerBuyOrganicThresholdHours) || 0));
}

function getFertilizerBuyNormalCount(accountId?: unknown): number {
    return Math.max(0, Math.min(10000, Number(getAccountConfigSnapshot(accountId).fertilizerBuyNormalCount) || 0));
}

function getFertilizerBuyNormalThresholdHours(accountId?: unknown): number {
    return Math.max(0, Math.min(990, Number(getAccountConfigSnapshot(accountId).fertilizerBuyNormalThresholdHours) || 0));
}

function getFertilizerBuyCheckIntervalMinutes(accountId?: unknown): number {
    return Math.max(1, Math.min(1440, Number(getAccountConfigSnapshot(accountId).fertilizerBuyCheckIntervalMinutes) || 30));
}

function getPlantBlacklist(accountId?: unknown): number[] {
    return [...(getAccountConfigSnapshot(accountId).plantBlacklist || [])];
}

function setPlantBlacklist(accountId: unknown, list: unknown[]): number[] {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, sharedState.accountFallbackConfig);
    next.plantBlacklist = Array.isArray(list) ? list.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
    setAccountConfigSnapshot(accountId, next);
    return [...next.plantBlacklist];
}

function getDefaultAccountConfig(): AccountConfig {
    return cloneAccountConfig(sharedState.DEFAULT_ACCOUNT_CONFIG);
}

function getFriendAutoAccept(accountId?: unknown): { enabled: boolean; minLevel: number } {
    const cfg = getAccountConfigSnapshot(accountId).automation;
    return {
        enabled: !!cfg.friend_auto_accept,
        minLevel: Math.max(0, Number.parseInt(String(cfg.friend_auto_accept_min_level), 10) || 0),
    };
}

function setFriendAutoAccept(accountId: unknown, enabled: boolean, minLevel?: number): ReturnType<typeof applyConfigSnapshot> {
    return applyConfigSnapshot({
        automation: {
            friend_auto_accept: enabled,
            friend_auto_accept_min_level: minLevel === undefined ? undefined : Math.max(0, Number.parseInt(String(minLevel), 10) || 0),
        },
    }, { accountId });
}

module.exports = {
    getAccountConfigSnapshot,
    setAccountConfigSnapshot,
    removeAccountConfig,
    ensureAccountConfig,
    getConfigSnapshot,
    applyConfigSnapshot,
    getAutomation,
    setAutomation,
    isAutomationOn,
    getPreferredSeed,
    getPlantingStrategy,
    getBagSeedPriority,
    getBagSeedFallbackStrategy,
    getIntervals,
    getFriendQuietHours,
    getKnownFriendGids,
    setKnownFriendGids,
    getKnownFriendGidSyncCooldownSec,
    setKnownFriendGidSyncCooldownSec,
    getFriendsListCacheTtlSec,
    setFriendsListCacheTtlSec,
    getFriendBlacklist,
    setFriendBlacklist,
    addFriendToBlacklist,
    getFriendGuardDogGids,
    setFriendGuardDogGids,
    addFriendGuardDogGid,
    removeFriendGuardDogGid,
    getFriendGuardDogBlacklist,
    setFriendGuardDogBlacklist,
    addFriendGuardDogBlacklistGid,
    removeFriendGuardDogBlacklistGid,
    getFriendGuardDogWhitelist,
    setFriendGuardDogWhitelist,
    addFriendGuardDogWhitelistGid,
    removeFriendGuardDogWhitelistGid,
    getNoGuardDogAtMap,
    getNoGuardDogCacheTtlSec,
    setNoGuardDogCacheTtlSec,
    markNoGuardDog,
    unmarkNoGuardDog,
    clearNoGuardDogCache,
    isNoGuardDogCacheFresh,
    getNoGuardDogCacheStats,
    getStealDelaySeconds,
    getPlantOrderRandom,
    getPlantDelaySeconds,
    getFertilizerBuyOrganicCount,
    getFertilizerBuyOrganicThresholdHours,
    getFertilizerBuyNormalCount,
    getFertilizerBuyNormalThresholdHours,
    getFertilizerBuyCheckIntervalMinutes,
    getPlantBlacklist,
    setPlantBlacklist,
    getDefaultAccountConfig,
    getFriendAutoAccept,
    setFriendAutoAccept,
};
