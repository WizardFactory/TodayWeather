import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.androidx.baselineprofile)
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

// Debug uses the SDK's test creatives. Release builds require units of the matching formats.
fun adSetting(name: String): String = System.getenv(name) ?: privateProps.getProperty(name, "")
val admobAppId = adSetting("TW_ADMOB_APP_ID_ANDROID")
val admobNative = adSetting("TW_ADMOB_NATIVE_ANDROID")
val admobInterstitial = adSetting("TW_ADMOB_INTERSTITIAL_ANDROID")
val admobBanner = adSetting("TW_ADMOB_BANNER_ANDROID")
val sampleAppId = "ca-app-pub-3940256099942544~3347511713"

// Place search (AN-10): the Android-restricted key of Places API (New), TW_PLACES_API_KEY_ANDROID (private input, as
// above). Without it S01 searches the bundled towns.
val placesKey: String = System.getenv("TW_PLACES_API_KEY_ANDROID") ?: privateProps.getProperty("TW_PLACES_API_KEY_ANDROID", "")


android {
    namespace = "net.wizardfactory.todayweather"
    compileSdk = 37

    defaultConfig {
        applicationId = "net.wizardfactory.todayweather"
        minSdk = 24
        targetSdk = 36
        // Above the Cordova 1.1.1 build (100091) so the native build installs as an update.
        // AN-19 sets the release value above every active Play track.
        versionCode = 200010
        versionName = "2.0.1"
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
            buildConfigField("String", "NATIVE_AD_UNIT", "\"ca-app-pub-3940256099942544/2247696110\"")
            buildConfigField("String", "INTERSTITIAL_AD_UNIT", "\"ca-app-pub-3940256099942544/1033173712\"")
            // Google's adaptive banner test unit (#3211).
            buildConfigField("String", "BANNER_AD_UNIT", "\"ca-app-pub-3940256099942544/9214589741\"")
            buildConfigField("boolean", "RELEASE_ADS", "false")
        }
        release {
            // R8 shrinks, optimizes and obfuscates the release (Play's DEX optimization check) and removes unused
            // resources. It writes build/outputs/mapping/release/mapping.txt, which the release keeps and uploads to
            // Play (docs/operations/android-release.md, step 4). The libraries bring their own rules;
            // proguard-rules.pro holds only what this app's code needs.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            manifestPlaceholders["admobAppId"] = admobAppId.ifBlank { sampleAppId }
            buildConfigField("String", "NATIVE_AD_UNIT", "\"$admobNative\"")
            buildConfigField("String", "INTERSTITIAL_AD_UNIT", "\"$admobInterstitial\"")
            buildConfigField("String", "BANNER_AD_UNIT", "\"$admobBanner\"")
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

// The app's baseline profile (#3224): :baselineprofile generates it on a connected device by hand
// (`./gradlew :app:generateBaselineProfile`, android/README.md) and the rules are kept in src/main/generated/baselineProfiles,
// which every build merges with the libraries' profiles. Building never runs the generator.
baselineProfile {
    automaticGenerationDuringBuild = false
    saveInSrc = true
    mergeIntoMain = true
}

// Robolectric's Android runtimes (one per SDK level the tests name in @Config) are fetched by Gradle, kept in
// android/.gradle/robolectric-runtimes, and read by the tests offline. Left to itself Robolectric downloads them
// from Maven Central while the tests run, and a refused download fails every Robolectric class (IOException in
// MavenArtifactFetcher). Maven Central refuses these large jars to CI runners often enough (429) that CI keeps the
// directory in its cache, keyed by robolectric-runtimes.txt. That file lists each version with the SHA-256 of its
// jar: a jar that is there with that hash is used as it is, and any other is fetched again and must match. Without a
// listed version the tests of its SDK level fail naming the jar.
data class RobolectricRuntime(val version: String, val sha256: String)
val robolectricRuntimes = file("robolectric-runtimes.txt").readLines().map { it.substringBefore('#').trim() }.filter { it.isNotEmpty() }
    .map { line -> line.split(Regex("\\s+")).let { RobolectricRuntime(it[0], it[1].lowercase()) } }
val robolectricRuntimeDir = rootProject.layout.projectDirectory.dir(".gradle/robolectric-runtimes").asFile
// Resolution stays lazy: a FileCollection is resolved only when the task reads it for a jar that is missing.
val robolectricDownloads = robolectricRuntimes.associate { runtime ->
    // Each version resolves on its own: together Gradle would keep only the newest.
    runtime.version to configurations.detachedConfiguration(dependencies.create("org.robolectric:android-all-instrumented:${runtime.version}"))
        .apply { isTransitive = false }.incoming.files
}
val copyRobolectricRuntimes = tasks.register("copyRobolectricRuntimes") {
    description = "Puts the listed Robolectric runtimes, with their recorded hashes, in android/.gradle/robolectric-runtimes"
    val runtimes = robolectricRuntimes
    val directory = robolectricRuntimeDir
    val downloads = robolectricDownloads
    inputs.property("runtimes", runtimes.map { "${it.version} ${it.sha256}" })
    outputs.dir(directory)
    // Always checks the hashes (about a second): a jar changed on disk must not pass because Gradle took the task as
    // up to date.
    outputs.upToDateWhen { false }
    doLast {
        // Local to the action, so the action captures no build script object.
        fun sha256(file: File): String = MessageDigest.getInstance("SHA-256").let { digest ->
            file.inputStream().use { input ->
                val buffer = ByteArray(1 shl 16)
                while (true) { val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) }
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        }
        directory.mkdirs()
        for (runtime in runtimes) {
            val name = "android-all-instrumented-${runtime.version}.jar"
            val target = File(directory, name)
            if (target.isFile && sha256(target) == runtime.sha256) continue
            val fetched = downloads.getValue(runtime.version).singleFile
            val hash = sha256(fetched)
            if (hash != runtime.sha256) {
                throw GradleException("android-all-instrumented ${runtime.version}: fetched SHA-256 $hash, robolectric-runtimes.txt records ${runtime.sha256}")
            }
            // A file of this run's own, moved over the target in one step: no partial or shared temporary file.
            val part = File.createTempFile("$name.", ".part", directory)
            try {
                fetched.copyTo(part, overwrite = true)
                Files.move(part.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE)
            } finally {
                part.delete()
            }
        }
    }
}
tasks.withType<Test>().configureEach {
    dependsOn(copyRobolectricRuntimes)
    systemProperty("robolectric.offline", "true")
    systemProperty("robolectric.dependency.dir", robolectricRuntimeDir.absolutePath)
}

// A release package refuses Google's sample IDs, as client/scripts/build-release.mjs does.
val releaseAdsMissing = listOf("TW_ADMOB_APP_ID_ANDROID" to admobAppId, "TW_ADMOB_NATIVE_ANDROID" to admobNative,
    "TW_ADMOB_INTERSTITIAL_ANDROID" to admobInterstitial, "TW_ADMOB_BANNER_ANDROID" to admobBanner)
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
    implementation(libs.androidx.profileinstaller)
    baselineProfile(project(":baselineprofile"))
    implementation(libs.user.messaging.platform)
    implementation(libs.play.services.location)
    implementation(libs.places)
    coreLibraryDesugaring(libs.desugar.jdk.libs)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.glance.appwidget)
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
