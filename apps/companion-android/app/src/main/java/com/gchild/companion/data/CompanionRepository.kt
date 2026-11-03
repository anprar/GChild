package com.gchild.companion.data

import android.os.Build
import android.util.Base64
import com.gchild.companion.BuildConfig
import com.gchild.companion.domain.CommandPlan
import com.gchild.companion.domain.planFor
import java.security.SecureRandom
import java.time.Instant
import java.util.UUID

sealed interface PairOutcome {
    data class Claimed(
        val verificationCode: String,
        val deviceLabel: String,
        val enrollmentId: String,
    ) : PairOutcome

    data class Failed(val message: String) : PairOutcome
}

sealed interface ConsentOutcome {
    data object Accepted : ConsentOutcome
    data class Failed(val message: String) : ConsentOutcome
}

sealed interface ApprovalOutcome {
    data class Approved(val deviceLabel: String?) : ApprovalOutcome
    data class Waiting(val status: String) : ApprovalOutcome
    data class Closed(val message: String) : ApprovalOutcome
}

sealed interface SyncOutcome {
    data class Ok(val message: String, val snapshot: StatusSnapshot? = null) : SyncOutcome
    data class Failed(val message: String, val revoked: Boolean = false) : SyncOutcome
}

/**
 * Satu-satunya jalur yang menghubungi backend. Command tidak pernah dilaporkan
 * sukses tanpa ACK final yang diterima server, dan tipe yang belum didukung
 * dilaporkan gagal dengan kode terstruktur.
 */
class CompanionRepository(
    private val api: CompanionApi,
    private val secrets: SecretStore,
    private val local: LocalPairingStore,
    private val statusCollector: StatusCollector,
) {
    val serverConfigured: Boolean
        get() = api.isConfigured

    fun deviceLabel(): String? = local.deviceLabel

    fun pendingVerificationCode(): String? = secrets.get(KEY_VERIFICATION_CODE)

    fun hasPendingClaim(): Boolean =
        local.enrollmentId != null && !secrets.get(KEY_CLAIM_TOKEN).isNullOrBlank()

    fun hasActivePairing(): Boolean =
        local.enrollmentId != null && !secrets.get(KEY_DEVICE_SECRET).isNullOrBlank()

    suspend fun claim(code: String, label: String): PairOutcome {
        if (!serverConfigured) return PairOutcome.Failed(SERVER_NOT_CONFIGURED)

        val deviceSecret = randomSecret()
        return when (
            val result = api.claim(
                code = code,
                deviceSecret = deviceSecret,
                label = label,
                installationId = local.installationId,
                appVersion = BuildConfig.VERSION_NAME,
                sdkInt = Build.VERSION.SDK_INT,
            )
        ) {
            is ApiResult.Ok -> {
                secrets.put(KEY_DEVICE_SECRET, deviceSecret)
                secrets.put(KEY_CLAIM_TOKEN, result.value.claimToken)
                secrets.put(KEY_VERIFICATION_CODE, result.value.verificationCode)
                local.enrollmentId = result.value.enrollmentId
                local.deviceLabel = label
                PairOutcome.Claimed(result.value.verificationCode, label, result.value.enrollmentId)
            }

            is ApiResult.HttpError -> PairOutcome.Failed(httpMessage(result))
            is ApiResult.NetworkError -> PairOutcome.Failed(result.message)
            is ApiResult.InvalidResponse -> PairOutcome.Failed(result.message)
        }
    }

    suspend fun confirmLocal(accepted: Boolean): ConsentOutcome {
        val enrollmentId = local.enrollmentId
            ?: return ConsentOutcome.Failed("Belum ada permintaan pairing.")
        val claimToken = secrets.get(KEY_CLAIM_TOKEN)
            ?: return ConsentOutcome.Failed("Token enrollment hilang; ulangi pairing.")

        val result = api.confirmLocal(enrollmentId, claimToken, accepted)
        if (!accepted) {
            forgetDevice()
            return ConsentOutcome.Failed("Persetujuan lokal ditolak. Enrollment dibatalkan.")
        }

        return when (result) {
            is ApiResult.Ok -> ConsentOutcome.Accepted
            is ApiResult.HttpError -> {
                if (result.status == 410 || result.status == 409) forgetDevice()
                ConsentOutcome.Failed(httpMessage(result))
            }

            is ApiResult.NetworkError -> ConsentOutcome.Failed(result.message)
            is ApiResult.InvalidResponse -> ConsentOutcome.Failed(result.message)
        }
    }

    suspend fun checkApproval(): ApprovalOutcome {
        val enrollmentId = local.enrollmentId
            ?: return ApprovalOutcome.Closed("Belum ada permintaan pairing.")
        val claimToken = secrets.get(KEY_CLAIM_TOKEN)
            ?: return ApprovalOutcome.Closed("Token enrollment hilang; ulangi pairing.")

        return when (val result = api.getEnrollment(enrollmentId, claimToken)) {
            is ApiResult.Ok -> when (result.value.status) {
                "APPROVED" -> {
                    secrets.remove(KEY_CLAIM_TOKEN)
                    secrets.remove(KEY_VERIFICATION_CODE)
                    ApprovalOutcome.Approved(result.value.deviceLabel ?: local.deviceLabel)
                }

                "REJECTED", "EXPIRED" -> {
                    forgetDevice()
                    ApprovalOutcome.Closed("Permintaan pairing ${result.value.status.lowercase()}. Mulai pairing baru.")
                }

                else -> ApprovalOutcome.Waiting(result.value.status)
            }

            is ApiResult.HttpError -> ApprovalOutcome.Closed(httpMessage(result))
            is ApiResult.NetworkError -> ApprovalOutcome.Closed(result.message)
            is ApiResult.InvalidResponse -> ApprovalOutcome.Closed(result.message)
        }
    }

    suspend fun sendStatus(): SyncOutcome {
        val credential = secrets.get(KEY_DEVICE_SECRET)
            ?: return SyncOutcome.Failed("Perangkat belum dipasangkan.", revoked = true)

        val snapshot = statusCollector.snapshot(backendReachable = true)
        val body = CompanionJson.buildStatusBody(
            snapshot = snapshot,
            sequence = local.nextSequence(),
            appVersion = BuildConfig.VERSION_NAME,
        )

        return when (val result = api.postStatus(credential, body)) {
            is ApiResult.Ok -> SyncOutcome.Ok("Status terkirim ke server.", snapshot)
            is ApiResult.HttpError -> if (result.status == 401) {
                forgetDevice()
                SyncOutcome.Failed(
                    "Akses perangkat dicabut orang tua. Pairing ulang diperlukan.",
                    revoked = true,
                )
            } else {
                SyncOutcome.Failed(httpMessage(result))
            }

            is ApiResult.NetworkError -> SyncOutcome.Failed(result.message)
            is ApiResult.InvalidResponse -> SyncOutcome.Failed(result.message)
        }
    }

    suspend fun checkCommands(): SyncOutcome {
        val credential = secrets.get(KEY_DEVICE_SECRET)
            ?: return SyncOutcome.Failed("Perangkat belum dipasangkan.", revoked = true)

        return when (val result = api.fetchCommands(credential)) {
            is ApiResult.Ok -> {
                if (result.value.isEmpty()) {
                    SyncOutcome.Ok("Tidak ada perintah baru.")
                } else {
                    val notes = result.value.map { handleCommand(credential, it) }
                    SyncOutcome.Ok(notes.joinToString("\n"))
                }
            }

            is ApiResult.HttpError -> if (result.status == 401) {
                forgetDevice()
                SyncOutcome.Failed(
                    "Akses perangkat dicabut orang tua. Pairing ulang diperlukan.",
                    revoked = true,
                )
            } else {
                SyncOutcome.Failed(httpMessage(result))
            }

            is ApiResult.NetworkError -> SyncOutcome.Failed(result.message)
            is ApiResult.InvalidResponse -> SyncOutcome.Failed(result.message)
        }
    }

    fun forgetDevice() {
        secrets.clear()
        local.clear()
    }

    private suspend fun handleCommand(credential: String, command: DeviceCommand): String {
        val typeLabel = command.type.wire.ifEmpty { "tidak dikenal" }

        val expiresAt = runCatching { Instant.parse(command.expiresAt) }.getOrNull()
        if (expiresAt != null && !Instant.now().isBefore(expiresAt)) {
            api.ack(
                credential,
                command.commandId,
                CompanionJson.buildAckBody(
                    ackId = UUID.randomUUID().toString(),
                    status = "EXPIRED",
                    observedAt = Instant.now().toString(),
                ),
            )
            return "Perintah $typeLabel kedaluwarsa; tidak dijalankan."
        }

        val received = api.ack(
            credential,
            command.commandId,
            CompanionJson.buildAckBody(
                ackId = UUID.randomUUID().toString(),
                status = "RECEIVED",
                observedAt = Instant.now().toString(),
            ),
        )
        if (received !is ApiResult.Ok) {
            return "Perintah $typeLabel: gagal ACK RECEIVED (${errorText(received)}). Tidak dieksekusi."
        }

        return when (val plan = planFor(command.type)) {
            CommandPlan.CollectAndReportStatus -> executeStatusCommand(credential, command, typeLabel)

            is CommandPlan.ReportFailure -> {
                // State machine mewajibkan EXECUTING sebelum FAILED. Lock tidak
                // dijalankan sama sekali; hasilnya jujur "gagal".
                api.ack(
                    credential,
                    command.commandId,
                    CompanionJson.buildAckBody(
                        ackId = UUID.randomUUID().toString(),
                        status = "EXECUTING",
                        observedAt = Instant.now().toString(),
                    ),
                )
                val failed = api.ack(
                    credential,
                    command.commandId,
                    CompanionJson.buildAckBody(
                        ackId = UUID.randomUUID().toString(),
                        status = "FAILED",
                        observedAt = Instant.now().toString(),
                        errorCode = plan.code,
                        errorMessage = plan.message,
                    ),
                )
                if (failed is ApiResult.Ok) {
                    "Perintah $typeLabel dilaporkan gagal: ${plan.message}"
                } else {
                    "Perintah $typeLabel: gagal melaporkan hasil (${errorText(failed)})."
                }
            }
        }
    }

    private suspend fun executeStatusCommand(
        credential: String,
        command: DeviceCommand,
        typeLabel: String,
    ): String {
        val executing = api.ack(
            credential,
            command.commandId,
            CompanionJson.buildAckBody(
                ackId = UUID.randomUUID().toString(),
                status = "EXECUTING",
                observedAt = Instant.now().toString(),
            ),
        )
        if (executing !is ApiResult.Ok) {
            return "Perintah $typeLabel: gagal ACK EXECUTING (${errorText(executing)}). Tidak dieksekusi."
        }

        val snapshot = statusCollector.snapshot(backendReachable = true)
        val post = api.postStatus(
            credential,
            CompanionJson.buildStatusBody(
                snapshot = snapshot,
                sequence = local.nextSequence(),
                appVersion = BuildConfig.VERSION_NAME,
            ),
        )
        if (post !is ApiResult.Ok) {
            api.ack(
                credential,
                command.commandId,
                CompanionJson.buildAckBody(
                    ackId = UUID.randomUUID().toString(),
                    status = "FAILED",
                    observedAt = Instant.now().toString(),
                    errorCode = "STATUS_REPORT_FAILED",
                    errorMessage = errorText(post),
                ),
            )
            return "Perintah $typeLabel: gagal mengirim status (${errorText(post)})."
        }

        val finalAck = api.ack(
            credential,
            command.commandId,
            CompanionJson.buildAckBody(
                ackId = UUID.randomUUID().toString(),
                status = "SUCCEEDED",
                observedAt = Instant.now().toString(),
                result = mapOf("source" to "android", "note" to "snapshot dikirim"),
            ),
        )
        return if (finalAck is ApiResult.Ok) {
            "Status dikirim dan perintah dilaporkan berhasil."
        } else {
            "Status terkirim, tetapi ACK final gagal (${errorText(finalAck)})."
        }
    }

    private fun errorText(result: ApiResult<*>): String = when (result) {
        is ApiResult.Ok -> ""
        is ApiResult.HttpError -> "${result.code} (HTTP ${result.status})"
        is ApiResult.NetworkError -> result.message
        is ApiResult.InvalidResponse -> result.message
    }

    private fun httpMessage(error: ApiResult.HttpError): String = when (error.status) {
        400 -> error.message
        401 -> "Akses tidak valid atau sudah dicabut."
        409 -> error.message
        410 -> "Kode atau pairing sudah kedaluwarsa."
        429 -> "Terlalu banyak percobaan. Coba lagi nanti."
        else -> error.message
    }

    private fun randomSecret(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return Base64.encodeToString(
            bytes,
            Base64.NO_WRAP or Base64.NO_PADDING or Base64.URL_SAFE,
        )
    }

    private companion object {
        const val KEY_DEVICE_SECRET = "device_secret"
        const val KEY_CLAIM_TOKEN = "claim_token"
        const val KEY_VERIFICATION_CODE = "verification_code"
        const val SERVER_NOT_CONFIGURED =
            "Server belum dikonfigurasi pada build ini. Hubungi pengelola build."
    }
}
