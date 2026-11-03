package com.gchild.companion

import android.app.Application
import android.content.Context
import com.gchild.companion.data.CompanionApi
import com.gchild.companion.data.CompanionRepository
import com.gchild.companion.data.LocalPairingStore
import com.gchild.companion.data.SecretStore
import com.gchild.companion.data.StatusCollector

class GChildApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(applicationContext)
    }
}

/** Dependency manual sederhana; tanpa Hilt sesuai rencana MVP. */
class AppContainer(context: Context) {
    private val api = CompanionApi(BuildConfig.API_BASE_URL)
    private val secrets = SecretStore(context)
    private val local = LocalPairingStore(context)
    private val statusCollector = StatusCollector(context)

    val repository = CompanionRepository(api, secrets, local, statusCollector)
}
