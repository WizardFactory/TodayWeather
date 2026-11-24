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
 * - **Threads (CODEX-3190-1, -8, -9):** the app changes it on the main thread (photos arrive there too). As a guard the
 *   unsaved place is one value ([unsaved]) changed by compare-and-set, and nothing is held while the saved state is
 *   called, so a change in flight never writes back a place that was replaced meanwhile, and a holder that resumes a
 *   waiting reader while it publishes never waits on this one. Changes handed to the holder are pure: it applies them
 *   again on each publish and when it writes them (CODEX-3190-11).
 * - **Selection (CODEX-3190-2):** the unsaved place is the selected one when it was selected last, or when the saved
 *   selection names no enabled saved place. While it is selected, S02's changes ([savedAccess]) keep the saved selection
 *   on the saved place selected before it ([Unsaved.returnTo]), else the first enabled one, else none, so the next start
 *   opens that place (#3180) and never a deleted or disabled row.
 */
class LinkPreview(private val saved: StateAccess) : StateAccess {
    /**
     * The unsaved place; [selected] when it was selected last; [returnTo], the saved place selected before it, which a
     * new start opens.
     */
    data class Unsaved(val place: Place, val selected: Boolean, val returnTo: Place? = null)

    private val shown = MutableStateFlow<Unsaved?>(null)

    /** The unsaved place with its selection, as one value: what the screens draw ([overlay]). */
    val unsaved: StateFlow<Unsaved?> = shown.asStateFlow()

    /**
     * The saved state for S02, which lists and changes the saved places only: while the unsaved place is selected, a
     * delete or a disable keeps the saved selection on [Unsaved.returnTo] when it stays enabled, else on the first enabled
     * place, else on none (-1). Otherwise Cordova's rules apply as they are.
     */
    val savedAccess: StateAccess = object : StateAccess {
        override fun current(): AppState? = saved.current()

        override fun change(update: (AppState) -> AppState) {
            // Read once: the holder applies the change again when it writes it, after the unsaved place may have gone
            // (CODEX-3190-11).
            val now = shown.value
            saved.change { s ->
                val changed = update(s)
                // Judged after the change: turning off the only enabled place makes the unsaved place the selected one.
                if (now == null || !selected(changed, now)) changed else changed.copy(placeIndex = savedSelection(changed, now.returnTo))
            }
        }
    }

    /** Shows [place] (enabled) as the selected place, in place of an earlier unsaved one. */
    fun show(place: Place) {
        while (true) {
            val now = shown.value
            val base = saved.current()
            val returnTo = when {
                now != null && base != null && selected(base, now) -> now.returnTo
                else -> base?.let(::enabledSelection)
            }
            if (shown.compareAndSet(now, Unsaved(place.copy(disable = false), selected = true, returnTo = returnTo))) return
        }
    }

    fun clear() {
        shown.value = null
    }

    /**
     * Saves the selected unsaved place where it stands, at the end of the list, and keeps it selected; when a saved
     * place lies within 0.01° ([LinkRoutes.nearbySaved]: by coordinates, as a link or a result matches, not
     * `getIndexOfCity`'s name and address, CODEX-3164-4) that one is selected instead, so a second tap saves nothing more.
     * On the start page the add closes S01 (`closeStart`), keeping that selection. The selected index, or null when the
     * unsaved place is not the selected one. The app has no place limit (S02 neither).
     */
    fun add(): Int? {
        val now = shown.value ?: return null
        if (!selected(saved.current() ?: return null, now)) return null
        saved.change { s ->
            val existing = LinkRoutes.nearbySaved(s, now.place)
            val added = if (existing >= 0) s.copy(placeIndex = existing)
            else s.copy(places = s.places + now.place, placeIndex = s.places.size)
            if (added.startShows) added.closeStart().copy(placeIndex = added.placeIndex) else added
        }
        // After the save, so the start page never shows in between. The place saved leaves the slot also when its own
        // fields (a photo) changed meanwhile; another place shown meanwhile stays (CODEX-3190-9).
        while (true) {
            val after = shown.value ?: break
            if (!samePlace(after.place, now.place) || shown.compareAndSet(after, null)) break
        }
        return saved.current()?.placeIndex
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

        /** Whether [unsaved] is the selected place over the saved [state]. */
        private fun selected(state: AppState, unsaved: Unsaved): Boolean = unsaved.selected || enabledSelection(state) == null

        /** The saved place the saved selection names, when it is an enabled one. */
        private fun enabledSelection(state: AppState): Place? = state.places.getOrNull(state.placeIndex)?.takeIf { !it.disable }

        /**
         * The saved selection while the unsaved place is selected: [returnTo] when it is still there and enabled, else
         * the first enabled row (not `setFirstCityIndex`, which names row 0 or 1 even when disabled), else -1.
         */
        private fun savedSelection(state: AppState, returnTo: Place?): Int {
            val back = returnTo?.let { place -> state.places.indexOfFirst { samePlace(it, place) } } ?: -1
            if (back >= 0 && !state.places[back].disable) return back
            return state.places.indexOfFirst { !it.disable }
        }

        /**
         * The same place whatever its loaded fields (photo, source): the current position by its flag; another place by
         * its name and address, and by its coordinates when both have them, so two places of one name at different
         * coordinates differ (CODEX-3190-10) and an old place whose coordinates a response fills in later stays the same
         * (CODEX-3190-13).
         */
        private fun samePlace(a: Place, b: Place): Boolean = when {
            a.currentPosition || b.currentPosition -> a.currentPosition && b.currentPosition
            else -> a.name == b.name && a.address == b.address && (a.location == null || b.location == null || a.location == b.location)
        }
    }

    override fun current(): AppState? = saved.current()?.let(::overlay)

    override fun change(update: (AppState) -> AppState) {
        while (true) {
            val now = shown.value ?: return saved.change(update)
            val base = saved.current() ?: return
            val before = overlay(base, now)
            val after = update(before)
            if (after.places.size != before.places.size) {
                // A change that adds or removes places is the saved list's own: the unsaved place goes first.
                if (!shown.compareAndSet(now, null)) continue
                return saved.change(update)
            }
            val last = before.places.lastIndex
            val selectedAfter = after.placeIndex == last
            // Moving onto the unsaved place remembers the saved place it came from.
            val returnTo = if (selectedAfter && !selected(base, now)) enabledSelection(base) else now.returnTo
            // A show, a star or another change in between: compute again over what is shown now.
            if (!shown.compareAndSet(now, Unsaved(after.places.last(), selectedAfter, returnTo))) continue
            saved.change { s ->
                val changed = update(overlay(s, now))
                if (changed.places.size != s.places.size + 1) return@change s
                // While the unsaved place is selected, the saved selection stays the one before it.
                val selection = if (changed.placeIndex == s.places.size) s.placeIndex else changed.placeIndex
                changed.copy(places = changed.places.dropLast(1), placeIndex = selection)
            }
            return
        }
    }
}
