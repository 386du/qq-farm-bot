import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 面板展示配置（公开读 + 管理员写）
 *  - GET  /api/display-config     公开读取（用于登录页 / 侧边栏展示版本号）
 *  - PUT  /api/display-config     管理员写入
 *
 * 数据存储在 core/data/display-config.json，结构：
 * {
 *   webVersion: 'v20260701',  // 自定义的 Web 版本号（留空则使用构建版本）
 *   updatedAt: '...',
 *   updatedBy: 'admin',
 * }
 */

const fs = require('node:fs');
const path = require('node:path');

const { ensureDataDir } = require('../../config/runtime-paths');
const { createModuleLogger } = require('../../services/logger');
const { adminRequired } = require('./middleware');

const displayConfigLogger = createModuleLogger('display-config');

const DISPLAY_CONFIG_FILE = 'display-config.json';

function getDisplayConfigPath(): string {
    return path.join(ensureDataDir(), DISPLAY_CONFIG_FILE);
}

function getInitialDisplayConfig(): any {
    return {
        webVersion: '',
        updatedAt: new Date(0).toISOString(),
        updatedBy: 'system',
    };
}

function readDisplayConfig(): any {
    try {
        const filePath = getDisplayConfigPath();
        if (!fs.existsSync(filePath)) {
            return getInitialDisplayConfig();
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return getInitialDisplayConfig();
        }
        return {
            webVersion: String(parsed.webVersion || ''),
            updatedAt: String(parsed.updatedAt || ''),
            updatedBy: String(parsed.updatedBy || 'system'),
        };
    }
    catch (e: any) {
        displayConfigLogger.warn('read display-config failed', { error: e?.message });
        return getInitialDisplayConfig();
    }
}

function writeDisplayConfig(data: any, updatedBy: string): { ok: boolean, error?: string, data?: any } {
    try {
        if (!data || typeof data !== 'object') {
            return { ok: false, error: '数据格式错误' };
        }
        const webVersion = String(data.webVersion || '').trim();
        if (webVersion.length > 64) {
            return { ok: false, error: 'webVersion 长度不能超过 64 个字符' };
        }
        const out = {
            webVersion,
            updatedAt: new Date().toISOString(),
            updatedBy: String(updatedBy || 'admin'),
        };
        fs.writeFileSync(getDisplayConfigPath(), JSON.stringify(out, null, 2), 'utf8');
        displayConfigLogger.info('display-config updated', { by: updatedBy, webVersion });
        return { ok: true, data: out };
    }
    catch (e: any) {
        return { ok: false, error: e?.message || '写入失败' };
    }
}

function mountDisplayConfigRoutes(app: Application, _ctx: AdminContext): void {
    // 公开读取（登录页 / 侧边栏用于显示自定义版本号）
    app.get('/api/display-config', (_req: Request, res: Response) => {
        try {
            const data = readDisplayConfig();
            res.json({ ok: true, data });
        }
        catch (e: any) {
            res.status(500).json({ ok: false, error: e?.message || '读取失败' });
        }
    });

    // 管理员写入
    app.put('/api/display-config', adminRequired, (req: any, res: Response) => {
        const body = req.body || {};
        const updatedBy = (req.currentUser && req.currentUser.username) || 'admin';
        const result = writeDisplayConfig(body, updatedBy);
        if (!result.ok) {
            return res.status(400).json(result);
        }
        res.json(result);
    });
}

module.exports = {
    mountDisplayConfigRoutes,
    readDisplayConfig,
    writeDisplayConfig,
};
