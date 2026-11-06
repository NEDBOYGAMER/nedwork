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
import time
from pathlib import Path

import requests
from flask import current_app

logger = logging.getLogger("nedwork.notify")

RESEND_URL = "https://api.resend.com/emails"
_REPLY_TO = "rico.fleming01@gmail.com"


# ------------------------------------------------------------------- links
def base_url() -> str:
    """Canonical site URL for links inside emails.

    Never request.host_url: the Host header is client-controlled, so it
    would let a crafted registration request point our token-bearing
    approval link at someone else's server.
    """
    return os.environ.get("SITE_BASE_URL", "https://nedwork.ch").rstrip("/") + "/"


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


TOKEN_TTL = 7 * 24 * 3600   # an emailed decision link dies after a week


def _sign(pending_id, ts) -> str:
    return hmac.new(
        _secret(),
        f"pending:{pending_id}:{ts}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def make_token(pending_id) -> str:
    """HMAC-SHA256 over the pending id plus its issue timestamp, as
    "<ts>.<hex>". The timestamp bounds how long an emailed link works."""
    ts = int(time.time())
    return f"{ts}.{_sign(pending_id, ts)}"


def token_ok(pending_id, token) -> bool:
    """Constant-time token check; anything missing/tampered/expired fails."""
    if not token:
        return False
    try:
        ts_s, sig = str(token).split(".", 1)
        ts = int(ts_s)
    except ValueError:
        return False
    # reject far-future stamps too (a clock-skewed signer is not us)
    if time.time() - ts > TOKEN_TTL or ts - time.time() > 60:
        return False
    return hmac.compare_digest(_sign(pending_id, ts), sig)


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
