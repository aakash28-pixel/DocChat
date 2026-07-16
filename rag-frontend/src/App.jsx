import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabaseClient'
import Auth, { ResetPassword } from './Auth'
import Chat from './Chat'
import Landing from './Landing'
import { Terms, Privacy } from './Legal'

function SetupNotice() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center px-4">
      <div className="max-w-md text-center bg-white/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-2xl p-8">
        <h1 className="text-xl font-semibold mb-3">
          <span className="text-indigo-600 dark:text-indigo-400">Doc</span>Chat — setup needed
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          Supabase is not configured yet. Add your project credentials to{' '}
          <code className="text-indigo-700 dark:text-indigo-300 bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded">rag-frontend/.env</code>:
        </p>
        <pre className="text-left text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 mt-4 text-slate-600 dark:text-slate-300">
{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
        </pre>
        <p className="text-xs text-slate-500 mt-4">Then restart the dev server.</p>
      </div>
    </div>
  )
}

function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [recovering, setRecovering] = useState(false)
  const [view, setView] = useState('landing') // 'landing' | 'auth' (logged-out only)
  const [legal, setLegal] = useState(null) // null | 'terms' | 'privacy'

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      // user arrived via a password-reset email link
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(newSession)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!isSupabaseConfigured) return <SetupNotice />
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <p className="text-slate-500 text-sm animate-pulse">Loading…</p>
      </div>
    )
  }

  // Legal pages are reachable from anywhere and overlay everything else.
  if (legal === 'terms') return <Terms onBack={() => setLegal(null)} />
  if (legal === 'privacy') return <Privacy onBack={() => setLegal(null)} />

  if (session) {
    if (recovering) return <ResetPassword onDone={() => setRecovering(false)} />
    return <Chat session={session} onLegal={setLegal} />
  }

  // Logged out: marketing landing first, then the auth screen on "Get started".
  if (view === 'auth') {
    return <Auth onBack={() => setView('landing')} onLegal={setLegal} />
  }
  return <Landing onGetStarted={() => setView('auth')} onLegal={setLegal} />
}

export default App
