"""Supabase integration: logs document metadata and chat history.

All functions are graceful no-ops when Supabase env vars aren't configured,
so the core RAG pipeline keeps working without a Supabase project.
"""

import logging
import os
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("uvicorn.error")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
# Optional: enables full auth-account deletion. Server-side only — never expose.
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def is_configured() -> bool:
    return SUPABASE_URL.startswith("http") and len(SUPABASE_ANON_KEY) > 20


def delete_all_user_rows(user_id: str, access_token: Optional[str] = None) -> None:
    """Delete a user's Postgres rows (documents, conversations, chat_history).
    Used when full auth-account deletion isn't configured; RLS scopes it to the
    requesting user."""
    client = _get_client(access_token)
    if client is None:
        return
    for table in ("chat_history", "conversations", "documents"):
        try:
            client.table(table).delete().eq("user_id", user_id).execute()
        except Exception as e:
            logger.warning("Deleting %s rows for user failed: %s", table, e)


def delete_auth_user(user_id: str) -> bool:
    """Permanently delete the auth user (cascades all Postgres rows via FK).
    Requires SUPABASE_SERVICE_ROLE_KEY. Returns True if the account was deleted."""
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        return False
    try:
        from supabase import create_client

        admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        admin.auth.admin.delete_user(user_id)
        return True
    except Exception as e:
        logger.warning("Auth account deletion failed: %s", e)
        return False


def validate_token(access_token: str) -> Optional[dict]:
    """Validate a Supabase JWT against the auth server.

    Returns {"id": ..., "email": ...} for a valid token, None otherwise.
    Signature, expiry, and revocation are all checked by Supabase itself.
    """
    if not is_configured() or not access_token:
        return None
    try:
        from supabase import create_client

        client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        response = client.auth.get_user(access_token)
        user = getattr(response, "user", None)
        if user and user.id:
            return {"id": user.id, "email": user.email}
    except Exception as e:
        logger.info("Token validation failed: %s", e)
    return None


def _get_client(access_token: Optional[str] = None):
    """Create a Supabase client authenticated as the requesting user (for RLS)."""
    if not is_configured():
        return None
    from supabase import create_client

    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    if access_token:
        # Act as the signed-in user so Row Level Security policies apply
        client.postgrest.auth(access_token)
    return client


def log_document(
    user_id: Optional[str],
    filename: str,
    chunks: int,
    access_token: Optional[str] = None,
    summary: Optional[str] = None,
    ocr_pages: int = 0,
) -> None:
    if not user_id:
        return
    try:
        client = _get_client(access_token)
        if client is None:
            return
        row = {
            "user_id": user_id,
            "filename": filename,
            "chunks": chunks,
            "ocr_pages": ocr_pages,
        }
        if summary:
            row["summary"] = summary
        client.table("documents").insert(row).execute()
    except Exception as e:
        logger.warning("Supabase document log failed: %s", e)


def delete_document(
    user_id: str, filename: str, access_token: Optional[str] = None
) -> None:
    try:
        client = _get_client(access_token)
        if client is None:
            return
        client.table("documents").delete().eq("user_id", user_id).eq(
            "filename", filename
        ).execute()
    except Exception as e:
        logger.warning("Supabase document delete failed: %s", e)


def log_chat(
    user_id: Optional[str],
    query: str,
    answer: str,
    access_token: Optional[str] = None,
    conversation_id: Optional[str] = None,
    citations: Optional[list] = None,
) -> None:
    if not user_id or not answer:
        return
    try:
        client = _get_client(access_token)
        if client is None:
            return
        # IDOR hardening: only attach messages to a conversation the requesting
        # user actually owns (RLS makes other users' conversations invisible here)
        if conversation_id:
            owned = (
                client.table("conversations")
                .select("id")
                .eq("id", conversation_id)
                .limit(1)
                .execute()
            )
            if not owned.data:
                logger.warning(
                    "Ignoring conversation_id not owned by user %s", user_id
                )
                conversation_id = None
        rows = [
            {"user_id": user_id, "role": "user", "content": query},
            {"user_id": user_id, "role": "ai", "content": answer, "citations": citations},
        ]
        if conversation_id:
            for row in rows:
                row["conversation_id"] = conversation_id
        client.table("chat_history").insert(rows).execute()
        if conversation_id:
            from datetime import datetime, timezone

            client.table("conversations").update(
                {"updated_at": datetime.now(timezone.utc).isoformat()}
            ).eq("id", conversation_id).execute()
    except Exception as e:
        logger.warning("Supabase chat log failed: %s", e)
