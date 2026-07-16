import { useState } from 'react'
import { supabase } from './supabaseClient'

// Shown after the user clicks the recovery link in their email
// (Supabase signs them in and fires PASSWORD_RECOVERY — App renders this).
export function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      onDone()
    } catch (err) {
      setError(err.message || 'Could not update the password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4"
      >
        <h1 className="text-lg font-semibold">Set a new password</h1>
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm
                     placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 dark:disabled:bg-slate-700
                     text-white text-sm font-medium rounded-xl py-2.5 transition"
        >
          {busy ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </div>
  )
}

function Auth(props) {
  const { onBack, onLegal } = props
  const [mode, setMode] = useState('login') // 'login' | 'signup' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        })
        if (error) throw error
        setNotice('If an account exists for that email, a reset link is on its way.')
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (data.user && !data.session) {
          setNotice('Check your email to confirm your account, then log in.')
        }
      }
    } catch (err) {
      setError(err.message || 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {onBack && (
          <button
            onClick={onBack}
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-indigo-500 mb-6"
          >
            ← Back to home
          </button>
        )}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">
            <span className="text-indigo-600 dark:text-indigo-400">Doc</span>Chat
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
            {mode === 'login'
              ? 'Welcome back — log in to continue.'
              : mode === 'forgot'
                ? "Enter your email and we'll send you a reset link."
                : 'Create an account to get started.'}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4"
        >
          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm
                         placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
          {mode !== 'forgot' && (
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm
                           placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}

          {mode === 'login' && (
            <button
              type="button"
              onClick={() => {
                setMode('forgot')
                setError('')
                setNotice('')
              }}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-300 transition"
            >
              Forgot password?
            </button>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          {notice && <p className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 dark:disabled:text-slate-400
                       text-white text-sm font-medium rounded-xl py-2.5 transition"
          >
            {busy
              ? 'Please wait…'
              : mode === 'login'
                ? 'Log in'
                : mode === 'forgot'
                  ? 'Send reset link'
                  : 'Sign up'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-5">
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login')
              setError('')
              setNotice('')
            }}
            className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-medium"
          >
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </p>

        {onLegal && (
          <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-8">
            By continuing you agree to our{' '}
            <button onClick={() => onLegal('terms')} className="underline hover:text-indigo-500">
              Terms
            </button>{' '}
            and{' '}
            <button onClick={() => onLegal('privacy')} className="underline hover:text-indigo-500">
              Privacy Policy
            </button>
            .
          </p>
        )}
      </div>
    </div>
  )
}

export default Auth
