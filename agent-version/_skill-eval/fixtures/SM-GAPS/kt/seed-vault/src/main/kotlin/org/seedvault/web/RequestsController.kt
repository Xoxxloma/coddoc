package org.seedvault.web

import org.seedvault.api.RequestsApi
import org.seedvault.api.model.NewRequestDto
import org.seedvault.api.model.RejectDto
import org.seedvault.api.model.SeedRequestDto
import org.seedvault.service.RequestService
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.RestController

@RestController
class RequestsController(private val requests: RequestService) : RequestsApi {

    // Заявка исследователя на семена: не больше 50 г из одной партии.
    override fun submitRequest(newRequestDto: NewRequestDto): ResponseEntity<SeedRequestDto> =
        ResponseEntity.status(201).body(requests.submit(newRequestDto))

    @PreAuthorize("hasRole('CURATOR')")
    override fun approveRequest(requestId: Long): ResponseEntity<SeedRequestDto> = ResponseEntity.ok(requests.approve(requestId))

    @PreAuthorize("hasRole('CURATOR')")
    override fun rejectRequest(requestId: Long, rejectDto: RejectDto): ResponseEntity<SeedRequestDto> =
        ResponseEntity.ok(requests.reject(requestId, rejectDto.reason))

    // Отгрузка списывает вес с партии; партии со всхожестью ниже 50 % не отгружаются — 409.
    @PreAuthorize("hasRole('KEEPER')")
    override fun shipRequest(requestId: Long): ResponseEntity<SeedRequestDto> = ResponseEntity.ok(requests.ship(requestId))

    override fun listRequests(status: String?): ResponseEntity<List<SeedRequestDto>> = ResponseEntity.ok(requests.list(status))

    override fun getRequest(requestId: Long): ResponseEntity<SeedRequestDto> = ResponseEntity.ok(requests.get(requestId))

    override fun cancelRequest(requestId: Long): ResponseEntity<Unit> {
        requests.cancel(requestId)
        return ResponseEntity.noContent().build()
    }
}
