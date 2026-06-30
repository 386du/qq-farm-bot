# 更新日志

本日志记录 QQ 农场智能助手 (`qq-farm-bot`) 的版本变更。

---

## v20260701 — 护主犬好友 + 同气连枝礼包

> 发布日期：2026-07-01
> 主要贡献：护主犬识别与分类、同气连枝礼包掉落通知、护主犬好友管理页

### ✨ 新功能

#### 🐶 护主犬过滤（只帮护主犬好友）
- 新增「**只帮护主犬好友**」开关，位于「自动控制 → 好友帮助」区域
- 开启后，机器人只对**携带护主犬**的好友执行帮忙（浇水/除草/除虫/施肥），跳过未携带的好友
- 偷菜、捣乱（放虫/放草）**不受影响**，照常执行
- 默认关闭，存量用户不受影响

#### 📦 好友管理新增「护主犬好友」标签页
- 标签栏新增 **🐶 护主犬好友** 分类，位置在「好友列表」与「好友申请」之间
- 列表实时显示已检测到携带护主犬的好友
- 标签页头部带计数徽标，标签栏上有数字角标
- 访问好友农场时若检测到护主犬，会自动把 GID 登记到该账号的护主犬好友清单
- 空态卡片友好提示检测机制
- 持久化存储：每个账号独立的护主犬好友清单，重启不丢

#### 🎁 同气连枝礼包（ID: 101351）掉落通知
- 机器人帮好友干活时，**同气连枝礼包**（洛克王国联动限定）会作为奖励掉落
- 检测到掉落时同时在「物品」与「好友」日志模块推送通知
- Dashboard「今日统计」新增 **🎁 同气连枝礼包** 计数项（琥珀色徽章）

### 🔧 优化与修复

- **护主犬物品 ID 修正**：原代码误用通用 `dog_id` 90001/90002/90003（喜乐蒂/斑点狗），现统一为洛克王国联动限定的 **90021**
- **日志噪音消除**：移除「未携带护主犬（ID: xxx），跳过帮忙」等冗余日志，帮忙命中护主犬时只输出一行简洁的成功日志
- **批量帮忙日志合并**：原本每个好友都打一条「开始帮忙」日志，现合并为开/收两行汇总
  - `开始批量帮助，扫描 N 个好友`
  - `批量帮助完成：实际帮助 X 个，跳过 Y 个，失败 Z 个`
- **帮忙路径补全**：`doFriendOperation` 的 farming/water/weed/bug 路径补上护主犬过滤

### 📝 配置项

新增 `friend_help_only_guard_dog`（默认 `false`）到 `AutomationConfig`，
新增 `friendGuardDogGids`（默认 `[]`）到 `AccountConfig` 用于持久化护主犬好友清单。

新增后端 API：
- `GET  /api/friend-guard-dog-gids` — 获取某账号的护主犬好友清单
- `POST /api/friend-guard-dog-gids/add` — 手动添加 GID
- `POST /api/friend-guard-dog-gids/remove` — 手动移除 GID
- `POST /api/friend-guard-dog-gids/clear` — 清空清单

### 🛠 改动文件概览

| 文件 | 说明 |
|---|---|
| `core/src/proto/visitpb.proto` | `EnterReply` 新增 `brief_dog_info` 字段及 `BriefDogInfo` 消息 |
| `core/src/types/config.ts` | 新增 `friend_help_only_guard_dog` / `friendGuardDogGids` |
| `core/src/models/store/shared-state.ts` | 默认值与字段归一化 |
| `core/src/models/store/account-config.ts` | 增删查接口 |
| `core/src/services/friend/visit-strategy.ts` | 护主犬过滤逻辑（`isFriendLackingGuardDog`） |
| `core/src/services/friend/scheduler.ts` | 批量帮忙日志合并 |
| `core/src/utils/network.ts` | `ItemNotify` 处理同气连枝礼包 |
| `core/src/services/stats.ts` | 今日统计新增 `guardDogDrop` |
| `core/src/controllers/admin/friend-routes.ts` | 新增 4 个护主犬好友相关 API |
| `web/src/stores/friend.ts` | 暴露 `guardDogFriends` 状态与增删查方法 |
| `web/src/views/Settings.vue` | 新增「只帮护主犬好友」开关 |
| `web/src/views/Dashboard.vue` | 今日统计新增「同气连枝礼包」项 |
| `web/src/views/Friends.vue` | 新增「护主犬好友」标签页 |

### ⬆️ 升级说明

- 旧版本升级到本版本无需额外迁移步骤
- 首次启动后，「只帮护主犬好友」开关默认关闭，行为与之前一致
- 开启后机器人会在扫描好友农场时自动建立护主犬好友清单

---

## v20260615 — 移除日报推送（基础版本）

> 基础版本作为本次变更起点
> 移除了每日 9 点自动推送的日报功能，仅在 Dashboard 顶栏展示数据

### 变更
- 后端删除 `pushDailyReport`、9 点自动推送、`/api/admin/report/...` 等相关代码
- Dashboard 顶栏保留数据展示

---

## v20260601 — Web 面板全面重构（Vue 3 + Pinia）

> 发布日期：2026-06-01

### ✨ 新功能

#### 🖥 Vue 3 + Pinia + Vite 重构
- Web 面板整体重写，启动速度提升 3 倍以上
- 全新 UI 设计，原子化样式 + 浅色/深色主题切换

#### 📊 Analytics 数据分析页
- 收益 / 操作 / 经验趋势图

#### ⚙️ ConfigManage 配置管理
- 物品、种子、化肥的可视化编辑

#### 🎁 Activity 活动页
- 限时活动一键参与

#### 👥 Friends 好友管理
- 好友列表 / 好友申请 / 黑名单 三标签

### 🔧 优化与修复
- 后端 Express 拆分多路由模块（auth/farm/friend/admin/...）
- Web 与 Core 通过 `/api/*` 同源部署，去掉跨域复杂度
- 操作日志支持按模块/事件/关键词/告警级别筛选

---

## v20260515 — 邀请系统 + 游戏化 + 排行榜

> 发布日期：2026-05-15

### ✨ 新功能

#### 🎟 邀请系统
- 邀请好友注册得奖励天数，邀请码持久化

#### 🏆 Leaderboard 排行榜
- 经验/金币/活跃度多维度排行

#### 🎮 Gamification 游戏化
- 每日签到、连续登录奖励、成就系统

#### 🪪 卡密系统
- 邀请码 + 卡密双轨激活

### 📝 新增 API
- `/api/invite/me` 查看我的邀请
- `/api/invite/claim` 领取邀请奖励
- `/api/admin/invite/config` 管理员配置邀请规则

---

## v20260501 — 任务/邮箱/仓库/月卡

> 发布日期：2026-05-01

### ✨ 新功能

#### ✅ Task 任务系统
- 每日/每周任务自动扫描 + 一键领取

#### 📬 Email 邮箱
- 奖励邮件自动领取（系统邮件 + 活动邮件）

#### 📦 Warehouse 仓库
- 仓库容量监控、低级化肥/种子自动出售

#### 💳 MonthCard 月卡礼包
- 每日月卡奖励自动领取

#### 🛍 Mall 商城
- 每日免费礼包、分享奖励、会员日礼包

### 🔧 优化与修复
- 种植策略新增「按等级解锁最优种子」算法
- 施肥策略新增「桶装化肥」统计与低储提醒

---

## v20260415 — 好友系统 + 农场自动化核心

> 发布日期：2026-04-15

### ✨ 新功能

#### 🤝 好友帮忙
- 自动给好友浇水/除草/除虫/施肥

#### 🏃 偷菜巡查
- 定时巡查好友农场，自动偷取成熟作物

#### 🚫 好友黑名单
- 屏蔽指定 GID，不帮忙也不偷菜

#### 🌾 农场自动化
- 巡查/收获/铲除/种植/施肥全自动流水线

#### 🌱 智能选种
- 根据仓库种子 + 等级 + 经验加成自动选最优

### 🔧 优化与修复
- protobuf 解码适配农场 + 好友双协议
- 土地卡片 UI 化（空闲/生长中/可收获/枯萎 四态）

---

## v20260401 — 项目首发

> 发布日期：2026-04-01
> QQ 农场智能助手 v1.0 正式发布 🎉

### ✨ 新功能

#### 🚀 项目首发
- QQ 农场智能助手 v1.0

#### 🌾 核心种菜
- 自动巡查 / 收获 / 铲除 / 种植 / 施肥

#### 🔐 YYB 扫码登录
- 应用宝扫码一键登录，无需抓包

#### 👤 多账号挂机
- 支持同时挂多个账号，独立配置

#### 📊 Dashboard 仪表盘
- 今日统计 / 经验速率 / 升级预测

#### 📜 运行日志
- 实时滚动显示所有操作

### 🛠 技术栈
- 后端：TypeScript + Node.js + Express + protobufjs + Socket.IO
- 前端：Vue 3 + Vite + Pinia + UnoCSS + Axios
- 通信：HTTP REST + WebSocket 实时推送
- 打包：pkg 跨平台二进制（Windows / macOS / Linux）
