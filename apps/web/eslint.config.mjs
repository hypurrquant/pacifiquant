import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),

  // Domain Import Rules (v0.12.4)
  // Rule 1: 도메인 내부에서 자기 barrel import 금지 (상대 경로 사용 필수)
  // Rule 2: 도메인 외부에서 deep import 금지 (barrel만 허용)
  //
  // Note: ESLint 9 + FlatCompat + Next.js 13.5 호환성 문제로 no-restricted-imports 적용 보류
  // 빌드 시 타입 체크로 위반 검출되며, CLAUDE.md에 규칙 문서화됨
  // Next.js 15 업그레이드 후 활성화 예정
];

export default eslintConfig;
