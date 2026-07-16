// Privacy-respecting analytics (Plausible). No-op unless VITE_PLAUSIBLE_DOMAIN
// is set at build time — so local dev and un-configured deploys stay clean.
// Plausible is cookieless and GDPR-friendly (no consent banner needed).
export function initAnalytics() {
  const domain = import.meta.env.VITE_PLAUSIBLE_DOMAIN
  if (!domain) return
  const host = import.meta.env.VITE_PLAUSIBLE_HOST || 'https://plausible.io'
  const s = document.createElement('script')
  s.defer = true
  s.setAttribute('data-domain', domain)
  s.src = `${host}/js/script.js`
  document.head.appendChild(s)
}
