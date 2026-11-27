package org.seedvault.jobs

import org.seedvault.service.VaultService
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
class ReservationSweeper(private val vault: VaultService) {
    // Каждый час снимает брони мест на полках старше seedvault.reservation-ttl-hours.
    @Scheduled(cron = "0 0 * * * *")
    fun sweep() = vault.dropExpiredReservations()
}
