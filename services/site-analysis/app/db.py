"""Synchronous psycopg3 connection pool — matches the legacy `pg.Pool` and the
sync-route + threadpool model (RUNBOOK_v3 §2.5). Pool sized >= the analysis
concurrency cap so concurrent analyses never starve.
"""
from __future__ import annotations
from psycopg_pool import ConnectionPool
from . import config

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        if not config.DATABASE_URL:
            raise RuntimeError("DATABASE_URL not set")
        _pool = ConnectionPool(
            conninfo=config.DATABASE_URL,
            min_size=1,
            max_size=max(4, config.MAX_CONCURRENT_ANALYSES),
            open=True,
        )
    return _pool


def db_available() -> bool:
    # Mirrors the legacy dbAvailable(): presence check only, no connectivity ping.
    return bool(config.DATABASE_URL)
