import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

/**
 * Side panel that renders one page of a cited PDF with pdf.js.
 * viewer = { source: filename, page: number, snippet: string }
 */
function PdfViewer({ viewer, onClose, accessToken }) {
  const canvasRef = useRef(null)
  const pdfRef = useRef(null)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(viewer.page || 1)

  useEffect(() => {
    setPage(viewer.page || 1)
  }, [viewer])

  // Fetch the PDF (with auth) and open it
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setStatus('loading')
      try {
        const res = await fetch(
          `${API_BASE}/files/${encodeURIComponent(viewer.source)}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              // skip ngrok free-tier interstitial; inert elsewhere
              'ngrok-skip-browser-warning': 'true',
            },
          }
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buf = await res.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise
        if (cancelled) return
        pdfRef.current = pdf
        setNumPages(pdf.numPages)
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [viewer.source, accessToken])

  // Render the current page to the canvas
  useEffect(() => {
    if (status !== 'ready' || !pdfRef.current) return
    let cancelled = false
    const render = async () => {
      const pdf = pdfRef.current
      const pageNo = Math.min(Math.max(page, 1), pdf.numPages)
      const p = await pdf.getPage(pageNo)
      const viewport = p.getViewport({ scale: 1.3 })
      const canvas = canvasRef.current
      if (!canvas || cancelled) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    }
    render()
    return () => {
      cancelled = true
    }
  }, [status, page])

  return (
    <div className="w-full sm:w-[480px] sm:max-w-[45vw] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sm:bg-white/80 sm:dark:bg-slate-900/80 flex flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" title={viewer.source}>
            📄 {viewer.source}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Page {page}
            {numPages ? ` of ${numPages}` : ''}
          </p>
        </div>
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white disabled:text-slate-300 dark:disabled:text-slate-600 px-2 py-1 text-sm"
        >
          ‹
        </button>
        <button
          onClick={() => setPage((p) => Math.min(numPages || p + 1, p + 1))}
          disabled={numPages > 0 && page >= numPages}
          className="text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white disabled:text-slate-300 dark:disabled:text-slate-600 px-2 py-1 text-sm"
        >
          ›
        </button>
        <button
          onClick={onClose}
          title="Close viewer"
          className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white text-lg leading-none px-1"
        >
          ✕
        </button>
      </div>

      {viewer.snippet && (
        <div className="border-b border-slate-200 dark:border-slate-800 bg-indigo-50 dark:bg-indigo-950/40 px-4 py-2.5">
          <p className="text-xs text-indigo-800 italic dark:text-indigo-200 line-clamp-3">
            “…{viewer.snippet}…”
          </p>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 flex justify-center bg-slate-100/60 dark:bg-slate-950/60">
        {status === 'loading' && (
          <p className="text-sm text-slate-500 self-center animate-pulse">Loading PDF…</p>
        )}
        {status === 'error' && (
          <p className="text-sm text-red-600 dark:text-red-400 self-center px-6 text-center">
            This file is no longer available — it may have been deleted, or it
            was uploaded before the citation viewer existed (re-upload it once).
          </p>
        )}
        <canvas
          ref={canvasRef}
          className={`rounded shadow-2xl ${status === 'ready' ? '' : 'hidden'} max-w-full h-auto`}
        />
      </div>
    </div>
  )
}

export default PdfViewer
