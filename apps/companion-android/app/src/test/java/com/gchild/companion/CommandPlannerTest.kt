package com.gchild.companion

import com.gchild.companion.data.CommandType
import com.gchild.companion.domain.CommandPlan
import com.gchild.companion.domain.planFor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CommandPlannerTest {

    @Test
    fun `REQUEST_STATUS mengumpulkan dan mengirim status`() {
        assertEquals(CommandPlan.CollectAndReportStatus, planFor(CommandType.REQUEST_STATUS))
    }

    @Test
    fun `LOCK_SCREEN tidak pernah dianggap sukses`() {
        val plan = planFor(CommandType.LOCK_SCREEN)
        assertTrue(plan is CommandPlan.ReportFailure)
        val failure = plan as CommandPlan.ReportFailure
        assertEquals("NOT_IMPLEMENTED_IN_COMPANION", failure.code)
        assertTrue(failure.message.contains("belum diimplementasikan"))
    }

    @Test
    fun `tipe command tidak dikenal dilaporkan gagal`() {
        val plan = planFor(CommandType.UNKNOWN)
        assertTrue(plan is CommandPlan.ReportFailure)
        assertEquals("UNSUPPORTED_COMMAND", (plan as CommandPlan.ReportFailure).code)
    }

    @Test
    fun `wire command dipetakan tanpa menebak tipe baru`() {
        assertEquals(CommandType.REQUEST_STATUS, CommandType.fromWire("REQUEST_STATUS"))
        assertEquals(CommandType.LOCK_SCREEN, CommandType.fromWire("LOCK_SCREEN"))
        assertEquals(CommandType.UNKNOWN, CommandType.fromWire("REBOOT_DEVICE"))
    }
}
