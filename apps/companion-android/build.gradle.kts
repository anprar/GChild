// AGP 9 memakai built-in Kotlin: plugin org.jetbrains.kotlin.android TIDAK dipakai.
// Versi KGP dikunci di sini agar compiler Kotlin sama dengan versi plugin Compose.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.compose.compiler) apply false
}
