#!/usr/bin/env bash
# 本地一键部署：构建 -> 通过 SSH 把 dist 上传到阿里云子路径
# 依赖：已把 ~/.ssh/id_ed25519_penguin 的公钥添加到阿里云 ecs 的 admin 用户
#       ~/.ssh/authorized_keys（注意：root 被禁 SSH，只能用 admin，它有免密 sudo）
# 用法：bash deploy-local.sh
set -euo pipefail

# ===== 按需修改 =====
HOST="123.56.2.125"
USER="admin"          # 阿里云 ECS 只能用 admin 登录（root 禁 SSH）
PORT="22"
KEY="$HOME/.ssh/id_ed25519_penguin"

# 服务器上的站点根目录（Nginx 的 root，按域名建的目录）
# 子路径 /deepseek-harness-tutorial 会自然落在该目录下
REMOTE_ROOT="/www/wwwroot/tutorial.baimuyuan.online"
# ====================

echo "[1/3] 构建静态站 ..."
npm run build

echo "[2/3] 清理服务器旧文件并创建目录 ..."
ssh -i "$KEY" -p "$PORT" "$USER@$HOST" "mkdir -p '$REMOTE_ROOT/deepseek-harness-tutorial' && rm -rf '$REMOTE_ROOT/deepseek-harness-tutorial'/*"

echo "[3/3] 上传 dist 到 $HOST:$REMOTE_ROOT/deepseek-harness-tutorial ..."
scp -i "$KEY" -P "$PORT" -r .vitepress/dist/* "$USER@$HOST:$REMOTE_ROOT/deepseek-harness-tutorial/"

echo "完成！访问 https://tutorial.baimuyuan.online/deepseek-harness-tutorial/"
