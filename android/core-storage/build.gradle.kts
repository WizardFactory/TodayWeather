plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "net.wizardfactory.todayweather.core.storage"
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
    implementation(project(":core-model"))
    testImplementation(libs.kotlin.test)
}
