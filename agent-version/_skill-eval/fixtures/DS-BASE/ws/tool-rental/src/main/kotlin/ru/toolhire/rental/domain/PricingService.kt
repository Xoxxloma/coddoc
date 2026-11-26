package ru.toolhire.rental.domain

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.time.Duration
import java.time.Instant

@Service
class PricingService(
    @Value("\${rental.daily-rate-rounding}") private val rounding: String,
) {
    fun billableDays(issuedAt: Instant, returnedAt: Instant): Long {
        val hours = Duration.between(issuedAt, returnedAt).toHours()
        val days = hours / 24
        return if (rounding == "up" && hours % 24 > 0) days + 1 else maxOf(days, 1)
    }
}
