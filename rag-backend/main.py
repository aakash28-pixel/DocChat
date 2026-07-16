"""FastAPI server exposing the RAG pipeline: POST /upload and streaming POST /chat.

Both endpoints require a valid Supabase JWT (Authorization: Bearer <token>).
The user's identity always comes from the validated token — never from the
request body — so one user can never read or write another user's data.
"""

import os
import re
import shutil
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

import jobs
import observability
import rag_logic
import supabase_client

observability.setup_logging()
SENTRY_ENABLED = observability.init_sentry()

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "25"))

# Comma-separated list of allowed frontend origins; set to your production
# domain(s) when deploying, e.g. "https://docchat.app,https://www.docchat.app"
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000",
    ).split(",")
    if o.strip()
]

# Free-tier usage limits (per authenticated user). slowapi accepts multiple
# limits separated by ';' — burst limit + daily quota.
CHAT_RATE_LIMIT = os.getenv("CHAT_RATE_LIMIT", "15/minute;150/day")
UPLOAD_RATE_LIMIT = os.getenv("UPLOAD_RATE_LIMIT", "5/minute;20/day")


def rate_limit_key(request: Request) -> str:
    """Rate-limit per authenticated user (their bearer token); fall back to IP."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return get_remote_address(request)


limiter = Limiter(key_func=rate_limit_key)

app = FastAPI(title="RAG Document Q&A API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Allow the React (Vite) frontend to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # meaningful once served over HTTPS in production; harmless on localhost
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


class ChatRequest(BaseModel):
    query: str = Field(..., max_length=4000)
    history: List[Dict[str, str]] = Field(default_factory=list, max_length=60)
    doc_id: Optional[str] = Field(None, max_length=300)  # filename scope
    conversation_id: Optional[str] = Field(None, max_length=64)  # conversations.id


class AuthedUser(BaseModel):
    id: str
    email: Optional[str] = None
    token: str


def get_current_user(authorization: Optional[str] = Header(None)) -> AuthedUser:
    """FastAPI dependency: reject any request without a valid Supabase JWT."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401, detail="Missing Authorization: Bearer <token> header."
        )
    token = authorization[7:].strip()
    if not supabase_client.is_configured():
        raise HTTPException(
            status_code=503,
            detail="Authentication unavailable: Supabase is not configured on the server.",
        )
    user = supabase_client.validate_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return AuthedUser(id=user["id"], email=user.get("email"), token=token)


def _health_payload():
    return {
        "status": "ok",
        "message": "RAG backend is running",
        "supabase_configured": supabase_client.is_configured(),
        "sentry_enabled": SENTRY_ENABLED,
    }


@app.get("/")
def root():
    return _health_payload()


@app.get("/health")
def health():
    """Uptime-monitor endpoint."""
    return _health_payload()


@app.post("/upload", status_code=202)
@limiter.limit(UPLOAD_RATE_LIMIT)
async def upload_pdf(
    request: Request,
    file: UploadFile = File(...),
    user: AuthedUser = Depends(get_current_user),
):
    """Validate the file synchronously (fast, so bad files fail immediately),
    then queue the heavy parse/OCR/chunk/embed work as a background job.
    Returns a job_id the client polls via GET /jobs/{id}."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    # Sanitize the name: basename strips paths; the regex strips anything exotic.
    safe_name = re.sub(r"[^\w .()\[\]-]", "_", os.path.basename(file.filename))[:200]
    if not safe_name.lower().endswith(".pdf"):
        safe_name += ".pdf"
    user_dir = os.path.join(UPLOAD_DIR, user.id)
    os.makedirs(user_dir, exist_ok=True)
    dest_path = os.path.join(user_dir, safe_name)

    # ── synchronous validation (cheap, returns a proper HTTP error) ──
    with open(dest_path, "wb") as out:
        shutil.copyfileobj(file.file, out)
    with open(dest_path, "rb") as f:
        if f.read(5) != b"%PDF-":
            os.remove(dest_path)
            raise HTTPException(
                status_code=422,
                detail="This file is not a valid PDF (content check failed).",
            )
    size_mb = os.path.getsize(dest_path) / (1024 * 1024)
    if size_mb > MAX_UPLOAD_MB:
        os.remove(dest_path)
        raise HTTPException(
            status_code=413,
            detail=f"File is too large ({size_mb:.1f} MB). Maximum is {MAX_UPLOAD_MB} MB.",
        )
    try:
        rag_logic.validate_pdf(dest_path)  # openable + within page limit
    except ValueError as e:
        os.remove(dest_path)
        raise HTTPException(status_code=422, detail=str(e))

    # ── queue the heavy work ──
    uid, token = user.id, user.token
    job_id = jobs.create_job(uid, safe_name)

    def work(progress):
        try:
            result = rag_logic.process_pdf(dest_path, safe_name, uid, progress=progress)
            progress("finalizing", 92)
            insights = rag_logic.generate_document_insights(safe_name, uid)
            supabase_client.log_document(
                user_id=uid,
                filename=safe_name,
                chunks=result["chunks_stored"],
                access_token=token,
                summary=insights["summary"],
                ocr_pages=result["ocr_pages"],
            )
            return {
                "filename": safe_name,
                "summary": insights["summary"],
                "suggested_questions": insights["questions"],
                **result,
            }
        except Exception:
            if os.path.exists(dest_path):
                os.remove(dest_path)
            raise

    jobs.submit(job_id, work)
    return {"job_id": job_id, "status": "queued", "filename": safe_name}


@app.get("/jobs/{job_id}")
def job_status(job_id: str, user: AuthedUser = Depends(get_current_user)):
    """Poll an ingestion job's status. Scoped to the requesting user (IDOR-safe)."""
    job = jobs.get_job(job_id, user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


@app.get("/files/{filename}")
def get_file(filename: str, user: AuthedUser = Depends(get_current_user)):
    """Serve one of the requesting user's own uploaded PDFs (for the citation viewer)."""
    safe_name = os.path.basename(filename)
    path = os.path.join(UPLOAD_DIR, user.id, safe_name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(path, media_type="application/pdf", filename=safe_name)


@app.delete("/documents/{filename}")
def delete_document(filename: str, user: AuthedUser = Depends(get_current_user)):
    """Delete one of the requesting user's documents: vector chunks, stored PDF,
    and the Supabase record. Strictly scoped to the authenticated user."""
    safe_name = os.path.basename(filename)
    chunks_removed = rag_logic.delete_document(safe_name, user.id)
    pdf_path = os.path.join(UPLOAD_DIR, user.id, safe_name)
    if os.path.isfile(pdf_path):
        os.remove(pdf_path)
    supabase_client.delete_document(user.id, safe_name, user.token)
    return {"deleted": safe_name, "chunks_removed": chunks_removed}


@app.delete("/account")
def delete_account(user: AuthedUser = Depends(get_current_user)):
    """Permanently delete ALL of the requesting user's data: vector chunks,
    uploaded PDFs, and Postgres rows. If a service-role key is configured, the
    auth account itself is deleted too (which cascades the DB rows)."""
    chunks = rag_logic.delete_all_user_chunks(user.id)

    user_dir = os.path.join(UPLOAD_DIR, user.id)
    if os.path.isdir(user_dir):
        shutil.rmtree(user_dir, ignore_errors=True)

    account_deleted = supabase_client.delete_auth_user(user.id)
    if not account_deleted:
        # no service-role key → at least wipe the user's rows via their token
        supabase_client.delete_all_user_rows(user.id, user.token)

    return {
        "data_deleted": True,
        "chunks_removed": chunks,
        "account_deleted": account_deleted,
    }


@app.post("/chat")
@limiter.limit(CHAT_RATE_LIMIT)
async def chat(
    request: Request,
    payload: ChatRequest,
    user: AuthedUser = Depends(get_current_user),
):
    query = payload.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    return StreamingResponse(
        rag_logic.stream_answer(
            query=query,
            user_id=user.id,
            history=payload.history,
            access_token=user.token,
            doc_id=payload.doc_id,
            conversation_id=payload.conversation_id,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
