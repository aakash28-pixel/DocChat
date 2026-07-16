import { applyTheme, getTheme } from './theme'
import { useState } from 'react'

const FEATURES = [
  {
    icon: '📄',
    title: 'Cited answers',
    body: 'Every answer links back to the exact page it came from. Click a citation to see the source with the passage highlighted — no more trusting a black box.',
  },
  {
    icon: '🌐',
    title: 'Speaks your language',
    body: 'Ask in English, Roman Urdu, Hindi, or more. DocChat reads your (possibly English) document and replies in the language you asked in.',
  },
  {
    icon: '🔎',
    title: 'One doc or all of them',
    body: 'Scope a chat to a single PDF, or search across everything you’ve uploaded — with each answer attributed to the right document.',
  },
  {
    icon: '⚡',
    title: 'Handles messy PDFs',
    body: 'Multi-column manuals, scanned pages (OCR), 300-page documents — it parses cleanly and streams answers as they’re written.',
  },
]

const STEPS = [
  ['Upload a PDF', 'Drag it in. We parse, OCR if needed, and index it in the background — you watch the progress.'],
  ['Ask anything', 'Type a question in any language. The answer streams in, grounded only in your document.'],
  ['Verify & export', 'Click any citation to see the source page. Export the whole conversation to Markdown or PDF.'],
]

function Landing({ onGetStarted, onLegal }) {
  const [theme, setTheme] = useState(getTheme())
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Nav */}
      <nav className="max-w-6xl mx-auto px-5 sm:px-8 py-5 flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">
          <span className="text-indigo-600 dark:text-indigo-400">Doc</span>Chat
        </span>
        <div className="flex items-center gap-2 sm:gap-4">
          <button
            onClick={toggleTheme}
            title="Toggle theme"
            className="text-sm bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 rounded-lg px-3 py-1.5 transition"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            onClick={onGetStarted}
            className="text-sm text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-300 transition"
          >
            Log in
          </button>
          <button
            onClick={onGetStarted}
            className="text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-1.5 transition"
          >
            Get started
          </button>
        </div>
      </nav>

      {/* Hero */}
      <header className="max-w-3xl mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-16 text-center">
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight leading-tight">
          Chat with your PDFs,
          <br />
          <span className="text-indigo-600 dark:text-indigo-400">with citations you can trust.</span>
        </h1>
        <p className="mt-6 text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
          Upload a document and ask questions in plain language. Every answer comes
          straight from your PDF, with clickable page-level citations — in English,
          Roman Urdu, and more.
        </p>
        <div className="mt-9 flex items-center justify-center gap-3">
          <button
            onClick={onGetStarted}
            className="text-base font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl px-7 py-3 transition shadow-lg shadow-indigo-600/20"
          >
            Get started — it&apos;s free
          </button>
        </div>
        <p className="mt-4 text-xs text-slate-500">No credit card. Free tier included.</p>
      </header>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-12">
        <div className="grid sm:grid-cols-2 gap-5">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-6"
            >
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-semibold mb-1.5">{f.title}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-4xl mx-auto px-5 sm:px-8 py-12">
        <h2 className="text-center text-2xl font-semibold mb-10">How it works</h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {STEPS.map(([title, body], i) => (
            <div key={title} className="text-center">
              <div className="w-10 h-10 mx-auto mb-4 rounded-full bg-indigo-600 text-white flex items-center justify-center font-semibold">
                {i + 1}
              </div>
              <h3 className="font-medium mb-1.5">{title}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-5 sm:px-8 py-16 text-center">
        <div className="bg-indigo-600 rounded-3xl px-8 py-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">Ready to talk to your documents?</h2>
          <button
            onClick={onGetStarted}
            className="mt-6 text-base font-medium bg-white text-indigo-600 hover:bg-indigo-50 rounded-xl px-7 py-3 transition"
          >
            Get started free
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <span>
            <span className="text-indigo-600 dark:text-indigo-400 font-semibold">Doc</span>Chat ·{' '}
            {new Date().getFullYear()}
          </span>
          <div className="flex items-center gap-5">
            <button onClick={() => onLegal('terms')} className="hover:text-indigo-500 transition">
              Terms
            </button>
            <button onClick={() => onLegal('privacy')} className="hover:text-indigo-500 transition">
              Privacy
            </button>
            <button onClick={onGetStarted} className="hover:text-indigo-500 transition">
              Log in
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default Landing
