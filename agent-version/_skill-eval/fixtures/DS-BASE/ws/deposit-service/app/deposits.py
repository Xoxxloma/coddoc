import logging

from app import db, review

log = logging.getLogger(__name__)


async def on_rental_returned(event: dict) -> None:
    rental_id = event["rentalId"]
    async with db.pool().acquire() as conn:
        async with conn.transaction():
            hold = await conn.fetchrow(
                "SELECT id, status FROM deposit_holds WHERE rental_id = $1 FOR UPDATE",
                rental_id,
            )
            if hold is None:
                log.warning("Нет залога для аренды %s — пропускаю", rental_id)
                return
            if hold["status"] != "HELD":
                return
            if event["damaged"]:
                await conn.execute(
                    "UPDATE deposit_holds SET status = 'ON_REVIEW' WHERE id = $1",
                    hold["id"],
                )
                await review.create_task(conn, hold["id"], rental_id)
            else:
                await conn.execute(
                    "UPDATE deposit_holds SET status = 'RELEASED', released_at = now() WHERE id = $1",
                    hold["id"],
                )
