"""Login throttling.

In-process, fixed-window counters for the two login endpoints. The goal is
only to make password guessing expensive: a legitimate user who fumbles a
password still gets several tries, and a successful login clears the
account's counter.

shortcut: per-process memory. Under a multi-process deployment each worker
keeps its own counters, so the effective limit multiplies by the worker
count; upgrade to a shared store (DB/redis) if this stops being enough.
"""
import threading
import time

WINDOW_SECONDS = 15 * 60
MAX_PER_ACCOUNT = 8     # failures per account per window
MAX_PER_IP = 40         # failures per IP per window (generous: behind a
                        # reverse proxy this key collapses to one value)
MAX_KEYS = 20_000       # hard bound so a spray cannot grow memory forever

_lock = threading.Lock()
_hits = {}              # key -> [first_ts, count]


def _key(scope, kind, value):
    return f"{scope}:{kind}:{value}"


def _bump(key, limit):
    """Register one failure. Returns False when the failure exceeds the
    limit for this window (i.e. the caller should be refused)."""
    now = time.monotonic()
    with _lock:
        if len(_hits) > MAX_KEYS:
            _hits.clear()
        entry = _hits.get(key)
        if entry is None or now - entry[0] >= WINDOW_SECONDS:
            _hits[key] = [now, 1]
            return True
        entry[1] += 1
        return entry[1] <= limit


def retry_after(scope, ip, account):
    """Seconds until the caller may try again, or 0 when not throttled."""
    now = time.monotonic()
    longest = 0.0
    with _lock:
        for key, limit in (
            (_key(scope, "ip", ip), MAX_PER_IP),
            (_key(scope, "account", account), MAX_PER_ACCOUNT),
        ):
            entry = _hits.get(key)
            if entry is not None and entry[1] >= limit:
                remaining = WINDOW_SECONDS - (now - entry[0])
                if remaining > 0:
                    longest = max(longest, remaining)
    return int(longest)


def fail(scope, ip, account):
    """Record a failed attempt; returns True when it may proceed."""
    ok_ip = _bump(_key(scope, "ip", ip), MAX_PER_IP)
    ok_account = True
    if account:
        ok_account = _bump(_key(scope, "account", account), MAX_PER_ACCOUNT)
    return ok_ip and ok_account


def clear(scope, account):
    """A successful login wipes the account counter (not the IP one — that
    one is there to cap spraying across many accounts)."""
    if not account:
        return
    with _lock:
        _hits.pop(_key(scope, "account", account), None)


def client_ip(request):
    """Remote address as seen by the server.

    X-Forwarded-For is deliberately NOT trusted: it is client-controlled
    without a ProxyFix, so trusting it would let an attacker rotate the
    key and skip the limit.
    """
    return request.remote_addr or "unknown"
