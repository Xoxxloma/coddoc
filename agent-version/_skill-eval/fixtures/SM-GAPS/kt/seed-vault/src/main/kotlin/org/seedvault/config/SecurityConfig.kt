package org.seedvault.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.web.SecurityFilterChain

// Вход — HTTP Basic против таблицы пользователей; роли CURATOR, KEEPER, LAB, ADMIN, остальные — исследователи.
@Configuration
@EnableMethodSecurity
class SecurityConfig {
    @Bean
    fun filterChain(http: HttpSecurity): SecurityFilterChain = http
        .csrf { it.disable() }
        .authorizeHttpRequests {
            it.requestMatchers("/internal/ping").permitAll()
            it.anyRequest().authenticated()
        }
        .httpBasic { }
        .build()
}
