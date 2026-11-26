import asyncpg

from app import config

_pool: asyncpg.Pool | None = None


async def init() -> None:
    global _pool
    _pool = await asyncpg.create_pool(config.DB_DSN, min_size=1, max_size=5)


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("db.init() не вызван")
    return _pool
