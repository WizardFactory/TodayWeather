package net.wizardfactory.todayweather.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.PlaceList
import net.wizardfactory.todayweather.core.storage.closeStart
import net.wizardfactory.todayweather.core.storage.startShows

/**
 * A place a `link.todayweather.ai` link opened without saving it (specs/deeplink.md §6.2). The weather pages read and
 * change the [saved] state through this one: while a preview shows, it is appended to the places and selected, its own
 * changes (a response's location, source and photo) stay in memory, and every other change is saved. Selecting a
 * saved place ([change] with another index: a swipe, a widget link, a notification tap) or [clear] ends the preview,
 * and the saved selection is the one before it. [add] (Add to favorites) saves it as a place, as S02's add does; on the
 * start page it closes S01 as a first place does. Only the screens see the preview: widgets, push and the store do not.
 */
class LinkPreview(private val saved: StateAccess) : StateAccess {
    private val shown = MutableStateFlow<Place?>(null)

    /** The place shown without being saved; null when none is. */
    val place: StateFlow<Place?> = shown.asStateFlow()

    /** Shows [place] (enabled) as the selected place. */
    fun show(place: Place) {
        shown.value = place.copy(disable = false)
    }

    fun clear() {
        shown.value = null
    }

    /**
     * Saves the preview as a place (`addCity`) and selects it, or selects the saved place it matches ([PlaceList.indexOf]);
     * on the start page the add closes S01 (`closeStart`). The selected index, or null when no preview shows.
     */
    fun add(): Int? {
        val place = shown.value ?: return null
        saved.change { s ->
            val existing = PlaceList.indexOf(s.places, place)
            val added = if (existing >= 0) s.copy(placeIndex = existing)
            else PlaceList.add(s, place)!!.let { it.copy(placeIndex = it.places.size - 1) }
            if (added.startShows) added.closeStart() else added
        }
        // After the save, so the start page never shows in between.
        shown.value = null
        return saved.current()?.placeIndex
    }

    /** True when [index] of the shown state is the preview: no saved place, alarm or widget has it. */
    fun isPreview(index: Int): Boolean = shown.value != null && index == saved.current()?.places?.size

    /** True when the tabs show over S01 for a preview ([state] as [overlay] gives it). */
    fun bypassesStart(state: AppState): Boolean = state.startShows && shown.value != null

    /** [state] with the preview appended and selected, as the screens see it. */
    fun overlay(state: AppState): AppState = overlay(state, shown.value)

    override fun current(): AppState? = saved.current()?.let(::overlay)

    override fun change(update: (AppState) -> AppState) {
        val place = shown.value ?: return saved.change(update)
        val base = saved.current() ?: return
        val before = overlay(base, place)
        val after = update(before)
        if (after.places.size != before.places.size) {
            // A change that adds or removes places is the saved list's own: the preview ends first.
            shown.value = null
            return saved.change(update)
        }
        shown.value = if (after.placeIndex == before.placeIndex) after.places.last() else null
        saved.change { s ->
            val changed = update(overlay(s, place))
            if (changed.places.size != s.places.size + 1) return@change s
            val selected = if (changed.placeIndex == s.places.size) s.placeIndex else changed.placeIndex
            changed.copy(places = changed.places.dropLast(1), placeIndex = selected)
        }
    }

    private fun overlay(state: AppState, place: Place?): AppState =
        if (place == null) state else state.copy(places = state.places + place, placeIndex = state.places.size)
}
