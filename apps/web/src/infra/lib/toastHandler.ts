/**
 * ToastHandler DI 패턴 — core → shared 역방향 의존성 해결
 *
 * Providers에서 setToastHandler로 실제 핸들러 등록,
 * core에서 showToast 호출.
 */

interface ToastParams {
  title: string;
  message?: string;
  type?: 'info' | 'success' | 'warning';
  debounceMs?: number;
}

type ToastHandler = (params: ToastParams) => void;

let toastHandler: ToastHandler = ({ title, message }) => {
  console.info(`[Toast] ${title}${message ? `: ${message}` : ''}`);
};

export const setToastHandler = (handler: ToastHandler): void => {
  toastHandler = handler;
};

export const showToast = (params: ToastParams): void => {
  toastHandler(params);
};
