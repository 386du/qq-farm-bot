# 应用宝 (YYB) 源码清单

本目录收录了项目内所有与应用宝一键登录（YYB）功能相关的源码文件，按原目录结构 1:1 复制。
**不遗漏、不多余**，全部为原文件完整内容。

## 数据流概览

```
[前端 YybConfigModal] ──POST /api/user/yyb-config──► [auth-routes]
                                                       │
                                                       ▼
                                          [global-config.setYybConfig]
                                                       │
                                                       ▼
                                       [GlobalConfig.userYybConfigs]

[前端 YybLoginModal] ──POST /api/yyb/code (openid)──► [auth-routes]
                                                       │
                                                       ▼
                                          [services/yyb-login.fetchFarmCode]
                                                       │
                                                       ▼
                                              外部 API (Bearer Token)

[启动/运行账号]
  worker-manager.buildYybEnv
    └─ fork 子进程时注入 env: FARM_LOGIN_TYPE/FARM_OPENID/YYB_API_TOKEN/YYB_ENDPOINT
                              │
                              ▼
            core/worker.ts → startYybSessionRenewer (2.5 min / 次)

[被踢/登录失效]
  ws_error 400 / account_kicked ─► runtime-engine.onAccountNeedsRelogin
                                     │
                                     ▼
                            yyb-relogin.handleAccountRelogin
                                     │
                                     ▼
                            拉新 Code → addOrUpdateAccount → restartWorker

[定时刷新] (reconnectIntervalMinutes)
  yyb-relogin.start() → 每 60s 检查所有运行中的 yyb 账号
                                     │
                                     ▼
                            命中间隔 → 拉新 Code → restartWorker
```

## 文件清单

### 前端 Web

| # | 路径 | 作用 |
|---|---|---|
| 1 | `web/src/stores/yyb-login.ts` | 应用宝 Pinia store（配置/Code/重连） |
| 2 | `web/src/components/YybConfigModal.vue` | 应用宝配置弹窗（OpenID + Token） |
| 3 | `web/src/components/YybLoginModal.vue` | 一键登录弹窗 |
| 4 | `web/src/components/AccountModal.vue` | 添加/编辑账号弹窗（含应用宝 Tab） |
| 5 | `web/src/views/Settings.vue` | 设置页（应用宝配置入口） |
| 6 | `web/src/views/Friends.vue` | 好友页（仅 1 处注释引用应用宝） |

### 后端 Core — 类型

| # | 路径 | 作用 |
|---|---|---|
| 7 | `core/src/types/config.ts` | `YybConfig` / `YybOpenIdEntry` / `GlobalConfig.userYybConfigs` |

### 后端 Core — 服务

| # | 路径 | 作用 |
|---|---|---|
| 8 | `core/src/services/yyb-login.ts` | `fetchFarmCode` 调外部 API 取 Code |
| 9 | `core/src/services/yyb-refresh.ts` | Worker 内部会话续期（2.5 分钟） |

### 后端 Core — 运行时

| # | 路径 | 作用 |
|---|---|---|
| 10 | `core/src/runtime/yyb-relogin.ts` | 主进程应用宝自动重连服务 |
| 11 | `core/src/runtime/worker-manager.ts` | `buildYybEnv` 注入 env / 扫描中断处理 |
| 12 | `core/src/runtime/runtime-engine.ts` | 串联 yybReloginService / onAccountNeedsRelogin 回调 |

### 后端 Core — Worker

| # | 路径 | 作用 |
|---|---|---|
| 13 | `core/src/core/worker.ts` | 启动/停止 `startYybSessionRenewer` |

### 后端 Core — 存储

| # | 路径 | 作用 |
|---|---|---|
| 14 | `core/src/models/store/global-config.ts` | `getYybConfig` / `setYybConfig` / `deleteUserYybConfig` |
| 15 | `core/src/models/store/shared-state.ts` | `DEFAULT_YYB_CONFIG` / `normalizeYybConfig` |
| 16 | `core/src/models/store/index.ts` | yyb 三个方法 re-export |

### 后端 Core — 路由

| # | 路径 | 作用 |
|---|---|---|
| 17 | `core/src/controllers/admin/auth-routes.ts` | `GET/POST /api/user/yyb-config` + `POST /api/yyb/code` |

## 接口汇总

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/user/yyb-config` | 读取当前用户应用宝配置 |
| POST | `/api/user/yyb-config` | 保存当前用户应用宝配置 |
| POST | `/api/yyb/code` | 根据 openid 取登录 Code（兼容旧 openIds+apiToken） |

## 环境变量（注入到 fork 子进程）

| 变量 | 含义 |
|---|---|
| `FARM_LOGIN_TYPE=yyb` | 标识这是应用宝登录 |
| `FARM_OPENID` | 当前账号的 OpenID |
| `YYB_API_TOKEN` | 该 OpenID 对应的 API Token |
| `YYB_ENDPOINT` | 外部 Code 接口地址 |

## 配置 schema（持久化在 store.json 的 `userYybConfigs[username]`）

```ts
interface YybConfig {
  enabled: boolean
  endpoint: string
  reconnectIntervalMinutes: number
  autoReconnect: boolean
  accounts: YybOpenIdEntry[]
}

interface YybOpenIdEntry {
  openid: string
  apiToken: string
  name?: string
}
```
