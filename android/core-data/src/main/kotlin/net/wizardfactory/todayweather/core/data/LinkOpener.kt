package net.wizardfactory.todayweather.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import net.wizardfactory.todayweather.core.domain.share.DeepLinkTarget
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.startShows

/** A link for the screens to apply once: [id] tells the same link opened twice apart. */
data class LinkRequest(val id: Long, val route: LinkRoute)

/**
 * Applies `link.todayweather.ai` links in order (specs/deeplink.md §6.2) over the saved [state], which is null until it
 * has been read after the migration. A saved place within 0.01° is selected and loaded ([openPlace], `reloadEvent
 * 'deeplink'`); another place shows as a [preview] and loads ([reload]), replacing an unsaved place shown before. On the start page (S01) every place link is a
 * preview, which covers S01 without closing it, and page links and `/open` are ignored (§6.2.3 "defer or ignore"), so
 * no link waits and none holds back the next. An unknown catalog city changes nothing. The screens get each applied
 * link, `/open` included, as the [requests] value (menus and pages close, then the tab or the page opens) and report
 * it [handled]; the next one follows then, so a link not yet applied is never replaced (CODEX-3164-12).
 */
class LinkOpener(
    private val state: StateFlow<AppState?>,
    private val preview: LinkPreview,
    private val openPlace: (Int) -> Unit,
    private val reload: () -> Unit,
) {
    /** The requests the screens have not applied yet, oldest first; [pending] is its head. */
    private val queue = ArrayDeque<LinkRequest>()
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
                    // The saved place is selected; an unsaved place opened earlier stays in the list.
                    openPlace(route.index!!)
                }
            }
        }
        synchronized(queue) {
            queue.addLast(LinkRequest(++next, route))
            pending.value = queue.first()
        }
    }

    /**
     * A place chosen in the search (#3180): the saved place within 0.01° is selected (the enabled current position
     * included), else the place shows without being saved. The search loads it and chooses the tab (`goPage`), so
     * nothing is asked of the screens here.
     */
    fun show(place: Place) {
        val saved = state.value ?: return
        val index = LinkRoutes.nearbySaved(saved, place, withCurrentPosition = true)
        if (index < 0) return preview.show(place)
        preview.change { it.copy(placeIndex = index) }
    }

    /** The screens applied the request [id], the oldest one: the next follows. Another id changes nothing. */
    fun handled(id: Long) = synchronized(queue) {
        if (queue.firstOrNull()?.id == id) queue.removeFirst()
        pending.value = queue.firstOrNull()
    }
}
