package ru.toolhire.rental.domain

import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.math.BigDecimal
import java.time.Instant

enum class RentalStatus { BOOKED, ISSUED, RETURNED, OVERDUE }

@Entity
@Table(name = "rentals")
class Rental(
    @Id val id: String,
    val toolId: String,
    val customerId: String,
    @Enumerated(EnumType.STRING) var status: RentalStatus = RentalStatus.BOOKED,
    val plannedReturnAt: Instant,
    var issuedAt: Instant? = null,
    var returnedAt: Instant? = null,
    var damaged: Boolean = false,
    var damageNote: String? = null,
    val depositAmount: BigDecimal,
)
