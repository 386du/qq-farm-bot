# qqfarmws-3min — QQ 农场 WS 帧 3 分钟异常检测工具链

> 配套 [54586825/qqfarmws](https://github.com/54586825/qqfarmws) 的**纯分析**扩展,
> 用来定位 QQ 农场客户端在「3 分钟」前后上报的、可能涉及**反作弊行为指纹**的 WS 帧。

**重要**:本工具链**只做抓包/分析**,不实现拦截、修改、伪造等绕过行为。

---

## 工具构成

| 文件 | 类型 | 作用 |
|---|---|---|
| `qqfarmws-3min-detect.ps1` | PowerShell | 读 `frames.csv`,按 4 个时间窗口做差集,定位 3 分钟异常帧 |
| `一键3分钟检测.bat` | Windows 启动器 | 一键调用上面那个,适合日常 |
| `bin-analyzer.mjs` | Node.js (0 依赖) | **盲拆** .bin(不需要 .proto 定义),支持 JSON / 字符串扫 / 对比 |
| `fixture-watch.mjs` | Node.js (0 依赖) | 协议快照基线 save/diff/list/prune,腾讯更新时秒发现 |
| `package.json` | Node.js | 给 `pnpm analyze` `pnpm fixture:*` 用 |

## 完整工作流

```
Reqable 抓 5+ 分钟 → 导出 HAR
  ↓
一键导出WS.bat (qqfarmws 原版)
  ↓
ws_frames/{frames.csv, frames/*.bin, pairs.csv, ...}
  ↓
一键3分钟检测.bat
  ↓
3min_anomaly_report.txt + 3min_anomaly_frames.csv + 3min_windows.csv
  ↓
node bin-analyzer.mjs frames/XXXX_send_op2.bin
  ↓ (对比)
node fixture-watch.mjs diff (跟上一版基线对比)
```

## 详细用法

### 1. 3 分钟异常帧检测

```powershell
# 基础: 扫 ws_frames/frames.csv
.\qqfarmws-3min-detect.ps1 -FramesCsv D:\cap\ws_frames\frames.csv

# 自定义窗口(比如 4 分钟)
.\qqfarmws-3min-detect.ps1 -FramesCsv ...\frames.csv -WindowSec 240 -HalfWidthSec 15

# 跟上次基线对比
.\qqfarmws-3min-detect.ps1 -FramesCsv ...\frames.csv -Baseline .\last_frames.csv

# 输出 JSON(给 Node 工具链)
.\qqfarmws-3min-detect.ps1 -FramesCsv ...\frames.csv -Json
```

**判定逻辑**:
- 把 send 帧按时间分 4 个窗口:`0-30s`(预热) `30s-2:50`(稳定) `2:50-3:10`(异常) `3:10-5:00`(恢复)
- 异常窗口里出现**新 label** 的帧 = `NEW_LABEL`
- 异常窗口里**大小 ≥ 其它窗口同 label 平均 2.5 倍** = `SIZE_SPIKE`
- 任一条件满足即标为"3 分钟异常帧"

**输出**:
- `3min_anomaly_report.txt` 人类可读报告
- `3min_anomaly_frames.csv` 异常帧列表(含 file 路径)
- `3min_windows.csv` 4 窗口 send 统计
- `3min_anomaly.json` (加 `-Json` 时)

### 2. 盲拆 .bin

```bash
# 树状打印
node bin-analyzer.mjs ws_frames/frames/0042_send_op2.bin

# 只看字符串(扫 batch 找 service.method)
node bin-analyzer.mjs ws_frames/frames/  --strings

# JSON 树(给 Python / 其它工具消费)
node bin-analyzer.mjs ws_frames/frames/0042_send_op2.bin --json > tree.json

# 对比两个 .bin 的结构差异
node bin-analyzer.mjs ws_frames/frames/0042_send_op2.bin --compare fixtures/baseline-2026-07-03/bins/frames__0042_send_op2.bin

# 完整 hex dump + 树
node bin-analyzer.mjs ws_frames/frames/0042_send_op2.bin --hex
```

**盲拆能力**:
- 自动识别 varint / fixed32 / fixed64 / length-delimited
- length-delimited 字段自动尝试:UTF-8 字符串 → 嵌套 message → packed repeated varint → 原始 hex
- 自动算 int64 / uint64 符号位
- **不需要 .proto 定义**(腾讯 SDK 私有的 message 也能看)

### 3. 协议快照基线

```bash
# 第一次: 建基线
pnpm fixture:save -- --src ../ws_frames --baseline ./fixtures/baseline-2026-07-03

# 以后每次腾讯更新: 跟基线对比
pnpm fixture:diff -- --src ../ws_frames --baseline ./fixtures/baseline-2026-07-03

# 或者自动找"最近一个基线"
pnpm fixture:diff -- --src ../ws_frames

# 列出所有基线
pnpm fixture:list

# 保留最近 5 个,删旧的(磁盘管理)
pnpm fixture:prune
```

**基线内容**:
```
fixtures/baseline-2026-07-03_2130/
├── manifest.json          # 文件清单 + sha256 + size + mtime
├── frames.csv             # 当时的 frames.csv 副本
└── bins/
    ├── frames__0001_send_op2.bin
    ├── frames__0002_recv_op2.bin
    └── ...
```

**diff 输出**:
- `新增` 帧(新协议帧,新反作弊字段最常见)
- `消失` 帧(服务端不再下发)
- `变化` 帧(size/sha256 变了,**最值得关注**)
- 自动给出 `bin-analyzer.mjs --compare` 命令

## 推荐节奏

1. **正常游戏日**:`fixture:save` 一次作为基线
2. **怀疑腾讯更新**:`fixture:diff` 看有没有变化
3. **有变化**:`bin-analyzer.mjs` 拆新增/变化的 .bin
4. **看到新增字段(尤其是 varint / bytes / 嵌套 message)** → 这就是「3 分钟」上报的新维度
5. **跨多个 build 累积观察** → 慢慢还原出完整行为指纹格式

## 注意事项

- 本工具链**只读取/分析**已抓到的 WS 帧,**不发送任何请求**
- 输出的 .bin 副本、manifest 仅用于**本地协议研究**
- 建议把 `fixtures/` 加进 `.gitignore`(基线 .bin 通常几 MB,不入仓)
- 腾讯若改端点或加密,本工具仍能用(只看 wire format,不依赖业务字段)
