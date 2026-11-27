package org.seedvault.web

import org.seedvault.api.LotsApi
import org.seedvault.api.model.LotDto
import org.seedvault.api.model.NewLotDto
import org.seedvault.api.model.SplitDto
import org.seedvault.service.LotService
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.RestController

@RestController
class LotsController(private val lots: LotService) : LotsApi {

    override fun listLots(species: String?, page: Int?): ResponseEntity<List<LotDto>> =
        ResponseEntity.ok(lots.list(species, page ?: 0))

    override fun getLot(lotId: Long): ResponseEntity<LotDto> = ResponseEntity.ok(lots.get(lotId))

    @PreAuthorize("hasRole('CURATOR')")
    override fun createLot(newLotDto: NewLotDto): ResponseEntity<LotDto> =
        ResponseEntity.status(201).body(lots.create(newLotDto))

    @PreAuthorize("hasRole('CURATOR')")
    override fun updateLot(lotId: Long, newLotDto: NewLotDto): ResponseEntity<LotDto> =
        ResponseEntity.ok(lots.update(lotId, newLotDto))

    // Списание партии: вес обнуляется, партия остаётся в истории со статусом RETIRED.
    @PreAuthorize("hasRole('CURATOR')")
    override fun retireLot(lotId: Long): ResponseEntity<Unit> {
        lots.retire(lotId)
        return ResponseEntity.noContent().build()
    }

    // Делит партию на две: новая получает указанный вес, у исходной он вычитается; меньше 5 г — 422.
    @PreAuthorize("hasRole('CURATOR')")
    override fun splitLot(lotId: Long, splitDto: SplitDto): ResponseEntity<List<LotDto>> =
        ResponseEntity.ok(lots.split(lotId, splitDto.grams))
}
