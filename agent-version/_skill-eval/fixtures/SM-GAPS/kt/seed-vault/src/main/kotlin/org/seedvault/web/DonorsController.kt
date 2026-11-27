package org.seedvault.web

import org.seedvault.api.DonorsApi
import org.seedvault.api.model.DonorDto
import org.seedvault.api.model.MergeDto
import org.seedvault.api.model.NewDonorDto
import org.seedvault.service.DonorService
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.RestController

@RestController
class DonorsController(private val donors: DonorService) : DonorsApi {

    override fun listDonors(region: String?): ResponseEntity<List<DonorDto>> = ResponseEntity.ok(donors.list(region))

    override fun getDonor(donorId: Long): ResponseEntity<DonorDto> = ResponseEntity.ok(donors.get(donorId))

    @PreAuthorize("hasRole('CURATOR')")
    override fun registerDonor(newDonorDto: NewDonorDto): ResponseEntity<DonorDto> =
        ResponseEntity.status(201).body(donors.register(newDonorDto))

    // Слияние дублей: партии второго донора переходят первому, второй удаляется.
    @PreAuthorize("hasRole('ADMIN')")
    override fun mergeDonors(mergeDto: MergeDto): ResponseEntity<DonorDto> =
        ResponseEntity.ok(donors.merge(mergeDto.keepId, mergeDto.dropId))

    // Заблокированный донор не может сдавать новые партии; старые партии остаются.
    @PreAuthorize("hasRole('ADMIN')")
    override fun blockDonor(donorId: Long): ResponseEntity<Unit> {
        donors.block(donorId)
        return ResponseEntity.noContent().build()
    }
}
