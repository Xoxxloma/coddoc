import uuid

import asyncpg

REVIEW_QUEUE = "damage"


async def create_task(conn: asyncpg.Connection, hold_id: str, rental_id: str) -> None:
    await conn.execute(
        "INSERT INTO review_tasks (id, hold_id, rental_id, queue) VALUES ($1, $2, $3, $4)",
        str(uuid.uuid4()),
        hold_id,
        rental_id,
        REVIEW_QUEUE,
    )
