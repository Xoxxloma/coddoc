import json
import logging

from aiokafka import AIOKafkaConsumer

from app import config, deposits

log = logging.getLogger(__name__)


async def run() -> None:
    consumer = AIOKafkaConsumer(
        config.RENTAL_EVENTS_TOPIC,
        bootstrap_servers=config.KAFKA_BOOTSTRAP,
        group_id=config.KAFKA_GROUP_ID,
        enable_auto_commit=False,
        value_deserializer=lambda raw: json.loads(raw),
    )
    await consumer.start()
    try:
        async for msg in consumer:
            event = msg.value
            if event.get("type") == "RENTAL_RETURNED":
                await deposits.on_rental_returned(event)
            await consumer.commit()
    finally:
        await consumer.stop()
