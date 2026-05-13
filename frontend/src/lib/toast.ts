import hotToast from 'react-hot-toast';
import type { ToastOptions } from 'react-hot-toast';

/** Extra display time per character so longer copy stays visible longer. */
const BASE_MS = 4000;
const MS_PER_CHAR = 38;
const MIN_MS = 4000;
const MAX_MS = 18000;
/** Non-string toasts (rare); allow a comfortable read time. */
const NON_STRING_MS = 7500;

export function toastReadableDurationMs(text: string): number {
  const len = (text ?? '').length;
  return Math.min(MAX_MS, Math.max(MIN_MS, BASE_MS + len * MS_PER_CHAR));
}

function mergeDuration(message: unknown, options?: ToastOptions): ToastOptions {
  if (options?.duration !== undefined) {
    return { ...options };
  }
  if (typeof message === 'string') {
    return { ...options, duration: toastReadableDurationMs(message) };
  }
  if (typeof message === 'number') {
    return { ...options, duration: toastReadableDurationMs(String(message)) };
  }
  return { ...options, duration: NON_STRING_MS };
}

function baseToast(message: Parameters<typeof hotToast>[0], options?: ToastOptions) {
  return hotToast(message, mergeDuration(message, options));
}

const toast = Object.assign(baseToast, hotToast, {
  success: (message: Parameters<typeof hotToast.success>[0], options?: ToastOptions) =>
    hotToast.success(message, mergeDuration(message, options)),
  error: (message: Parameters<typeof hotToast.error>[0], options?: ToastOptions) =>
    hotToast.error(message, mergeDuration(message, options)),
}) as typeof hotToast;

export default toast;
