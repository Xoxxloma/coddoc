package ru.toolhire.rental

import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.kafka.test.context.EmbeddedKafka
import ru.toolhire.rental.domain.RentalService

@SpringBootTest(properties = ["rental.events-topic=rental-events-test"])
@EmbeddedKafka(topics = ["rental-events-test"], partitions = 1)
class RentalEventsPublisherTest {

    @Autowired
    lateinit var rentals: RentalService

    @Test
    fun `возврат публикует событие в топик`() {
        rentals.returnTool("r-1", damaged = false, damageNote = null)
        // TODO: прочитать rental-events-test через KafkaTestUtils и сверить тело
    }
}
