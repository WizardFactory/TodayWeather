package net.wizardfactory.todayweather.ads

import net.wizardfactory.todayweather.core.domain.shell.Tab

/** Activity-owned, main-thread inventory. A tab keeps its assigned ad. Only the unused spare can change hands. */
internal class NativeInventory<T : Any>(
    private val load: ((T?) -> Unit) -> Unit,
    private val release: (T) -> Unit,
    private val clock: () -> Long,
    private val post: (() -> Unit) -> Unit,
) {
    private data class Entry<T>(val ad: T, val loadedAt: Long)
    private val assigned = mutableMapOf<Tab, Entry<T>>()
    private var spare: Entry<T>? = null
    private var enabled = false
    private var foreground = false
    private var loading = false
    private var generation = 0L
    private var retryAfter = 0L
    private var current: Visit? = null

    fun setEnabled(value: Boolean) {
        if (enabled == value) return
        enabled = value
        if (value) {
            prepareSpare()
        } else {
            generation++
            loading = false
            retryAfter = 0L
            current?.clear()
            assigned.values.forEach { release(it.ad) }
            assigned.clear()
            spare?.let { release(it.ad) }
            spare = null
        }
    }

    fun setForeground(value: Boolean) {
        foreground = value
        if (value) prepareSpare()
    }

    /**
     * Opens a visit. An ad on hand is taken at once; otherwise the visit stays pending, and a fill that arrives
     * before its slot is reached is shown in it (#3212).
     */
    fun open(tab: Tab, key: Any, show: (T?) -> Unit): Visit {
        discardExpired()
        current?.takeIf { it.key === key }?.let {
            it.attach(show)
            return it
        }
        current?.close()
        val visit = Visit(key, tab)
        current = visit
        take(tab)?.let { visit.decide(it.ad) }
        visit.attach(show)
        prepareSpare()
        return visit
    }

    fun end(key: Any) {
        current?.takeIf { it.key === key }?.close()
    }

    private fun take(tab: Tab): Entry<T>? = assigned[tab] ?: spare?.also {
        assigned[tab] = it
        spare = null
    }

    private fun prepareSpare() {
        if (!enabled || !foreground) return
        discardExpired()
        if (loading || spare != null || assigned.size == Tab.entries.size || clock() < retryAfter) return
        loading = true
        val request = ++generation
        post {
            if (request != generation) return@post
            if (!foreground) {
                loading = false
                return@post
            }
            load { ad ->
                if (request != generation || !loading) {
                    ad?.let(release)
                } else {
                    loading = false
                    if (ad == null) {
                        retryAfter = clock() + 60_000L
                    } else {
                        spare = Entry(ad, clock())
                        // The reader has not reached the slot yet: the card appears below the viewport.
                        current?.takeIf { it.pending }?.let { visit ->
                            take(visit.tab)?.let { visit.decide(it.ad) }
                            prepareSpare()
                        }
                    }
                }
            }
        }
    }

    private fun discardExpired() {
        val cutoff = clock() - 55 * 60_000L
        assigned.entries.removeAll { (tab, entry) ->
            if (entry.loadedAt > cutoff) return@removeAll false
            if (current?.tab == tab) current?.clear()
            release(entry.ad)
            true
        }
        spare?.takeIf { it.loadedAt <= cutoff }?.let {
            release(it.ad)
            spare = null
        }
    }

    /**
     * One decision per actual page visit, made by an ad on hand at opening, a fill before the slot is reached, or a
     * miss once it is reached. Changing a menu or search overlay only detaches its renderer.
     */
    inner class Visit(val key: Any, val tab: Tab) {
        private var creative: T? = null
        private var render: ((T?) -> Unit)? = null
        internal var pending = true
            private set

        internal fun attach(show: (T?) -> Unit) {
            render = show
            show(creative)
        }

        internal fun decide(ad: T) {
            pending = false
            creative = ad
            render?.invoke(ad)
        }

        internal fun clear() {
            creative = null
            render?.invoke(null)
        }

        fun detach() { render = null }

        /** The slot's insertion point came into the viewport: decide now. A later fill waits for another visit. */
        fun reach() {
            if (current !== this || !pending) return
            discardExpired()
            val entry = take(tab)
            pending = false
            if (entry != null) {
                decide(entry.ad)
                prepareSpare()
            }
        }

        internal fun close() {
            if (current === this) current = null
            clear()
            detach()
        }
    }
}
