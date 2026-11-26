package ru.toolhire.rental.domain

import org.springframework.context.ApplicationEventPublisher
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.toolhire.rental.events.RentalReturned
import java.time.Clock

@Service
class RentalService(
    private val repo: RentalRepository,
    private val events: ApplicationEventPublisher,
    private val clock: Clock,
) {
    @Transactional
    fun issue(id: String): Rental {
        val rental = repo.findById(id).orElseThrow { RentalNotFound(id) }
        check(rental.status == RentalStatus.BOOKED) { "Инструмент уже выдан или возвращён" }
        rental.status = RentalStatus.ISSUED
        rental.issuedAt = clock.instant()
        return repo.save(rental)
    }

    @Transactional
    fun returnTool(id: String, damaged: Boolean, damageNote: String?): Rental {
        val rental = repo.findById(id).orElseThrow { RentalNotFound(id) }
        check(rental.status == RentalStatus.ISSUED) { "Вернуть можно только выданный инструмент" }
        rental.status = RentalStatus.RETURNED
        rental.returnedAt = clock.instant()
        rental.damaged = damaged
        rental.damageNote = damageNote
        val saved = repo.save(rental)
        events.publishEvent(RentalReturned.from(saved))
        return saved
    }
}

class RentalNotFound(id: String) : RuntimeException("Аренда $id не найдена")
