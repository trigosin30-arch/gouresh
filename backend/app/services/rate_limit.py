"""Minimal in-process sliding-window rate limiter.

Single-process only: a multi-worker deployment must use a shared store
(Redis) instead. This limitation is documented in SECURITY.md.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Deque, Dict, Tuple

from fastapi import HTTPException, Request, status

_lock = threading.Lock()
_hits: Dict[Tuple[str, str], Deque[float]] = {}
_last_cleanup = time.monotonic()


def _cleanup(now_ts: float) -> None:
    global _last_cleanup
    if now_ts - _last_cleanup < 300:
        return
    _last_cleanup = now_ts
    stale = [k for k, dq in _hits.items() if not dq or now_ts - dq[-1] > 3600]
    for key in stale:
        _hits.pop(key, None)


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"


def enforce(request: Request, bucket: str, limit: int, window_seconds: int) -> None:
    ts = time.monotonic()
    key = (bucket, client_ip(request))
    with _lock:
        _cleanup(ts)
        dq = _hits.setdefault(key, deque())
        cutoff = ts - window_seconds
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= limit:
            retry_after = max(1, int(window_seconds - (ts - dq[0])) + 1)
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"Too many requests. Please try again in {retry_after} seconds.",
                headers={"Retry-After": str(retry_after)},
            )
        dq.append(ts)


def reset() -> None:
    """Test helper."""
    with _lock:
        _hits.clear()
