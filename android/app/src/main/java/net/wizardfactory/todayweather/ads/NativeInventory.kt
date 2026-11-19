package net.wizardfactory.todayweather.ads

/**
 * Main-thread owner of one displayed creative and one preloaded spare across tab visits.
 * A displayed slot must never jump into the reader's viewport after the weather has appeared.
 */
internal class NativeInventory<T : Any>(
    private val load: ((T?) -> Unit) -> Unit,
    private val release: (T) -> Unit,
    private val clock: () -> Long,
) {
    private var enabled = false
    private var loading = false
    private var generation = 0
    private var spare: T? = null
    private var loadedAt = 0L
    private var current: Visit? = null

    fun setEnabled(value: Boolean) {
        if (enabled == value) return
        enabled = value
        if (enabled) {
            preload()
        } else {
            generation++
            loading = false
            spare?.let(release)
            spare = null
            current?.clear()
        }
    }

    fun open(visitKey: Any, show: (T?) -> Unit): Visit {
        current?.takeIf { it.key === visitKey }?.let { visit ->
            visit.attach(show)
            return visit
        }
        current?.close()
        val visit = Visit(visitKey, show)
        current = visit
        visit.takeReady()
        preload()
        return visit
    }

    fun displayedFor(visitKey: Any): T? = current?.takeIf { it.key === visitKey }?.displayed

    fun end(visitKey: Any) {
        current?.takeIf { it.key === visitKey }?.close()
    }

    private fun preload() {
        if (!enabled || loading || spare != null) return
        loading = true
        val request = ++generation
        load { ad ->
            if (generation != request || !loading) {
                ad?.let(release)
            } else {
                loading = false
                spare = ad
                loadedAt = clock()
                if (ad != null && current?.canInsertOffscreen == true) current?.takeReady()
            }
        }
    }

    inner class Visit(val key: Any, private var show: ((T?) -> Unit)?) {
        var displayed: T? = null
            private set
        private var reached = false
        var canInsertOffscreen = false
            private set

        fun position(belowViewport: Boolean) {
            if (current !== this || show == null) return
            if (!belowViewport) reached = true
            canInsertOffscreen = belowViewport && !reached && displayed == null
            if (canInsertOffscreen) takeReady()
        }

        internal fun takeReady() {
            if (displayed != null || reached) return
            val ad = spare ?: return
            spare = null
            if (clock() - loadedAt >= 60 * 60 * 1_000L) {
                release(ad)
            } else {
                displayed = ad
                canInsertOffscreen = false
                show?.invoke(ad)
            }
            preload()
        }

        internal fun clear() {
            displayed?.let { ad ->
                displayed = null
                reached = true
                canInsertOffscreen = false
                show?.invoke(null)
                release(ad)
            }
        }

        // Overlays remove the view but retain the reader's progress and any displayed creative.
        fun detach() {
            show = null
            canInsertOffscreen = false
        }

        internal fun attach(render: (T?) -> Unit) {
            show = render
            render(displayed)
        }

        fun close() {
            if (current === this) current = null
            clear()
            detach()
        }
    }
}
