# PacifiQuant Root Justfile
# Usage: just <recipe>  |  just --list

# apps/web 정적 빌드 + nginx 배포
deploy-web:
    bash scripts/deploy-web.sh

# tsc 아티팩트 제거 (packages/core)
clean:
    bash scripts/clean-tsc-artifacts.sh
