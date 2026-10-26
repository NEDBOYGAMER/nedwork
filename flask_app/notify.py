"""Admin email notifications via the Resend HTTP API.

Fire-and-forget by design: a mail problem may never delay or break the
request that triggered it (registration / suggestion submission). Every
failure is logged once and swallowed.

Configuration is read from the environment AT SEND TIME:
  RESEND_API_KEY  - API key from the Resend dashboard;
                    unset = the whole feature is a silent no-op
  NOTIFY_EMAIL    - recipient (default: rico.fleming01@gmail.com)
  NOTIFY_FROM     - sender   (default: Nedwork Admin <admin@nedwork.ch>)

Also owns the HMAC decision-link tokens: registration emails carry a
deep link to /notify/pending/<id>?t=<token>; the token authorizes the
decision page instead of a console login (same trust pattern as
password-reset links). The signing secret lives in
instance/notify_secret.key, created once and never regenerated while
the file exists (regenerating would invalidate outstanding links).
"""

import hashlib
import hmac
import logging
import os
import secrets
import threading
from pathlib import Path

import requests
from flask import current_app

logger = logging.getLogger("nedwork.notify")

RESEND_URL = "https://api.resend.com/emails"
_REPLY_TO = "rico.fleming01@gmail.com"


# ------------------------------------------------------------------ tokens
def _secret() -> bytes:
    """The HMAC secret, created once into instance/notify_secret.key."""
    path = Path(current_app.instance_path) / "notify_secret.key"
    try:
        return path.read_bytes().strip()
    except FileNotFoundError:
        try:
            path.write_bytes(secrets.token_hex(32).encode("ascii"))
            path.chmod(0o600)   # no-op on Windows, correct on the server
        except FileExistsError:
            pass   # a concurrent worker won the race - use its file
        return path.read_bytes().strip()


def make_token(pending_id) -> str:
    """HMAC-SHA256 hex digest binding the token to this pending id."""
    return hmac.new(
        _secret(),
        f"pending:{pending_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def token_ok(pending_id, token) -> bool:
    """Constant-time token check; anything missing/tampered fails."""
    if not token:
        return False
    return hmac.compare_digest(make_token(pending_id), str(token))


# ------------------------------------------------------------------- mail
def notify(subject: str, html: str, text: str) -> None:
    """Queue one admin email. Never raises; without RESEND_API_KEY this
    is a guaranteed silent no-op (a hard deployment requirement)."""
    try:
        api_key = os.environ.get("RESEND_API_KEY", "")
        if not api_key:
            return

        to_addr = os.environ.get("NOTIFY_EMAIL", "rico.fleming01@gmail.com")
        from_addr = os.environ.get(
            "NOTIFY_FROM", "Nedwork Admin <admin@nedwork.ch>")

        payload = {
            "from": from_addr,
            "to": [to_addr],
            "subject": subject,
            "html": html,
            "text": text,
            "reply_to": _REPLY_TO,
        }
        thread = threading.Thread(target=_send, args=(api_key, payload), daemon=True)
        thread.start()
    except Exception:
        # even a bug here may only cost us the email, never the request
        logger.exception("notify() failed to queue an email")


def _send(api_key: str, payload: dict) -> None:
    """The actual POST, running off the request path. Failures are logged
    once and swallowed."""
    try:
        resp = requests.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
            timeout=10,
        )
        if resp.status_code != 200:
            logger.warning(
                "notify: Resend answered %s: %s",
                resp.status_code, resp.text[:200],
            )
    except Exception:
        logger.warning("notify: mail send failed", exc_info=True)
