package org.seedvault.service

import org.seedvault.api.model.DonorDto
import org.seedvault.api.model.NewDonorDto
import org.seedvault.domain.Donor
import org.seedvault.repo.DonorRepository
import org.seedvault.repo.SeedLotRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class DonorService(private val donors: DonorRepository, private val lots: SeedLotRepository) {
    fun list(region: String?) = donors.findAll().filter { region == null || it.region == region }.map(::dto)
    fun get(id: Long) = dto(load(id))
    fun register(d: NewDonorDto) = dto(donors.save(Donor(name = d.name, region = d.region)))
    fun merge(keepId: Long, dropId: Long): DonorDto {
        val keep = load(keepId); val drop = load(dropId)
        lots.findByDonorId(dropId).forEach { it.donorId = keepId }
        donors.delete(drop)
        return dto(keep)
    }
    fun block(id: Long) { load(id).blocked = true }
    private fun load(id: Long) = donors.findById(id).orElseThrow { NotFound("донор $id") }
    private fun dto(d: Donor) = DonorDto(d.id!!, d.name, d.region, d.blocked)
}
