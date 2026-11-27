package org.seedvault.domain

import jakarta.persistence.*
import java.time.Instant

enum class LotStatus { ACTIVE, TESTING, LOW_VIABILITY, RETIRED }
enum class TestStatus { RUNNING, FINISHED, CANCELLED }
enum class RequestStatus { SUBMITTED, APPROVED, REJECTED, SHIPPED, CANCELLED }

@Entity
@Table(name = "lots")
class SeedLot(
    @Id @GeneratedValue var id: Long? = null,
    var species: String = "",
    var donorId: Long = 0,
    var grams: Long = 0,
    var viability: Int? = null,
    var shelfId: Long? = null,
    @Enumerated(EnumType.STRING) var status: LotStatus = LotStatus.ACTIVE,
)

@Entity
@Table(name = "shelves")
class Shelf(
    @Id @GeneratedValue var id: Long? = null,
    var chamber: String = "",
    var temperature: Int = -18,
    var capacity: Int = 40,
)

@Entity
@Table(name = "slots")
class Slot(
    @Id @GeneratedValue var id: Long? = null,
    var shelfId: Long = 0,
    var reservedAt: Instant = Instant.now(),
)

@Entity
@Table(name = "germination_tests")
class GerminationTest(
    @Id @GeneratedValue var id: Long? = null,
    var lotId: Long = 0,
    var day: Int = 0,
    var sprouted: Int = 0,
    @Enumerated(EnumType.STRING) var status: TestStatus = TestStatus.RUNNING,
)

@Entity
@Table(name = "donors")
class Donor(
    @Id @GeneratedValue var id: Long? = null,
    var name: String = "",
    var region: String = "",
    var blocked: Boolean = false,
)

@Entity
@Table(name = "seed_requests")
class SeedRequest(
    @Id @GeneratedValue var id: Long? = null,
    var researcher: String = "",
    var lotId: Long = 0,
    var grams: Long = 0,
    var reason: String? = null,
    @Enumerated(EnumType.STRING) var status: RequestStatus = RequestStatus.SUBMITTED,
)
