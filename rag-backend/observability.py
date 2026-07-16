"""Structured logging + optional Sentry error tracking.

Both are env-gated so nothing changes locally until you opt in:
- LOG_FORMAT=json         → machine-parseable JSON logs (default: plain text)
- LOG_LEVEL=INFO          → log level
- SENTRY_DSN=<dsn>        → enable Sentry (free tier is fine for launch)
- ENVIRONMENT=production  → tags Sentry events
"""

import json
import logging
import os
import sys


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def setup_logging() -> None:
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    handler = logging.StreamHandler(sys.stdout)
    if os.getenv("LOG_FORMAT", "").lower() == "json":
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)


def init_sentry() -> bool:
    """Initialize Sentry if SENTRY_DSN is set. Returns True if enabled."""
    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        return False
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=dsn,
            environment=os.getenv("ENVIRONMENT", "development"),
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
            send_default_pii=False,  # never send user emails / tokens
        )
        return True
    except Exception as e:  # pragma: no cover - defensive
        logging.getLogger("uvicorn.error").warning("Sentry init failed: %s", e)
        return False
