import type { AccountConfig, Announcement, DeletedFriendRecord, FriendSnapshotItem, GoConfig, OfflineReminder, SystemConfig, UIConfig, YybConfig } from '../../types/config';
export {};

const { readTextFile, writeJsonFileAtomic } = require('../../services/json-db');
const { DEFAULT_CLIENT_VERSION } = require('../../config/config');

const sharedState = require('./shared-state');

const {
    STORE_FILE,
    PUSHOO_CHANNELS,
    DEFAULT_OFFLINE_REMINDER,
    DEFAULT_YYB_CONFIG,
    DEFAULT_GO_CONFIG,
    globalConfig,
    normalizeAccountConfig,
    normalizeYybConfig,
    normalizeGoConfig,
    cloneAccountConfig,
    DEFAULT_ACCOUNT_CONFIG,
} = sharedState;

function normalizeOfflineReminder(input: unknown): OfflineReminder {
    const src: Record<string, any> = (input && typeof input === 'object') ? input as Record<string, any> : {};
    let offlineDeleteSec = Number.parseInt(src.offlineDeleteSec, 10);
    if (!Number.isFinite(offlineDeleteSec) || offlineDeleteSec < 0) {
        offlineDeleteSec = DEFAULT_OFFLINE_REMINDER.offlineDeleteSec;
    }
    const rawChannel = (src.channel !== undefined && src.channel !== null)
        ? String(src.channel).trim().toLowerCase()
        : '';
    const endpoint = (src.endpoint !== undefined && src.endpoint !== null)
        ? String(src.endpoint).trim()
        : DEFAULT_OFFLINE_REMINDER.endpoint;
    const migratedChannel = rawChannel
        || (PUSHOO_CHANNELS.has(String(endpoint || '').trim().toLowerCase())
            ? String(endpoint || '').trim().toLowerCase()
            : DEFAULT_OFFLINE_REMINDER.channel);
    const channel = PUSHOO_CHANNELS.has(migratedChannel)
        ? migratedChannel
        : DEFAULT_OFFLINE_REMINDER.channel;
    const rawReloginUrlMode = (src.reloginUrlMode !== undefined && src.reloginUrlMode !== null)
        ? String(src.reloginUrlMode).trim().toLowerCase()
        : DEFAULT_OFFLINE_REMINDER.reloginUrlMode;
    const reloginUrlMode: OfflineReminder['reloginUrlMode'] = new Set(['none', 'qq_link', 'qr_link']).has(rawReloginUrlMode)
        ? rawReloginUrlMode as OfflineReminder['reloginUrlMode']
        : DEFAULT_OFFLINE_REMINDER.reloginUrlMode;
    const token = (src.token !== undefined && src.token !== null)
        ? String(src.token).trim()
        : DEFAULT_OFFLINE_REMINDER.token;
    const title = (src.title !== undefined && src.title !== null)
        ? String(src.title).trim()
        : DEFAULT_OFFLINE_REMINDER.title;
    const msg = (src.msg !== undefined && src.msg !== null)
        ? String(src.msg).trim()
        : DEFAULT_OFFLINE_REMINDER.msg;
    return {
        channel,
        reloginUrlMode,
        endpoint,
        token,
        title,
        msg,
        offlineDeleteSec,
    };
}

function sanitizeGlobalConfigBeforeSave(): void {
    sharedState.accountFallbackConfig = normalizeAccountConfig(globalConfig.defaultAccountConfig, DEFAULT_ACCOUNT_CONFIG);
    globalConfig.defaultAccountConfig = cloneAccountConfig(sharedState.accountFallbackConfig);

    const map = (globalConfig.accountConfigs && typeof globalConfig.accountConfigs === 'object')
        ? globalConfig.accountConfigs
        : {};
    const nextMap: Record<string, AccountConfig> = {};
    for (const [id, cfg] of Object.entries(map)) {
        const sid = String(id || '').trim();
        if (!sid) continue;
        nextMap[sid] = normalizeAccountConfig(cfg, DEFAULT_ACCOUNT_CONFIG);
    }
    globalConfig.accountConfigs = nextMap;

    const userReminders = (globalConfig.userOfflineReminders && typeof globalConfig.userOfflineReminders === 'object')
        ? globalConfig.userOfflineReminders
        : {};
    const nextReminders: Record<string, OfflineReminder> = {};
    for (const [username, cfg] of Object.entries(userReminders)) {
        const u = String(username || '').trim();
        if (!u) continue;
        nextReminders[u] = normalizeOfflineReminder(cfg);
    }
    globalConfig.userOfflineReminders = nextReminders;

    const userYybConfigs = (globalConfig.userYybConfigs && typeof globalConfig.userYybConfigs === 'object')
        ? globalConfig.userYybConfigs
        : {};
    const nextYybConfigs: Record<string, YybConfig> = {};
    for (const [username, cfg] of Object.entries(userYybConfigs)) {
        const u = String(username || '').trim();
        if (!u) continue;
        nextYybConfigs[u] = normalizeYybConfig(cfg);
    }
    globalConfig.userYybConfigs = nextYybConfigs;

    const userGoConfigs = (globalConfig.userGoConfigs && typeof globalConfig.userGoConfigs === 'object')
        ? globalConfig.userGoConfigs
        : {};
    const nextGoConfigs: Record<string, GoConfig> = {};
    for (const [username, cfg] of Object.entries(userGoConfigs)) {
        const u = String(username || '').trim();
        if (!u) continue;
        nextGoConfigs[u] = normalizeGoConfig(cfg);
    }
    globalConfig.userGoConfigs = nextGoConfigs;
}

function saveGlobalConfig(): void {
    const { ensureDataDir } = require('../../config/runtime-paths');
    ensureDataDir();
    try {
        const oldJson: string = readTextFile(STORE_FILE, '');

        sanitizeGlobalConfigBeforeSave();
        const newJson = JSON.stringify(globalConfig, null, 2);

        if (oldJson !== newJson) {
            console.warn('[系统] 正在保存配置到:', STORE_FILE);
            writeJsonFileAtomic(STORE_FILE, globalConfig);
        }
    } catch (e: any) {
        console.error('保存配置失败:', e.message);
    }
}

function getAdminPasswordHash(): string {
    return String(globalConfig.adminPasswordHash || '');
}

function setAdminPasswordHash(hash: unknown): string {
    globalConfig.adminPasswordHash = String(hash || '');
    saveGlobalConfig();
    return globalConfig.adminPasswordHash;
}

function getUI(): UIConfig {
    return { ...globalConfig.ui };
}

function setUITheme(theme: unknown): UIConfig {
    const t = String(theme || '').toLowerCase();
    const next: UIConfig['theme'] = (t === 'light') ? 'light' : 'dark';
    // Import here to avoid circular - use direct globalConfig mutation
    if (globalConfig.ui) {
        globalConfig.ui.theme = next;
    }
    saveGlobalConfig();
    return getUI();
}

function getOfflineReminder(username?: string): OfflineReminder {
    if (!username) {
        return normalizeOfflineReminder(globalConfig.offlineReminder);
    }
    const userCfg = globalConfig.userOfflineReminders && globalConfig.userOfflineReminders[username];
    if (userCfg) {
        return normalizeOfflineReminder(userCfg);
    }
    return normalizeOfflineReminder({});
}

function setOfflineReminder(cfg: Partial<OfflineReminder> | undefined, username?: string): OfflineReminder {
    if (!username) {
        const current = normalizeOfflineReminder(globalConfig.offlineReminder);
        globalConfig.offlineReminder = normalizeOfflineReminder({ ...current, ...(cfg || {}) });
        saveGlobalConfig();
        return getOfflineReminder();
    }
    if (!globalConfig.userOfflineReminders) {
        globalConfig.userOfflineReminders = {};
    }
    const current = normalizeOfflineReminder(globalConfig.userOfflineReminders[username] || {});
    globalConfig.userOfflineReminders[username] = normalizeOfflineReminder({ ...current, ...(cfg || {}) });
    saveGlobalConfig();
    return getOfflineReminder(username);
}

function deleteUserOfflineReminder(username: string): void {
    if (globalConfig.userOfflineReminders && globalConfig.userOfflineReminders[username]) {
        delete globalConfig.userOfflineReminders[username];
        saveGlobalConfig();
    }
}

function getYybConfig(username?: string): YybConfig {
    if (!username) {
        return normalizeYybConfig(globalConfig.userYybConfigs?.[''] || DEFAULT_YYB_CONFIG);
    }
    const userCfg = globalConfig.userYybConfigs && globalConfig.userYybConfigs[username];
    if (userCfg) {
        return normalizeYybConfig(userCfg);
    }
    return normalizeYybConfig(DEFAULT_YYB_CONFIG);
}

function setYybConfig(cfg: Partial<YybConfig> | undefined, username?: string): YybConfig {
    if (!username) {
        const current = normalizeYybConfig(globalConfig.userYybConfigs?.[''] || DEFAULT_YYB_CONFIG);
        globalConfig.userYybConfigs = globalConfig.userYybConfigs || {};
        globalConfig.userYybConfigs[''] = normalizeYybConfig({ ...current, ...(cfg || {}) });
        saveGlobalConfig();
        return getYybConfig();
    }
    if (!globalConfig.userYybConfigs) {
        globalConfig.userYybConfigs = {};
    }
    const current = normalizeYybConfig(globalConfig.userYybConfigs[username] || DEFAULT_YYB_CONFIG);
    globalConfig.userYybConfigs[username] = normalizeYybConfig({ ...current, ...(cfg || {}) });
    saveGlobalConfig();
    return getYybConfig(username);
}

function deleteUserYybConfig(username: string): void {
    if (globalConfig.userYybConfigs && globalConfig.userYybConfigs[username]) {
        delete globalConfig.userYybConfigs[username];
        saveGlobalConfig();
    }
}

function getGoConfig(username?: string): GoConfig {
    if (!username) {
        return normalizeGoConfig(globalConfig.userGoConfigs?.[''] || DEFAULT_GO_CONFIG);
    }
    const userCfg = globalConfig.userGoConfigs && globalConfig.userGoConfigs[username];
    if (userCfg) {
        return normalizeGoConfig(userCfg);
    }
    return normalizeGoConfig(DEFAULT_GO_CONFIG);
}

function setGoConfig(cfg: Partial<GoConfig> | undefined, username?: string): GoConfig {
    if (!username) {
        const current = normalizeGoConfig(globalConfig.userGoConfigs?.[''] || DEFAULT_GO_CONFIG);
        globalConfig.userGoConfigs = globalConfig.userGoConfigs || {};
        globalConfig.userGoConfigs[''] = normalizeGoConfig({ ...current, ...(cfg || {}) });
        saveGlobalConfig();
        return getGoConfig();
    }
    if (!globalConfig.userGoConfigs) {
        globalConfig.userGoConfigs = {};
    }
    const current = normalizeGoConfig(globalConfig.userGoConfigs[username] || DEFAULT_GO_CONFIG);
    globalConfig.userGoConfigs[username] = normalizeGoConfig({ ...current, ...(cfg || {}) });
    saveGlobalConfig();
    return getGoConfig(username);
}

function deleteUserGoConfig(username: string): void {
    if (globalConfig.userGoConfigs && globalConfig.userGoConfigs[username]) {
        delete globalConfig.userGoConfigs[username];
        saveGlobalConfig();
    }
}

function getAnnouncement(): Announcement {
    return {
        content: globalConfig.announcement?.content || '',
        showOnce: globalConfig.announcement?.showOnce ?? true,
        updatedAt: globalConfig.announcement?.updatedAt || 0,
    };
}

function setAnnouncement(content: unknown, showOnce: boolean = true): Announcement {
    globalConfig.announcement = {
        content: String(content || '').trim(),
        showOnce: !!showOnce,
        updatedAt: Date.now(),
    };
    saveGlobalConfig();
    return getAnnouncement();
}

function getAnnouncementReadRecord(username: string): number {
    if (!username) return 0;
    return globalConfig.announcementReadRecords?.[username] || 0;
}

function markAnnouncementRead(username: string): void {
    if (!username) return;
    if (!globalConfig.announcementReadRecords) {
        globalConfig.announcementReadRecords = {};
    }
    globalConfig.announcementReadRecords[username] = Date.now();
    saveGlobalConfig();
}

function shouldShowAnnouncement(username: string): boolean {
    const announcement = getAnnouncement();
    if (!announcement.content) return false;
    if (!username) return false;
    if (!announcement.showOnce) return true;
    const readAt = getAnnouncementReadRecord(username);
    return readAt < announcement.updatedAt;
}

function getSystemConfig(): SystemConfig | null {
    return globalConfig.systemConfig ? { ...globalConfig.systemConfig } : null;
}

function setSystemConfig(config: Partial<SystemConfig> | undefined): SystemConfig | null {
    if (!config || typeof config !== 'object') return null;
    const DEFAULT_DEVICE_INFO = {
        os: 'Windows',
        clientVersion: DEFAULT_CLIENT_VERSION,
        sysSoftware: 'Windows 10',
        network: 'wifi',
        memory: '16384',
        deviceId: 'DESKTOP-PC<WPC>',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)',
    };
    const srcDevice = (config.deviceInfo && typeof config.deviceInfo === 'object') ? config.deviceInfo : {};
    const deviceInfo = {
        os: String((srcDevice as any).os || DEFAULT_DEVICE_INFO.os).trim(),
        clientVersion: String((srcDevice as any).clientVersion || DEFAULT_DEVICE_INFO.clientVersion).trim(),
        sysSoftware: String((srcDevice as any).sysSoftware || DEFAULT_DEVICE_INFO.sysSoftware).trim(),
        network: String((srcDevice as any).network || DEFAULT_DEVICE_INFO.network).trim(),
        memory: String((srcDevice as any).memory || DEFAULT_DEVICE_INFO.memory).trim(),
        deviceId: String((srcDevice as any).deviceId || DEFAULT_DEVICE_INFO.deviceId).trim(),
        userAgent: String((srcDevice as any).userAgent || DEFAULT_DEVICE_INFO.userAgent).trim(),
    };
    globalConfig.systemConfig = {
        serverUrl: String(config.serverUrl || '').trim(),
        clientVersion: deviceInfo.clientVersion,
        platform: String(config.platform || 'qq').trim(),
        os: deviceInfo.os,
        deviceInfo,
        autoResumeEnabled: typeof (config as any).autoResumeEnabled === 'boolean'
            ? !!(config as any).autoResumeEnabled
            : true,
    };
    saveGlobalConfig();
    return { ...globalConfig.systemConfig };
}

/**
 * 读取"全局自动恢复"开关(供 runtime-engine 启动时调用)
 * 未配置/旧数据/字段不存在时默认 true(向后兼容,保持"按 autoStart 恢复"的默认行为)
 */
function getAutoResumeEnabled(): boolean {
    const v = globalConfig.systemConfig && globalConfig.systemConfig.autoResumeEnabled;
    if (typeof v === 'boolean') return v;
    return true;
}

// Initialize on load
const { loadGlobalConfig } = sharedState;
loadGlobalConfig();
// Apply offlineReminder normalization after load
globalConfig.offlineReminder = normalizeOfflineReminder(globalConfig.offlineReminder);
for (const [username, cfg] of Object.entries(globalConfig.userOfflineReminders || {})) {
    globalConfig.userOfflineReminders[username] = normalizeOfflineReminder(cfg);
}

// ============ 被好友删除记录（per-account） ============

function normalizeDeletedFriendRecord(input: unknown): DeletedFriendRecord | null {
    if (!input || typeof input !== 'object') return null;
    const src = input as Record<string, any>;
    const gid = Number.parseInt(String(src.gid ?? ''), 10);
    if (!Number.isFinite(gid) || gid <= 0) return null;
    const deletedAt = Number(src.deletedAt) || 0;
    if (deletedAt <= 0) return null;
    return {
        gid,
        name: String(src.name || `GID:${gid}`).trim() || `GID:${gid}`,
        avatarUrl: String(src.avatarUrl || '').trim(),
        deletedAt,
    };
}

function normalizeFriendSnapshotItem(input: unknown): FriendSnapshotItem | null {
    if (!input || typeof input !== 'object') return null;
    const src = input as Record<string, any>;
    const gid = Number.parseInt(String(src.gid ?? ''), 10);
    if (!Number.isFinite(gid) || gid <= 0) return null;
    return {
        gid,
        name: String(src.name || `GID:${gid}`).trim() || `GID:${gid}`,
        avatarUrl: String(src.avatarUrl || '').trim(),
    };
}

function getFriendDeletedRecords(accountId: unknown): DeletedFriendRecord[] {
    const id = sharedState.resolveAccountId(accountId);
    if (!id) return [];
    const map = (globalConfig.friendDeletedRecords && typeof globalConfig.friendDeletedRecords === 'object')
        ? globalConfig.friendDeletedRecords
        : {};
    const list = map[id];
    if (!Array.isArray(list)) return [];
    return list
        .map(normalizeDeletedFriendRecord)
        .filter((item): item is DeletedFriendRecord => !!item)
        .sort((a, b) => b.deletedAt - a.deletedAt);
}

function getFriendListSnapshot(accountId: unknown): FriendSnapshotItem[] {
    const id = sharedState.resolveAccountId(accountId);
    if (!id) return [];
    const map = (globalConfig.friendListSnapshot && typeof globalConfig.friendListSnapshot === 'object')
        ? globalConfig.friendListSnapshot
        : {};
    const list = map[id];
    if (!Array.isArray(list)) return [];
    return list
        .map(normalizeFriendSnapshotItem)
        .filter((item): item is FriendSnapshotItem => !!item);
}

function setFriendListSnapshot(accountId: unknown, snapshot: unknown[]): FriendSnapshotItem[] {
    const id = sharedState.resolveAccountId(accountId);
    if (!id) return [];
    if (!globalConfig.friendListSnapshot || typeof globalConfig.friendListSnapshot !== 'object') {
        globalConfig.friendListSnapshot = {};
    }
    const normalized: FriendSnapshotItem[] = (Array.isArray(snapshot) ? snapshot : [])
        .map(normalizeFriendSnapshotItem)
        .filter((item): item is FriendSnapshotItem => !!item);
    // 去重（同 gid 只保留第一次出现）
    const seen = new Set<number>();
    const unique: FriendSnapshotItem[] = [];
    for (const item of normalized) {
        if (seen.has(item.gid)) continue;
        seen.add(item.gid);
        unique.push(item);
    }
    globalConfig.friendListSnapshot[id] = unique;
    saveGlobalConfig();
    return unique;
}

/**
 * 对比当前好友列表与上次快照，处理被删/重新加回两种情况。
 *  - 快照中存在但当前列表中不存在的 gid:追加为"被删"记录（同 gid 只保留最新一条）
 *  - 已记录的"被删"gid 重新出现在当前列表:从被删记录中移除（视为主动恢复）
 * 统一在末尾 saveGlobalConfig() 一次，避免重复 IO。
 * 最多保留 5000 条被删记录，防止 store.json 无限增长。
 * 返回本次"新增"的被删记录条数。
 */
function detectAndRecordDeletedFriends(accountId: unknown, currentFriends: unknown[]): number {
    const id = sharedState.resolveAccountId(accountId);
    if (!id) return 0;

    const currentList: FriendSnapshotItem[] = (Array.isArray(currentFriends) ? currentFriends : [])
        .map((f: any) => {
            const gid = Number.parseInt(String(f?.gid ?? ''), 10);
            if (!Number.isFinite(gid) || gid <= 0) return null;
            return {
                gid,
                name: String(f?.name || `GID:${gid}`).trim() || `GID:${gid}`,
                avatarUrl: String(f?.avatarUrl || f?.avatar_url || '').trim(),
            } as FriendSnapshotItem;
        })
        .filter((item): item is FriendSnapshotItem => !!item);

    // 去重
    const seen = new Set<number>();
    const uniqueCurrent: FriendSnapshotItem[] = [];
    for (const item of currentList) {
        if (seen.has(item.gid)) continue;
        seen.add(item.gid);
        uniqueCurrent.push(item);
    }

    const previousSnapshot = getFriendListSnapshot(id);
    const currentGidSet = new Set(uniqueCurrent.map(f => f.gid));

    // 初始化全局容器
    if (!globalConfig.friendListSnapshot || typeof globalConfig.friendListSnapshot !== 'object') {
        globalConfig.friendListSnapshot = {};
    }
    if (!globalConfig.friendDeletedRecords || typeof globalConfig.friendDeletedRecords !== 'object') {
        globalConfig.friendDeletedRecords = {};
    }

    // 首次填充快照时（previousSnapshot 为空），不算"被删"，直接写入快照
    if (previousSnapshot.length === 0) {
        if (uniqueCurrent.length > 0) {
            globalConfig.friendListSnapshot[id] = uniqueCurrent;
            saveGlobalConfig();
        }
        return 0;
    }

    // 找出快照中存在、当前列表中不存在的 gid → 新增被删
    const newlyRemoved: DeletedFriendRecord[] = [];
    const now = Date.now();
    for (const prev of previousSnapshot) {
        if (!currentGidSet.has(prev.gid)) {
            newlyRemoved.push({
                gid: prev.gid,
                name: prev.name,
                avatarUrl: prev.avatarUrl,
                deletedAt: now,
            });
        }
    }

    // 已有被删记录中、当前又出现在好友列表里的 gid → 视为恢复，自动清理
    const existing = Array.isArray(globalConfig.friendDeletedRecords[id])
        ? globalConfig.friendDeletedRecords[id]
        : [];
    const existingMap = new Map<number, DeletedFriendRecord>();
    for (const item of existing) {
        const normalized = normalizeDeletedFriendRecord(item);
        if (normalized) existingMap.set(normalized.gid, normalized);
    }
    for (const item of newlyRemoved) {
        existingMap.set(item.gid, item);
    }
    // 删除已恢复的项
    for (const gid of currentGidSet) {
        existingMap.delete(gid);
    }
    // 按 deletedAt 倒序，超出上限丢弃最旧
    const merged = Array.from(existingMap.values()).sort((a, b) => b.deletedAt - a.deletedAt);
    const MAX = 5000;
    if (merged.length > MAX) merged.length = MAX;
    if (merged.length === 0) {
        delete globalConfig.friendDeletedRecords[id];
    } else {
        globalConfig.friendDeletedRecords[id] = merged;
    }

    // 更新快照
    globalConfig.friendListSnapshot[id] = uniqueCurrent;

    // 统一一次落盘
    if (newlyRemoved.length > 0 || merged.length !== existing.length) {
        saveGlobalConfig();
    }
    return newlyRemoved.length;
}

function clearFriendDeletedRecords(accountId: unknown): number {
    const id = sharedState.resolveAccountId(accountId);
    if (!id) return 0;
    if (!globalConfig.friendDeletedRecords || !Array.isArray(globalConfig.friendDeletedRecords[id])) {
        return 0;
    }
    const count = globalConfig.friendDeletedRecords[id].length;
    delete globalConfig.friendDeletedRecords[id];
    saveGlobalConfig();
    return count;
}

function removeFriendDeletedRecord(accountId: unknown, gid: unknown, deletedAt: unknown): boolean {
    const id = sharedState.resolveAccountId(accountId);
    const gidNum = Number.parseInt(String(gid ?? ''), 10);
    if (!id || !Number.isFinite(gidNum) || gidNum <= 0) return false;
    const list = globalConfig.friendDeletedRecords?.[id];
    if (!Array.isArray(list)) return false;
    const before = list.length;
    const filtered = list.filter((item: any) => {
        const n = normalizeDeletedFriendRecord(item);
        if (!n) return false;
        if (n.gid !== gidNum) return true;
        // 优先按 deletedAt 精确匹配；未传 deletedAt 时按 gid 全部移除
        if (deletedAt === undefined || deletedAt === null) return false;
        return n.deletedAt !== Number(deletedAt);
    });
    if (filtered.length === before) return false;
    if (filtered.length === 0) {
        delete globalConfig.friendDeletedRecords![id];
    } else {
        globalConfig.friendDeletedRecords![id] = filtered;
    }
    saveGlobalConfig();
    return true;
}

module.exports = {
    saveGlobalConfig,
    getAdminPasswordHash,
    setAdminPasswordHash,
    getUI,
    setUITheme,
    getOfflineReminder,
    setOfflineReminder,
    deleteUserOfflineReminder,
    getYybConfig,
    setYybConfig,
    deleteUserYybConfig,
    getGoConfig,
    setGoConfig,
    deleteUserGoConfig,
    getAnnouncement,
    setAnnouncement,
    getAnnouncementReadRecord,
    markAnnouncementRead,
    shouldShowAnnouncement,
    getSystemConfig,
    setSystemConfig,
    getAutoResumeEnabled,
    getFriendDeletedRecords,
    getFriendListSnapshot,
    setFriendListSnapshot,
    detectAndRecordDeletedFriends,
    clearFriendDeletedRecords,
    removeFriendDeletedRecord,
};
