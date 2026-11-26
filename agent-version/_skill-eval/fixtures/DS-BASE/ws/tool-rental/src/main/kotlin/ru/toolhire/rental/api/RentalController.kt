package ru.toolhire.rental.api

import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import ru.toolhire.rental.domain.Rental
import ru.toolhire.rental.domain.RentalService
import java.time.Instant

@RestController
@RequestMapping("/api/rentals")
class RentalController(private val rentals: RentalService) {

    @PostMapping("/{id}/issue")
    fun issue(@PathVariable id: String): RentalView = RentalView.of(rentals.issue(id))

    @PostMapping("/{id}/return")
    fun returnTool(@PathVariable id: String, @RequestBody body: ReturnRequest): RentalView =
        RentalView.of(rentals.returnTool(id, body.damaged, body.damageNote))
}

data class ReturnRequest(val damaged: Boolean = false, val damageNote: String? = null)

data class RentalView(val id: String, val status: String, val returnedAt: Instant?) {
    companion object {
        fun of(r: Rental) = RentalView(r.id, r.status.name, r.returnedAt)
    }
}
