@echo off
rem 一键运行 3 分钟异常帧检测
rem 用法: 一键3分钟检测.bat  (默认扫当前目录最新 ws_frames)
rem       一键3分钟检测.bat D:\captures\ws_frames
chcp 65001 >nul
setlocal

set "SCRIPT_DIR=%~dp0"
set "WS_DIR=%~1"
if "%WS_DIR%"=="" set "WS_DIR=%SCRIPT_DIR%ws_frames"

if not exist "%WS_DIR%\frames.csv" (
    echo [X] 找不到 frames.csv: %WS_DIR%\frames.csv
    echo     请先跑 一键导出WS.bat 生成 ws_frames
    exit /b 1
)

echo [*] 调用 qqfarmws-3min-detect.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%qqfarmws-3min-detect.ps1" -FramesCsv "%WS_DIR%\frames.csv" -Json
if errorlevel 1 exit /b 1

echo.
echo [*] 检测完成,报告: %WS_DIR%\3min_anomaly_report.txt
echo [*] JSON:      %WS_DIR%\3min_anomaly.json
echo.
echo 下一步: 用 bin-analyzer.mjs 分析异常帧
echo   node "%SCRIPT_DIR%bin-analyzer.mjs" "%WS_DIR%\frames\0001_send_op2.bin"
