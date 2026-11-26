package ru.toolhire.catalog

import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
class WriteOffService(private val tools: ToolRepository) {

    @Transactional
    fun registerDamage(toolId: String) {
        val tool = tools.findById(toolId).orElseThrow()
        tool.damageCount += 1
        if (tool.damageCount >= MAX_DAMAGES) {
            tool.status = ToolStatus.WRITTEN_OFF
        }
        tools.save(tool)
    }

    companion object {
        const val MAX_DAMAGES = 3
    }
}
