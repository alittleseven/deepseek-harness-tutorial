#!/usr/bin/env bash
# 本地一键部署：构建 -> 通过 SSH 把 dist 上传到阿里云子路径
# 依赖：已把 ~/.ssh/id_ed25519_penguin 的公钥添加到阿里云 ecs 的 /root/.ssh/authorized_keys
# 用法：bash deploy-local.sh
set -euo pipefail

# ===== 按需修改 =====
HOST="123.56.2.125"
USER="root"
PORT="22"
KEY="~/.ssh/id_ed25519_penguin"

# 服务器上的部署根目录（请在服务器上确认 Nginx 实际站点根，例如 /www/wwwroot/ 或 /usr/share/nginx/）
# 子路径 /deepseek-harness-tutorial 会自然落在该目录下
REMOTE_ROOT="/www/wwwroot"
# ====================

echo "[1/3] 构建静态站 ..."
npm run build

echo "[2/3] 清理服务器旧文件并创建目录 ..."
ssh -i "$KEY" -p "$PORT" "$USER@$HOST" "mkdir -p '$REMOTE_ROOT/deepseek-harness-tutorial' && rm -rf '$REMOTE_ROOT/deepseek-harness-tutorial'/*"

echo "[3/3] 上传 dist 到 $HOST:$REMOTE_ROOT/deepseek-harness-tutorial ..."
scp -i "$KEY" -P "$PORT" -r .vitepress/dist/* "$USER@$HOST:$REMOTE_ROOT/deepseek-harness-tutorial/"

echo "完成！访问 https://tutorial.baimuyuan.online/deepseek-harness-tutorial/"
