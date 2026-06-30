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
 * 这里复用了仓库根目录 CHANGELOG.md 的内容，但用结构化 JSON 表达。
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
                title: '护主犬好友 + 同气连枝礼包',
                groups: [
                    {
                        type: '新功能',
                        icon: '✨',
                        items: [
                            '🐶 **护主犬过滤**（只帮护主犬好友）— 开关位于「自动控制 → 好友帮助」区域',
                            '📦 **好友管理新增「护主犬好友」标签页** — 位置在好友列表与好友申请之间，自动登记 + 持久化',
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
                title: '移除日报推送',
                groups: [
                    {
                        type: '变更',
                        icon: '🗑️',
                        items: [
                            '后端删除 `pushDailyReport`、9 点自动推送、`/api/admin/report/...` 等相关代码',
                            'Dashboard 顶栏保留数据展示',
                        ],
                    },
                ],
            },
            {
                version: 'v20260601',
                date: '2026-06-01',
                title: 'Web 面板全面重构（Vue 3 + Pinia）',
                groups: [
                    {
                        type: '新功能',
                        icon: '✨',
                        items: [
                            '🖥 **Vue 3 + Pinia + Vite 重构** Web 面板，启动速度提升 3 倍以上',
                            '🎨 **全新 UI 设计** — Tailwind/UnoCSS 原子化样式，支持浅色/深色主题切换',
                            '📊 **Analytics 数据分析页** — 收益/操作/经验趋势图',
                            '⚙️ **ConfigManage 配置管理** — 物品、种子、化肥的可视化编辑',
                            '🎁 **Activity 活动页** — 限时活动一键参与',
                            '👥 **Friends 好友管理** — 好友列表 / 好友申请 / 黑名单 三标签',
                        ],
                    },
                    {
                        type: '优化与修复',
                        icon: '🔧',
                        items: [
                            '后端 Express 拆分多路由模块（auth/farm/friend/admin/...）',
                            'Web 与 Core 通过 `/api/*` 同源部署，去掉跨域复杂度',
                            '操作日志支持按模块/事件/关键词/告警级别筛选',
                        ],
                    },
                ],
            },
            {
                version: 'v20260515',
                date: '2026-05-15',
                title: '邀请系统 + 游戏化 + 排行榜',
                groups: [
                    {
                        type: '新功能',
                        icon: '✨',
                        items: [
                            '🎟 **邀请系统** — 邀请好友注册得奖励天数，邀请码持久化',
                            '🏆 **Leaderboard 排行榜** — 经验/金币/活跃度多维度排行',
                            '🎮 **Gamification 游戏化** — 每日签到、连续登录奖励、成就系统',
                            '🪪 **卡密系统** — 邀请码 + 卡密双轨激活',
                        ],
                    },
                    {
                        type: '配置',
                        icon: '📝',
                        items: [
                            '`/api/invite/me` 查看我的邀请',
                            '`/api/invite/claim` 领取邀请奖励',
                            '`/api/admin/invite/config` 管理员配置邀请规则',
                        ],
                    },
                ],
            },
            {
                version: 'v20260501',
                date: '2026-05-01',
                title: '任务/邮箱/仓库/月卡',
                groups: [
                    {
                        type: '新功能',
                        icon: '✨',
                        items: [
                            '✅ **Task 任务系统** — 每日/每周任务自动扫描 + 一键领取',
                            '📬 **Email 邮箱** — 奖励邮件自动领取（系统邮件 + 活动邮件）',
                            '📦 **Warehouse 仓库** — 仓库容量监控、低级化肥/种子自动出售',
                            '💳 **MonthCard 月卡礼包** — 每日月卡奖励自动领取',
                            '🛍 **Mall 商城** — 每日免费礼包、分享奖励、会员日礼包',
                        ],
                    },
                    {
                        type: '优化与修复',
                        icon: '🔧',
                        items: [
                            '种植策略新增「按等级解锁最优种子」算法',
                            '施肥策略新增「桶装化肥」统计与低储提醒',
                        ],
                    },
                ],
            },
            {
                version: 'v20260415',
                date: '2026-04-15',
                title: '好友系统 + 农场自动化核心',
                groups: [
                    {
                        type: '新功能',
                        icon: '✨',
                        items: [
                            '🤝 **好友帮忙** — 自动给好友浇水/除草/除虫/施肥',
                            '🏃 **偷菜巡查** — 定时巡查好友农场，自动偷取成熟作物',
                            '🚫 **好友黑名单** — 屏蔽指定 GID，不帮忙也不偷菜',
                            '🌾 **农场自动化** — 巡查/收获/铲除/种植/施肥全自动流水线',
                            '🌱 **智能选种** — 根据仓库种子 + 等级 + 经验加成自动选最优',
                        ],
                    },
                    {
                        type: '优化与修复',
                        icon: '🔧',
                        items: [
                            'protobuf 解码适配农场 + 好友双协议',
                            '土地卡片 UI 化（空闲/生长中/可收获/枯萎 四态）',
                        ],
                    },
                ],
            },
            {
                version: 'v20260401',
                date: '2026-04-01',
                title: '项目首发',
                groups: [
                    {
                        type: '新功能',
                        icon: '🎉',
                        items: [
                            '🚀 **项目首发** — QQ 农场智能助手 v1.0',
                            '🌾 **核心种菜** — 自动巡查 / 收获 / 铲除 / 种植 / 施肥',
                            '🔐 **YYB 扫码登录** — 应用宝扫码一键登录，无需抓包',
                            '👤 **多账号挂机** — 支持同时挂多个账号，独立配置',
                            '📊 **Dashboard 仪表盘** — 今日统计 / 经验速率 / 升级预测',
                            '📜 **运行日志** — 实时滚动显示所有操作',
                        ],
                    },
                    {
                        type: '技术栈',
                        icon: '🛠',
                        items: [
                            '后端：TypeScript + Node.js + Express + protobufjs + Socket.IO',
                            '前端：Vue 3 + Vite + Pinia + UnoCSS + Axios',
                            '通信：HTTP REST + WebSocket 实时推送',
                            '打包：pkg 跨平台二进制（Windows / macOS / Linux）',
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
