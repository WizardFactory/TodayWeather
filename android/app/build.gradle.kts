import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// The Firebase configuration is a private input (README.md). Without it the app builds and runs
// with Firebase uninitialized, which sends nothing. Crashlytics needs its plugin for the build ID.
if (file("google-services.json").exists()) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
    apply(plugin = libs.plugins.firebase.crashlytics.get().pluginId)
}

// The legacy server URL, the weather photo feed URL and the feedback address are private inputs too (README.md):
// TW_SERVER_URL, TW_WEATHER_PHOTOS_URL and TW_MAIL_TO from the environment or android/private.properties. Empty: no
// requests to them, and a feedback mail without a recipient.
val privateProps = Properties().apply {
    rootProject.file("private.properties").takeIf { it.isFile }?.inputStream()?.use { load(it) }
}
val serverUrl: String = System.getenv("TW_SERVER_URL") ?: privateProps.getProperty("TW_SERVER_URL", "")
val weatherPhotosUrl: String = System.getenv("TW_WEATHER_PHOTOS_URL") ?: privateProps.getProperty("TW_WEATHER_PHOTOS_URL", "")
val mailTo: String = System.getenv("TW_MAIL_TO") ?: privateProps.getProperty("TW_MAIL_TO", "")

// AdMob (AN-15): release builds take the app ID and the banner unit from TW_ADMOB_APP_ID_ANDROID and
// TW_ADMOB_BANNER_ANDROID (private inputs, as above); debug builds always use Google's sample app ID and test banner
// unit, so development builds never request real ads (client/scripts/make-client-config.mjs).
val admobAppId: String = System.getenv("TW_ADMOB_APP_ID_ANDROID") ?: privateProps.getProperty("TW_ADMOB_APP_ID_ANDROID", "")
val admobBanner: String = System.getenv("TW_ADMOB_BANNER_ANDROID") ?: privateProps.getProperty("TW_ADMOB_BANNER_ANDROID", "")
val sampleAppId = "ca-app-pub-3940256099942544~3347511713"

// Place search (AN-10): the Android-restricted key of Places API (New), TW_PLACES_API_KEY_ANDROID (private input, as
// above). Without it S01 searches the bundled towns.
val placesKey: String = System.getenv("TW_PLACES_API_KEY_ANDROID") ?: privateProps.getProperty("TW_PLACES_API_KEY_ANDROID", "")
val testBanner = "ca-app-pub-3940256099942544/9214589741"

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
        buildConfigField("String", "WEATHER_PHOTOS_URL", "\"" + weatherPhotosUrl + "\"")
        buildConfigField("String", "MAIL_TO", "\"" + mailTo + "\"")
        buildConfigField("String", "PLACES_API_KEY", "\"" + placesKey + "\"")
    }

    // Device tests read the golden corpus generated for core-domain and the chart references; the image
    // comparison is shared by the JVM and device tests.
    sourceSets["androidTest"].assets.srcDir("../core-domain/src/test/resources")
    sourceSets["test"].kotlin.srcDir("src/sharedTest/java")
    sourceSets["androidTest"].kotlin.srcDir("src/sharedTest/java")

    buildTypes {
        debug {
            manifestPlaceholders["admobAppId"] = sampleAppId
            buildConfigField("String", "BANNER_AD_UNIT", "\"$testBanner\"")
            buildConfigField("boolean", "RELEASE_ADS", "false")
        }
        release {
            manifestPlaceholders["admobAppId"] = admobAppId.ifBlank { sampleAppId }
            buildConfigField("String", "BANNER_AD_UNIT", "\"" + admobBanner.ifBlank { testBanner } + "\"")
            buildConfigField("boolean", "RELEASE_ADS", "true")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Places 5+ requires Java 8+ library support; the app's own code still avoids java.time (MinSdkApiTest).
        isCoreLibraryDesugaringEnabled = true
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all { it.systemProperty("tw.projectDir", project.projectDir.absolutePath) }
    }
}

// A release package refuses Google's sample IDs, as client/scripts/build-release.mjs does.
val releaseAdsMissing = listOf("TW_ADMOB_APP_ID_ANDROID" to admobAppId, "TW_ADMOB_BANNER_ANDROID" to admobBanner)
    .filter { (_, value) -> value.isBlank() || "3940256099942544" in value }.map { it.first }
tasks.matching { it.name == "packageRelease" || it.name == "bundleRelease" }.configureEach {
    doFirst {
        if (releaseAdsMissing.isNotEmpty()) throw GradleException("a release build needs ${releaseAdsMissing.joinToString(" and ")} (README, Private inputs)")
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
    implementation(libs.firebase.config)
    implementation(libs.firebase.crashlytics)
    implementation(libs.play.services.ads)
    implementation(libs.user.messaging.platform)
    implementation(libs.play.services.location)
    implementation(libs.places)
    coreLibraryDesugaring(libs.desugar.jdk.libs)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.work.runtime)
    implementation(libs.androidx.core.splashscreen)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)

    testImplementation(libs.junit)
    testImplementation(libs.kotlin.test)
    testImplementation(libs.org.json)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.compose.ui.test.junit4)
    testImplementation(libs.androidx.test.espresso.core)
    testImplementation(libs.kotlinx.coroutines.test)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.espresso.intents)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
}
