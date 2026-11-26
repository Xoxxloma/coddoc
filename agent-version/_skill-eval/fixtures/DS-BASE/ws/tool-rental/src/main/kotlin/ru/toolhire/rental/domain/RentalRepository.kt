package ru.toolhire.rental.domain

import org.springframework.data.jpa.repository.JpaRepository

interface RentalRepository : JpaRepository<Rental, String>
