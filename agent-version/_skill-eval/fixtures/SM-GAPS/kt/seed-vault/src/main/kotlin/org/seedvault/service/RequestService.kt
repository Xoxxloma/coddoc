package org.seedvault.service

import org.seedvault.api.model.NewRequestDto
import org.seedvault.api.model.SeedRequestDto
import org.seedvault.domain.RequestStatus
import org.seedvault.domain.SeedRequest
import org.seedvault.repo.SeedLotRepository
import org.seedvault.repo.SeedRequestRepository
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class RequestService(private val requests: SeedRequestRepository, private val lots: SeedLotRepository) {
    fun submit(d: NewRequestDto): SeedRequestDto {
        if (d.grams > 50) throw Invalid("не больше 50 г из одной партии")
        val me = SecurityContextHolder.getContext().authentication.name
        return dto(requests.save(SeedRequest(researcher = me, lotId = d.lotId, grams = d.grams)))
    }
    fun approve(id: Long) = dto(load(id).apply { status = RequestStatus.APPROVED })
    fun reject(id: Long, reason: String) = dto(load(id).apply { status = RequestStatus.REJECTED; this.reason = reason })
    fun ship(id: Long): SeedRequestDto {
        val r = load(id)
        if (r.status != RequestStatus.APPROVED) throw Conflict("заявка не одобрена")
        val lot = lots.findById(r.lotId).orElseThrow { NotFound("партия ${r.lotId}") }
        if ((lot.viability ?: 0) < 50) throw Conflict("всхожесть партии ниже 50 %")
        lot.grams -= r.grams
        r.status = RequestStatus.SHIPPED
        return dto(r)
    }
    fun list(status: String?) = (if (status == null) requests.findAll() else requests.findByStatus(RequestStatus.valueOf(status))).map(::dto)
    fun get(id: Long) = dto(load(id))
    fun cancel(id: Long) {
        val r = load(id)
        if (r.status == RequestStatus.SHIPPED) throw Conflict("уже отгружена")
        r.status = RequestStatus.CANCELLED
    }
    private fun load(id: Long) = requests.findById(id).orElseThrow { NotFound("заявка $id") }
    private fun dto(r: SeedRequest) = SeedRequestDto(r.id!!, r.researcher, r.lotId, r.grams, r.status.name, r.reason)
}
