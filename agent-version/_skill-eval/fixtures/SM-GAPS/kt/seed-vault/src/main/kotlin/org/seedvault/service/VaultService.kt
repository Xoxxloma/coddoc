package org.seedvault.service

import org.seedvault.api.model.ShelfDto
import org.seedvault.api.model.SlotDto
import org.seedvault.domain.Shelf
import org.seedvault.domain.Slot
import org.seedvault.repo.SeedLotRepository
import org.seedvault.repo.ShelfRepository
import org.seedvault.repo.SlotRepository
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Duration
import java.time.Instant

@Service
@Transactional
class VaultService(
    private val shelves: ShelfRepository,
    private val slots: SlotRepository,
    private val lots: SeedLotRepository,
    @Value("\${seedvault.reservation-ttl-hours}") private val ttlHours: Long,
) {
    fun shelves(chamber: String?) = shelves.findAll().filter { chamber == null || it.chamber == chamber }.map(::dto)
    fun shelf(id: Long) = dto(load(id))
    fun move(lotId: Long, shelfId: Long) {
        val lot = lots.findById(lotId).orElseThrow { NotFound("партия $lotId") }
        val to = load(shelfId)
        val from = lot.shelfId?.let(::load)
        if (from != null && from.temperature != to.temperature) throw Conflict("другая температура камеры")
        lot.shelfId = shelfId
    }
    fun reserve(shelfId: Long) = slots.save(Slot(shelfId = load(shelfId).id!!)).let { SlotDto(it.id!!, it.shelfId) }
    fun release(slotId: Long) = slots.deleteById(slotId)
    fun dropExpiredReservations() = slots.deleteByReservedAtBefore(Instant.now().minus(Duration.ofHours(ttlHours)))
    private fun load(id: Long) = shelves.findById(id).orElseThrow { NotFound("полка $id") }
    private fun dto(s: Shelf) = ShelfDto(s.id!!, s.chamber, s.temperature, s.capacity)
}
