import type { UTCTimestamp } from 'lightweight-charts';

/**
 * seconds → UTCTimestamp 변환.
 * lightweight-charts의 UTCTimestamp는 branded number type이라 단언이 불가피.
 * TODO: lightweight-charts가 nominal type을 완화하거나, 공식 변환 함수를 제공하면 이 헬퍼 제거
 */
export function toUtcTimestamp(seconds: number): UTCTimestamp {
  return seconds as UTCTimestamp; // @ci-exception(type-assertion-count) — branded type, 라이브러리 제약
}
