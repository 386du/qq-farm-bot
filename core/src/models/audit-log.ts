export {};
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../services/json-db');

const AUDIT_LOG_FILE = getDataFile('audit-logs.json');
const MAX_LOGS = 10000;

interface AuditLogEntry {
    id: string;
    timestamp: number;
    event: string;
    username: string;
    ip: string;
    details?: Record<string, any>;
}

interface AuditLogData {
    logs: AuditLogEntry[];
}

function loadLogs(): AuditLogData {
    ensureDataDir();
    return readJsonFile(AUDIT_LOG_FILE, () => ({ logs: [] }));
}

function saveLogs(data: AuditLogData): void {
    ensureDataDir();
    writeJsonFileAtomic(AUDIT_LOG_FILE, data);
}

function generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

function log(event: string, username: string, ip: string, details?: Record<string, any>): void {
    try {
        const data = loadLogs();
        data.logs.unshift({
            id: generateId(),
            timestamp: Date.now(),
            event,
            username: username || 'unknown',
            ip: ip || 'unknown',
            details,
        });
        if (data.logs.length > MAX_LOGS) {
            data.logs = data.logs.slice(0, MAX_LOGS);
        }
        saveLogs(data);
    } catch (e: any) {
        console.error('[审计日志] 写入失败:', e.message);
    }
}

function getLogs(limit = 100, offset = 0): AuditLogEntry[] {
    const data = loadLogs();
    return data.logs.slice(offset, offset + limit);
}

function getLogCount(): number {
    return loadLogs().logs.length;
}

function clearLogs(): void {
    saveLogs({ logs: [] });
}

module.exports = {
    log,
    getLogs,
    getLogCount,
    clearLogs,
};
