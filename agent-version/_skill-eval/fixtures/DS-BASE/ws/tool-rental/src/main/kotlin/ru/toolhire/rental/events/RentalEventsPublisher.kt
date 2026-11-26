package ru.toolhire.rental.events

import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.kafka.core.KafkaTemplate
import org.springframework.stereotype.Component
import org.springframework.transaction.event.TransactionPhase
import org.springframework.transaction.event.TransactionalEventListener

@Component
class RentalEventsPublisher(
    private val kafka: KafkaTemplate<String, Any>,
    @Value("\${rental.events-topic}") private val topic: String,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun onReturned(event: RentalReturned) {
        kafka.send(topic, event.toolId, event).whenComplete { _, ex ->
            if (ex != null) {
                log.error("Не отправлено событие возврата rentalId={}", event.rentalId, ex)
            }
        }
    }
}
