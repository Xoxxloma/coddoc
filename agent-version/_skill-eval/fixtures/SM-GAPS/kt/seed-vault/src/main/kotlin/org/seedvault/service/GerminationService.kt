package org.seedvault.service

import org.seedvault.api.model.GerminationTestDto
import org.seedvault.domain.GerminationTest
import org.seedvault.domain.LotStatus
import org.seedvault.domain.TestStatus
import org.seedvault.repo.GerminationTestRepository
import org.seedvault.repo.SeedLotRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class GerminationService(private val tests: GerminationTestRepository, private val lots: SeedLotRepository) {
    fun start(lotId: Long): GerminationTestDto {
        val lot = lots.findById(lotId).orElseThrow { NotFound("партия $lotId") }
        lot.status = LotStatus.TESTING
        return dto(tests.save(GerminationTest(lotId = lotId)))
    }
    fun record(id: Long, day: Int, sprouted: Int): GerminationTestDto {
        if (day > 21) throw Invalid("тест длится не больше 21 дня")
        return dto(load(id).apply { this.day = day; this.sprouted = sprouted })
    }
    fun finish(id: Long): GerminationTestDto {
        val t = load(id).apply { status = TestStatus.FINISHED }
        val lot = lots.findById(t.lotId).orElseThrow { NotFound("партия ${t.lotId}") }
        lot.viability = t.sprouted
        lot.status = if (t.sprouted < 50) LotStatus.LOW_VIABILITY else LotStatus.ACTIVE
        return dto(t)
    }
    fun list(lotId: Long?) = (if (lotId == null) tests.findAll() else tests.findByLotId(lotId)).map(::dto)
    fun get(id: Long) = dto(load(id))
    fun cancel(id: Long) {
        val t = load(id).apply { status = TestStatus.CANCELLED }
        lots.findById(t.lotId).ifPresent { it.status = LotStatus.ACTIVE }
    }
    private fun load(id: Long) = tests.findById(id).orElseThrow { NotFound("тест $id") }
    private fun dto(t: GerminationTest) = GerminationTestDto(t.id!!, t.lotId, t.day, t.sprouted, t.status.name)
}
