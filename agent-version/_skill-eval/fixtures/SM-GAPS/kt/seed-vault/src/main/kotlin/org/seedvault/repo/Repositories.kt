package org.seedvault.repo

import org.seedvault.domain.*
import org.springframework.data.jpa.repository.JpaRepository

interface SeedLotRepository : JpaRepository<SeedLot, Long> {
    fun findByDonorId(donorId: Long): List<SeedLot>
}
interface ShelfRepository : JpaRepository<Shelf, Long>
interface SlotRepository : JpaRepository<Slot, Long> {
    fun deleteByReservedAtBefore(cutoff: java.time.Instant): Int
}
interface GerminationTestRepository : JpaRepository<GerminationTest, Long> {
    fun findByLotId(lotId: Long): List<GerminationTest>
}
interface DonorRepository : JpaRepository<Donor, Long>
interface SeedRequestRepository : JpaRepository<SeedRequest, Long> {
    fun findByStatus(status: org.seedvault.domain.RequestStatus): List<SeedRequest>
}
