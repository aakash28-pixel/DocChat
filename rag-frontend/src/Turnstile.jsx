import { useEffect, useRef } from 'react'

// Cloudflare Turnstile CAPTCHA widget. Fully env-gated: without
// VITE_TURNSTILE_SITE_KEY nothing renders and auth works as before.
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY

export const turnstileEnabled = Boolean(SITE_KEY)

let scriptPromise = null
function loadScript() {
  if (window.turnstile) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve) => {
      const s = document.createElement('script')
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      s.async = true
      s.onload = resolve
      document.head.appendChild(s)
    })
  }
  return scriptPromise
}

export function resetTurnstile() {
  try {
    window.turnstile?.reset()
  } catch {
    /* widget not rendered */
  }
}

function Turnstile({ onToken }) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken

  useEffect(() => {
    if (!SITE_KEY) return
    let cancelled = false
    loadScript().then(() => {
      if (cancelled || !containerRef.current || widgetIdRef.current !== null) return
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: SITE_KEY,
        theme: 'auto',
        callback: (token) => onTokenRef.current(token),
        'expired-callback': () => onTokenRef.current(null),
        'error-callback': () => onTokenRef.current(null),
      })
    })
    return () => {
      cancelled = true
      if (widgetIdRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          /* already gone */
        }
        widgetIdRef.current = null
      }
    }
  }, [])

  if (!SITE_KEY) return null
  return <div ref={containerRef} className="flex justify-center min-h-[65px]" />
}

export default Turnstile
