package net.wizardfactory.todayweather.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import net.wizardfactory.todayweather.core.domain.share.DeepLinkTarget
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.startShows

/** A link for the screens to apply once: [id] tells the same link opened twice apart. */
data class LinkRequest(val id: Long, val route: LinkRoute)

/**
 * Applies `link.todayweather.ai` links in order (specs/deeplink.md §6.2) over the saved [state], which is null until it
 * has been read after the migration. A saved place within 0.01° is selected and loaded ([openPlace], `reloadEvent
 * 'deeplink'`); another place shows as a [preview] and loads ([reload]). On the start page (S01) every place link is a
 * preview, which covers S01 without closing it, and page links and `/open` are ignored (§6.2.3 "defer or ignore"), so
 * no link waits and none holds back the next. An unknown catalog city changes nothing. The screens get each applied
 * link, `/open` included, as a [requests] value (menus and pages close, then the tab or the page opens) and report it
 * [handled].
 */
class LinkOpener(
    private val state: StateFlow<AppState?>,
    private val preview: LinkPreview,
    private val openPlace: (Int) -> Unit,
    private val reload: () -> Unit,
) {
    private val pending = MutableStateFlow<LinkRequest?>(null)
    private var next = 0L

    val requests: StateFlow<LinkRequest?> = pending.asStateFlow()

    suspend fun open(target: DeepLinkTarget) {
        val saved = state.first { it != null }!!
        val start = saved.startShows
        val route = LinkRoutes.of(target, saved, matchSaved = !start) ?: return
        when (route) {
            LinkRoute.App, is LinkRoute.Page -> if (start) return
            is LinkRoute.Weather -> {
                val place = route.preview
                if (place != null) {
                    preview.show(place)
                    reload()
                } else {
                    preview.clear()
                    openPlace(route.index!!)
                }
            }
        }
        pending.value = LinkRequest(++next, route)
    }

    /** The screens applied the request [id]; a newer one stays. */
    fun handled(id: Long) = pending.update { if (it?.id == id) null else it }
}
