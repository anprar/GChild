plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
}

/**
 * Base URL server:
 * - debug default ke loopback emulator (10.0.2.2) supaya bisa dicoba lokal;
 * - release tidak punya default: harus diisi lewat -Pgchild.apiBaseUrl=https://...
 *   dan wajib https (cleartext ditolak di network security config release).
 */
val debugApiBaseUrl: String = providers.gradleProperty("gchild.apiBaseUrl")
    .getOrElse("http://10.0.2.2:3000")
val releaseApiBaseUrl: String = providers.gradleProperty("gchild.apiBaseUrl").getOrElse("")

val releaseKeystorePath: String? = System.getenv("GCHILD_KEYSTORE_PATH")
val releaseKeystorePassword: String? = System.getenv("GCHILD_KEYSTORE_PASSWORD")
val releaseKeyAlias: String? = System.getenv("GCHILD_KEY_ALIAS")
val releaseKeyPassword: String? = System.getenv("GCHILD_KEY_PASSWORD")

val releaseSigningValues = listOf(
    releaseKeystorePath,
    releaseKeystorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
)
val hasReleaseSigning = releaseSigningValues.all { !it.isNullOrBlank() }

if (releaseApiBaseUrl.isNotEmpty() && !releaseApiBaseUrl.startsWith("https://")) {
    throw GradleException(
        "gchild.apiBaseUrl untuk release wajib https:// (ditolak: bukan koneksi terenkripsi).",
    )
}
if (releaseApiBaseUrl.isEmpty()) {
    logger.warn(
        "Release build tanpa -Pgchild.apiBaseUrl: APK akan menampilkan 'Server belum dikonfigurasi'.",
    )
}

android {
    namespace = "com.gchild.companion"
    compileSdk = 37
    // Android 17 dipublikasikan sebagai platform minor "android-37.2";
    // tanpa ini AGP mencari platforms/android-37 yang tidak pernah ada.
    compileSdkMinor = 2

    defaultConfig {
        applicationId = "com.gchild.companion"
        minSdk = 28
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0-alpha01"
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                // Nilai hanya dari environment/CI secret; tidak pernah ditulis ke repo.
                storeFile = file(releaseKeystorePath!!)
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            buildConfigField("String", "API_BASE_URL", "\"$debugApiBaseUrl\"")
        }
        getByName("release") {
            buildConfigField("String", "API_BASE_URL", "\"$releaseApiBaseUrl\"")
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        // Runtime JDK boleh 21 (CI), bytecode tetap 17 agar sesuai dukungan AGP/D8.
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    // org.json disediakan Android; versi JVM ini hanya untuk unit test parsing JSON.
    testImplementation(libs.org.json)
}
