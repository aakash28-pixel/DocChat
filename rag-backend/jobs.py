"""In-process background ingestion jobs.

A single worker thread serializes all ingestion work. This is deliberate:
the local ChromaDB store is SQLite-backed and must not be written by two
processes/threads concurrently. Uploads return immediately with a job_id;
the frontend polls /jobs/{id} for staged progress. If we later move to a
managed vector DB (Area 3), this swaps cleanly for a real queue (Celery/RQ).
"""

import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger("uvicorn.error")

# max_workers=1 → ingestion is serialized (safe for single-writer SQLite/Chroma)
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ingest")
_jobs: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()

_JOB_TTL_SECONDS = 3600  # keep finished jobs pollable for 1 hour

# queued → parsing → chunking → embedding → finalizing → ready (or error)
STAGE_LABELS = {
    "queued": "Queued…",
    "parsing": "Parsing pages…",
    "chunking": "Chunking text…",
    "embedding": "Building the index…",
    "finalizing": "Generating summary & questions…",
    "ready": "Ready",
    "error": "Failed",
}


def create_job(user_id: str, filename: str) -> str:
    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = {
            "id": job_id,
            "user_id": user_id,  # never returned to clients
            "filename": filename,
            "status": "queued",  # queued | processing | ready | error
            "stage": "queued",
            "progress": 0,
            "result": None,
            "error": None,
            "created_at": time.time(),
        }
    return job_id


def _update(job_id: str, **fields: Any) -> None:
    with _lock:
        if job_id in _jobs:
            _jobs[job_id].update(fields)


def get_job(job_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """Return a job ONLY if it belongs to the requesting user (IDOR protection)."""
    with _lock:
        job = _jobs.get(job_id)
        if not job or job["user_id"] != user_id:
            return None
        public = {k: v for k, v in job.items() if k != "user_id"}
    public["stage_label"] = STAGE_LABELS.get(public["stage"], public["stage"])
    return public


def _prune_expired() -> None:
    now = time.time()
    with _lock:
        stale = [
            jid
            for jid, j in _jobs.items()
            if j["status"] in ("ready", "error")
            and now - j["created_at"] > _JOB_TTL_SECONDS
        ]
        for jid in stale:
            del _jobs[jid]


def submit(job_id: str, work: Callable[[Callable[..., None]], Dict[str, Any]]) -> None:
    """Run `work(progress)` on the worker thread. `progress(stage, pct)` updates
    the job so the frontend's poll reflects real staged progress."""

    def progress(stage: str, pct: Optional[int] = None) -> None:
        fields: Dict[str, Any] = {"status": "processing", "stage": stage}
        if pct is not None:
            fields["progress"] = max(0, min(100, int(pct)))
        _update(job_id, **fields)

    def run() -> None:
        try:
            result = work(progress)
            _update(job_id, status="ready", stage="ready", progress=100, result=result)
        except ValueError as e:
            # expected, user-facing (corrupt PDF, too many pages, no text, …)
            _update(job_id, status="error", stage="error", error=str(e))
        except Exception:
            logger.exception("Ingestion job %s failed", job_id)
            _update(
                job_id,
                status="error",
                stage="error",
                error="Something went wrong while processing this document. Please try again.",
            )
        finally:
            _prune_expired()

    _executor.submit(run)
