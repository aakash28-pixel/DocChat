import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from './supabaseClient'
import PdfViewer from './PdfViewer'
import { applyTheme, getTheme } from './theme'

const MAX_UPLOAD_MB = 25

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch { /* clipboard unavailable */ }
      }}
      title="Copy answer"
      className="text-[11px] text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-300 transition"
    >
      {copied ? '✓ Copied' : '⧉ Copy'}
    </button>
  )
}

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

// Free-tier ngrok tunnels show a browser interstitial that breaks API calls;
// this header skips it. Inert for any other backend host.
axios.defaults.headers.common['ngrok-skip-browser-warning'] = 'true'
const TUNNEL_HEADER = { 'ngrok-skip-browser-warning': 'true' }
const RATE_LIMIT_MSG =
  'You are sending too many requests. Please wait a minute and try again.'

// Safety net against citation spam on "answer not found" replies (any language).
const NOT_FOUND_RX =
  /(does not contain|could ?no?t find|do(?:es)? ?no?t know|don't know|doesn't (?:contain|mention)|no information|not mentioned|maloomat nahi|zikr nahi|nahi (?:hai|hain|milta|milti|hoti))/i

const stripCitationSpam = (text = '') => {
  // 1. a glued run of 3+ markers at the very end is spam, not citation
  let t = text.replace(/(\s*\[\d+\]){3,}\s*$/, '')
  // 2. short not-found replies should carry no markers at all
  if (t.length < 300 && NOT_FOUND_RX.test(t)) t = t.replace(/\s*\[\d+\]/g, '')
  return t
}

const expandCommaMarkers = (text = '') =>
  text.replace(/\[(\d+(?:\s*,\s*\d+)+)\]/g, (_, nums) =>
    nums.split(/\s*,\s*/).map((n) => `[${n}]`).join('')
  )

// citations actually used in a finished AI message (same logic as the UI list)
const citedListFor = (msg) => {
  if (!msg.citations?.length) return []
  const normalized = expandCommaMarkers(stripCitationSpam(msg.text || ''))
  const citedNs = new Set([...normalized.matchAll(/\[(\d+)\]/g)].map((m) => +m[1]))
  return msg.citations.filter((c) => citedNs.has(c.n))
}

function Chat({ session, onLegal }) {
  const [documents, setDocuments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [activeDocId, setActiveDocId] = useState(null) // filename of the selected document
  const [conversations, setConversations] = useState([])
  const [activeConvId, setActiveConvId] = useState(null)
  const [viewer, setViewer] = useState(null) // { source, page, snippet } → PDF side panel
  const [deletingDoc, setDeletingDoc] = useState(null) // filename being deleted
  const [suggestions, setSuggestions] = useState([]) // LLM starter questions after upload
  const [exportOpen, setExportOpen] = useState(false)
  const [theme, setTheme] = useState(getTheme())
  const [sidebarOpen, setSidebarOpen] = useState(false) // mobile drawer
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploadStage, setUploadStage] = useState(null) // null | 'uploading' | 'processing'
  const [uploadPct, setUploadPct] = useState(0)
  const [stageLabel, setStageLabel] = useState('')
  const [toast, setToast] = useState('')
  const stageTimerRef = useRef(null)
  const dragDepthRef = useRef(0)

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }
  const fileInputRef = useRef(null)
  const chatEndRef = useRef(null)
  const toastTimerRef = useRef(null)

  const user = session?.user
  const accessToken = session?.access_token

  const showToast = (msg) => {
    setToast(msg)
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(''), 6000)
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  // ── Load documents + conversations from Supabase (survives reloads) ──

  useEffect(() => {
    if (!user) return
    const load = async () => {
      const { data: docs } = await supabase
        .from('documents')
        .select('filename, chunks, summary, ocr_pages, created_at')
        .order('created_at', { ascending: false })
      if (docs) {
        const seen = new Set()
        const unique = []
        for (const d of docs) {
          if (!seen.has(d.filename)) {
            seen.add(d.filename)
            unique.push({
              name: d.filename,
              chunks: d.chunks,
              summary: d.summary,
              ocrPages: d.ocr_pages || 0,
            })
          }
        }
        setDocuments(unique)
      }
      const { data: convs } = await supabase
        .from('conversations')
        .select('id, title, doc_id, updated_at')
        .order('updated_at', { ascending: false })
      if (convs) setConversations(convs)
    }
    load()
  }, [user])

  // ── Conversation management ──

  const startNewChat = () => {
    setMessages([])
    setActiveConvId(null)
    setSidebarOpen(false)
  }

  // Single entry point for changing document scope. If a conversation is on
  // screen, park it (it stays in the sidebar) and start fresh — the scope
  // pill, active conversation, and visible messages always change together.
  const changeScope = (nextDocId) => {
    if (thinking) return // don't yank state while an answer is streaming
    if (nextDocId === activeDocId) return
    if (activeConvId || messages.length > 0) startNewChat()
    setActiveDocId(nextDocId)
    setSidebarOpen(false)
    // fresh scoped chat: greet with the document's stored summary card
    const doc = nextDocId && documents.find((d) => d.name === nextDocId)
    if (doc?.summary) {
      setMessages([{ role: 'summary', doc: doc.name, text: doc.summary }])
    }
  }

  const ensureConversation = async (firstQuery) => {
    if (activeConvId) return activeConvId
    try {
      const { data, error } = await supabase
        .from('conversations')
        .insert({
          user_id: user.id,
          doc_id: activeDocId,
          title: firstQuery.slice(0, 60),
        })
        .select()
        .single()
      if (error) throw error
      setActiveConvId(data.id)
      setConversations((convs) => [data, ...convs])
      return data.id
    } catch {
      // persistence unavailable (e.g. migration not run yet) — chat still works
      return null
    }
  }

  const resumeConversation = async (conv) => {
    setActiveConvId(conv.id)
    setSidebarOpen(false)
    // if the scoped document was deleted, fall back to All documents
    const docStillExists = conv.doc_id && documents.some((d) => d.name === conv.doc_id)
    setActiveDocId(docStillExists ? conv.doc_id : null)
    if (conv.doc_id && !docStillExists) {
      showToast(`"${conv.doc_id}" was deleted — this chat now searches all documents.`)
    }
    const { data } = await supabase
      .from('chat_history')
      .select('role, content, citations')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true })
    setMessages(
      (data || []).map((m) => ({
        role: m.role,
        text: m.content,
        citations: m.citations || [],
      }))
    )
  }

  const deleteConversation = async (conv, e) => {
    e.stopPropagation()
    await supabase.from('conversations').delete().eq('id', conv.id)
    setConversations((convs) => convs.filter((c) => c.id !== conv.id))
    if (conv.id === activeConvId) startNewChat()
  }

  // ── Export chat (Markdown / PDF) ──

  const exportableMessages = messages.filter(
    (m) => !m.error && !m.streaming && ['user', 'ai', 'summary'].includes(m.role)
  )

  const exportTitle = () =>
    conversations.find((c) => c.id === activeConvId)?.title || 'DocChat conversation'

  const buildMarkdown = () => {
    const lines = [
      `# ${exportTitle()}`,
      '',
      `**Scope:** ${activeDocId ? `Only: ${activeDocId}` : 'All documents'}  `,
      `**Exported:** ${new Date().toLocaleString()}`,
      '',
      '---',
      '',
    ]
    for (const m of exportableMessages) {
      if (m.role === 'summary') {
        lines.push(`> **📄 Document summary — ${m.doc}**`)
        lines.push(`> ${m.text.replace(/\n/g, '\n> ')}`, '')
      } else if (m.role === 'user') {
        lines.push('### 🧑 You', '', m.text, '')
      } else {
        lines.push('### 🤖 DocChat', '', stripCitationSpam(m.text), '')
        const cited = citedListFor(m)
        if (cited.length) {
          lines.push('**Citations:**', '')
          for (const c of cited) {
            lines.push(
              `- [${c.n}] ${c.source}${c.page ? ` · p.${c.page}` : ''} — “${(c.snippet || '').slice(0, 120)}…”`
            )
          }
          lines.push('')
        }
      }
    }
    return lines.join('\n')
  }

  const exportMarkdown = () => {
    const blob = new Blob([buildMarkdown()], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `docchat-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
    setExportOpen(false)
  }

  const exportPdf = () => {
    const esc = (s = '') =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const blocks = exportableMessages
      .map((m) => {
        if (m.role === 'summary') {
          return `<div class="summary"><div class="label">📄 Summary — ${esc(m.doc)}</div>${esc(m.text)}</div>`
        }
        if (m.role === 'user') {
          return `<div class="q"><div class="label">You</div>${esc(m.text)}</div>`
        }
        const cited = citedListFor(m)
        const cites = cited.length
          ? `<ul class="cites">${cited
              .map(
                (c) =>
                  `<li>[${c.n}] ${esc(c.source)}${c.page ? ` · p.${c.page}` : ''} — “${esc((c.snippet || '').slice(0, 120))}…”</li>`
              )
              .join('')}</ul>`
          : ''
        return `<div class="a"><div class="label">DocChat</div>${esc(stripCitationSpam(m.text))}${cites}</div>`
      })
      .join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(exportTitle())}</title><style>
      body{font-family:-apple-system,'Segoe UI',sans-serif;max-width:720px;margin:40px auto;color:#111;line-height:1.55}
      h1{font-size:20px}.meta{color:#666;font-size:12px;margin-bottom:24px}
      .q,.a,.summary{white-space:pre-wrap;padding:12px 16px;border-radius:10px;margin:10px 0;font-size:13px}
      .q{background:#eef2ff;border:1px solid #c7d2fe}.a{background:#f8fafc;border:1px solid #e2e8f0}
      .summary{background:#faf5ff;border:1px solid #e9d5ff}
      .label{font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6366f1;margin-bottom:6px}
      .cites{margin-top:10px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:11px;color:#555;list-style:none;padding-left:0}
      @media print{body{margin:10mm auto}}
    </style></head><body><h1>${esc(exportTitle())}</h1><div class="meta">Scope: ${esc(
      activeDocId ? `Only: ${activeDocId}` : 'All documents'
    )} · Exported ${new Date().toLocaleString()}</div>${blocks}</body></html>`

    const w = window.open('', '_blank')
    if (!w) {
      showToast('Popup blocked — allow popups for this site to export as PDF.')
      return
    }
    w.document.write(html)
    w.document.close()
    setTimeout(() => {
      w.focus()
      w.print()
    }, 300)
    setExportOpen(false)
  }

  // ── Citations: guard against deleted documents ──

  const openCitation = (cite) => {
    if (!documents.some((d) => d.name === cite.source)) {
      showToast('That document has been deleted — its PDF is no longer available.')
      return
    }
    setViewer(cite)
  }

  // ── Document deletion ──

  const handleDeleteDocument = async (doc, e) => {
    e.stopPropagation()
    if (deletingDoc) return // one at a time; also blocks double-clicks
    const ok = window.confirm(
      `Delete "${doc.name}"? This will remove its indexed data. This cannot be undone.`
    )
    if (!ok) return
    setDeletingDoc(doc.name)
    try {
      await axios.delete(`${API_BASE}/documents/${encodeURIComponent(doc.name)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      setDocuments((docs) => docs.filter((d) => d.name !== doc.name))
      if (viewer?.source === doc.name) setViewer(null)
      if (activeDocId === doc.name) changeScope(null)
      showToast(`"${doc.name}" deleted.`)
    } catch (err) {
      showToast(
        err.response?.status === 429
          ? RATE_LIMIT_MSG
          : err.response?.data?.detail || 'Delete failed. Is the backend running?'
      )
    } finally {
      setDeletingDoc(null)
    }
  }

  // ── Upload ──

  const uploadFile = async (file) => {
    if (!file || uploading) return
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Only PDF files are supported.')
      return
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setUploadError(
        `"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_UPLOAD_MB} MB.`
      )
      return
    }
    setUploading(true)
    setUploadError('')
    setUploadStage('uploading')
    setUploadPct(0)
    setStageLabel('Uploading…')
    const formData = new FormData()
    formData.append('file', file)
    try {
      // 1) upload bytes → backend validates and returns a job id (202)
      const { data: job } = await axios.post(`${API_BASE}/upload`, formData, {
        headers: { Authorization: `Bearer ${accessToken}` },
        onUploadProgress: (e) => {
          const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0
          setUploadPct(pct)
        },
      })

      // 2) poll the ingestion job for real staged progress
      setUploadStage('processing')
      const data = await pollJob(job.job_id)

      // 3) job finished → update UI from the result
      setDocuments((docs) => [
        {
          name: data.filename,
          chunks: data.chunks_stored,
          summary: data.summary,
          ocrPages: data.ocr_pages || 0,
        },
        ...docs.filter((d) => d.name !== data.filename),
      ])
      setSuggestions(data.suggested_questions || [])
      if (data.summary) {
        setMessages((msgs) => [
          ...msgs,
          { role: 'summary', doc: data.filename, text: data.summary },
        ])
      }
    } catch (err) {
      if (err.response?.status === 429) {
        setUploadError(RATE_LIMIT_MSG)
        showToast(RATE_LIMIT_MSG)
      } else {
        setUploadError(
          err.message ||
            err.response?.data?.detail ||
            'Upload failed. Is the backend running?'
        )
      }
    } finally {
      clearTimeout(stageTimerRef.current)
      setUploading(false)
      setUploadStage(null)
      setUploadPct(0)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Poll GET /jobs/{id} until ready/error. Resolves with the result payload,
  // rejects with a friendly Error on failure. Drives the staged progress UI.
  const pollJob = (jobId) =>
    new Promise((resolve, reject) => {
      const tick = async () => {
        try {
          const { data: job } = await axios.get(`${API_BASE}/jobs/${jobId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          setStageLabel(job.stage_label || 'Processing…')
          setUploadPct(job.progress || 0)
          if (job.status === 'ready') return resolve(job.result)
          if (job.status === 'error') {
            return reject(new Error(job.error || 'Ingestion failed.'))
          }
          stageTimerRef.current = setTimeout(tick, 900)
        } catch {
          reject(new Error('Lost connection while processing. Please try again.'))
        }
      }
      tick()
    })

  const handleUpload = (e) => uploadFile(e.target.files?.[0])

  // ── Drag & drop upload ──

  const onDragEnter = (e) => {
    e.preventDefault()
    dragDepthRef.current += 1
    setDragOver(true)
  }
  const onDragLeave = (e) => {
    e.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragOver(false)
  }
  const onDrop = (e) => {
    e.preventDefault()
    dragDepthRef.current = 0
    setDragOver(false)
    uploadFile(e.dataTransfer.files?.[0])
  }

  // ── Account / data deletion ──

  const deleteAccount = async () => {
    const ok = window.confirm(
      'Permanently delete ALL your data — every document, conversation, and your ' +
        'account? This cannot be undone.'
    )
    if (!ok) return
    setDeleting(true)
    try {
      await axios.delete(`${API_BASE}/account`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      await supabase.auth.signOut()
      // signOut re-renders App to the landing/auth screen
    } catch {
      setDeleting(false)
      showToast('Could not delete your account. Please try again.')
    }
  }

  // ── Chat (SSE streaming) ──

  const sendMessage = async (overrideText) => {
    // overrideText comes from suggested-question chips; button clicks pass an event
    const query = (typeof overrideText === 'string' ? overrideText : input).trim()
    if (!query || thinking) return
    setInput('')

    const conversationId = await ensureConversation(query)

    // history = prior user/ai turns only (skip error bubbles and summary cards)
    const history = messages
      .filter((m) => !m.error && (m.role === 'user' || m.role === 'ai'))
      .map((m) => ({ role: m.role, text: m.text }))

    setMessages((msgs) => [
      ...msgs,
      { role: 'user', text: query },
      { role: 'ai', text: '', streaming: true },
    ])
    setThinking(true)

    const updateLast = (updater) =>
      setMessages((msgs) => {
        const next = [...msgs]
        next[next.length - 1] = updater(next[next.length - 1])
        return next
      })

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...TUNNEL_HEADER,
        },
        body: JSON.stringify({
          query,
          history,
          doc_id: activeDocId,
          conversation_id: conversationId,
        }),
      })
      if (res.status === 429) {
        showToast(RATE_LIMIT_MSG)
        throw new Error(RATE_LIMIT_MSG)
      }
      if (!res.ok || !res.body) {
        const detail = await res.json().then((d) => d.detail).catch(() => null)
        throw new Error(detail || `Request failed (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() // keep incomplete event in the buffer

        for (const raw of events) {
          const line = raw.trim()
          if (!line.startsWith('data: ')) continue
          const evt = JSON.parse(line.slice(6))
          if (evt.type === 'token') {
            updateLast((m) => ({ ...m, text: m.text + evt.content }))
          } else if (evt.type === 'done') {
            updateLast((m) => ({
              ...m,
              streaming: false,
              sources: evt.sources,
              citations: evt.citations || [],
            }))
          } else if (evt.type === 'error') {
            updateLast((m) => ({
              ...m,
              streaming: false,
              error: true,
              text: m.text || evt.message,
            }))
          }
        }
      }
      updateLast((m) => ({ ...m, streaming: false }))
    } catch (err) {
      updateLast((m) => ({
        ...m,
        streaming: false,
        error: true,
        text: m.text || err.message || 'Something went wrong. Is the backend running?',
      }))
    } finally {
      setThinking(false)
    }
  }

  return (
    <div
      className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans relative"
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 z-30 bg-white/80 dark:bg-slate-950/80 flex items-center justify-center pointer-events-none">
          <div className="border-2 border-dashed border-indigo-400 rounded-3xl px-16 py-12 text-center">
            <p className="text-4xl mb-3">📄</p>
            <p className="text-lg font-medium text-indigo-700 dark:text-indigo-300">Drop your PDF to upload</p>
          </div>
        </div>
      )}
      {/* mobile drawer backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 sm:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* ── Sidebar (static on desktop, slide-in drawer on mobile) ── */}
      <aside
        className={`fixed sm:static inset-y-0 left-0 z-40 w-72 shrink-0 border-r border-slate-200 dark:border-slate-800
          bg-white dark:bg-slate-900 sm:bg-white/60 sm:dark:bg-slate-900/60 p-5 flex flex-col gap-5
          transform transition-transform duration-200 sm:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              <span className="text-indigo-600 dark:text-indigo-400">Doc</span>Chat
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">RAG-based document Q&amp;A</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="sm:hidden text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleUpload}
            className="hidden"
            id="pdf-upload"
          />
          <label
            htmlFor="pdf-upload"
            className={`block w-full text-center text-sm font-medium rounded-lg px-4 py-2.5 cursor-pointer transition
              ${uploading
                ? 'bg-slate-300 dark:bg-slate-700 text-slate-500 dark:text-slate-400 cursor-wait'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
          >
            {uploading ? stageLabel || 'Processing…' : '+ Upload PDF'}
          </label>
          {uploading && (
            <div className="mt-2">
              <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                {uploadStage === 'uploading'
                  ? `Uploading… ${uploadPct}%`
                  : `${stageLabel} ${uploadPct}%`}
              </p>
            </div>
          )}
          {!uploading && (
            <p className="text-[10px] text-slate-500 mt-1.5 text-center">
              or drag &amp; drop a PDF anywhere
            </p>
          )}
          {uploadError && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-2">{uploadError}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto space-y-6">
          {/* Documents */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs uppercase tracking-wider text-slate-500">
                Documents
              </h2>
              {activeDocId && (
                <button
                  onClick={() => changeScope(null)}
                  title="Clear selection and search across all documents"
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-medium"
                >
                  ✕ Clear (Search All)
                </button>
              )}
            </div>
            {documents.length === 0 ? (
              <p className="text-sm text-slate-500">No documents yet.</p>
            ) : (
              <ul className="space-y-2">
                {documents.map((doc, i) => (
                  <li
                    key={i}
                    onClick={() =>
                      deletingDoc !== doc.name &&
                      changeScope(activeDocId === doc.name ? null : doc.name)
                    }
                    className={`group flex items-center gap-2 text-sm rounded-lg px-3 py-2 border transition
                      ${deletingDoc === doc.name
                        ? 'bg-slate-100 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/50 opacity-60 cursor-wait'
                        : activeDocId === doc.name
                          ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-900/40 cursor-pointer'
                          : 'bg-white dark:bg-slate-800/70 border-slate-200 dark:border-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700/70 cursor-pointer'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium" title={doc.name}>📄 {doc.name}</p>
                      <p className={`text-xs ${activeDocId === doc.name ? 'text-indigo-200' : 'text-slate-500 dark:text-slate-400'}`}>
                        {deletingDoc === doc.name
                          ? 'Deleting…'
                          : activeDocId === doc.name
                            ? '✓ Active — chat is scoped to this file'
                            : `${doc.chunks} chunks indexed`}
                      </p>
                      {doc.ocrPages > 0 && (
                        <p
                          className={`text-[10px] mt-0.5 ${activeDocId === doc.name ? 'text-indigo-200' : 'text-amber-600 dark:text-amber-400/80'}`}
                          title={`${doc.ocrPages} scanned page(s) were read using OCR`}
                        >
                          🔍 OCR used ({doc.ocrPages} {doc.ocrPages === 1 ? 'page' : 'pages'})
                        </p>
                      )}
                    </div>
                    <button
                      onClick={(e) => handleDeleteDocument(doc, e)}
                      disabled={Boolean(deletingDoc)}
                      title="Delete document"
                      className={`shrink-0 text-xs transition
                        ${deletingDoc === doc.name
                          ? 'opacity-100 animate-pulse'
                          : 'opacity-0 group-hover:opacity-100'}
                        ${activeDocId === doc.name
                          ? 'text-indigo-200 hover:text-red-300'
                          : 'text-slate-500 hover:text-red-600 dark:hover:text-red-400'}`}
                    >
                      {deletingDoc === doc.name ? '⏳' : '🗑'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Conversations */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs uppercase tracking-wider text-slate-500">
                Conversations
              </h2>
              <button
                onClick={startNewChat}
                title="Start a new conversation"
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-medium"
              >
                + New
              </button>
            </div>
            {conversations.length === 0 ? (
              <p className="text-sm text-slate-500">No conversations yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {conversations.map((conv) => (
                  <li
                    key={conv.id}
                    onClick={() => resumeConversation(conv)}
                    className={`group flex items-center gap-2 text-sm rounded-lg px-3 py-2 border cursor-pointer transition
                      ${activeConvId === conv.id
                        ? 'bg-slate-200 dark:bg-slate-700/80 border-indigo-400 dark:border-indigo-500/60'
                        : 'bg-slate-100 dark:bg-slate-800/40 border-transparent hover:bg-slate-200/80 dark:hover:bg-slate-800/80'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate" title={conv.title}>💬 {conv.title}</p>
                      {conv.doc_id && (
                        <p className="text-xs text-slate-500 truncate" title={conv.doc_id}>
                          📄 {conv.doc_id}
                          {!documents.some((d) => d.name === conv.doc_id) && (
                            <span className="text-amber-500/80"> · document deleted</span>
                          )}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={(e) => deleteConversation(conv, e)}
                      title="Delete conversation"
                      className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition text-xs shrink-0"
                    >
                      🗑
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mb-2" title={user?.email}>
            {user?.email}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => supabase.auth.signOut()}
              className="flex-1 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700
                         rounded-lg px-4 py-2 transition"
            >
              Log out
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              className="shrink-0 text-sm bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 rounded-lg px-3 py-2 transition"
            >
              ⚙︎
            </button>
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="shrink-0 text-sm bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 rounded-lg px-3 py-2 transition"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main chat window ── */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        {toast && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-amber-100/95 dark:bg-amber-900/90 border border-amber-300 dark:border-amber-700
                          text-amber-900 dark:text-amber-100 text-sm rounded-xl px-5 py-3 shadow-lg">
            ⏳ {toast}
          </div>
        )}
        <header className="border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="sm:hidden text-xl leading-none text-slate-600 dark:text-slate-300"
            title="Menu"
          >
            ☰
          </button>
          <h2 className="font-medium hidden sm:block">Chat with your documents</h2>
          {activeDocId ? (
            <button
              onClick={() => changeScope(null)}
              className="text-xs bg-indigo-50 dark:bg-indigo-950 border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300
                         hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-full px-3 py-1 truncate max-w-60 transition"
              title={`Scoped to ${activeDocId} — click to search all documents`}
            >
              🔎 Only: {activeDocId}
            </button>
          ) : (
            <span
              className="text-xs bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400
                         rounded-full px-3 py-1"
              title="Answers can draw from any of your documents. Click a document in the sidebar to narrow the scope."
            >
              🌐 All documents
            </span>
          )}

          <div className="ml-auto relative">
            <button
              onClick={() => setExportOpen((o) => !o)}
              disabled={exportableMessages.length === 0}
              title={
                exportableMessages.length === 0
                  ? 'Nothing to export yet'
                  : 'Download this conversation'
              }
              className="text-xs bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300
                         hover:border-indigo-500 hover:text-indigo-500 dark:hover:text-indigo-300 disabled:opacity-40
                         disabled:hover:border-slate-300 dark:disabled:hover:border-slate-700 disabled:hover:text-slate-600 dark:disabled:hover:text-slate-300
                         rounded-lg px-3 py-1.5 transition"
            >
              ⬇ Export
            </button>
            {exportOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700
                              rounded-xl shadow-xl z-20 overflow-hidden">
                <button
                  onClick={exportMarkdown}
                  className="block w-full text-left px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  📝 Markdown (.md)
                </button>
                <button
                  onClick={exportPdf}
                  className="block w-full text-left px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  🖨 PDF (via print)
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-slate-500">
                <p className="text-4xl mb-3">💬</p>
                <p className="text-sm">
                  Upload a PDF, then ask anything about it.
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => msg.role === 'summary' ? (
            <div key={i} className="flex justify-center">
              <div className="w-full max-w-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 rounded-2xl px-5 py-4">
                <p className="text-xs uppercase tracking-wider text-indigo-700 dark:text-indigo-300 mb-1.5">
                  📄 Summary — {msg.doc}
                </p>
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{msg.text}</p>
              </div>
            </div>
          ) : (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed
                  ${msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-sm whitespace-pre-wrap'
                    : msg.error
                      ? 'bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-200 rounded-bl-sm whitespace-pre-wrap'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-bl-sm'}`}
              >
                {msg.role === 'ai' && !msg.error ? (
                  <div
                    className="prose dark:prose-invert prose-sm max-w-none
                               prose-p:my-1.5 prose-headings:my-2 prose-ul:my-1.5 prose-ol:my-1.5
                               prose-li:my-0.5 prose-pre:my-2 prose-pre:bg-slate-950
                               prose-code:text-indigo-600 dark:prose-code:text-indigo-300 prose-table:my-2
                               prose-th:border prose-th:border-slate-300 dark:prose-th:border-slate-700 prose-th:px-2 prose-th:py-1
                               prose-td:border prose-td:border-slate-300 dark:prose-td:border-slate-700 prose-td:px-2 prose-td:py-1"
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children }) => {
                          if (href?.startsWith('#cite-')) {
                            const n = parseInt(href.slice(6), 10)
                            const cite = msg.citations?.find((c) => c.n === n)
                            if (!cite) return <span>[{n}]</span>
                            return (
                              <button
                                onClick={() => openCitation(cite)}
                                title={`${cite.source}${cite.page ? ` — page ${cite.page}` : ''}`}
                                className="inline-flex items-center justify-center align-super text-[10px]
                                           font-semibold bg-indigo-100 dark:bg-indigo-900/80 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-600 dark:hover:bg-indigo-700
                                           hover:text-white rounded px-1 mx-0.5 no-underline cursor-pointer
                                           transition"
                              >
                                {n}
                              </button>
                            )
                          }
                          return (
                            <a href={href} target="_blank" rel="noreferrer">
                              {children}
                            </a>
                          )
                        },
                      }}
                    >
                      {(() => {
                        const text = msg.streaming ? msg.text : stripCitationSpam(msg.text)
                        if (!msg.citations?.length) return text
                        return text
                          // defensive: expand comma lists like [1, 2, 3] into single chips
                          .replace(/\[(\d+(?:\s*,\s*\d+)+)\]/g, (_, nums) =>
                            nums.split(/\s*,\s*/).map((n) => `[${n}]`).join('')
                          )
                          .replace(/\[(\d+)\]/g, '[$1](#cite-$1)')
                      })()}
                    </ReactMarkdown>
                  </div>
                ) : (
                  msg.text
                )}
                {msg.streaming && (
                  <span className="inline-block w-2 h-4 ml-0.5 bg-indigo-400 animate-pulse align-text-bottom" />
                )}
                {(() => {
                  if (msg.role !== 'ai' || msg.error || msg.streaming) return null
                  const normalized = stripCitationSpam(msg.text).replace(
                    /\[(\d+(?:\s*,\s*\d+)+)\]/g,
                    (_, nums) => nums.split(/\s*,\s*/).map((n) => `[${n}]`).join('')
                  )
                  const citedNs = new Set(
                    [...normalized.matchAll(/\[(\d+)\]/g)].map((m) => +m[1])
                  )
                  const cited = (msg.citations || []).filter((c) => citedNs.has(c.n))
                  if (cited.length > 0) {
                    return (
                      <div className="mt-2 pt-2 border-t border-slate-300 dark:border-slate-700 space-y-1">
                        {cited.map((c) => (
                          <button
                            key={c.n}
                            onClick={() => openCitation(c)}
                            className="block w-full text-left text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-300
                                       transition truncate"
                            title="Open this page in the PDF viewer"
                          >
                            <span className="text-indigo-600 dark:text-indigo-400 font-semibold">[{c.n}]</span>{' '}
                            {c.source}
                            {c.page ? ` · p.${c.page}` : ''} — “{c.snippet?.slice(0, 90)}…”
                          </button>
                        ))}
                      </div>
                    )
                  }
                  if (msg.sources?.length > 0) {
                    return (
                      <p className="mt-2 pt-2 border-t border-slate-300 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                        Sources: {msg.sources.join(', ')}
                      </p>
                    )
                  }
                  return null
                })()}
                {msg.role === 'ai' && !msg.error && !msg.streaming && msg.text && (
                  <div className="mt-1.5">
                    <CopyButton text={stripCitationSpam(msg.text)} />
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <footer className="border-t border-slate-200 dark:border-slate-800 px-6 py-4">
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {suggestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => {
                    sendMessage(q)
                    setSuggestions([])
                  }}
                  className="text-xs bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300
                             hover:border-indigo-500 hover:text-indigo-500 dark:hover:text-indigo-300 rounded-full
                             px-3 py-1.5 transition"
                >
                  💡 {q}
                </button>
              ))}
              <button
                onClick={() => setSuggestions([])}
                title="Dismiss suggestions"
                className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-1"
              >
                ✕
              </button>
            </div>
          )}
          <div className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Ask a question about your documents…"
              className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm
                         placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={sendMessage}
              disabled={thinking || !input.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 dark:disabled:text-slate-400
                         text-white text-sm font-medium rounded-xl px-5 py-2.5 transition"
            >
              Send
            </button>
          </div>
        </footer>
      </main>

      {/* ── PDF citation viewer (side panel on desktop, full-screen on mobile) ── */}
      {viewer && (
        <div className="fixed inset-0 z-50 sm:static sm:inset-auto sm:z-auto flex">
          <PdfViewer
            viewer={viewer}
            onClose={() => setViewer(null)}
            accessToken={accessToken}
          />
        </div>
      )}

      {/* ── Settings modal ── */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Settings</h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl leading-none"
              >
                ✕
              </button>
            </div>

            <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Signed in as</p>
            <p className="text-sm font-medium mb-5 truncate">{user?.email}</p>

            <div className="flex gap-4 text-sm mb-6">
              <button
                onClick={() => onLegal?.('terms')}
                className="text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Terms
              </button>
              <button
                onClick={() => onLegal?.('privacy')}
                className="text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Privacy
              </button>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-800 pt-5">
              <p className="text-xs uppercase tracking-wider text-red-500 mb-2">Danger zone</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                Permanently delete all your documents, conversations, and your account.
                This cannot be undone.
              </p>
              <button
                onClick={deleteAccount}
                disabled={deleting}
                className="w-full text-sm font-medium text-white bg-red-600 hover:bg-red-500 disabled:bg-red-400
                           rounded-lg px-4 py-2.5 transition"
              >
                {deleting ? 'Deleting…' : 'Delete all my data & account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Chat
