package org.seedvault.web

import org.seedvault.service.LotService
import org.springframework.http.MediaType
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class ExportController(private val lots: LotService) {
    // Выгрузка всех партий в CSV для годового отчёта.
    @PreAuthorize("hasRole('ADMIN')")
    @GetMapping("/exports/lots.csv", produces = [MediaType.TEXT_PLAIN_VALUE])
    fun exportLots(): String = lots.csv()
}
