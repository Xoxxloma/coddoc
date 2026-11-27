package org.seedvault.service

import org.seedvault.api.model.LotDto
import org.seedvault.api.model.NewLotDto
import org.seedvault.domain.LotStatus
import org.seedvault.domain.SeedLot
import org.seedvault.repo.DonorRepository
import org.seedvault.repo.SeedLotRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class LotService(private val lots: SeedLotRepository, private val donors: DonorRepository) {
    fun list(species: String?, page: Int) =
        lots.findAll().filter { species == null || it.species == species }.drop(page * 50).take(50).map(::dto)
    fun get(id: Long) = dto(load(id))
    fun create(d: NewLotDto): LotDto {
        val donor = donors.findById(d.donorId).orElseThrow { NotFound("донор ${d.donorId}") }
        if (donor.blocked) throw Conflict("донор заблокирован")
        return dto(lots.save(SeedLot(species = d.species, donorId = d.donorId, grams = d.grams)))
    }
    fun update(id: Long, d: NewLotDto) = dto(load(id).apply { species = d.species; grams = d.grams })
    fun retire(id: Long) { load(id).apply { grams = 0; status = LotStatus.RETIRED } }
    fun split(id: Long, grams: Long): List<LotDto> {
        if (grams < 5) throw Invalid("меньше 5 г")
        val src = load(id); if (src.grams <= grams) throw Invalid("в партии меньше")
        src.grams -= grams
        val part = lots.save(SeedLot(species = src.species, donorId = src.donorId, grams = grams, viability = src.viability))
        return listOf(dto(src), dto(part))
    }
    fun csv() = lots.findAll().joinToString("\n") { "${it.id};${it.species};${it.grams};${it.viability ?: ""}" }
    private fun load(id: Long) = lots.findById(id).orElseThrow { NotFound("партия $id") }
    private fun dto(l: SeedLot) = LotDto(l.id!!, l.species, l.grams, l.viability, l.status.name)
}
