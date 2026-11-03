package com.gchild.companion.domain

import com.gchild.companion.data.CommandType

/** Rencana eksekusi per tipe command. Tidak ada tipe yang dianggap sukses default. */
sealed interface CommandPlan {
    data object CollectAndReportStatus : CommandPlan

    data class ReportFailure(val code: String, val message: String) : CommandPlan
}

fun planFor(type: CommandType): CommandPlan = when (type) {
    CommandType.REQUEST_STATUS -> CommandPlan.CollectAndReportStatus

    // Kunci layar baru ada di tahap Device Admin. Menjalankan lockNow() belum
    // diimplementasikan, jadi perangkat harus melapor gagal, bukan sukses.
    CommandType.LOCK_SCREEN -> CommandPlan.ReportFailure(
        code = "NOT_IMPLEMENTED_IN_COMPANION",
        message = "Kunci layar (Device Admin) belum diimplementasikan di versi ini.",
    )

    CommandType.UNKNOWN -> CommandPlan.ReportFailure(
        code = "UNSUPPORTED_COMMAND",
        message = "Tipe command tidak dikenal oleh versi Companion ini.",
    )
}
