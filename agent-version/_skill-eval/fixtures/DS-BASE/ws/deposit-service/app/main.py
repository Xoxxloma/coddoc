import asyncio
import logging

from app import consumer, db


async def _serve() -> None:
    await db.init()
    await consumer.run()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    asyncio.run(_serve())


if __name__ == "__main__":
    main()
