package com.gchild.companion.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * JSON murni (org.json) tanpa ketergantungan Android, supaya bisa diuji di JVM.
 * Nilai yang tidak diketahui tetap dikirim sebagai null, bukan 0/false.
 */
object CompanionJson {

    fun buildClaimBody(
        code: String,
        deviceSecret: String,
        label: String,
        installationId: String,
        appVersion: String,
        sdkInt: Int,
    ): String {
        val device = JSONObject()
            .put("label", label)
            .put("installationId", installationId)
            .put("appVersion", appVersion)
            .put("sdkInt", sdkInt)
        return JSONObject()
            .put("code", code)
            .put("deviceSecret", deviceSecret)
            .put("device", device)
            .toString()
    }

    fun parseClaimResponse(body: String): ClaimResponse {
        val json = JSONObject(body)
        return ClaimResponse(
            enrollmentId = json.getString("enrollmentId"),
            claimToken = json.getString("claimToken"),
            verificationCode = json.getString("verificationCode"),
            status = json.optString("status", "CLAIMED"),
            deviceLabel = json.nullableString("deviceLabel"),
        )
    }

    fun buildConfirmLocalBody(accepted: Boolean): String =
        JSONObject()
            .put("accepted", accepted)
            .put("disclosureVersion", DISCLOSURE_VERSION)
            .toString()

    fun parseEnrollmentStatus(body: String): EnrollmentStatus {
        val json = JSONObject(body)
        return EnrollmentStatus(
            status = json.optString("status", "UNKNOWN"),
            deviceLabel = json.nullableString("deviceLabel"),
        )
    }

    fun parseCommandList(body: String): List<DeviceCommand> {
        val items = JSONObject(body).optJSONArray("items") ?: JSONArray()
        return buildList {
            for (index in 0 until items.length()) {
                val item = items.optJSONObject(index) ?: continue
                add(
                    DeviceCommand(
                        commandId = item.getString("commandId"),
                        type = CommandType.fromWire(item.optString("type", "")),
                        expiresAt = item.optString("expiresAt", ""),
                    ),
                )
            }
        }
    }

    fun parseAckResponse(body: String): AckResult {
        val json = JSONObject(body)
        return AckResult(
            state = json.optString("state", "UNKNOWN"),
            idempotent = json.optBoolean("idempotent", false),
        )
    }

    fun buildAckBody(
        ackId: String,
        status: String,
        observedAt: String?,
        result: Map<String, Any?>? = null,
        errorCode: String? = null,
        errorMessage: String? = null,
    ): String {
        val json = JSONObject()
            .put("ackId", ackId)
            .put("status", status)
        if (observedAt != null) {
            json.put("observedAt", observedAt)
        }
        if (result != null) {
            json.put("result", JSONObject(result))
        }
        if (errorCode != null) {
            val error = JSONObject().put("code", errorCode)
            if (errorMessage != null) error.put("message", errorMessage)
            json.put("error", error)
        }
        return json.toString()
    }

    fun buildStatusBody(snapshot: StatusSnapshot, sequence: Int, appVersion: String): String =
        JSONObject()
            .put("sequence", sequence)
            .putNullable("batteryLevel", snapshot.batteryLevel)
            .putNullable("charging", snapshot.charging)
            .putNullable("networkConnected", snapshot.networkConnected)
            .putNullable("backendReachable", snapshot.backendReachable)
            .putNullable("screenInteractive", snapshot.screenInteractive)
            .putNullable("keyguardLocked", snapshot.keyguardLocked)
            .put("observedAt", snapshot.observedAt)
            .put("appVersion", appVersion)
            .toString()

    fun parseError(body: String): ApiError? {
        val error = runCatching { JSONObject(body).optJSONObject("error") }.getOrNull() ?: return null
        return ApiError(
            code = error.optString("code", "UNKNOWN"),
            message = error.optString("message", "Permintaan gagal."),
        )
    }

    const val DISCLOSURE_VERSION = "companion-disclosure-1"

    private fun JSONObject.nullableString(key: String): String? =
        if (!has(key) || isNull(key)) null else optString(key)

    private fun JSONObject.putNullable(key: String, value: Any?): JSONObject =
        put(key, value ?: JSONObject.NULL)
}
