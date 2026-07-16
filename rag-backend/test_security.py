"""Security test suite for the RAG backend.

Run with:  ./venv/bin/pytest test_security.py -v

Covers:
- Endpoints reject requests with no token (401)
- Endpoints reject garbage / forged / expired tokens (401)
- Health endpoint stays public
- ChromaDB tenant isolation: user A can never retrieve user B's chunks
- (optional) authenticated streaming smoke test if TEST_USER_EMAIL /
  TEST_USER_PASSWORD env vars point at a real Supabase user
"""

import datetime
import os
import shutil
import tempfile

# Use an isolated vector store so tests never touch the live chroma_db
_TEST_DB = tempfile.mkdtemp(prefix="chroma_test_")
os.environ["CHROMA_DB_DIR"] = _TEST_DB

import jwt  # PyJWT, installed with supabase
import pytest
from fastapi.testclient import TestClient

import main
import rag_logic

client = TestClient(main.app)


def _forged_jwt(expired: bool = False) -> str:
    """A well-formed JWT signed with the WRONG secret (and optionally expired)."""
    now = datetime.datetime.now(datetime.timezone.utc)
    exp = now - datetime.timedelta(hours=1) if expired else now + datetime.timedelta(hours=1)
    payload = {
        "iss": "supabase",
        "sub": "11111111-1111-1111-1111-111111111111",
        "role": "authenticated",
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, "not-the-real-secret", algorithm="HS256")


# ── 1. Public endpoints ───────────────────────────────────────────────


def test_health_is_public():
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ── 2. Missing token → 401 ────────────────────────────────────────────


def test_chat_without_token_is_rejected():
    r = client.post("/chat", json={"query": "hello"})
    assert r.status_code == 401


def test_upload_without_token_is_rejected():
    r = client.post("/upload", files={"file": ("x.pdf", b"%PDF-1.4", "application/pdf")})
    assert r.status_code == 401


def test_chat_with_malformed_header_is_rejected():
    r = client.post(
        "/chat", json={"query": "hello"}, headers={"Authorization": "Token abc123"}
    )
    assert r.status_code == 401


# ── 3. Fake / forged / expired tokens → 401 ───────────────────────────


def test_chat_with_garbage_token_is_rejected():
    r = client.post(
        "/chat",
        json={"query": "hello"},
        headers={"Authorization": "Bearer totally-not-a-jwt"},
    )
    assert r.status_code == 401


def test_chat_with_forged_jwt_is_rejected():
    r = client.post(
        "/chat",
        json={"query": "hello"},
        headers={"Authorization": f"Bearer {_forged_jwt()}"},
    )
    assert r.status_code == 401


def test_chat_with_expired_jwt_is_rejected():
    r = client.post(
        "/chat",
        json={"query": "hello"},
        headers={"Authorization": f"Bearer {_forged_jwt(expired=True)}"},
    )
    assert r.status_code == 401


def test_upload_with_forged_jwt_is_rejected():
    r = client.post(
        "/upload",
        files={"file": ("x.pdf", b"%PDF-1.4", "application/pdf")},
        headers={"Authorization": f"Bearer {_forged_jwt()}"},
    )
    assert r.status_code == 401


# ── 4. ChromaDB tenant isolation ──────────────────────────────────────


def _make_pdf(text: str) -> str:
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 80), text, fontsize=11)
    path = os.path.join(_TEST_DB, f"{abs(hash(text))}.pdf")
    doc.save(path)
    return path


def test_users_cannot_retrieve_each_others_chunks():
    user_a, user_b = "user-a-0000", "user-b-0000"
    rag_logic.process_pdf(_make_pdf("Alpha secret: the launch code is 4242."), "a.pdf", user_a)
    rag_logic.process_pdf(_make_pdf("Beta note: the meeting is on Friday."), "b.pdf", user_b)

    a_results = rag_logic.retrieve_chunks("launch code", user_a)
    b_results = rag_logic.retrieve_chunks("launch code", user_b)

    assert all(c["metadata"]["user_id"] == user_a for c in a_results)
    assert all(c["metadata"]["user_id"] == user_b for c in b_results)
    # user B must never see user A's content, even when asking for it directly
    assert not any("4242" in c["text"] for c in b_results)
    # and user A does find their own secret
    assert any("4242" in c["text"] for c in a_results)


def test_doc_id_scopes_retrieval_to_one_document():
    """When a doc_id (filename) is selected, retrieval must only return that file's chunks."""
    user = "doc-scope-user"
    rag_logic.process_pdf(_make_pdf("Invoice total: 500 dollars."), "invoice.pdf", user)
    rag_logic.process_pdf(_make_pdf("Contract term: two years."), "contract.pdf", user)

    scoped = rag_logic.retrieve_chunks("what is the total?", user, doc_id="invoice.pdf")
    assert scoped, "scoped retrieval should return chunks"
    assert all(c["metadata"]["source"] == "invoice.pdf" for c in scoped)

    # global search (no doc_id) still sees both files
    global_results = rag_logic.retrieve_chunks("total and term", user)
    sources = {c["metadata"]["source"] for c in global_results}
    assert sources == {"invoice.pdf", "contract.pdf"}


def test_delete_document_requires_auth():
    r = client.delete("/documents/anything.pdf")
    assert r.status_code == 401


def test_users_cannot_delete_each_others_documents():
    """Deleting a filename you don't own must be a no-op on the owner's data."""
    owner, attacker = "del-owner-0000", "del-attacker-0000"
    rag_logic.process_pdf(
        _make_pdf("Owner secret: the vault combination is 9-9-9."), "delme.pdf", owner
    )

    # attacker tries to delete the owner's document by filename
    assert rag_logic.delete_document("delme.pdf", attacker) == 0
    # owner's chunks are fully intact
    remaining = rag_logic.retrieve_chunks("vault combination", owner, doc_id="delme.pdf")
    assert any("9-9-9" in c["text"] for c in remaining)

    # the owner CAN delete it, and then it's gone
    assert rag_logic.delete_document("delme.pdf", owner) > 0
    assert rag_logic.retrieve_chunks("vault combination", owner, doc_id="delme.pdf") == []


def test_user_with_no_documents_sees_none():
    assert rag_logic.user_has_documents("ghost-user-0000") is False
    assert rag_logic.retrieve_chunks("anything", "ghost-user-0000") == []


def test_non_pdf_content_fails_magic_byte_check():
    """A file with a .pdf name but non-PDF bytes is rejected before parsing."""
    fake_user = main.AuthedUser(id="magic-test-user", email="m@test.local", token="t")
    main.app.dependency_overrides[main.get_current_user] = lambda: fake_user
    try:
        r = client.post(
            "/upload",
            files={"file": ("fake.pdf", b"this is not a real pdf at all", "application/pdf")},
            headers={"Authorization": "Bearer magic-bucket"},
        )
        assert r.status_code == 422
        assert "not a valid PDF" in r.json()["detail"]
    finally:
        main.app.dependency_overrides.clear()


def test_corrupt_pdf_returns_friendly_422():
    """Correct magic bytes but garbage body → friendly corrupt-file error."""
    fake_user = main.AuthedUser(id="corrupt-test-user", email="c@test.local", token="t")
    main.app.dependency_overrides[main.get_current_user] = lambda: fake_user
    try:
        r = client.post(
            "/upload",
            files={"file": ("broken.pdf", b"%PDF-1.7 garbage garbage garbage", "application/pdf")},
            headers={"Authorization": "Bearer corrupt-bucket"},
        )
        assert r.status_code == 422
        assert "corrupt or unreadable" in r.json()["detail"]
    finally:
        main.app.dependency_overrides.clear()


def test_page_count_limit_enforced(monkeypatch):
    monkeypatch.setattr(rag_logic, "MAX_PDF_PAGES", 2)
    import fitz

    doc = fitz.open()
    for i in range(3):
        page = doc.new_page()
        page.insert_text((50, 80), f"Page {i + 1}")
    path = os.path.join(_TEST_DB, "toolong.pdf")
    doc.save(path)

    import pytest as _pytest

    with _pytest.raises(ValueError, match="maximum is 2"):
        rag_logic.process_pdf(path, "toolong.pdf", "pagelimit-user")


def test_users_cannot_poll_each_others_jobs():
    """A job created by user A must be invisible to user B (IDOR)."""
    import jobs

    job_id = jobs.create_job("job-owner-0000", "x.pdf")
    assert jobs.get_job(job_id, "job-owner-0000") is not None
    assert jobs.get_job(job_id, "job-attacker-0000") is None
    # the public job dict never leaks the owner's user_id
    assert "user_id" not in jobs.get_job(job_id, "job-owner-0000")

    # via the endpoint: attacker gets 404
    attacker = main.AuthedUser(id="job-attacker-0000", email="a@test.local", token="t")
    main.app.dependency_overrides[main.get_current_user] = lambda: attacker
    try:
        r = client.get(f"/jobs/{job_id}")
        assert r.status_code == 404
    finally:
        main.app.dependency_overrides.clear()


def test_users_cannot_fetch_each_others_files():
    """/files/{name} must only serve the requesting user's own uploads (IDOR)."""
    owner_dir = os.path.join(main.UPLOAD_DIR, "file-owner-0000")
    os.makedirs(owner_dir, exist_ok=True)
    with open(os.path.join(owner_dir, "private.pdf"), "wb") as f:
        f.write(b"%PDF-1.4 owner data")
    try:
        attacker = main.AuthedUser(id="file-attacker-0000", email="a@test.local", token="t")
        main.app.dependency_overrides[main.get_current_user] = lambda: attacker

        # same filename, different user → must 404, never the owner's bytes
        r = client.get("/files/private.pdf")
        assert r.status_code == 404
        # path traversal attempt must not escape the attacker's directory
        r = client.get("/files/..%2Ffile-owner-0000%2Fprivate.pdf")
        assert r.status_code == 404

        # the owner CAN fetch their own file
        owner = main.AuthedUser(id="file-owner-0000", email="o@test.local", token="t")
        main.app.dependency_overrides[main.get_current_user] = lambda: owner
        r = client.get("/files/private.pdf")
        assert r.status_code == 200
    finally:
        main.app.dependency_overrides.clear()
        shutil.rmtree(owner_dir, ignore_errors=True)


# ── 5. LLM provider errors must never leak to the user ────────────────


def _collect_stream(user_id: str, query: str = "hello"):
    import asyncio

    async def run():
        events = []
        async for sse in rag_logic.stream_answer(query, user_id):
            import json as _json

            events.append(_json.loads(sse[6:].strip()))
        return events

    return asyncio.get_event_loop().run_until_complete(run())


def test_llm_quota_error_streams_friendly_message(monkeypatch):
    rag_logic.process_pdf(_make_pdf("Error handling test doc."), "err.pdf", "err-user")

    raw_429 = (
        "429 You exceeded your current quota. "
        '{"quota_metric": "generate_requests_per_day", "retry_delay": {"seconds": 3}}'
    )

    def boom(max_retries=None):
        raise RuntimeError(raw_429)

    monkeypatch.setattr(rag_logic, "_get_llm", boom)
    events = _collect_stream("err-user")

    errors = [e for e in events if e["type"] == "error"]
    assert errors, "an error event should be streamed"
    msg = errors[0]["message"]
    assert "quota_metric" not in msg and "retry_delay" not in msg, "raw error leaked"
    assert "high demand" in msg  # 429-specific friendly message
    assert not any(e["type"] == "done" for e in events), "failed answer must not complete"


def test_llm_generic_error_streams_friendly_message(monkeypatch):
    def boom(max_retries=None):
        raise RuntimeError("Connection reset by provider: ssl handshake failure xyz")

    monkeypatch.setattr(rag_logic, "_get_llm", boom)
    events = _collect_stream("err-user")

    errors = [e for e in events if e["type"] == "error"]
    assert errors
    assert "temporarily unavailable" in errors[0]["message"]
    assert "ssl handshake" not in errors[0]["message"], "raw error leaked"


# ── 6. Rate limiting ──────────────────────────────────────────────────


def test_chat_rate_limit_kicks_in_at_16th_request():
    """15 requests/minute are allowed on /chat; the 16th must return 429."""
    fake_user = main.AuthedUser(
        id="rate-limit-test-user", email="rl@test.local", token="test-token"
    )
    main.app.dependency_overrides[main.get_current_user] = lambda: fake_user
    try:
        statuses = []
        for _ in range(16):
            r = client.post("/chat", json={"query": "ping"})
            statuses.append(r.status_code)
        assert statuses[:15] == [200] * 15, f"first 15 should pass, got {statuses}"
        assert statuses[15] == 429, f"16th request should be 429, got {statuses[15]}"
    finally:
        main.app.dependency_overrides.clear()


def test_upload_rate_limit_kicks_in_at_6th_request():
    """5 requests/minute are allowed on /upload; the 6th must return 429."""
    fake_user = main.AuthedUser(
        id="rate-limit-test-user-2", email="rl2@test.local", token="test-token-2"
    )
    main.app.dependency_overrides[main.get_current_user] = lambda: fake_user
    try:
        statuses = []
        for _ in range(6):
            # a .txt upload is rejected with 400 — but still counts against the limit,
            # which is exactly what we want to verify without parsing 6 real PDFs
            r = client.post(
                "/upload",
                files={"file": ("x.txt", b"not a pdf", "text/plain")},
                headers={"Authorization": "Bearer upload-bucket"},
            )
            statuses.append(r.status_code)
        assert statuses[:5] == [400] * 5, f"first 5 should reach the endpoint, got {statuses}"
        assert statuses[5] == 429, f"6th request should be 429, got {statuses[5]}"
    finally:
        main.app.dependency_overrides.clear()


# ── 6. Optional: authenticated streaming smoke test ───────────────────


@pytest.mark.skipif(
    not (os.getenv("TEST_USER_EMAIL") and os.getenv("TEST_USER_PASSWORD")),
    reason="Set TEST_USER_EMAIL and TEST_USER_PASSWORD to run the live streaming test",
)
def test_authenticated_chat_streams_sse():
    from supabase import create_client
    import supabase_client as sc

    sb = create_client(sc.SUPABASE_URL, sc.SUPABASE_ANON_KEY)
    session = sb.auth.sign_in_with_password(
        {"email": os.environ["TEST_USER_EMAIL"], "password": os.environ["TEST_USER_PASSWORD"]}
    ).session

    with client.stream(
        "POST",
        "/chat",
        json={"query": "hello"},
        headers={"Authorization": f"Bearer {session.access_token}"},
    ) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        body = "".join(r.iter_text())
        assert 'data: {"type"' in body
