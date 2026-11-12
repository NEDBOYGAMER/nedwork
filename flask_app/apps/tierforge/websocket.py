"""Compatibility entry point for the shared WebSocket relay.

The relay itself now lives in ``flask_app/ws/`` and serves both the
TierForge rooms and ``/ws/notifications``. This module is kept so the
existing Docker entry point
(``python -m flask_app.apps.tierforge.websocket``) needs no compose
change; move the entry point to ``flask_app.ws`` as a separate change.
"""
import os

from flask_app.ws.server import run_server

__all__ = ["run_server"]


if __name__ == "__main__":
    run_server(
        os.environ.get("TIERFORGE_WS_HOST", "0.0.0.0"),
        int(os.environ.get("TIERFORGE_WS_PORT", "5001")),
    )
