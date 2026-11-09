package net.wizardfactory.todayweather.ui.nation

import java.util.TimeZone
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import net.wizardfactory.todayweather.core.data.NationSource
import net.wizardfactory.todayweather.core.data.PageLoad
import net.wizardfactory.todayweather.core.domain.Warnings
import net.wizardfactory.todayweather.core.domain.nation.WarningCard
import net.wizardfactory.todayweather.core.domain.nation.WarningCards
import net.wizardfactory.todayweather.core.model.NationResponse
import net.wizardfactory.todayweather.core.storage.UnitSettings

/** The menu pages of AN-13, by their Cordova state names; they open over the tabs like the settings pages. */
object NationRoutes {
    const val WARNINGS = "kma-special"
    const val NATION = "nation"
    const val NATION_AIR = "nation-air"
    fun known(route: String) = route == WARNINGS || route == NATION || route == NATION_AIR
}

/** What an open nationwide or warnings page has. */
sealed interface NationPageState {
    /** Its request runs (`$ionicLoading` on S10 and S11). */
    data object Loading : NationPageState

    /** S10, S11: the response, or null after a failure (the labels show their names only). */
    data class Nation(val response: NationResponse?) : NationPageState

    /** S12: the cards; none after a failure. */
    data class Warnings(val cards: List<WarningCard>) : NationPageState
}

/**
 * The requests of the open nationwide and warning pages (#2892). A page sends its request when it opens, as the
 * Cordova states (`cache: false`) did. It keeps the answer while it stays open, across configuration changes, and
 * closing it drops the answer.
 * - [units]: the stored units, for the units query.
 * - [languages]: the app's language tags; the first is the WebView locale that formats the warning times.
 * - [timeZone]: the device's time zone.
 */
class NationLoads(
    private val source: NationSource,
    private val scope: CoroutineScope,
    private val units: () -> UnitSettings?,
    private val languages: () -> List<String>,
    private val timeZone: () -> String = { TimeZone.getDefault().id },
) {
    private val states = MutableStateFlow<Map<String, NationPageState>>(emptyMap())
    private val jobs = HashMap<String, Job>()

    /** The state of each open page by route. */
    val pages: StateFlow<Map<String, NationPageState>> = states.asStateFlow()

    /** The page [route] opens: its request starts, replacing an earlier one of the same route. */
    fun open(route: String) {
        jobs.remove(route)?.cancel()
        states.update { it + (route to NationPageState.Loading) }
        jobs[route] = scope.launch {
            val state = when (route) {
                NationRoutes.WARNINGS -> when (val load = source.special(languages())) {
                    is PageLoad.Loaded -> NationPageState.Warnings(
                        WarningCards.cards(Warnings.parse(load.value, languages().firstOrNull() ?: "en-US", timeZone())))
                    is PageLoad.Failed -> NationPageState.Warnings(emptyList())
                }
                else -> {
                    val stored = units()
                    val load = if (stored == null) PageLoad.Failed(null) else source.nation("KR", stored, languages())
                    NationPageState.Nation((load as? PageLoad.Loaded)?.value)
                }
            }
            states.update { it + (route to state) }
        }
    }

    /** A page shown without having been opened in this process (restored after the process ended) opens now. */
    fun ensure(route: String) {
        if (route !in states.value) open(route)
    }

    /** The page [route] closed: its request stops and its answer goes. */
    fun close(route: String) {
        jobs.remove(route)?.cancel()
        states.update { it - route }
    }
}
