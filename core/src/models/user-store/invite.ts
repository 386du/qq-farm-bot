export {};
const fs = require('node:fs');
const { getDataFile, ensureDataDir } = require('../../config/runtime-paths');
const { writeJsonFileAtomic } = require('../../services/json-db');

const INVITE_CONFIG_FILE: string = getDataFile('invite-config.json');
const INVITE_RECORDS_FILE: string = getDataFile('invite-records.json');
const INVITE_REWARDS_FILE: string = getDataFile('invite-rewards.json');

// 注意：users.ts 与 invite.ts 存在循环依赖（users.registerUser 会调用 invite.*），
// 必须在函数内部延迟加载 users，否则 invite.ts 加载时 users 还未完成初始化，
// 会导致 users 为空对象，进而出现 "users.loadUsers is not a function" 的 500 错误。
let _users: any = null;
function getUsers(): any {
    if (!_users) {
        _users = require('./users');
    }
    return _users;
}
const DEFAULT_ACCOUNT_LIMIT_FALLBACK = 2;

interface InviteRewardRule {
    count: number;
    rewardDays: number;
    rewardAccountLimit?: number;
    description?: string;
}

interface InviteConfig {
    enabled: boolean;
    rules: InviteRewardRule[];
}

interface InviteRecord {
    inviter: string;
    invitee: string;
    invitedAt: number;
}

interface UserRewardState {
    username: string;
    inviteCount: number;
    claimed: number[];
}

let inviteConfigCache: InviteConfig | null = null;
let inviteRecordsCache: InviteRecord[] | null = null;
let inviteRewardsCache: UserRewardState[] | null = null;

function generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function loadInviteConfig(): InviteConfig {
    if (inviteConfigCache) return inviteConfigCache;
    ensureDataDir();
    try {
        if (fs.existsSync(INVITE_CONFIG_FILE)) {
            const data = JSON.parse(fs.readFileSync(INVITE_CONFIG_FILE, 'utf8'));
            const rules = Array.isArray(data.rules)
                ? data.rules.filter((r: any) => r && typeof r.count === 'number' && typeof r.rewardDays === 'number')
                : [];
            inviteConfigCache = {
                enabled: data.enabled !== false,
                rules: rules.sort((a: InviteRewardRule, b: InviteRewardRule) => a.count - b.count),
            };
        } else {
            inviteConfigCache = { enabled: true, rules: [] };
            saveInviteConfig(inviteConfigCache);
        }
    } catch (e: any) {
        console.error('加载邀请配置失败:', e.message);
        inviteConfigCache = { enabled: true, rules: [] };
    }
    return inviteConfigCache;
}

function saveInviteConfig(config: InviteConfig): void {
    inviteConfigCache = {
        enabled: config.enabled !== false,
        rules: (config.rules || [])
            .filter(r => r && typeof r.count === 'number' && typeof r.rewardDays === 'number')
            .sort((a, b) => a.count - b.count),
    };
    try {
        writeJsonFileAtomic(INVITE_CONFIG_FILE, inviteConfigCache);
    } catch (e: any) {
        console.error('保存邀请配置失败:', e.message);
    }
}

function loadInviteRecords(): InviteRecord[] {
    if (inviteRecordsCache) return inviteRecordsCache;
    ensureDataDir();
    try {
        if (fs.existsSync(INVITE_RECORDS_FILE)) {
            const data = JSON.parse(fs.readFileSync(INVITE_RECORDS_FILE, 'utf8'));
            inviteRecordsCache = Array.isArray(data.records) ? data.records : [];
        } else {
            inviteRecordsCache = [];
            saveInviteRecords();
        }
    } catch (e: any) {
        console.error('加载邀请记录失败:', e.message);
        inviteRecordsCache = [];
    }
    return inviteRecordsCache;
}

function saveInviteRecords(): void {
    try {
        writeJsonFileAtomic(INVITE_RECORDS_FILE, { records: inviteRecordsCache || [] });
    } catch (e: any) {
        console.error('保存邀请记录失败:', e.message);
    }
}

function loadInviteRewards(): UserRewardState[] {
    if (inviteRewardsCache) return inviteRewardsCache;
    ensureDataDir();
    try {
        if (fs.existsSync(INVITE_REWARDS_FILE)) {
            const data = JSON.parse(fs.readFileSync(INVITE_REWARDS_FILE, 'utf8'));
            inviteRewardsCache = Array.isArray(data.states) ? data.states : [];
        } else {
            inviteRewardsCache = [];
            saveInviteRewards();
        }
    } catch (e: any) {
        console.error('加载邀请奖励记录失败:', e.message);
        inviteRewardsCache = [];
    }
    return inviteRewardsCache;
}

function saveInviteRewards(): void {
    try {
        writeJsonFileAtomic(INVITE_REWARDS_FILE, { states: inviteRewardsCache || [] });
    } catch (e: any) {
        console.error('保存邀请奖励记录失败:', e.message);
    }
}

function getOrCreateUserRewardState(username: string): UserRewardState {
    const states = loadInviteRewards();
    let state = states.find(s => s.username === username);
    if (!state) {
        state = { username, inviteCount: 0, claimed: [] };
        states.push(state);
    }
    return state;
}

function ensureUserInviteCode(username: string): string {
    const users = getUsers();
    // 注意：不要在此调用 users.loadUsers()，
    // 否则会从文件重新加载覆盖调用方刚刚在内存中修改的 users 数组，
    // 导致 registerUser 中 push 的新用户丢失、saveUsers 写入残缺数据。
    const user = users.getAllUsersInternal().find((u: any) => u.username === username);
    if (!user) return '';

    if (!user.inviteCode) {
        let code = generateInviteCode();
        const allUsers = users.getAllUsersInternal();
        while (allUsers.some((u: any) => u.inviteCode === code)) {
            code = generateInviteCode();
        }
        user.inviteCode = code;
        users.saveUsers();
    }
    return user.inviteCode;
}

function findUserByInviteCode(code: string): any {
    if (!code) return null;
    const users = getUsers();
    return users.getAllUsersInternal().find((u: any) => u.inviteCode === code) || null;
}

function recordInvite(inviterCode: string, inviteeUsername: string): { ok: boolean; error?: string; inviter?: string } {
    const config = loadInviteConfig();
    if (!config.enabled) {
        return { ok: false, error: '邀请功能未开启' };
    }

    const inviter = findUserByInviteCode(inviterCode);
    if (!inviter) {
        return { ok: false, error: '邀请码不存在' };
    }

    if (inviter.username === inviteeUsername) {
        return { ok: false, error: '不能邀请自己' };
    }

    const records = loadInviteRecords();
    if (records.some(r => r.invitee === inviteeUsername)) {
        return { ok: false, error: '该用户已被邀请过' };
    }

    records.push({
        inviter: inviter.username,
        invitee: inviteeUsername,
        invitedAt: Date.now(),
    });
    inviteRecordsCache = records;
    saveInviteRecords();

    const state = getOrCreateUserRewardState(inviter.username);
    state.inviteCount = records.filter(r => r.inviter === inviter.username).length;
    saveInviteRewards();

    return { ok: true, inviter: inviter.username };
}

function getInviteCount(username: string): number {
    const records = loadInviteRecords();
    return records.filter(r => r.inviter === username).length;
}

function getUserInviteInfo(username: string): { code: string; count: number; invitees: string[] } {
    getUsers().loadUsers();
    const code = ensureUserInviteCode(username);
    const records = loadInviteRecords();
    const userRecords = records.filter(r => r.inviter === username);
    return {
        code,
        count: userRecords.length,
        invitees: userRecords.map(r => r.invitee),
    };
}

function getAvailableRewards(username: string): { rules: InviteRewardRule[]; count: number } {
    const config = loadInviteConfig();
    const count = getInviteCount(username);
    const state = getOrCreateUserRewardState(username);
    const available = config.rules.filter(rule => count >= rule.count && !state.claimed.includes(rule.count));
    return { rules: available, count };
}

function getRewardState(username: string): { count: number; claimed: number[]; totalRewardDays: number; totalRewardAccountLimit: number } {
    const state = getOrCreateUserRewardState(username);
    const config = loadInviteConfig();
    const claimedRules = config.rules.filter(r => state.claimed.includes(r.count));
    const totalRewardDays = claimedRules.reduce((sum, r) => sum + (r.rewardDays || 0), 0);
    const totalRewardAccountLimit = claimedRules.reduce((sum, r) => sum + (r.rewardAccountLimit || 0), 0);
    return {
        count: state.inviteCount,
        claimed: state.claimed,
        totalRewardDays,
        totalRewardAccountLimit,
    };
}

function addDaysToUserCard(username: string, days: number): { ok: boolean; error?: string } {
    const users = getUsers();
    users.loadUsers();
    const user = users.getAllUsersInternal().find((u: any) => u.username === username);
    if (!user) return { ok: false, error: '用户不存在' };

    const now = Date.now();
    if (!user.card) {
        user.card = {
            code: 'invite-reward',
            description: '邀请奖励',
            days: 0,
            expiresAt: null,
            enabled: true,
        };
    }

    const currentExpires = user.card.expiresAt || 0;
    const currentDays = user.card.days || 0;

    if (days === -1) {
        user.card.expiresAt = null;
        user.card.days = -1;
    } else if (user.card.days === -1) {
        user.card.expiresAt = null;
    } else {
        user.card.days = currentDays + days;
        if (currentExpires && currentExpires > now) {
            user.card.expiresAt = currentExpires + days * 24 * 60 * 60 * 1000;
        } else {
            user.card.expiresAt = now + days * 24 * 60 * 60 * 1000;
        }
    }

    if (!user.card.description || user.card.description === '邀请奖励') {
        user.card.description = '邀请奖励';
    }

    users.saveUsers();
    return { ok: true };
}

function addAccountLimit(username: string, amount: number): { ok: boolean; error?: string } {
    const users = getUsers();
    users.loadUsers();
    const user = users.getAllUsersInternal().find((u: any) => u.username === username);
    if (!user) return { ok: false, error: '用户不存在' };

    const baseLimit = users.DEFAULT_ACCOUNT_LIMIT || DEFAULT_ACCOUNT_LIMIT_FALLBACK;
    user.accountLimit = (user.accountLimit || baseLimit) + amount;
    users.saveUsers();
    return { ok: true };
}

function claimReward(username: string, count: number): { ok: boolean; error?: string; reward?: InviteRewardRule } {
    const config = loadInviteConfig();
    if (!config.enabled) {
        return { ok: false, error: '邀请功能未开启' };
    }

    const rule = config.rules.find(r => r.count === count);
    if (!rule) {
        return { ok: false, error: '奖励档位不存在' };
    }

    const inviteCount = getInviteCount(username);
    if (inviteCount < count) {
        return { ok: false, error: '邀请人数不足' };
    }

    const state = getOrCreateUserRewardState(username);
    if (state.claimed.includes(count)) {
        return { ok: false, error: '该奖励已领取' };
    }

    if (rule.rewardDays && rule.rewardDays > 0) {
        const result = addDaysToUserCard(username, rule.rewardDays);
        if (!result.ok) return result;
    }

    if (rule.rewardAccountLimit && rule.rewardAccountLimit > 0) {
        const result = addAccountLimit(username, rule.rewardAccountLimit);
        if (!result.ok) return result;
    }

    state.claimed.push(count);
    state.inviteCount = inviteCount;
    saveInviteRewards();

    return { ok: true, reward: rule };
}

function getAllInviteRecords(): InviteRecord[] {
    return loadInviteRecords();
}

function getInviteConfig(): InviteConfig {
    return loadInviteConfig();
}

function setInviteConfig(config: InviteConfig): InviteConfig {
    saveInviteConfig(config);
    return loadInviteConfig();
}

function refreshInviteConfig(): void {
    inviteConfigCache = null;
}

function resetCache(): void {
    inviteConfigCache = null;
    inviteRecordsCache = null;
    inviteRewardsCache = null;
}

module.exports = {
    generateInviteCode,
    ensureUserInviteCode,
    findUserByInviteCode,
    recordInvite,
    getInviteCount,
    getUserInviteInfo,
    getAvailableRewards,
    getRewardState,
    claimReward,
    getAllInviteRecords,
    getInviteConfig,
    setInviteConfig,
    refreshInviteConfig,
    resetCache,
};
