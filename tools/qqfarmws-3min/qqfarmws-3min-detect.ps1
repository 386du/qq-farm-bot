# qqfarmws-3min-detect.ps1
# ---------------------------------------------------------------------------
# 用途: 读取 ws_export.ps1 生成的 frames.csv,按时间窗口分析 send 帧,
#       定位"3 分钟前后"出现的可疑上报帧(反作弊行为指纹 / Telemetry)。
#
# 用法:
#   .\qqfarmws-3min-detect.ps1 -FramesCsv "C:\captures\ws_frames\frames.csv"
#   .\qqfarmws-3min-detect.ps1 -FramesCsv "...\frames.csv" -WindowSec 180 -HalfWidthSec 10
#   .\qqfarmws-3min-detect.ps1 -FramesCsv "...\frames.csv" -Baseline ".\baseline.csv"
#   .\qqfarmws-3min-detect.ps1 -FramesCsv "...\frames.csv" -Json  (输出 JSON 给 Node 工具链)
#
# 输出:
#   - 同目录生成 3min_anomaly_report.txt  (人类可读报告)
#   - 同目录生成 3min_anomaly_frames.csv  (异常帧列表)
#   - 同目录生成 3min_windows.csv         (4 个时间窗口的统计摘要)
#   - 加 -Json 时额外输出 3min_anomaly.json
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$FramesCsv,

    [int]$WindowSec = 180,           # 默认锚点 3 分钟
    [int]$HalfWidthSec = 10,         # 默认 ±10s 窗口(2:50 ~ 3:10)
    [string]$Baseline,               # 可选: 上一次的 frames.csv 当基线
    [switch]$Json,
    [int]$MinSessionSec = 240        # 至少抓够 4 分钟才告警
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

if (-not (Test-Path -LiteralPath $FramesCsv)) {
    Write-Host "[X] 找不到 frames.csv: $FramesCsv" -ForegroundColor Red
    return
}

Write-Host "[*] 读取 $FramesCsv" -ForegroundColor Cyan
$rows = Import-Csv -LiteralPath $FramesCsv

# ---- 解析时间戳,转成"距 T0 的秒数" ----
# HAR 标准 timestamp 是 Unix epoch 毫秒;个别工具是秒,我们都容忍
function Parse-Ts($v) {
    if ($null -eq $v -or "$v" -eq '') { return $null }
    $n = 0
    if (-not [long]::TryParse("$v", [ref]$n)) { return $null }
    if ($n -gt 1e12) { return $n / 1000.0 }   # ms
    return [double]$n                          # s
}

$parsed = @()
foreach ($r in $rows) {
    $ts = Parse-Ts $r.time
    $parsed += [pscustomobject]@{
        index     = [int]$r.index
        direction = "$($r.direction)"
        label     = "$($r.label)"
        opcode    = "$($r.opcode)"
        size      = [int]$r.size
        file      = "$($r.file)"
        ts        = $ts
        dt        = 0
        ts_raw    = "$($r.time)"
    }
}

# 锚点 T0: 第一个 send 帧的时间(若 0 send 帧则第一个任意帧)
$firstSend = $parsed | Where-Object { $_.direction -eq 'send' -and $null -ne $_.ts } | Select-Object -First 1
$firstAny  = $parsed | Where-Object { $null -ne $_.ts }                  | Select-Object -First 1
$anchor = if ($firstSend) { $firstSend.ts } elseif ($firstAny) { $firstAny.ts } else { 0 }
foreach ($p in $parsed) {
    if ($null -ne $p.ts) { $p.dt = [math]::Round($p.ts - $anchor, 3) }
}

$totalSec = if ($parsed.Count -gt 0) {
    ($parsed | Where-Object { $null -ne $_.ts } | Measure-Object -Property dt -Maximum).Maximum
} else { 0 }

Write-Host ("[*] 锚点 T0: {0:F2}  会话时长: {1:F1}s  帧数: {2}" -f $anchor, $totalSec, $parsed.Count) -ForegroundColor Cyan

if ($totalSec -lt $MinSessionSec) {
    Write-Host ("[!] 会话时长 < {0}s,可能还没到 3 分钟节点,结果仅供参考" -f $MinSessionSec) -ForegroundColor Yellow
}

# ---- 4 个时间窗口 ----
$wWarmEnd    = 30
$wStableEnd  = $WindowSec - $HalfWidthSec       # 170
$wAnomalyEnd = $WindowSec + $HalfWidthSec       # 190
$wPostEnd    = [math]::Max($WindowSec + 60, $wAnomalyEnd + 60)

$windows = @(
    @{ name = 'warmup_0-30s';        from = 0;                to = $wWarmEnd },
    @{ name = 'stable_30-2:50';      from = $wWarmEnd;        to = $wStableEnd },
    @{ name = ('anomaly_2:50-3:10'); from = $wStableEnd;     to = $wAnomalyEnd },
    @{ name = 'post_3:10-5:00';      from = $wAnomalyEnd;     to = [math]::Min($wPostEnd, $totalSec + 1) }
)

function In-Window($dt, $w) {
    return ($dt -ge $w.from -and $dt -lt $w.to)
}

# ---- 统计每个窗口的 send 帧 ----
$winStats = @()
foreach ($w in $windows) {
    $inWin = $parsed | Where-Object { $_.direction -eq 'send' -and (In-Window $_.dt $w) }
    $sizes = @($inWin | ForEach-Object { $_.size })
    $sumSize = 0; if ($sizes.Count -gt 0) { $sumSize = ($sizes | Measure-Object -Sum).Sum }
    $avgSize = 0; if ($sizes.Count -gt 0) { $avgSize = [int]($sumSize / $sizes.Count) }
    $labels = ($inWin | ForEach-Object { $_.label } | Where-Object { $_ }) | Sort-Object -Unique
    $winStats += [pscustomobject]@{
        window   = $w.name
        from_sec = $w.from
        to_sec   = $w.to
        send_count   = $sizes.Count
        send_bytes   = $sumSize
        avg_frame_size = $avgSize
        distinct_labels = ($labels -join '|')
    }
}

# ---- 找异常帧: 仅在 anomaly 窗口出现,且不在其他窗口 ----
$warmLabels   = @((($parsed | Where-Object { $_.direction -eq 'send' -and (In-Window $_.dt $windows[0]) } | ForEach-Object { $_.label }) | Sort-Object -Unique))
$stableLabels = @((($parsed | Where-Object { $_.direction -eq 'send' -and (In-Window $_.dt $windows[1]) } | ForEach-Object { $_.label }) | Sort-Object -Unique))
$postLabels   = @((($parsed | Where-Object { $_.direction -eq 'send' -and (In-Window $_.dt $windows[3]) } | ForEach-Object { $_.label }) | Sort-Object -Unique))

$anomalyFrames = @()
$anomalyCandidates = $parsed | Where-Object {
    $_.direction -eq 'send' -and (In-Window $_.dt $windows[2])
}
foreach ($c in $anomalyCandidates) {
    $lbl = $c.label
    $isNewLabel = ($lbl -eq '' -or ($warmLabels -notcontains $lbl -and $stableLabels -notcontains $lbl))
    $isSizeSpike = $false
    if ($lbl) {
        $sameLabel = $parsed | Where-Object { $_.direction -eq 'send' -and $_.label -eq $lbl -and (In-Window $_.dt $windows[1]) }
        if ($sameLabel.Count -gt 0) {
            $avgOther = (($sameLabel | Measure-Object -Property size -Average).Average)
            if ($avgOther -gt 0 -and $c.size -gt $avgOther * 2.5 -and $c.size -ge 32) {
                $isSizeSpike = $true
            }
        }
    }
    $isUnsolicited = $false  # recv 配对: 这里只看 send 本身,先留接口
    if ($isNewLabel -or $isSizeSpike) {
        $anomalyFrames += [pscustomobject]@{
            index     = $c.index
            dt        = $c.dt
            label     = $c.label
            opcode    = $c.opcode
            size      = $c.size
            file      = $c.file
            ts_raw    = $c.ts_raw
            reason    = ($(if ($isNewLabel) { 'NEW_LABEL' } else { '' }),
                         $(if ($isSizeSpike) { 'SIZE_SPIKE' } else { '' }) -join '+')
        }
    }
}

# ---- 与基线 diff(可选) ----
$baselineDiff = $null
if ($Baseline -and (Test-Path -LiteralPath $Baseline)) {
    Write-Host "[*] 加载基线: $Baseline" -ForegroundColor Cyan
    $baseRows = Import-Csv -LiteralPath $Baseline
    $baseMap = @{}
    foreach ($br in $baseRows) {
        $key = "$($br.direction)|$($br.label)|$($br.size)|$($br.time)"
        $baseMap[$key] = $true
    }
    $curKeys = @{}
    foreach ($r in $rows) {
        $key = "$($r.direction)|$($r.label)|$($r.size)|$($r.time)"
        $curKeys[$key] = $true
    }
    $newKeys    = @($curKeys.Keys  | Where-Object { -not $baseMap.ContainsKey($_) })
    $removedKeys = @($baseMap.Keys | Where-Object { -not $curKeys.ContainsKey($_) })
    $baselineDiff = [pscustomobject]@{
        new_count     = $newKeys.Count
        removed_count = $removedKeys.Count
        new_samples   = ($newKeys    | Select-Object -First 10)
        removed_samples = ($removedKeys | Select-Object -First 10)
    }
}

# ---- 写报告 ----
$outDir = Split-Path -Parent $FramesCsv
$reportPath   = Join-Path $outDir '3min_anomaly_report.txt'
$framesPath   = Join-Path $outDir '3min_anomaly_frames.csv'
$windowsPath  = Join-Path $outDir '3min_windows.csv'
$jsonPath     = Join-Path $outDir '3min_anomaly.json'

$report = New-Object System.Text.StringBuilder
[void]$report.AppendLine("=" * 72)
[void]$report.AppendLine("QQ Farm WS - 3 分钟异常帧检测报告")
[void]$report.AppendLine("=" * 72)
[void]$report.AppendLine(("HAR      : {0}" -f $FramesCsv))
[void]$report.AppendLine(("锚点 T0  : {0:F2}  (首个 send 帧时间戳)" -f $anchor))
[void]$report.AppendLine(("会话时长 : {0:F1}s  (要求 >= {1}s)" -f $totalSec, $MinSessionSec))
[void]$report.AppendLine(("检测窗口 : {0}±{1}s  (即 {2}-{3}s)" -f $WindowSec, $HalfWidthSec, $wStableEnd, $wAnomalyEnd))
[void]$report.AppendLine("")
[void]$report.AppendLine("---- 4 个时间窗口 send 帧统计 ----")
[void]$report.AppendLine(("  {0,-22} {1,8} {2,10} {3,10} {4}" -f '窗口','send数','字节','平均字节','出现过的 label'))
foreach ($ws in $winStats) {
    [void]$report.AppendLine(("  {0,-22} {1,8} {2,10} {3,10} {4}" -f $ws.window, $ws.send_count, $ws.send_bytes, $ws.avg_frame_size, ($ws.distinct_labels -as [string])))
}
[void]$report.AppendLine("")
[void]$report.AppendLine("---- 3 分钟异常帧候选 ----")
if ($anomalyFrames.Count -eq 0) {
    [void]$report.AppendLine("  (无) - anomaly 窗口内的 send 帧在其它窗口都有出现,大小也无突变")
}
else {
    foreach ($a in $anomalyFrames) {
        [void]$report.AppendLine(("  #{0,-4}  t={1,7:F2}s  label='{2}'  op={3}  size={4}B  reason={5}" -f $a.index, $a.dt, $a.label, $a.opcode, $a.size, $a.reason))
        [void]$report.AppendLine(("         file: {0}" -f $a.file))
    }
    [void]$report.AppendLine("")
    [void]$report.AppendLine("  -> 下一步: 用 bin-analyzer.mjs 解析这些 .bin,看里面是什么 message")
    [void]$report.AppendLine("     node bin-analyzer.mjs `"$($anomalyFrames[0].file)`"")
}
if ($baselineDiff) {
    [void]$report.AppendLine("")
    [void]$report.AppendLine("---- 与基线 diff ----")
    [void]$report.AppendLine(("  新增帧签名: {0}" -f $baselineDiff.new_count))
    foreach ($s in $baselineDiff.new_samples) { [void]$report.AppendLine(("    + {0}" -f $s)) }
    [void]$report.AppendLine(("  消失帧签名: {0}" -f $baselineDiff.removed_count))
    foreach ($s in $baselineDiff.removed_samples) { [void]$report.AppendLine(("    - {0}" -f $s)) }
}

Set-Content -LiteralPath $reportPath -Value $report.ToString() -Encoding UTF8
$anomalyFrames | Export-Csv -LiteralPath $framesPath -NoTypeInformation -Encoding UTF8
$winStats       | Export-Csv -LiteralPath $windowsPath -NoTypeInformation -Encoding UTF8

if ($Json) {
    $payload = [pscustomobject]@{
        anchor_ts   = $anchor
        session_sec = $totalSec
        window_sec  = $WindowSec
        half_width  = $HalfWidthSec
        windows     = $winStats
        anomalies   = $anomalyFrames
        baseline_diff = $baselineDiff
    }
    $payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
}

Write-Host ""
Write-Host "========== 3 分钟异常帧检测 ==========" -ForegroundColor Green
Write-Host ("锚点 T0 : {0:F2}" -f $anchor)
Write-Host ("会话时长 : {0:F1}s" -f $totalSec)
foreach ($ws in $winStats) {
    Write-Host ("  {0,-22} send={1,3}  bytes={2,6}  avg={3,5}" -f $ws.window, $ws.send_count, $ws.send_bytes, $ws.avg_frame_size) -ForegroundColor $(if ($ws.window -like 'anomaly*') { 'Yellow' } else { 'Gray' })
}
Write-Host ("异常帧  : {0}" -f $anomalyFrames.Count) -ForegroundColor $(if ($anomalyFrames.Count -gt 0) { 'Yellow' } else { 'Green' })
Write-Host ""
Write-Host "输出:" -ForegroundColor Cyan
Write-Host ("  报告: {0}" -f $reportPath)
Write-Host ("  异常帧: {0}" -f $framesPath)
Write-Host ("  窗口统计: {0}" -f $windowsPath)
if ($Json) { Write-Host ("  JSON: {0}" -f $jsonPath) }
