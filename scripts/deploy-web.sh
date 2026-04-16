#!/bin/bash
set -e

# HypurrQuant Web 배포 스크립트
# 사용법: ./deploy-web.sh

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/web"
DEPLOY_DIR="/var/www/app.hypurrquant/front"

cd "$ROOT_DIR"

echo "=== 1/4 WASM Build ==="
cd "$ROOT_DIR/packages/wasm-crypto"
# seed 변경은 rotate-keys 전용 — deploy 시에는 고정 seed 사용
bash build.sh
cd "$ROOT_DIR"

echo "=== 2/4 Web Build ==="
NODE_OPTIONS="--max-old-space-size=4096" pnpm --filter hypurrquant-fe build

echo "=== 3/4 Deploy ==="
rsync -a --delete "$APP_DIR/out/" "$DEPLOY_DIR/"

echo "=== 4/4 Done ==="
echo "Deployed to $DEPLOY_DIR"
