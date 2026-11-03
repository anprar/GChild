package com.gchild.companion.data

import android.content.Context
import java.util.UUID

/** Data pairing non-secret. Secret disimpan terpisah di [SecretStore]. */
class LocalPairingStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    val installationId: String
        get() {
            prefs.getString(KEY_INSTALLATION, null)?.let { return it }
            val generated = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_INSTALLATION, generated).apply()
            return generated
        }

    var enrollmentId: String?
        get() = prefs.getString(KEY_ENROLLMENT, null)
        set(value) {
            prefs.edit().putString(KEY_ENROLLMENT, value).apply()
        }

    var deviceLabel: String?
        get() = prefs.getString(KEY_LABEL, null)
        set(value) {
            prefs.edit().putString(KEY_LABEL, value).apply()
        }

    /** Sequence status monoton naik per pengiriman. */
    fun nextSequence(): Int {
        val next = (prefs.getInt(KEY_SEQUENCE, 0)) + 1
        prefs.edit().putInt(KEY_SEQUENCE, next).apply()
        return next
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val PREFS_NAME = "gchild_pairing"
        const val KEY_INSTALLATION = "installation_id"
        const val KEY_ENROLLMENT = "enrollment_id"
        const val KEY_LABEL = "device_label"
        const val KEY_SEQUENCE = "status_sequence"
    }
}
