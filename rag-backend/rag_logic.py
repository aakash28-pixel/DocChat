"""RAG pipeline: PDF extraction, chunking, ChromaDB vector store, retrieval + LLM answer."""

import json
import logging
import os
import uuid
from typing import Any, AsyncGenerator, Callable, Dict, List, Optional

import chromadb
import fitz  # PyMuPDF — handles multi-column layouts far better than PyPDF2
from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser

import supabase_client

load_dotenv()

logger = logging.getLogger("uvicorn.error")

CHROMA_DB_DIR = os.getenv("CHROMA_DB_DIR", "./chroma_db")
MAX_PDF_PAGES = int(os.getenv("MAX_PDF_PAGES", "300"))
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "60"))  # seconds per LLM call
COLLECTION_NAME = "documents"

# ChromaDB persistent client with its built-in local embedding function
# (all-MiniLM-L6-v2 via ONNX — no embedding API key needed).
_chroma_client = chromadb.PersistentClient(path=CHROMA_DB_DIR)
_collection = _chroma_client.get_or_create_collection(name=COLLECTION_NAME)

_text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    separators=["\n\n", "\n", ". ", " ", ""],
)


# ── PDF ingestion ─────────────────────────────────────────────────────


def extract_text_from_pdf(file_path: str) -> str:
    pages = []
    with fitz.open(file_path) as doc:
        for page in doc:
            # sort=True reassembles text in natural reading order, which keeps
            # multi-column layouts (e.g. device manuals) coherent
            pages.append(page.get_text("text", sort=True))
    return "\n".join(pages).strip()


def _ocr_page(page) -> str:
    """OCR a single page image via Tesseract. Returns '' on any failure."""
    try:
        import io

        import pytesseract
        from PIL import Image

        pix = page.get_pixmap(dpi=200)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        return pytesseract.image_to_string(img) or ""
    except Exception as e:
        logger.warning("OCR failed on page %s: %s", page.number + 1, e)
        return ""


def validate_pdf(file_path: str) -> int:
    """Fast, synchronous pre-check: is the file an openable PDF within the page
    limit? Returns the page count, or raises ValueError with a friendly message.
    Runs in the request so bad files fail fast before a job is queued."""
    try:
        doc = fitz.open(file_path)
    except Exception as e:
        logger.warning("Unreadable PDF: %s", e)
        raise ValueError(
            "This PDF appears to be corrupt or unreadable. Try re-exporting or re-scanning it."
        )
    with doc:
        n_pages = len(doc)
    if n_pages > MAX_PDF_PAGES:
        raise ValueError(
            f"This PDF has {n_pages} pages — the maximum is {MAX_PDF_PAGES}. "
            "Split it into smaller parts and upload those."
        )
    return n_pages


def process_pdf(
    file_path: str,
    filename: str,
    user_id: str,
    progress: Optional[Callable[..., None]] = None,
) -> Dict[str, Any]:
    """Extract, chunk, embed, and store a PDF in ChromaDB.

    Chunking happens per page so every chunk carries its page number for
    citations and click-to-view. Pages without an extractable text layer
    (scanned images) fall back to Tesseract OCR. `progress(stage, pct)` (if
    given) drives the ingestion status shown in the UI.
    """

    def _p(stage: str, pct: int) -> None:
        if progress:
            progress(stage, pct)

    pages: List[str] = []
    ocr_pages = 0
    try:
        pdf = fitz.open(file_path)
    except Exception as e:
        logger.warning("Unreadable PDF %r: %s", filename, e)
        raise ValueError(
            "This PDF appears to be corrupt or unreadable. Try re-exporting or re-scanning it."
        )
    with pdf as doc:
        total = len(doc)
        if total > MAX_PDF_PAGES:
            raise ValueError(
                f"This PDF has {total} pages — the maximum is {MAX_PDF_PAGES}. "
                "Split it into smaller parts and upload those."
            )
        # parse page-by-page so large PDFs report real progress (5% → 60%)
        for i, page in enumerate(doc):
            text = page.get_text("text", sort=True)
            if not text.strip():
                ocr_text = _ocr_page(page)
                if ocr_text.strip():
                    text = ocr_text
                    ocr_pages += 1
            pages.append(text)
            _p("parsing", 5 + int(55 * (i + 1) / max(total, 1)))

    if ocr_pages:
        logger.info("OCR used on %d/%d pages of %r", ocr_pages, len(pages), filename)

    if not any(p.strip() for p in pages):
        raise ValueError(
            "No text could be extracted from this PDF — not even with OCR. "
            "The scan quality may be too low."
        )

    _p("chunking", 65)
    chunks: List[str] = []
    metadatas: List[Dict[str, Any]] = []
    for page_no, page_text in enumerate(pages, start=1):
        for piece in _text_splitter.split_text(page_text):
            chunks.append(piece)
            metadatas.append(
                {
                    "source": filename,
                    "page": page_no,
                    "chunk": len(chunks) - 1,
                    "user_id": user_id,
                }
            )

    _p("embedding", 75)
    doc_id = uuid.uuid4().hex[:8]
    # embed in batches so very large documents stay responsive and bounded
    BATCH = 256
    ids = [f"{doc_id}-{i}" for i in range(len(chunks))]
    for start in range(0, len(chunks), BATCH):
        end = start + BATCH
        _collection.add(
            documents=chunks[start:end],
            ids=ids[start:end],
            metadatas=metadatas[start:end],
        )
        _p("embedding", 75 + int(15 * end / max(len(chunks), 1)))

    return {"filename": filename, "chunks_stored": len(chunks), "ocr_pages": ocr_pages}


# ── Retrieval + generation ────────────────────────────────────────────

_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are a highly capable and helpful multilingual AI assistant.\n"
            "Use the provided context to answer the user's question. Answer "
            "using ONLY the context below and the conversation so far — do not "
            "make things up.\n\n"
            "CRITICAL INSTRUCTION ON LANGUAGE: You MUST reply in the exact "
            "same language and script that the user uses in their question. "
            "If the user asks in Roman Urdu / Roman Hindi (e.g., words like "
            "'kaise', 'batao', 'samjhao'), you must read the English context, "
            "translate the concepts in your head, and generate your entire "
            "response in natural, conversational Roman Urdu. Do not reply in "
            "English if the user asks in Roman Urdu. The same rule applies to "
            "any other language: match the user's language and script exactly.\n\n"
            "If the context does not contain the answer, say so politely in "
            "the user's chosen language.\n\n"
            "CITATIONS: Each context passage below is numbered, e.g. [1], [2]. "
            "Whenever your answer uses information from a passage, append its "
            "marker right after the relevant sentence, e.g. 'The refund window "
            "is 30 days [1].' Use only numbers that exist in the context and "
            "never invent citations. Each marker must be a single number in "
            "its own brackets, like [1][3] — never a comma list like [1, 2, 3]. "
            "A citation marks exactly one thing: a sentence stating information "
            "you took from that numbered passage.\n"
            "OVERRIDING RULE — applies in every language and in both single- "
            "and multi-document mode: if the context does not contain the "
            "answer, your entire reply must contain ZERO citation markers. "
            "Never attach markers to a sentence that says the information is "
            "missing, unknown, or not mentioned.\n\n"
            "MULTIPLE DOCUMENTS: When the context contains passages from more "
            "than one document and they contribute to the answer, make clear "
            "which document each part comes from, e.g. 'According to "
            "policy.pdf, ... [2]'.\n\n"
            "Context:\n{context}",
        ),
        MessagesPlaceholder(variable_name="history"),
        ("human", "{question}"),
    ]
)

# How many past turns (user+ai pairs) the LLM sees; configurable via .env
MAX_HISTORY_TURNS = int(os.getenv("MAX_HISTORY_TURNS", "6"))
MAX_HISTORY_MESSAGES = MAX_HISTORY_TURNS * 2


def _format_history(history: Optional[List[Dict[str, str]]]) -> List[tuple]:
    """Convert [{role: 'user'|'ai', text: ...}] into LangChain message tuples."""
    formatted = []
    for msg in (history or [])[-MAX_HISTORY_MESSAGES:]:
        role = "human" if msg.get("role") == "user" else "ai"
        text = (msg.get("text") or "").strip()
        if text:
            formatted.append((role, text))
    return formatted


def _get_llm(max_retries: Optional[int] = None):
    provider = os.getenv("LLM_PROVIDER", "gemini").lower()
    api_key = os.getenv("LLM_API_KEY")
    if not api_key or api_key == "your_api_key_here":
        raise RuntimeError(
            "LLM_API_KEY is not set. Add your Gemini or Claude API key to rag-backend/.env"
        )

    kwargs: Dict[str, Any] = {"timeout": LLM_TIMEOUT}
    if max_retries is not None:
        kwargs["max_retries"] = max_retries

    if provider in ("claude", "anthropic"):
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(
            model=os.getenv("LLM_MODEL", "claude-opus-4-8"),
            api_key=api_key,
            max_tokens=2048,
            **kwargs,
        )

    # default: Gemini
    from langchain_google_genai import ChatGoogleGenerativeAI

    return ChatGoogleGenerativeAI(
        model=os.getenv("LLM_MODEL", "gemini-2.5-flash"),
        google_api_key=api_key,
        **kwargs,
    )


def _build_search_query(query: str, history: Optional[List[Dict[str, str]]]) -> str:
    """Fold recent user turns into the vector search so follow-ups like
    'how do I change it?' still retrieve the right chunks."""
    prev_user = [
        (m.get("text") or "").strip()
        for m in (history or [])
        if m.get("role") == "user"
    ][-2:]
    return " ".join([t for t in prev_user if t] + [query])


_EMPTY_INSIGHTS: Dict[str, Any] = {"summary": "", "questions": []}


def generate_document_insights(
    filename: str, user_id: str, n_questions: int = 4
) -> Dict[str, Any]:
    """One LLM call producing both a 3–5 sentence summary and starter questions
    for a freshly indexed document.

    Best-effort: returns empty values on any failure so uploads never break,
    but every failure is logged so it can be diagnosed.
    """
    try:
        found = _collection.get(
            where={"$and": [{"user_id": user_id}, {"source": filename}]},
            limit=8,
            include=["documents"],
        )
        docs = found.get("documents") or []
        if not docs:
            logger.warning("Document insights: no chunks found for %r", filename)
            return dict(_EMPTY_INSIGHTS)
        sample = "\n\n".join(docs)[:8000]

        prompt = (
            "Here is an excerpt from a document a user just uploaded:\n\n"
            f"{sample}\n\n"
            "Reply with ONLY valid JSON (no markdown fences, no extra text) in "
            "exactly this shape:\n"
            '{"summary": "<3-5 sentence summary of the document, in the '
            "document's own language>\", "
            '"questions": ["<q1>", "<q2>", ...]}\n'
            f"Include exactly {n_questions} short, natural questions (max 12 "
            "words each) a user might ask about this document, also in the "
            "document's own language."
        )
    except Exception as e:
        logger.warning("Document insights: setup failed for %r: %s", filename, e)
        return dict(_EMPTY_INSIGHTS)

    # One explicit retry; SDK-internal retries capped at 1 so a dead quota
    # can't stall the upload response for a minute of exponential backoff.
    for attempt in (1, 2):
        try:
            resp = _get_llm(max_retries=1).invoke(prompt)
            content = resp.content if isinstance(resp.content, str) else str(resp.content)
            # tolerate markdown fences or stray prose around the JSON object
            start, end = content.find("{"), content.rfind("}")
            data = json.loads(content[start : end + 1])
            summary = str(data.get("summary", "")).strip()
            questions = [
                str(q).strip() for q in data.get("questions", []) if str(q).strip()
            ][:n_questions]
            return {"summary": summary, "questions": questions}
        except Exception as e:
            if _is_quota_error(e):
                logger.warning(
                    "Document insights skipped for %r: LLM quota/rate limit "
                    "hit (attempt %d/2). Upload continues without summary/questions.",
                    filename, attempt,
                )
            else:
                logger.warning(
                    "Document insights: LLM call failed for %r (attempt %d/2): %s",
                    filename, attempt, e,
                )
    return dict(_EMPTY_INSIGHTS)


def delete_document(filename: str, user_id: str) -> int:
    """Remove all of ONE user's chunks for a document from the vector store.

    The user_id filter means a user can only ever delete their own chunks,
    even if another user has a document with the same filename.
    Returns the number of chunks removed.
    """
    where = {"$and": [{"user_id": user_id}, {"source": filename}]}
    found = _collection.get(where=where, include=[])
    ids = found.get("ids", [])
    if ids:
        _collection.delete(ids=ids)
    return len(ids)


def delete_all_user_chunks(user_id: str) -> int:
    """Remove every vector chunk belonging to a user (account deletion)."""
    found = _collection.get(where={"user_id": user_id}, include=[])
    ids = found.get("ids", [])
    if ids:
        _collection.delete(ids=ids)
    return len(ids)


def user_has_documents(user_id: str) -> bool:
    found = _collection.get(where={"user_id": user_id}, limit=1, include=[])
    return len(found.get("ids", [])) > 0


def retrieve_chunks(
    query: str, user_id: str, k: int = 8, doc_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    # Never ask for more results than the collection holds
    k = min(k, _collection.count())
    if k == 0:
        return []
    # user_id filter enforces tenant isolation: users only ever see their own chunks.
    # doc_id (the filename) optionally narrows search to one document.
    where = (
        {"$and": [{"user_id": user_id}, {"source": doc_id}]}
        if doc_id
        else {"user_id": user_id}
    )
    results = _collection.query(query_texts=[query], n_results=k, where=where)
    docs = results.get("documents", [[]])[0]
    metas = results.get("metadatas", [[]])[0]
    return [{"text": d, "metadata": m} for d, m in zip(docs, metas)]


def answer_query(
    query: str,
    user_id: str,
    history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """Non-streaming answer (kept for tests / simple clients)."""
    if not user_has_documents(user_id):
        return {
            "answer": "No documents have been uploaded yet. Please upload a PDF first.",
            "sources": [],
        }

    chunks = retrieve_chunks(_build_search_query(query, history), user_id)
    context, _ = _numbered_context(chunks)

    chain = _PROMPT | _get_llm() | StrOutputParser()
    answer = chain.invoke(
        {"context": context, "question": query, "history": _format_history(history)}
    )

    sources = sorted({c["metadata"].get("source", "unknown") for c in chunks})
    return {"answer": answer, "sources": sources}


def _is_quota_error(e: Exception) -> bool:
    s = f"{type(e).__name__}: {e}"
    return (
        "429" in s
        or "ResourceExhausted" in s
        or "quota" in s.lower()
        or "rate limit" in s.lower()
    )


def _numbered_context(chunks: List[Dict[str, Any]]):
    """Number retrieved chunks for inline citations.

    Returns the context block for the prompt and the citation metadata the
    frontend needs ({n, source, page, snippet}).
    """
    parts = []
    citations = []
    for i, c in enumerate(chunks, start=1):
        source = c["metadata"].get("source", "unknown")
        page = c["metadata"].get("page")
        page_label = f", page {page}" if page else ""
        parts.append(f"[{i}] (from {source}{page_label}):\n{c['text']}")
        citations.append(
            {
                "n": i,
                "source": source,
                "page": page,
                "snippet": c["text"][:180].strip(),
            }
        )
    return "\n\n---\n\n".join(parts), citations


def _sse(payload: Dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def stream_answer(
    query: str,
    user_id: str,
    history: Optional[List[Dict[str, str]]] = None,
    access_token: Optional[str] = None,
    doc_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Stream the answer as Server-Sent Events, then log the exchange to Supabase."""
    if not user_has_documents(user_id):
        msg = "No documents have been uploaded yet. Please upload a PDF first."
        yield _sse({"type": "token", "content": msg})
        yield _sse({"type": "done", "sources": []})
        return

    try:
        chunks = retrieve_chunks(_build_search_query(query, history), user_id, doc_id=doc_id)
        if not chunks:
            # e.g. scoped to a document that has no indexed chunks
            msg = "I couldn't find this in your documents."
            yield _sse({"type": "token", "content": msg})
            yield _sse({"type": "done", "sources": []})
            return
        context, citations = _numbered_context(chunks)
        sources = sorted({c["metadata"].get("source", "unknown") for c in chunks})

        chain = _PROMPT | _get_llm() | StrOutputParser()
        full_answer = ""
        async for token in chain.astream(
            {"context": context, "question": query, "history": _format_history(history)}
        ):
            if token:
                full_answer += token
                yield _sse({"type": "token", "content": token})

        yield _sse({"type": "done", "sources": sources, "citations": citations})

        # Token-usage log for per-user cost tracking. This is an estimate
        # (~4 chars/token) rather than exact provider metering — good enough
        # to compare relative cost per user; use the provider billing dashboard
        # for authoritative numbers.
        prompt_chars = len(context) + len(query)
        est_tokens = (prompt_chars + len(full_answer)) // 4
        logger.info(
            "llm_usage user=%s est_tokens=%d prompt_chars=%d answer_chars=%d doc=%s",
            user_id, est_tokens, prompt_chars, len(full_answer), doc_id or "ALL",
        )

        supabase_client.log_chat(
            user_id, query, full_answer, access_token, conversation_id, citations
        )
    except Exception as e:
        # Full provider error goes to the server log ONLY — never to the user
        logger.error("Chat generation failed (user %s): %s", user_id, e)
        if _is_quota_error(e):
            msg = (
                "The AI service is experiencing high demand right now "
                "(rate limit reached). Please try again shortly."
            )
        else:
            msg = (
                "The AI service is temporarily unavailable. "
                "Please try again in a minute."
            )
        yield _sse({"type": "error", "message": msg})
