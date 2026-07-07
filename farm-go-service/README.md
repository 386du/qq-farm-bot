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
3. 一台 Linux 服务器(amd64 或 arm64,Ubuntu/CentOS 之类)
4. **不需要装 Go** —— 二进制已经编好,直接跑

## 快速开始(宝塔面板用户)

### 1. 拉代码

宝塔 → **终端**,粘:

```bash
cd /opt
git clone https://github.com/386du/qq-farm-bot.git qq-farm-bot --depth 1
ls qq-farm-bot/farm-go-service/
```

应该能看到 `farm-go-service-linux-amd64` 这个文件。

### 2. 改配置

宝塔 → **文件** → 进 `/opt/qq-farm-bot/farm-go-service/`:
1. 找到 `.env.example` → 右键 **重命名** → 改成 `.env`
2. 右键 `.env` → **编辑** → 至少确认 `JSLOGIN_API=http://127.0.0.1:8059/api` 是不是对 → **保存**

> 如果你 `JSLOGIN_API` 不是这个,改成你现有的 wxlogin 服务地址。

### 3. 拿 Gewechat Token

宝塔 → **终端**:

```bash
curl -X POST http://127.0.0.1:2531/tools/getTokenId
```

返回 JSON,把 `"data":"xxxx"` 里那串复制出来。

回宝塔 **文件** → 编辑 `/opt/qq-farm-bot/farm-go-service/.env` → 把 `GEWE_TOKEN=` 后面填上一步拿的 token → **保存**。

### 4. 加执行权限 + 测试跑一下

宝塔 → **终端**:

```bash
chmod +x /opt/qq-farm-bot/farm-go-service/farm-go-service-linux-amd64
cd /opt/qq-farm-bot/farm-go-service
./farm-go-service-linux-amd64
```

看到 `Farm Go Service 启动,监听 :8060` 就对了。

新开浏览器(手机也行)访问 `http://你的服务器IP:8060/health`,看到 `{"status":"ok"...}` 就成了。

测试完按 `Ctrl+C` 停掉。

### 5. 后台守护 + 开机自启

宝塔 → **软件商店** → 装 **进程守护管理器**(也叫 Supervisor 管理器)。

装好之后:
- 名称:`farm-go`
- 启动命令:`/opt/qq-farm-bot/farm-go-service/farm-go-service-linux-amd64`
- 工作目录:`/opt/qq-farm-bot/farm-go-service`
- 启动用户:`root`
- 开机自启:✅

点 **确定** → 点 **启动**。

### 6. 开防火墙

宝塔 → **安全** → 顶部 **放行端口**,加 `8060`。

### 7. 配农场项目

打开 qq-farm-bot 后台:
- **设置** → **账号管理** → **🧩 Go 服务配置**
- **Go 服务地址**:`http://你的服务器IP:8060`
- **APPID**:`wx5306c5978fdb76e4`
- 启用 → 保存

然后 **添加账号 → Go 扫码** → 弹二维码 → 微信扫一下就成了。

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

### 4. 二进制架构不对(运行提示 Exec format error)
- 你服务器是 ARM(国产 CPU)而不是 x86
- 改用 `farm-go-service-linux-arm64` 这个二进制
- 修改进程守护的启动命令把 `amd64` 改成 `arm64`

## 本地开发(无 Docker)

```bash
go run main.go
```

监听 `0.0.0.0:8060`,从 `.env` 读取配置。

