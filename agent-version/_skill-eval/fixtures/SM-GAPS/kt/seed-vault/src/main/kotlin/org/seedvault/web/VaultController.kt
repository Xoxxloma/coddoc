package org.seedvault.web

import org.seedvault.api.VaultApi
import org.seedvault.api.model.MoveDto
import org.seedvault.api.model.ShelfDto
import org.seedvault.api.model.SlotDto
import org.seedvault.service.VaultService
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.RestController

@RestController
class VaultController(private val vault: VaultService) : VaultApi {

    override fun listShelves(chamber: String?): ResponseEntity<List<ShelfDto>> = ResponseEntity.ok(vault.shelves(chamber))

    override fun getShelf(shelfId: Long): ResponseEntity<ShelfDto> = ResponseEntity.ok(vault.shelf(shelfId))

    // Перенос партии на другую полку; полка в камере с другой температурой — 409.
    @PreAuthorize("hasAnyRole('CURATOR','KEEPER')")
    override fun moveLot(moveDto: MoveDto): ResponseEntity<Unit> {
        vault.move(moveDto.lotId, moveDto.shelfId)
        return ResponseEntity.noContent().build()
    }

    // Бронь места на полке на 48 часов (seedvault.reservation-ttl-hours), потом её снимает ReservationSweeper.
    @PreAuthorize("hasAnyRole('CURATOR','KEEPER')")
    override fun reserveSlot(shelfId: Long): ResponseEntity<SlotDto> = ResponseEntity.ok(vault.reserve(shelfId))

    @PreAuthorize("hasAnyRole('CURATOR','KEEPER')")
    override fun releaseSlot(slotId: Long): ResponseEntity<Unit> {
        vault.release(slotId)
        return ResponseEntity.noContent().build()
    }
}
