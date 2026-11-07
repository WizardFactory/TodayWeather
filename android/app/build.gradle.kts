import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// The Firebase configuration is a private input (README.md). Without it the app builds and runs
// with Firebase uninitialized, which sends nothing.
if (file("google-services.json").exists()) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
}

// The legacy server URL is a private input too (README.md): TW_SERVER_URL from the environment or
// android/private.properties. Empty: the app makes no server requests.
val privateProps = Properties().apply {
    rootProject.file("private.properties").takeIf { it.isFile }?.inputStream()?.use { load(it) }
}
val serverUrl: String = System.getenv("TW_SERVER_URL") ?: privateProps.getProperty("TW_SERVER_URL", "")

android {
    namespace = "net.wizardfactory.todayweather"
    compileSdk = 37

    defaultConfig {
        applicationId = "net.wizardfactory.todayweather"
        minSdk = 24
        targetSdk = 36
        // Above the Cordova 1.1.1 build (100091) so the native build installs as an update.
        // AN-19 sets the release value above every active Play track.
        versionCode = 200000
        versionName = "2.0.0"
        testInstrumentationRunner = "net.wizardfactory.todayweather.TestRunner"
        buildConfigField("String", "SERVER_URL", "\"" + serverUrl.trimEnd('/') + "\"")
    }

    // Device tests read the golden corpus generated for core-domain.
    sourceSets["androidTest"].assets.srcDir("../core-domain/src/test/resources")

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.all { it.systemProperty("tw.projectDir", project.projectDir.absolutePath) }
    }
}

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-domain"))
    implementation(project(":core-data"))
    implementation(project(":core-storage"))

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.analytics)
    implementation(libs.firebase.messaging)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.kotlinx.coroutines.android)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)

    testImplementation(libs.junit)
    testImplementation(libs.kotlin.test)
    testImplementation(libs.org.json)

    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
}
