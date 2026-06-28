export {};

const fs = require('node:fs');
const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../../config/runtime-paths');
const { createModuleLogger } = require('../../services/logger');

const logger = createModuleLogger('token-store');

const TOKEN_FILE = getDataFile('tokens.json');
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 每小时清理一次

interface TokenEntry {
    token: string;
    user: any;
    createdAt: number;
    expiresAt: number;
    lastActivityAt?: number;
}

interface TokenStoreData {
    tokens: Record<string, TokenEntry>;
}

let tokens: Record<string, TokenEntry> = {};
let cleanupTimer: any = null;
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 分钟内活跃视为在线

function loadTokens(): void {
    try {
        ensureDataDir();
        if (fs.existsSync(TOKEN_FILE)) {
            const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
            const data: TokenStoreData = JSON.parse(raw);
            if (data && data.tokens && typeof data.tokens === 'object') {
                tokens = data.tokens;
                const cleaned = cleanupExpired();
                if (cleaned > 0) {
                    logger.info(`启动时清理了 ${cleaned} 个过期 token`);
                }
            }
        }
    }
    catch (e: any) {
        logger.warn('加载 token 文件失败，使用空数据:', e.message);
        tokens = {};
    }
}

function saveTokens(): void {
    try {
        ensureDataDir();
        const data: TokenStoreData = { tokens };
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf8');
    }
    catch (e: any) {
        logger.error('保存 token 文件失败:', e.message);
    }
}

function generateToken(): string {
    return crypto.randomBytes(24).toString('hex');
}

function addToken(user: any): TokenEntry {
    const token = generateToken();
    const now = Date.now();
    const entry: TokenEntry = {
        token,
        user,
        createdAt: now,
        expiresAt: now + TOKEN_TTL_MS,
        lastActivityAt: now,
    };
    tokens[token] = entry;
    saveTokens();
    return entry;
}

function getToken(token: string): TokenEntry | null {
    const entry = tokens[token];
    if (!entry)
        return null;
    if (Date.now() > entry.expiresAt) {
        delete tokens[token];
        saveTokens();
        return null;
    }
    return entry;
}

function removeToken(token: string): boolean {
    if (tokens[token]) {
        delete tokens[token];
        saveTokens();
        return true;
    }
    return false;
}

function updateTokenUser(token: string, user: any): boolean {
    const entry = tokens[token];
    if (!entry)
        return false;
    entry.user = user;
    saveTokens();
    return true;
}

function updateTokensForUser(username: string, updater: (user: any) => any): number {
    let count = 0;
    for (const token of Object.keys(tokens)) {
        const entry = tokens[token];
        if (entry.user?.username === username) {
            entry.user = updater({ ...entry.user });
            count++;
        }
    }
    if (count > 0)
        saveTokens();
    return count;
}

function cleanupExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const token of Object.keys(tokens)) {
        if (now > tokens[token].expiresAt) {
            delete tokens[token];
            count++;
        }
    }
    if (count > 0)
        saveTokens();
    return count;
}

function startCleanupTimer(): void {
    if (cleanupTimer)
        return;
    cleanupTimer = setInterval(() => {
        const cleaned = cleanupExpired();
        if (cleaned > 0) {
            logger.info(`自动清理了 ${cleaned} 个过期 token`);
        }
    }, CLEANUP_INTERVAL_MS);
    if (cleanupTimer.unref)
        cleanupTimer.unref();
}

function getAllTokens(): TokenEntry[] {
    return Object.values(tokens);
}

function getTokenCount(): number {
    return Object.keys(tokens).length;
}

function updateActivity(token: string): void {
    const entry = tokens[token];
    if (!entry)
        return;
    entry.lastActivityAt = Date.now();
}

function isUserOnline(username: string): boolean {
    const now = Date.now();
    return Object.values(tokens).some(entry =>
        entry.user?.username === username
        && (entry.lastActivityAt || entry.createdAt) > now - ONLINE_THRESHOLD_MS
    );
}

function getUserLastActivity(username: string): number | null {
    let last: number | null = null;
    for (const entry of Object.values(tokens)) {
        if (entry.user?.username === username) {
            const t = entry.lastActivityAt || entry.createdAt;
            if (t && (last === null || t > last)) {
                last = t;
            }
        }
    }
    return last;
}

interface SessionInfo {
    token: string;
    username: string;
    role: string;
    ip?: string;
    userAgent?: string;
    createdAt: number;
    lastActivityAt: number;
    online: boolean;
}

function getActiveSessions(): SessionInfo[] {
    const now = Date.now();
    return Object.values(tokens)
        .map(entry => ({
            token: entry.token,
            username: entry.user?.username || 'unknown',
            role: entry.user?.role || 'user',
            ip: entry.user?.ip || 'unknown',
            userAgent: entry.user?.userAgent || '',
            createdAt: entry.createdAt,
            lastActivityAt: entry.lastActivityAt || entry.createdAt,
            online: (entry.lastActivityAt || entry.createdAt) > now - ONLINE_THRESHOLD_MS,
        }))
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

function revokeToken(token: string): boolean {
    if (tokens[token]) {
        delete tokens[token];
        saveTokens();
        return true;
    }
    return false;
}

function revokeTokensByUser(username: string): number {
    let count = 0;
    for (const token of Object.keys(tokens)) {
        if (tokens[token].user?.username === username) {
            delete tokens[token];
            count++;
        }
    }
    if (count > 0)
        saveTokens();
    return count;
}

loadTokens();
startCleanupTimer();

module.exports = {
    TOKEN_TTL_MS,
    ONLINE_THRESHOLD_MS,
    addToken,
    getToken,
    removeToken,
    updateTokenUser,
    updateTokensForUser,
    cleanupExpired,
    getAllTokens,
    getTokenCount,
    updateActivity,
    isUserOnline,
    getUserLastActivity,
    getActiveSessions,
    revokeToken,
    revokeTokensByUser,
};
