#!/usr/bin/env bash
# tsc --noEmit 없이 실행해서 생긴 빌드 산출물 제거
# .ts 원본이 있거나, 원본이 삭제된 고아 아티팩트(.js/.js.map/.d.ts/.d.ts.map) 삭제

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/packages/core"
COUNT=0

while IFS= read -r f; do
  # .js → .ts 원본 확인
  base="${f%.js.map}"
  base="${base%.js}"
  base="${base%.d.ts.map}"
  base="${base%.d.ts}"

  if [[ -f "${base}.ts" || -f "${base}.tsx" ]]; then
    # .ts/.tsx 원본 존재 → tsc 아티팩트 삭제
    rm "$f"
    ((COUNT++))
  elif [[ "$f" == *.d.ts || "$f" == *.d.ts.map || "$f" == *.js.map ]]; then
    # .ts 원본 삭제됨 → .d.ts/.d.ts.map/.js.map은 항상 tsc 산출물
    rm "$f"
    ((COUNT++))
  elif [[ "$f" == *.js && ! -e "${base}.ts" ]]; then
    # .ts 원본 삭제됨 → .js도 고아 아티팩트로 판단
    rm "$f"
    ((COUNT++))
  fi
done < <(find "$TARGET" -type f \( -name "*.js" -o -name "*.js.map" -o -name "*.d.ts" -o -name "*.d.ts.map" \) ! -path "*/node_modules/*")

echo "Deleted $COUNT tsc artifacts from packages/core"
