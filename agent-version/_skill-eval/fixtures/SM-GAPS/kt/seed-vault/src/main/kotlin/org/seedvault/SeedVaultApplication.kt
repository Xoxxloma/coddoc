package org.seedvault

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.scheduling.annotation.EnableScheduling

@SpringBootApplication
@EnableScheduling
class SeedVaultApplication

fun main(args: Array<String>) {
    runApplication<SeedVaultApplication>(*args)
}
