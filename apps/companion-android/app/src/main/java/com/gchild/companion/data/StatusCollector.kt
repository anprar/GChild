package com.gchild.companion.data

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.PowerManager
import android.app.KeyguardManager
import java.time.Instant

/**
 * Membaca status yang benar-benar dapat diamati. Nilai yang tidak tersedia
 * dikembalikan null, bukan 0/false, agar UI tidak berbohong.
 */
class StatusCollector(private val context: Context) {

    fun snapshot(backendReachable: Boolean): StatusSnapshot {
        val batteryIntent = context.registerReceiver(
            null,
            IntentFilter(Intent.ACTION_BATTERY_CHANGED),
        )

        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val batteryLevel = if (level >= 0 && scale > 0) level * 100 / scale else null

        val batteryStatus = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = when (batteryStatus) {
            BatteryManager.BATTERY_STATUS_CHARGING,
            BatteryManager.BATTERY_STATUS_FULL,
            -> true
            BatteryManager.BATTERY_STATUS_DISCHARGING,
            BatteryManager.BATTERY_STATUS_NOT_CHARGING,
            -> false
            else -> null
        }

        val powerManager = context.getSystemService(PowerManager::class.java)
        val keyguardManager = context.getSystemService(KeyguardManager::class.java)
        val connectivity = context.getSystemService(ConnectivityManager::class.java)

        val capabilities = connectivity?.activeNetwork?.let {
            connectivity.getNetworkCapabilities(it)
        }
        val networkConnected =
            capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)

        return StatusSnapshot(
            batteryLevel = batteryLevel,
            charging = charging,
            networkConnected = networkConnected,
            backendReachable = backendReachable,
            screenInteractive = powerManager?.isInteractive,
            keyguardLocked = keyguardManager?.isKeyguardLocked,
            observedAt = Instant.now().toString(),
        )
    }
}
