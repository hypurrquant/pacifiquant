/**
 * Shared Utilities — v1.30.5 통합
 * 이전: array.ts + cn.ts (2파일)
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind CSS 클래스 병합 유틸리티
 * clsx로 조건부 클래스 처리 + tailwind-merge로 충돌 병합
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Array.includes()의 타입 안전한 대체.
 * readonly T[]에서 unknown 값을 검사하고 type guard로 동작.
 */
export function typedIncludes<T extends string>(
  arr: readonly T[],
  value: string,
): value is T {
  return arr.some(item => item === value);
}
