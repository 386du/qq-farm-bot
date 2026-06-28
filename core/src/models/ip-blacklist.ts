export {};
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../services/json-db');

const BLACKLIST_FILE = getDataFile('ip-blacklist.json');

// 自动封禁阈值：30 分钟内失败 10 次
const AUTO_BLOCK_FAILED_THRESHOLD = 10;
const AUTO_BLOCK_WINDOW_MS = 30 * 60 * 1000;
const AUTO_BLOCK_DURATION_MS = 24 * 60 * 60 * 1000;

interface BlacklistEntry {
    ip: string;
    reason: string;
    createdAt: number;
    expiresAt: number | null;
    autoBlocked: boolean;
}

interface FailedAttempt {
    count: number;
    firstAttempt: number;
    lastAttempt: number;
}

interface IpBlacklistData {
    blacklist: BlacklistEntry[];
    failedAttempts: Record<string, FailedAttempt>;
}

let data: IpBlacklistData = { blacklist: [], failedAttempts: {} };

function load(): void {
    ensureDataDir();
    data = readJsonFile(BLACKLIST_FILE, () => ({ blacklist: [], failedAttempts: {} }));
    cleanExpired();
}

function save(): void {
    ensureDataDir();
    writeJsonFileAtomic(BLACKLIST_FILE, data);
}

function cleanExpired(): void {
    const now = Date.now();
    let changed = false;

    const validBlacklist: BlacklistEntry[] = [];
    for (const entry of data.blacklist) {
        if (entry.expiresAt && entry.expiresAt <= now) {
            changed = true;
            continue;
        }
        validBlacklist.push(entry);
    }
    data.blacklist = validBlacklist;

    for (const ip of Object.keys(data.failedAttempts)) {
        const attempt = data.failedAttempts[ip];
        if (now - attempt.firstAttempt > AUTO_BLOCK_WINDOW_MS) {
            delete data.failedAttempts[ip];
            changed = true;
        }
    }

    if (changed) {
        save();
    }
}

function isBlocked(ip: string): { blocked: boolean; reason?: string; remainingMs?: number } {
    load();
    const entry = data.blacklist.find(e => e.ip === ip);
    if (!entry) {
        return { blocked: false };
    }
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
        remove(ip);
        return { blocked: false };
    }
    return {
        blocked: true,
        reason: entry.reason,
        remainingMs: entry.expiresAt ? entry.expiresAt - Date.now() : undefined,
    };
}

function add(
    ip: string,
    reason = '管理员手动封禁',
    expiresAt: number | null = null,
    autoBlocked = false,
): void {
    load();
    if (!ip || ip === 'unknown') return;

    const idx = data.blacklist.findIndex(e => e.ip === ip);
    const entry: BlacklistEntry = {
        ip,
        reason,
        createdAt: Date.now(),
        expiresAt,
        autoBlocked,
    };

    if (idx >= 0) {
        data.blacklist[idx] = entry;
    } else {
        data.blacklist.push(entry);
    }

    save();
}

function remove(ip: string): boolean {
    load();
    const before = data.blacklist.length;
    data.blacklist = data.blacklist.filter(e => e.ip !== ip);
    if (data.failedAttempts[ip]) {
        delete data.failedAttempts[ip];
    }
    if (data.blacklist.length !== before || data.failedAttempts[ip] === undefined) {
        save();
    }
    return data.blacklist.length !== before;
}

function clear(): void {
    data.blacklist = [];
    data.failedAttempts = {};
    save();
}

function getList(): BlacklistEntry[] {
    load();
    return [...data.blacklist];
}

function recordFailedLogin(ip: string): void {
    load();
    if (!ip || ip === 'unknown') return;

    const now = Date.now();
    let attempt = data.failedAttempts[ip];
    if (!attempt || now - attempt.firstAttempt > AUTO_BLOCK_WINDOW_MS) {
        attempt = { count: 1, firstAttempt: now, lastAttempt: now };
    } else {
        attempt.count++;
        attempt.lastAttempt = now;
    }
    data.failedAttempts[ip] = attempt;

    if (attempt.count >= AUTO_BLOCK_FAILED_THRESHOLD && !data.blacklist.find(e => e.ip === ip)) {
        add(
            ip,
            `登录失败次数过多（${attempt.count} 次）`,
            now + AUTO_BLOCK_DURATION_MS,
            true,
        );
    }

    save();
}

function clearFailedAttempts(ip: string): void {
    load();
    if (data.failedAttempts[ip]) {
        delete data.failedAttempts[ip];
        save();
    }
}

load();

module.exports = {
    load,
    save,
    isBlocked,
    add,
    remove,
    clear,
    getList,
    recordFailedLogin,
    clearFailedAttempts,
    AUTO_BLOCK_FAILED_THRESHOLD,
    AUTO_BLOCK_WINDOW_MS,
    AUTO_BLOCK_DURATION_MS,
};
