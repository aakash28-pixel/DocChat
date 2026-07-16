import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { applyTheme, getTheme } from './theme'
import { initSentry } from './sentry'
import { initAnalytics } from './analytics'

// apply persisted theme before first paint
applyTheme(getTheme())
initSentry() // no-op unless VITE_SENTRY_DSN is set
initAnalytics() // no-op unless VITE_PLAUSIBLE_DOMAIN is set

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
