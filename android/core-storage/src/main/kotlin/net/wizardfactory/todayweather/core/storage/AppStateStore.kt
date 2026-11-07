package net.wizardfactory.todayweather.core.storage

import android.content.Context
import android.content.SharedPreferences
import androidx.datastore.core.CorruptionException
import androidx.datastore.core.DataStore
import androidx.datastore.core.DataStoreFactory
import androidx.datastore.core.Serializer
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.flow.first
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

/** JSON file serializer for [AppState]. */
object AppStateSerializer : Serializer<AppState> {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    override val defaultValue = AppState()
    override suspend fun readFrom(input: InputStream): AppState = try {
        json.decodeFromString(AppState.serializer(), input.readBytes().decodeToString())
    } catch (e: SerializationException) {
        throw CorruptionException("Unreadable app state", e)
    }
    override suspend fun writeTo(t: AppState, output: OutputStream) {
        output.write(json.encodeToString(AppState.serializer(), t).encodeToByteArray())
    }
}

/** The app's single DataStore, `files/app_state.json`. */
object AppStateStore {
    @Volatile private var instance: DataStore<AppState>? = null

    fun get(context: Context): DataStore<AppState> = instance ?: synchronized(this) {
        instance ?: DataStoreFactory.create(AppStateSerializer) {
            File(context.applicationContext.filesDir, "app_state.json")
        }.also { instance = it }
    }
}

/** What the migration reads; see [CordovaMigration.migrate]. */
data class MigrationSources(
    val local: Map<String, String>,
    val suite: Map<String, String?>,
    val legacySuite: Map<String, String?>,
)

/**
 * Runs [CordovaMigration] once into [store]: a stored state with migration metadata is never
 * replaced, whatever the sources or the clock say later.
 */
class MigrationRunner(
    private val store: DataStore<AppState>,
    private val sources: () -> MigrationSources,
    private val clock: () -> Long,
    private val zone: () -> TimeZone,
    private val region: () -> String?,
) {
    suspend fun runIfNeeded(): AppState {
        store.data.first().let { if (it.migration != null) return it }
        return store.updateData { state ->
            if (state.migration != null) return@updateData state
            val s = sources()
            CordovaMigration.migrate(s.local, s.suite, s.legacySuite, region(), clock(), zone())
        }
    }
}

/**
 * Runs the migration on the first start of the native app over a Cordova install. The Cordova storage
 * (WebView files and suites) is read, never changed: the rollback hand-back (AN-17) uses it.
 */
class CordovaMigrator(
    private val context: Context,
    store: DataStore<AppState> = AppStateStore.get(context),
    clock: () -> Long = System::currentTimeMillis,
) {
    private val runner = MigrationRunner(
        store,
        sources = {
            MigrationSources(
                local = WebViewLocalStorage.readAppData(File(context.applicationInfo.dataDir)),
                suite = read(context.getSharedPreferences(CordovaMigration.SUITE, Context.MODE_PRIVATE)),
                legacySuite = read(context.getSharedPreferences(CordovaMigration.LEGACY_SUITE, Context.MODE_PRIVATE)),
            )
        },
        clock = clock,
        zone = TimeZone::getDefault,
        region = { Locale.getDefault().country.ifEmpty { null } },
    )

    /** Returns the state after the migration; a second call changes nothing. */
    suspend fun migrateIfNeeded(): AppState = runner.runIfNeeded()

    private fun read(prefs: SharedPreferences): Map<String, String?> =
        prefs.all.filterKeys { !it.startsWith("_") }.mapValues { (_, v) -> v?.toString() }
}
