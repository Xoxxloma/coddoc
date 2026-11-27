package org.seedvault.web

import org.seedvault.api.GerminationApi
import org.seedvault.api.model.CountDto
import org.seedvault.api.model.GerminationTestDto
import org.seedvault.api.model.NewTestDto
import org.seedvault.service.GerminationService
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.RestController

@RestController
class GerminationController(private val tests: GerminationService) : GerminationApi {

    // Тест всхожести: 100 семян из партии, партия на время теста помечена TESTING.
    @PreAuthorize("hasRole('LAB')")
    override fun startTest(newTestDto: NewTestDto): ResponseEntity<GerminationTestDto> =
        ResponseEntity.status(201).body(tests.start(newTestDto.lotId))

    // Подсчёт проросших за день; день теста больше 21 — 422.
    @PreAuthorize("hasRole('LAB')")
    override fun recordCount(testId: Long, countDto: CountDto): ResponseEntity<GerminationTestDto> =
        ResponseEntity.ok(tests.record(testId, countDto.day, countDto.sprouted))

    // Итог теста пишется в партию как всхожесть, в процентах; ниже 50 % партия уходит в статус LOW_VIABILITY.
    @PreAuthorize("hasRole('LAB')")
    override fun finishTest(testId: Long): ResponseEntity<GerminationTestDto> = ResponseEntity.ok(tests.finish(testId))

    override fun listTests(lotId: Long?): ResponseEntity<List<GerminationTestDto>> = ResponseEntity.ok(tests.list(lotId))

    override fun getTest(testId: Long): ResponseEntity<GerminationTestDto> = ResponseEntity.ok(tests.get(testId))

    @PreAuthorize("hasRole('LAB')")
    override fun cancelTest(testId: Long): ResponseEntity<Unit> {
        tests.cancel(testId)
        return ResponseEntity.noContent().build()
    }
}
