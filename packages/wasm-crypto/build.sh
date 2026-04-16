#!/bin/bash
# WASM Build Script — v1.45.0
# OBFUSCATION_SEED env로 빌드마다 다른 바이너리 생성

set -euo pipefail

# rotate-keys가 OBFUSCATION_SEED를 설정하지 않으면 "default" 사용
# ⚠️ seed 변경 시 RAW_PARTS도 함께 갱신해야 함 (rotate-keys 참조)
SEED="${OBFUSCATION_SEED:-default}"

echo "[wasm-crypto] Building with OBFUSCATION_SEED=$SEED"

# 시드를 Rust 빌드에 환경변수로 전달
export WASM_CRYPTO_SEED="$SEED"

# WASM 빌드
wasm-pack build --target web --release

# content hash를 파일명에 포함
if [ -f pkg/wasm_crypto_bg.wasm ]; then
  HASH=$(shasum -a 256 pkg/wasm_crypto_bg.wasm | cut -c1-8)
  echo "[wasm-crypto] Build hash: $HASH"
  echo "$HASH" > pkg/.build-hash
fi

echo "[wasm-crypto] Build complete"
