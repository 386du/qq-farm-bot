import type { Account, AccountsData } from '../../types/account';
export {};

const { ensureDataDir } = require('../../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../../services/json-db');

const { ACCOUNTS_FILE } = require('./shared-state');

function loadAccounts(): AccountsData {
    ensureDataDir();
    const data = readJsonFile(ACCOUNTS_FILE, () => ({ accounts: [], nextId: 1 }));
    return normalizeAccountsData(data);
}

function saveAccounts(data: AccountsData): void {
    ensureDataDir();
    writeJsonFileAtomic(ACCOUNTS_FILE, normalizeAccountsData(data));
}

function getAccounts(): AccountsData {
    return loadAccounts();
}

function normalizeAccountsData(raw: unknown): AccountsData {
    const data: any = raw && typeof raw === 'object' ? raw : {};
    const accounts: Account[] = Array.isArray(data.accounts) ? data.accounts : [];
    const usedIds = new Set<number>();
    for (const a of accounts) {
        const id = Number.parseInt(a && a.id, 10);
        if (Number.isFinite(id) && id > 0) usedIds.add(id);
        // 旧 accounts.json 没有 autoStart 字段时显式归一为 undefined（让 addOrUpdateAccount 默认行为决定）
        if (typeof (a as any).autoStart !== 'boolean') {
            (a as any).autoStart = undefined;
        }
        // 归一化 Go 扫码账号的 codeRefreshIntervalMinutes(0 = 不刷新, 1~1440 = 1 分钟 ~ 24 小时)
        const interval = Math.max(0, Math.min(1440, Number.parseInt(String((a as any).codeRefreshIntervalMinutes ?? 0), 10) || 0));
        (a as any).codeRefreshIntervalMinutes = interval;
    }
    let nextId = 1;
    while (usedIds.has(nextId)) nextId++;
    return { accounts, nextId };
}

/**
 * 仅更新指定账号的 autoStart 字段（不改动其他字段）
 * 容器启动时通过这个函数恢复持久化的"用户希望自动启动"标记
 */
function setAccountAutoStart(accountId: string, enabled: boolean): AccountsData {
    const data = normalizeAccountsData(loadAccounts());
    const target = data.accounts.find(a => String(a.id) === String(accountId));
    if (!target) return data;
    target.autoStart = !!enabled;
    target.updatedAt = Date.now();
    saveAccounts(data);
    return data;
}

/**
 * 获取所有标记了 autoStart=true 的账号（容器启动时调）
 * 注：调用方要再过滤一次"账号仍存在 / 没被删除"
 */
function getAutoStartAccountIds(): string[] {
    const data = normalizeAccountsData(loadAccounts());
    return (data.accounts || [])
        .filter(a => (a as any).autoStart === true)
        .map(a => String(a.id));
}

function addOrUpdateAccount(acc: Partial<Account> & { avatarUrl?: string }): AccountsData {
    const { ensureAccountConfig } = require('./account-config');
    const data = normalizeAccountsData(loadAccounts());
    let touchedAccountId = '';
    if (acc.id) {
        const idx = data.accounts.findIndex(a => a.id === acc.id);
        if (idx >= 0) {
            const current = data.accounts[idx];
            const merged: any = { ...current, ...acc, name: acc.name !== undefined ? acc.name : current.name, updatedAt: Date.now() };
            // 保持 loginType / openid / codeRefreshIntervalMinutes 这些 go_scan 必需字段
            if (acc.loginType !== undefined) merged.loginType = acc.loginType;
            else if (current.loginType) merged.loginType = current.loginType;
            if (acc.openid !== undefined) merged.openid = acc.openid ? String(acc.openid) : '';
            else if (current.openid) merged.openid = current.openid;
            if (acc.codeRefreshIntervalMinutes !== undefined) {
                merged.codeRefreshIntervalMinutes = Math.max(0, Math.min(1440, Number.parseInt(String(acc.codeRefreshIntervalMinutes), 10) || 0));
            }
            data.accounts[idx] = merged;
            touchedAccountId = String(data.accounts[idx].id || '');
        }
    } else {
        const id = data.nextId++;
        touchedAccountId = String(id);
        const newAcc: any = {
            id: touchedAccountId,
            name: acc.name || `账号${id}`,
            code: acc.code || '',
            platform: acc.platform || 'qq',
            uin: acc.uin ? String(acc.uin) : '',
            qq: acc.qq ? String(acc.qq) : (acc.uin ? String(acc.uin) : ''),
            avatar: acc.avatar || acc.avatarUrl || '',
            username: acc.username || '',
            loginType: acc.loginType || '',
            openid: acc.openid ? String(acc.openid) : '',
            codeRefreshIntervalMinutes: Math.max(0, Math.min(1440, Number.parseInt(String(acc.codeRefreshIntervalMinutes ?? 0), 10) || 0)),
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        data.accounts.push(newAcc);
    }
    saveAccounts(data);
    if (touchedAccountId) {
        ensureAccountConfig(touchedAccountId);
    }
    return data;
}

function deleteAccount(id: unknown): AccountsData {
    const { removeAccountConfig } = require('./account-config');
    const data = normalizeAccountsData(loadAccounts());
    data.accounts = data.accounts.filter(a => a.id !== String(id));
    if (data.accounts.length === 0) {
        data.nextId = 1;
    }
    saveAccounts(data);
    removeAccountConfig(id);
    return data;
}

function getAccountsByUser(username: string): AccountsData {
    const allAccounts = loadAccounts();
    if (!username) return allAccounts;
    return {
        accounts: allAccounts.accounts.filter(a => a.username === username),
        nextId: allAccounts.nextId
    };
}

function deleteAccountsByUser(username: string): { deletedCount: number; deletedIds: string[] } {
    const { removeAccountConfig } = require('./account-config');
    const data = loadAccounts();
    const deletedIds: string[] = [];
    data.accounts = data.accounts.filter(a => {
        if (a.username === username) {
            deletedIds.push(a.id);
            return false;
        }
        return true;
    });
    if (data.accounts.length === 0) {
        data.nextId = 1;
    }
    saveAccounts(data);
    deletedIds.forEach(id => removeAccountConfig(id));
    return { deletedCount: deletedIds.length, deletedIds };
}

function deleteUserConfig(username: string): void {
    const { deleteUserOfflineReminder } = require('./global-config');
    deleteUserOfflineReminder(username);
}

module.exports = {
    loadAccounts,
    saveAccounts,
    getAccounts,
    normalizeAccountsData,
    addOrUpdateAccount,
    deleteAccount,
    getAccountsByUser,
    deleteAccountsByUser,
    deleteUserConfig,
    setAccountAutoStart,
    getAutoStartAccountIds,
};
