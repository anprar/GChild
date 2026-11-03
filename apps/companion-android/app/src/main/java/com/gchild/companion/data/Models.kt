package com.gchild.companion.data

/** Tipe command yang dikenal; tipe baru dari server tidak ditebak. */
enum class CommandType(val wire: String) {
    REQUEST_STATUS("REQUEST_STATUS"),
    LOCK_SCREEN("LOCK_SCREEN"),
    UNKNOWN("");

    companion object {
        fun fromWire(value: String): CommandType =
            entries.firstOrNull { it.wire == value } ?: UNKNOWN
    }
}

data class ClaimResponse(
    val enrollmentId: String,
    val claimToken: String,
    val verificationCode: String,
    val status: String,
    val deviceLabel: String?,
)

data class EnrollmentStatus(
    val status: String,
    val deviceLabel: String?,
)

data class DeviceCommand(
    val commandId: String,
    val type: CommandType,
    val expiresAt: String,
)

data class AckResult(
    val state: String,
    val idempotent: Boolean,
)

data class StatusSnapshot(
    val batteryLevel: Int?,
    val charging: Boolean?,
    val networkConnected: Boolean?,
    val backendReachable: Boolean?,
    val screenInteractive: Boolean?,
    val keyguardLocked: Boolean?,
    val observedAt: String,
)

data class ApiError(val code: String, val message: String)
