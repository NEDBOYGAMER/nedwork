"""Shared WebSocket relay: TierForge rooms + site-wide notification pushes.

The relay is a separate asyncio process (or dev thread) beside the Flask
app. It reads the live SQLite database directly, but every connection is
opened with ``PRAGMA query_only = ON`` so a bug in the relay can never
write. The Flask app stays the only writer.
"""
