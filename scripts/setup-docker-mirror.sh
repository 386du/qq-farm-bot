#!/usr/bin/env bash
# 配置 Docker 镜像加速器（适用于国内服务器）
# 用法：sudo bash setup-docker-mirror.sh

set -e

DAEMON_JSON="/etc/docker/daemon.json"

if [ "$EUID" -ne 0 ]; then
  echo "❌ 请用 root 运行：sudo bash $0"
  exit 1
fi

mkdir -p /etc/docker

if [ -f "$DAEMON_JSON" ]; then
  echo "⚠️  $DAEMON_JSON 已存在，备份为 ${DAEMON_JSON}.bak"
  cp "$DAEMON_JSON" "${DAEMON_JSON}.bak.$(date +%Y%m%d%H%M%S)"
fi

cat > "$DAEMON_JSON" <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com"
  ],
  "max-concurrent-downloads": 10,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

echo "✅ 已写入 $DAEMON_JSON"
echo ""
cat "$DAEMON_JSON"
echo ""

systemctl daemon-reload
systemctl restart docker
sleep 2

echo "=== 验证 ==="
docker info 2>/dev/null | grep -A 5 "Registry Mirrors" || echo "⚠️  未检测到 Registry Mirrors，请检查 docker 是否启动"

echo ""
echo "🎉 完成。可以重新拉镜像 / build 了："
echo "   docker pull node:20-alpine"
echo "   cd /path/to/qq-farm-bot && ./你的部署脚本.sh"
