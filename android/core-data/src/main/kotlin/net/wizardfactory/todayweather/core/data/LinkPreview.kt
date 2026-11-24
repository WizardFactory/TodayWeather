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
 *
 * Shows, changes and the star run one at a time ([lock]), whichever thread calls them: a photo refresh off the main
 * thread never writes back a place that a search or link replaced meanwhile (CODEX-3190-1). The screens read the place
 * and its selection as one value ([unsaved]).
 */
class LinkPreview(private val saved: StateAccess) : StateAccess {
    /** The unsaved place and whether it is the selected one (the saved selection stays the one before it). */
    data class Unsaved(val place: Place, val selected: Boolean)

    private val lock = Any()
    private val shown = MutableStateFlow<Unsaved?>(null)
    private val placeNow = MutableStateFlow<Place?>(null)
    private val selectedNow = MutableStateFlow(false)

    /** The unsaved place with its selection, as one value: what the screens draw ([overlay]). */
    val unsaved: StateFlow<Unsaved?> = shown.asStateFlow()

    /** The place shown without being saved; null when none is. */
    val place: StateFlow<Place?> = placeNow.asStateFlow()

    /** True while the unsaved place is the selected one: the header shows its star in the bell's position. */
    val selected: StateFlow<Boolean> = selectedNow.asStateFlow()

    /** Shows [place] (enabled) as the selected place, in place of an earlier unsaved one. */
    fun show(place: Place) = synchronized(lock) { set(Unsaved(place.copy(disable = false), selected = true)) }

    fun clear() = synchronized(lock) { set(null) }

    /**
     * Saves the selected unsaved place where it stands, at the end of the list, and keeps it selected; when a saved
     * place lies within 0.01° ([LinkRoutes.nearbySaved]: by coordinates, as a link or a result matches, not
     * `getIndexOfCity`'s name and address, CODEX-3164-4) that one is selected instead. On the start page the add closes
     * S01 (`closeStart`), keeping that selection. The selected index, or null when the unsaved place is not the
     * selected one. The app has no place limit (S02 neither).
     */
    fun add(): Int? = synchronized(lock) {
        val now = shown.value ?: return null
        if (!selected(saved.current() ?: return null, now)) return null
        saved.change { s ->
            val existing = LinkRoutes.nearbySaved(s, now.place)
            val added = if (existing >= 0) s.copy(placeIndex = existing)
            else s.copy(places = s.places + now.place, placeIndex = s.places.size)
            if (added.startShows) added.closeStart().copy(placeIndex = added.placeIndex) else added
        }
        // After the save, so the start page never shows in between.
        set(null)
        saved.current()?.placeIndex
    }

    /** True when [index] of the shown state is the unsaved place: no saved place, alarm or widget has it. */
    fun isPreview(index: Int): Boolean = shown.value != null && index == saved.current()?.places?.size

    /** True when the unsaved place is the selected place of [state], the shown state: the header shows its star. */
    fun isSelected(state: AppState): Boolean = shown.value != null && state.placeIndex == state.places.lastIndex

    /**
     * True when [index], from outside the screens (`todayweather://N`, a notification's `cityIndex`), names a saved
     * place: the unsaved place has no number there (CODEX-3190-3).
     */
    fun isSaved(index: Double): Boolean {
        val count = saved.current()?.places?.size ?: return false
        return index >= 0 && index < count
    }

    /** True when the tabs show over S01 for an unsaved place ([state] as [overlay] gives it). */
    fun bypassesStart(state: AppState): Boolean = state.startShows && shown.value != null

    /** [state] with the unsaved place appended, and selected while it is the selected one, as the screens see it. */
    fun overlay(state: AppState): AppState = overlay(state, shown.value)

    companion object {
        /**
         * The same view from a collected [unsaved] value: a screen that collects it and the saved state redraws on each,
         * also when only the selection moved off the unsaved place.
         */
        fun overlay(state: AppState, unsaved: Unsaved?): AppState = when {
            unsaved == null -> state
            selected(state, unsaved) -> state.copy(places = state.places + unsaved.place, placeIndex = state.places.size)
            else -> state.copy(places = state.places + unsaved.place)
        }

        /**
         * Whether [unsaved] is the selected place over the saved [state]: when it was selected last, or when the saved
         * selection is past the saved places, where it would name the unsaved place (S02 deleted the last enabled place,
         * and Cordova's `removeCity` keeps the index; CODEX-3190-2).
         */
        private fun selected(state: AppState, unsaved: Unsaved): Boolean = unsaved.selected || state.placeIndex !in state.places.indices
    }

    override fun current(): AppState? = saved.current()?.let(::overlay)

    override fun change(update: (AppState) -> AppState): Unit = synchronized(lock) {
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
        set(Unsaved(after.places.last(), selected = after.placeIndex == last))
        saved.change { s ->
            val changed = update(overlay(s, now))
            if (changed.places.size != s.places.size + 1) return@change s
            // While the unsaved place is selected, the saved selection stays the one before it.
            val selection = if (changed.placeIndex == s.places.size) s.placeIndex else changed.placeIndex
            changed.copy(places = changed.places.dropLast(1), placeIndex = selection)
        }
    }

    private fun set(value: Unsaved?) {
        shown.value = value
        placeNow.value = value?.place
        selectedNow.value = value?.selected == true
    }

    private fun overlay(state: AppState, value: Unsaved?): AppState = Companion.overlay(state, value)
}
