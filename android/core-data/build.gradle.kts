plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "net.wizardfactory.todayweather.core.data"
    compileSdk = 37
    defaultConfig {
        minSdk = 24
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    api(project(":core-model"))
    api(project(":core-storage"))
    api(libs.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    testImplementation(libs.kotlin.test.junit)
    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
}
