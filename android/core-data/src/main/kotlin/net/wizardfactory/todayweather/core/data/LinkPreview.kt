package net.wizardfactory.todayweather.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.closeStart
import net.wizardfactory.todayweather.core.storage.startShows

/**
 * A place opened without saving it, by a search result or a `link.todayweather.ai` link (#3180, specs/deeplink.md
 * §6.2). The weather pages read and change the [saved] state through this one: the unsaved place is the last place of
 * the list, so swipes and arrows reach it as any other. Its own changes (a response's location, source and photo) stay
 * in memory; every other change is saved, and while it is selected the saved selection stays the one before it.
 *
 * One unsaved place is kept. Moving to a saved place keeps it (a swipe back shows it again); another [show] replaces
 * it; a new start of the app has none, because nothing was saved. [add], the header's star, saves it where it stands,
 * and on the start page that closes S01 as a first place does. Only the screens see it: widgets, push, S02's list and
 * the store do not.
 */
class LinkPreview(private val saved: StateAccess) : StateAccess {
    private data class Shown(val place: Place, val selected: Boolean)

    private val shown = MutableStateFlow<Shown?>(null)
    private val placeNow = MutableStateFlow<Place?>(null)
    private val selectedNow = MutableStateFlow(false)

    /** The place shown without being saved; null when none is. */
    val place: StateFlow<Place?> = placeNow.asStateFlow()

    /** True while the unsaved place is the selected one: the header shows its star in the bell's position. */
    val selected: StateFlow<Boolean> = selectedNow.asStateFlow()

    /** Shows [place] (enabled) as the selected place, in place of an earlier unsaved one. */
    fun show(place: Place) = set(Shown(place.copy(disable = false), selected = true))

    fun clear() = set(null)

    /**
     * Saves the selected unsaved place where it stands, at the end of the list, and keeps it selected; when a saved
     * place lies within 0.01° ([LinkRoutes.nearbySaved]: by coordinates, as a link or a result matches, not
     * `getIndexOfCity`'s name and address, CODEX-3164-4) that one is selected instead. On the start page the add closes
     * S01 (`closeStart`), keeping that selection. The selected index, or null when the unsaved place is not the
     * selected one. The app has no place limit (S02 neither).
     */
    fun add(): Int? {
        val now = shown.value?.takeIf { it.selected } ?: return null
        saved.change { s ->
            val existing = LinkRoutes.nearbySaved(s, now.place)
            val added = if (existing >= 0) s.copy(placeIndex = existing)
            else s.copy(places = s.places + now.place, placeIndex = s.places.size)
            if (added.startShows) added.closeStart().copy(placeIndex = added.placeIndex) else added
        }
        // After the save, so the start page never shows in between.
        set(null)
        return saved.current()?.placeIndex
    }

    /** True when [index] of the shown state is the unsaved place: no saved place, alarm or widget has it. */
    fun isPreview(index: Int): Boolean = shown.value != null && index == saved.current()?.places?.size

    /** True when the tabs show over S01 for an unsaved place ([state] as [overlay] gives it). */
    fun bypassesStart(state: AppState): Boolean = state.startShows && shown.value != null

    /** [state] with the unsaved place appended, and selected while it is the selected one, as the screens see it. */
    fun overlay(state: AppState): AppState = overlay(state, shown.value)

    companion object {
        /**
         * The same view from collected values of [place] and [selected]: a screen that collects both flows and the saved
         * state redraws on each of them, also when only the selection moved off the unsaved place.
         */
        fun overlay(state: AppState, place: Place?, selected: Boolean): AppState = when {
            place == null -> state
            selected -> state.copy(places = state.places + place, placeIndex = state.places.size)
            else -> state.copy(places = state.places + place)
        }
    }

    override fun current(): AppState? = saved.current()?.let(::overlay)

    override fun change(update: (AppState) -> AppState) {
        val now = shown.value ?: return saved.change(update)
        val base = saved.current() ?: return
        val before = overlay(base, now)
        val after = update(before)
        if (after.places.size != before.places.size) {
            // A change that adds or removes places is the saved list's own: the unsaved place goes first.
            set(null)
            return saved.change(update)
        }
        val last = before.places.lastIndex
        set(Shown(after.places.last(), selected = after.placeIndex == last))
        saved.change { s ->
            val changed = update(overlay(s, now))
            if (changed.places.size != s.places.size + 1) return@change s
            // While the unsaved place is selected, the saved selection stays the one before it.
            val selection = if (changed.placeIndex == s.places.size) s.placeIndex else changed.placeIndex
            changed.copy(places = changed.places.dropLast(1), placeIndex = selection)
        }
    }

    private fun set(value: Shown?) {
        shown.value = value
        placeNow.value = value?.place
        selectedNow.value = value?.selected == true
    }

    private fun overlay(state: AppState, value: Shown?): AppState = overlay(state, value?.place, value?.selected == true)
}
