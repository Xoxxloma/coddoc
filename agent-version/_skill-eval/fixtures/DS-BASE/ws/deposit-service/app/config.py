import os

KAFKA_BOOTSTRAP = os.environ["KAFKA_BOOTSTRAP"]
RENTAL_EVENTS_TOPIC = os.environ["RENTAL_EVENTS_TOPIC"]
KAFKA_GROUP_ID = os.environ.get("KAFKA_GROUP_ID", "deposit-service")
DB_DSN = os.environ["DB_DSN"]
