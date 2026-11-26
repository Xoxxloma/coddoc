package ru.toolhire.catalog

import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import org.springframework.data.jpa.repository.JpaRepository

enum class ToolStatus { AVAILABLE, WRITTEN_OFF }

@Entity
class Tool(
    @Id val id: String,
    val title: String,
    var damageCount: Int = 0,
    @Enumerated(EnumType.STRING) var status: ToolStatus = ToolStatus.AVAILABLE,
)

interface ToolRepository : JpaRepository<Tool, String>
