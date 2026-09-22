export type GlobalErrorDetail = { message: string; stack?: string }
export type GlobalErrorSource = 'error' | 'unhandledrejection'

export function installGlobalErrorHandlers(
  onError: (source: GlobalErrorSource, detail: GlobalErrorDetail) => void,
): { uninstall: () => void } {
  if (typeof window === 'undefined') {
    return { uninstall: () => {} }
  }

  function onWindowError(ev: ErrorEvent) {
    const message = ev.message ?? String(ev.error ?? 'Unknown window error')
    const stack = typeof ev.error?.stack === 'string' ? ev.error.stack : undefined
    onError('error', { message, stack })
  }

  function onUnhandledRejection(ev: PromiseRejectionEvent) {
    const reason = ev.reason
    const message =
      typeof reason === 'object' && reason !== null && 'message' in reason
        ? String((reason as { message?: unknown }).message ?? 'Unhandled promise rejection')
        : typeof reason === 'string'
          ? reason
          : 'Unhandled promise rejection'
    const stack =
      typeof reason === 'object' && reason !== null && 'stack' in reason
        ? (typeof (reason as { stack?: unknown }).stack === 'string'
            ? (reason as { stack: string }).stack
            : undefined)
        : undefined
    onError('unhandledrejection', { message, stack })
  }

  window.addEventListener('error', onWindowError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  return {
    uninstall: () => {
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    },
  }
}
