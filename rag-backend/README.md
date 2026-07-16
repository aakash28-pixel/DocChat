# RAG Document Q&A — Backend

FastAPI + LangChain + ChromaDB backend. Upload PDFs, then ask questions answered by an LLM (Gemini or Claude) using retrieved document chunks. Supabase provides auth (JWT required on all data endpoints), document metadata, and persistent chat history.

## Setup

1. Add your API key to `.env`:
   - `LLM_API_KEY` — your Gemini or Claude API key
   - `LLM_PROVIDER` — `gemini` (default) or `claude`
   - `SUPABASE_URL` / `SUPABASE_ANON_KEY` — from your Supabase project
   - `MAX_HISTORY_TURNS` — chat turns the LLM sees per request (default 6)
2. Dependencies live in `venv/`. To reinstall:
   ```bash
   ./venv/bin/pip install -r requirements.txt
   ```
3. OCR fallback for scanned PDFs requires Tesseract: `brew install tesseract`

## Run

```bash
cd rag-backend
./venv/bin/uvicorn main:app --reload --port 8000
```

## Endpoints (all except `/` require `Authorization: Bearer <supabase JWT>`)

- `POST /upload` — multipart PDF upload; per-page chunking with page numbers, OCR fallback for scanned pages, stores the PDF for the citation viewer, generates a summary + suggested questions (one LLM call), logs metadata to Supabase. Rate limit: 5/min.
- `POST /chat` — `{query, history, doc_id?, conversation_id?}`; streams the answer as SSE with inline citations; persists the exchange to `chat_history`. Rate limit: 15/min.
- `GET /files/{filename}` — serves the requesting user's own stored PDF (citation viewer).
- `DELETE /documents/{filename}` — removes the user's chunks, stored PDF, and Supabase record.

Embeddings are computed locally by ChromaDB (all-MiniLM-L6-v2) — no embedding API key needed. Only answer/summary generation uses `LLM_API_KEY`.

## ⚠️ API quota requirements

**Every chat message costs 1 LLM request, and every upload costs 1 extra LLM request** (combined document summary + suggested questions).

The **Gemini free tier is very limited** (e.g. ~20 requests/day on `gemini-2.5-flash` free tier) and will be exhausted quickly by normal use — expect a `429 ResourceExhausted` once it runs out. For real usage, enable billing on your Gemini key (or use a paid Claude key). Check usage at https://ai.dev/rate-limit.

Behavior when the provider rejects a call (quota/outage):

- **Chat**: the user sees a short friendly error bubble ("high demand… try again shortly" for 429s); the raw provider error is only written to the server log, and nothing is saved to `chat_history`.
- **Upload**: indexing still succeeds; the summary/suggested-questions step is skipped with a `Document insights skipped … quota/rate limit` warning in the server log.

## Tests

```bash
./venv/bin/pytest test_security.py -v
```

Covers auth enforcement, tenant isolation, per-document scoping, secure deletion, rate limiting, and LLM-error sanitization.
