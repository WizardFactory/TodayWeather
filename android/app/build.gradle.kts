plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

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
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // Device tests read the golden corpus generated for core-domain.
    sourceSets["androidTest"].assets.srcDir("../core-domain/src/test/resources")

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
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
