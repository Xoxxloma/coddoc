package ru.toolhire.rental.events

import ru.toolhire.rental.domain.Rental
import java.math.BigDecimal
import java.time.Instant

data class RentalReturned(
    val type: String = "RENTAL_RETURNED",
    val rentalId: String,
    val toolId: String,
    val customerId: String,
    val returnedAt: Instant,
    val damaged: Boolean,
    val depositAmount: BigDecimal,
) {
    companion object {
        fun from(r: Rental) = RentalReturned(
            rentalId = r.id,
            toolId = r.toolId,
            customerId = r.customerId,
            returnedAt = requireNotNull(r.returnedAt),
            damaged = r.damaged,
            depositAmount = r.depositAmount,
        )
    }
}
