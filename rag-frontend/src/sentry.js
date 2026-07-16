import * as Sentry from '@sentry/react'

const dsn = import.meta.env.VITE_SENTRY_DSN

export const sentryEnabled = Boolean(dsn)

// No-op unless VITE_SENTRY_DSN is set, so local dev is unaffected.
export function initSentry() {
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  })
}

export { Sentry }
