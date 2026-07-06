# Farm Go Service

把 **Gewechat(个人微信扫码)** 封装成你农场项目要的 3 个 HTTP 接口,放在 Go 服务后面。

## 用途

你的 qq-farm-bot 里「Go 扫码」Tab 默认会请求这 3 个接口:

| 路径 | 方法 | 用途 |
|---|---|---|
| `/Login/LoginGetQRCar` | POST | 拿二维码 |
| `/Login/LoginCheckQR?uuid=xxx` | POST | 轮询扫码状态,返回 `wxid` |
| `/Wxapp/JSLogin` | POST | 用 `wxid` 换农场 `code` |

本服务把 Gewechat 内部 API(`getLoginQrCode` / `checkLoginQr`)包成这套格式,然后把 `JSLogin` 转发到你已有的下游 wxlogin 服务。

## 网络拓扑

```
[农场 Web UI]  ──HTTP──>  [Farm Go Service :8060]  ──HTTP──>  [Gewechat :2531]
                                  │
                                  └─HTTP──>  [下游 wxlogin apiBase :8059/api]
                                               (同你现有「QQ扫码」用的服务)
```

## 前置条件

1. **Gewechat** 已部署并可访问(默认 `http://127.0.0.1:2531`)
2. **下游 JSLogin 服务** 已部署(就是你「QQ扫码」Tab 一直在用的 wxlogin 服务,默认 `http://127.0.0.1:8059/api`)
3. Go 1.22+ / Docker

## 快速开始

```bash
# 1. 复制配置
cp .env.example .env
# 编辑 .env,至少填好 JSLOGIN_API

# 2. 启动
docker compose up -d --build

# 3. 检查
curl http://127.0.0.1:8060/health
```

返回示例:
```json
{
  "status": "ok",
  "appid": "wx5306c5978fdb76e4",
  "gewe": "http://host.docker.internal:2531",
  "jsLogin": "http://host.docker.internal:8059/api",
  "regionId": "320000",
  "device": "mac"
}
```

## 接入农场项目

在 qq-farm-bot 的「设置 → 账号管理 → 🧩 Go 服务配置」里:
- **Go 服务地址**:`http://你的服务器IP:8060`
- **APPID**:`wx5306c5978fdb76e4`
- 启用 → 保存

然后在「添加账号 → Go 扫码」Tab 扫码即可。

## 配置项

| 环境变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `PORT` | 否 | 8060 | 本服务监听端口 |
| `GEWE_BASE` | 是 | `http://127.0.0.1:2531` | Gewechat 后端地址 |
| `GEWE_TOKEN` | 否* | 自动获取 | 启动时若留空,会 `POST /tools/getTokenId` 拿一个 |
| `JSLOGIN_API` | 是 | 空 | 下游 wxlogin 服务地址(必填,否则 JSLogin 端点不可用) |
| `APPID` | 否 | `wx5306c5978fdb76e4` | 微信小程序 AppID |
| `REGION_ID` | 否 | 320000 | Gewechat 地区 ID |
| `DEVICE_TYPE` | 否 | mac | Gewechat 设备类型(`mac` 或 `ipad`) |

## 获取 Gewechat Token

```bash
curl -X POST http://127.0.0.1:2531/tools/getTokenId
# 返回: {"ret":200,"msg":"操作成功","data":"<token>"}
```

把这个 token 填到 `GEWE_TOKEN` 即可,留空则服务启动时自动获取。

## 常见问题

### 1. `getLoginQrCode 失败: ret=500`
- Gewechat 未登录或 token 无效,需要先用 `getLoginQrCode` 走一次扫码流程初始化

### 2. `Wxapp/JSLogin 失败: 下游返回 ...`
- 检查 `JSLOGIN_API` 是否能访问,以及下游服务的 `/Wxapp/JSLogin` 端点是否正常
- 多数情况下这就是你「QQ扫码」Tab 在用的同一个服务

### 3. 想用其他扫码服务(非 Gewechat)
- 修改 `main.go` 里 `geweGetQR` / `geweCheckQR` 两个函数,换掉 HTTP 端点即可,对外接口不需要改

## 本地开发(无 Docker)

```bash
go run main.go
```

监听 `0.0.0.0:8060`,从 `.env` 读取配置。
