package com.gchild.companion

import com.gchild.companion.data.CommandType
import com.gchild.companion.data.CompanionJson
import com.gchild.companion.data.StatusSnapshot
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CompanionJsonTest {

    @Test
    fun `claim response diparse sesuai kontrak`() {
        val body = """
            {
              "enrollmentId": "pair_abc",
              "status": "CLAIMED",
              "claimToken": "token-abcdefghijklmnop",
              "claimExpiresAt": "2026-11-03T08:15:00.000Z",
              "verificationCode": "123456",
              "deviceLabel": "HP Budi"
            }
        """.trimIndent()

        val claim = CompanionJson.parseClaimResponse(body)
        assertEquals("pair_abc", claim.enrollmentId)
        assertEquals("CLAIMED", claim.status)
        assertEquals("123456", claim.verificationCode)
        assertEquals("HP Budi", claim.deviceLabel)
    }

    @Test
    fun `daftar command memetakan tipe dan menandai yang tidak dikenal`() {
        val body = """
            {
              "serverTime": "2026-11-03T08:00:00.000Z",
              "items": [
                {"commandId": "cmd_1", "type": "REQUEST_STATUS", "expiresAt": "2026-11-03T08:01:00.000Z"},
                {"commandId": "cmd_2", "type": "LOCK_SCREEN", "expiresAt": "2026-11-03T08:02:00.000Z"},
                {"commandId": "cmd_3", "type": "REBOOT_DEVICE", "expiresAt": "2026-11-03T08:03:00.000Z"}
              ]
            }
        """.trimIndent()

        val commands = CompanionJson.parseCommandList(body)
        assertEquals(3, commands.size)
        assertEquals(CommandType.REQUEST_STATUS, commands[0].type)
        assertEquals(CommandType.LOCK_SCREEN, commands[1].type)
        assertEquals(CommandType.UNKNOWN, commands[2].type)
    }

    @Test
    fun `status body mempertahankan null sebagai null`() {
        val snapshot = StatusSnapshot(
            batteryLevel = null,
            charging = null,
            networkConnected = true,
            backendReachable = true,
            screenInteractive = null,
            keyguardLocked = false,
            observedAt = "2026-11-03T08:00:00.000Z",
        )

        val json = JSONObject(CompanionJson.buildStatusBody(snapshot, sequence = 7, appVersion = "test"))
        assertEquals(7, json.getInt("sequence"))
        assertTrue(json.isNull("batteryLevel"))
        assertTrue(json.isNull("charging"))
        assertEquals(true, json.getBoolean("networkConnected"))
        assertTrue(json.isNull("screenInteractive"))
        assertEquals(false, json.getBoolean("keyguardLocked"))
        assertEquals("2026-11-03T08:00:00.000Z", json.getString("observedAt"))
    }

    @Test
    fun `ack body memuat error terstruktur dan observedAt opsional`() {
        val body = CompanionJson.buildAckBody(
            ackId = "ack-12345678",
            status = "FAILED",
            observedAt = "2026-11-03T08:00:00.000Z",
            errorCode = "NOT_IMPLEMENTED_IN_COMPANION",
            errorMessage = "belum tersedia",
        )
        val json = JSONObject(body)
        assertEquals("FAILED", json.getString("status"))
        assertEquals(
            "NOT_IMPLEMENTED_IN_COMPANION",
            json.getJSONObject("error").getString("code"),
        )
        assertTrue(json.has("observedAt"))

        val withResult = JSONObject(
            CompanionJson.buildAckBody(
                ackId = "ack-87654321",
                status = "SUCCEEDED",
                observedAt = null,
                result = mapOf("source" to "android"),
            ),
        )
        assertEquals("android", withResult.getJSONObject("result").getString("source"))
        assertTrue(!withResult.has("observedAt"))
        assertTrue(!withResult.has("error"))
    }

    @Test
    fun `error response dibaca tanpa membocorkan isi lain`() {
        assertEquals(
            "VALIDATION_ERROR",
            CompanionJson.parseError("""{"error":{"code":"VALIDATION_ERROR","message":"Payload tidak valid."}}""")?.code,
        )
        assertNull(CompanionJson.parseError("bukan json"))
        assertNull(CompanionJson.parseError("{}"))
    }
}
