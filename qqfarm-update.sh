#!/bin/bash
# QQ Farm Bot 部署更新脚本
# 自动处理 force push 后的 divergent branches

set -e

cd "$(dirname "$0")"

echo "===== 拉取最新代码 ====="

# 1. 先放弃所有本地修改（包括未跟踪文件、stash）
git stash push -u -m "auto-stash-$(date +%s)" 2>/dev/null || true

# 2. 拉取远程最新引用
git fetch origin

# 3. 检测本地 master 与 origin/master 是否分歧
LOCAL=$(git rev-parse master 2>/dev/null || echo "")
REMOTE=$(git rev-parse origin/master 2>/dev/null || echo "")
BASE=$(git merge-base master origin/master 2>/dev/null || echo "")

if [ -z "$LOCAL" ] || [ -z "$REMOTE" ]; then
    echo "[!] 无法读取本地/远程 master, 跳过"
elif [ "$LOCAL" != "$REMOTE" ] && [ "$LOCAL" != "$BASE" ] && [ "$REMOTE" != "$BASE" ]; then
    echo "[!] 检测到 divergent branches (force push 后常见)"
    echo "    本地: ${LOCAL:0:7}"
    echo "    远程: ${REMOTE:0:7}"
    echo "    强制重置到 origin/master..."
    git reset --hard origin/master
    git clean -fd
elif [ "$LOCAL" != "$REMOTE" ]; then
    # fast-forward 可解决
    echo "[*] fast-forward 同步..."
    git pull --ff-only origin master
else
    echo "[*] 已是最新"
fi

# 4. 输出当前 commit
echo "[✓] 当前 HEAD: $(git rev-parse --short HEAD)"
echo "    作者: $(git log -1 --pretty=format:'%an %ai')"
echo "    说明: $(git log -1 --pretty=format:'%s')"

echo "===== 重建 Docker 容器 ====="
# 根据你的实际部署方式调整下面这行
docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true
docker compose up -d --build 2>/dev/null || docker-compose up -d --build 2>/dev/null || true

echo "===== 完成 ====="
