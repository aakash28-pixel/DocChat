import { Component } from 'react'
import { Sentry } from './sentry'

// Catches render-time crashes anywhere in the tree and shows a friendly
// fallback instead of a blank white screen. Reports to Sentry when enabled.
class ErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    try {
      Sentry.captureException(error, { extra: info })
    } catch {
      /* Sentry not configured — ignore */
    }
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center px-4">
          <div className="max-w-md text-center bg-white/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-2xl p-8">
            <p className="text-4xl mb-3">😵</p>
            <h1 className="text-lg font-semibold mb-2">Something went wrong</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
              The app hit an unexpected error. Reloading usually fixes it.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl px-5 py-2.5 transition"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
