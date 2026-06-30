import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 版本更新日志（changelog）管理
 *  - GET  /api/changelog        公开读取（普通用户可看）
 *  - PUT  /api/changelog        管理员写入
 *  - POST /api/changelog/reset  管理员重置为初始内容
 *
 * 数据存储在 core/data/changelog.json，结构：
 * {
 *   version: 'v20260701',
 *   updatedAt: '2026-07-01T12:00:00.000Z',
 *   updatedBy: 'admin',
 *   sections: [
 *     {
 *       version: 'v20260701',
 *       date: '2026-07-01',
 *       title: '护主犬好友 + 同气连枝礼包',
 *       groups: [
 *         { type: '新功能', icon: '✨', items: ['...', '...'] },
 *         { type: '优化与修复', icon: '🔧', items: ['...'] },
 *       ],
 *     },
 *   ],
 * }
 */

const fs = require('node:fs');
const path = require('node:path');

const { ensureDataDir } = require('../../config/runtime-paths');
const { createModuleLogger } = require('../../services/logger');
const { adminRequired } = require('./middleware');

const changelogLogger = createModuleLogger('changelog');

const CHANGELOG_FILE = 'changelog.json';

function getChangelogPath(): string {
    return path.join(ensureDataDir(), CHANGELOG_FILE);
}

/**
 * 初始内容（首次启动 / 重置时使用）
 * 内容完全对齐 GitHub 提交时间线（git log），不收录已删除的功能
 */
function getInitialChangelog(): any {
    return {
        version: 'v20260701',
        updatedAt: '2026-07-01T00:00:00.000Z',
        updatedBy: 'system',
        sections: [
            {
                version: 'v20260701',
                date: '2026-07-01',
                title: '排行榜数据实时刷新 + 数据真实准确',
                groups: [
                    {
                        type: '新功能',
                        icon: '✨',
                        items: [
                            '📊 排行榜 Tab 新增「🤝 帮忙」「🐶 护主犬」',
                            '🔄 手动「🔄 刷新」按钮 + 30s 自动轮询（可暂停）',
                            '🟢 列表行显示账号在线状态、最后存盘时间',
                            '⏸/▶ 一键切换自动/手动刷新模式',
                        ],
                    },
                    {
                        type: '修复',
                        icon: '🔧',
                        items: [
                            '排行榜不再读缓存，每次从 `data/stats/*.json` 重新计算（之前缓存导致数据长期不更新）',
                            'Worker 内存统计防抖 2s → **1s**，减少重启/切号时丢失的数据量',
                            '新增 `flushStats` IPC，刷新按钮触发时立即落盘',
                        ],
                    },
                ],
            },
            {
                version: 'v20260701',
                date: '2026-07-01',
                title: '新版本首次进入面板自动弹出更新日志',
                groups: [
                    {
                        type: '新功能',
                        icon: '✨',
                        items: [
                            '🆕 进入面板时若发现 `version` 与本地 `lastSeenVersion` 不同，自动弹出更新日志',
                            '🔖 关闭弹窗自动 `markSeen` 当前版本，**同一版本不会重复弹**',
                            '💾 `lastSeenVersion` 持久化在 `localStorage["changelog:last_seen_version"]`',
                        ],
                    },
                ],
            },
            {
                version: 'v20260701',
                date: '2026-07-01',
                title: '面板内置版本更新查看与编辑',
                groups: [
                    {
                        type: '新功能',
                        icon: '✨',
                        items: [
                            '🆕 运行日志工具栏新增「📋 版本更新」按钮',
                            '🔍 `GET /api/changelog` 公开读取（任意登录用户可看）',
                            '✏️ `PUT /api/changelog` 管理员写入（仅 admin 角色）',
                            '♻️ `POST /api/changelog/reset` 管理员重置为初始内容',
                            '🛠 编辑模式：增/删/改/重排版本、分类、条目',
                            '🧬 JSON 高级编辑模式（直接改原始结构）',
                        ],
                    },
                    {
                        type: '存储',
                        icon: '💾',
                        items: [
                            '`core/data/changelog.json` 结构化 JSON 存储（gitignored，不入仓）',
                            '首次启动自动从 `getInitialChangelog()` 初始化',
                        ],
                    },
                ],
            },
            {
                version: 'v20260630',
                date: '2026-06-30',
                title: '护主犬好友 + 同气连枝礼包',
                groups: [
                    {
                        type: '新功能',
                        icon: '✨',
                        items: [
                            '🐶 **护主犬过滤**（只帮护主犬好友）— 开关位于「自动控制 → 好友帮助」区域',
                            '📦 **好友管理新增「护主犬好友」标签页** — 位置在好友列表与好友申请之间',
                            '🎁 **同气连枝礼包掉落通知** — 检测到掉落时同时在「物品」与「好友」日志模块推送通知',
                            '📊 **今日统计新增** 🎁 同气连枝礼包 计数项',
                        ],
                    },
                    {
                        type: '优化与修复',
                        icon: '🔧',
                        items: [
                            '护主犬物品 ID 修正（90001/90002/90003 → **90021** 洛克王国联动限定）',
                            '移除冗余日志（只输出命中护主犬的成功日志）',
                            '批量帮忙日志合并为开/收两行汇总',
                            '帮忙路径补全护主犬过滤',
                        ],
                    },
                    {
                        type: '配置',
                        icon: '📝',
                        items: [
                            '`friend_help_only_guard_dog`（默认 `false`）',
                            '`friendGuardDogGids`（默认 `[]`）',
                            '4 个新 API（GET/POST add/remove/clear）',
                        ],
                    },
                ],
            },
            {
                version: 'v20260615',
                date: '2026-06-15',
                title: '基础版本（初始快照）',
                groups: [
                    {
                        type: '说明',
                        icon: '📌',
                        items: [
                            '本仓库首个 commit 的快照。',
                            '包含当前代码中所有现存的核心功能：',
                        ],
                    },
                    {
                        type: '农场自动化',
                        icon: '🌾',
                        items: [
                            '自动巡查 / 收获 / 铲除 / 种植 / 施肥 全流程',
                            '智能选种（按等级 + 经验加成 + 仓库现有种子）',
                            '土地状态分析（空闲/生长中/可收获/枯萎）',
                        ],
                    },
                    {
                        type: '好友系统',
                        icon: '🤝',
                        items: [
                            '好友帮忙（浇水/除草/除虫/施肥）',
                            '偷菜巡查（定时巡检 + 自动偷取成熟作物）',
                            '好友黑名单（屏蔽指定 GID）',
                        ],
                    },
                    {
                        type: '其他功能',
                        icon: '🎮',
                        items: [
                            '✅ 任务系统（每日/每周任务自动扫描 + 领取）',
                            '📬 邮箱自动领取（系统邮件 + 活动邮件）',
                            '📦 仓库管理（容量监控 + 低级化肥/种子自动出售）',
                            '💳 月卡礼包每日自动领取',
                            '🛍 商城（每日免费礼包、分享奖励、会员日礼包）',
                            '🎁 活动页（限时活动一键参与）',
                            '🎟 邀请系统（邀请码 + 卡密）',
                            '📈 数据分析（收益/操作/经验趋势）',
                            '🏆 跨账号排行榜',
                        ],
                    },
                    {
                        type: '平台',
                        icon: '👤',
                        items: [
                            '多账号挂机（独立配置 + 同时挂多个）',
                            'QQ / 微信 双平台',
                            'YYB 扫码登录（应用宝一键登录）',
                            '🛡 后台管理面板（仪表盘/卡密/用户/账号/会话/日志/系统/邀请）',
                        ],
                    },
                ],
            },
        ],
    };
}

function readChangelog(): any {
    try {
        const filePath = getChangelogPath();
        if (!fs.existsSync(filePath)) {
            const initial = getInitialChangelog();
            try {
                fs.writeFileSync(filePath, JSON.stringify(initial, null, 2), 'utf8');
                changelogLogger.info('init changelog', { filePath });
            } catch (e: any) {
                changelogLogger.warn('init changelog failed', { error: e?.message });
            }
            return initial;
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        // 兼容性兜底
        if (!parsed || !Array.isArray(parsed.sections)) {
            return getInitialChangelog();
        }
        return parsed;
    } catch (e: any) {
        changelogLogger.warn('read changelog failed', { error: e?.message });
        return getInitialChangelog();
    }
}

function writeChangelog(data: any, updatedBy: string): { ok: boolean; error?: string; data?: any } {
    try {
        if (!data || typeof data !== 'object') {
            return { ok: false, error: '数据格式错误' };
        }
        if (!Array.isArray(data.sections)) {
            return { ok: false, error: 'sections 必须是数组' };
        }
        // 简单校验每条
        for (const s of data.sections) {
            if (!s || typeof s !== 'object') {
                return { ok: false, error: 'section 格式错误' };
            }
            if (!Array.isArray(s.groups)) {
                return { ok: false, error: 'groups 必须是数组' };
            }
            for (const g of s.groups) {
                if (!g || typeof g !== 'object') {
                    return { ok: false, error: 'group 格式错误' };
                }
                if (!Array.isArray(g.items)) {
                    return { ok: false, error: 'items 必须是数组' };
                }
            }
        }
        const out = {
            version: String(data.version || 'custom'),
            updatedAt: new Date().toISOString(),
            updatedBy: String(updatedBy || 'admin'),
            sections: data.sections,
        };
        fs.writeFileSync(getChangelogPath(), JSON.stringify(out, null, 2), 'utf8');
        changelogLogger.info('changelog updated', { by: updatedBy, version: out.version });
        return { ok: true, data: out };
    } catch (e: any) {
        return { ok: false, error: e?.message || '写入失败' };
    }
}

function mountChangelogRoutes(app: Application, ctx: AdminContext): void {
    // 公开读取
    app.get('/api/changelog', (_req: Request, res: Response) => {
        try {
            const data = readChangelog();
            res.json({ ok: true, data });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e?.message || '读取失败' });
        }
    });

    // 管理员写入
    app.put('/api/changelog', adminRequired, (req: any, res: Response) => {
        const body = req.body || {};
        const updatedBy = (req.currentUser && req.currentUser.username) || 'admin';
        const result = writeChangelog(body, updatedBy);
        if (!result.ok) {
            return res.status(400).json(result);
        }
        res.json(result);
    });

    // 管理员重置为初始内容
    app.post('/api/changelog/reset', adminRequired, (req: any, res: Response) => {
        const initial = getInitialChangelog();
        const updatedBy = (req.currentUser && req.currentUser.username) || 'admin';
        initial.updatedBy = updatedBy;
        initial.updatedAt = new Date().toISOString();
        const result = writeChangelog(initial, updatedBy);
        res.json(result);
    });
}

module.exports = {
    mountChangelogRoutes,
    readChangelog,
    writeChangelog,
};
