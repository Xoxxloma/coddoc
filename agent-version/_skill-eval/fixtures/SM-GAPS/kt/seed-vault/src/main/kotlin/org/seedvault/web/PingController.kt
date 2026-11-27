package org.seedvault.web

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class PingController {
    @GetMapping("/internal/ping")
    fun ping(): Map<String, String> = mapOf("status" to "ok")
}
