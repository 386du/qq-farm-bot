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
