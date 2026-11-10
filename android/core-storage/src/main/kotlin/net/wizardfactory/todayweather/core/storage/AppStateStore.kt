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
 * Runs [CordovaMigration] once into [store]: a stored state with migration metadata is never replaced, whatever the
 * sources or the clock say later, except after a rollback (AN-17): when a fallback Cordova build claimed the state
 * ([CordovaHandBack.cordovaClaim]) with a generation this state has not adopted, the Cordova storage the user changed
 * there migrates again; the next hand-back then hands the state back to the fallback build. Every migration adopts the
 * claim it found, the first one too: a Cordova build with the hand-back claims the state at each of its starts.
 */
class MigrationRunner(
    private val store: DataStore<AppState>,
    private val sources: () -> MigrationSources,
    private val clock: () -> Long,
    private val zone: () -> TimeZone,
    private val region: () -> String?,
    /** The suite's [CordovaHandBack.MARKER], read on every start (the sources only when migrating). */
    private val marker: () -> String? = { null },
) {
    suspend fun runIfNeeded(): AppState {
        val text = marker()
        store.data.first().let { if (it.migration != null && claim(it, text) == null) return it }
        return store.updateData { state ->
            if (state.migration != null && claim(state, text) == null) return@updateData state
            val s = sources()
            val migrated = CordovaMigration.migrate(s.local, s.suite, s.legacySuite, region(), clock(), zone())
            val adopted = CordovaHandBack.cordovaClaim(text) ?: return@updateData migrated
            migrated.copy(migration = migrated.migration?.copy(handBackGeneration = adopted.generation))
        }
    }

    /** The fallback build's claim in [text] when [state] was migrated before and has not adopted it. */
    private fun claim(state: AppState, text: String?): CordovaHandBack.Marker? {
        val migration = state.migration ?: return null
        return CordovaHandBack.cordovaClaim(text)?.takeIf { it.generation > (migration.handBackGeneration ?: 0) }
    }
}

/**
 * Runs the migration on the first start of the native app over a Cordova install, and again after a fallback Cordova
 * build claimed the state (AN-17). It only reads the Cordova storage (WebView files and suites); the rollback hand-back
 * ([CordovaHandBack]) writes the suite.
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
        marker = { runCatching { context.getSharedPreferences(CordovaMigration.SUITE, Context.MODE_PRIVATE).getString(CordovaHandBack.MARKER, null) }.getOrNull() },
    )

    /** Returns the state after the migration; a second call changes nothing. */
    suspend fun migrateIfNeeded(): AppState = runner.runIfNeeded()

    private fun read(prefs: SharedPreferences): Map<String, String?> =
        prefs.all.filterKeys { !it.startsWith("_") }.mapValues { (_, v) -> v?.toString() }
}
