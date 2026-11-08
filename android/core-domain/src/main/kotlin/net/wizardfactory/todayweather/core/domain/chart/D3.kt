package net.wizardfactory.todayweather.core.domain.chart

import kotlin.math.ceil
import kotlin.math.floor

/** The D3 v3.5.17 arithmetic the chart directives use (client/www/lib/d3/d3.js), with the same operations. */
internal object D3 {
    /** `rangeBand()` of `d3.scale.ordinal().rangeBands([start, stop])` over `d3.range(n)` (no padding). */
    fun band(start: Double, stop: Double, n: Int): Double = (stop - start) / n

    /**
     * `d3.min(values)`: the first defined, non-NaN value, then smaller ones (`a > b`). Null is
     * JavaScript undefined or null.
     */
    fun min(values: List<Double?>): Double? = values.filter { it != null && !it.isNaN() }.let { v ->
        if (v.isEmpty()) null else v.reduce { a, b -> if (a!! > b!!) b else a }
    }

    fun max(values: List<Double?>): Double? = values.filter { it != null && !it.isNaN() }.let { v ->
        if (v.isEmpty()) null else v.reduce { a, b -> if (b!! > a!!) b else a }
    }

    /** `d3.scale.linear().range([r0, r1]).domain([d0, d1]).nice()`; undefined domain values give NaN. */
    class Linear(d0: Double?, d1: Double?, private val r0: Double, private val r1: Double) {
        val domain: DoubleArray = doubleArrayOf(d0 ?: Double.NaN, d1 ?: Double.NaN).also { nice(it) }

        /** `d3_interpolateNumber(r0, r1)(d3_uninterpolateNumber(d0, d1)(x))`. */
        operator fun invoke(x: Double?): Double {
            val a = domain[0]
            var b = domain[1] - a
            if (b == 0.0 || b.isNaN()) b = 1 / b // `b = (b -= a) || 1 / b`
            val t = ((x ?: Double.NaN) - a) / b
            return r0 * (1 - t) + r1 * t
        }

        private fun nice(domain: DoubleArray) {
            repeat(2) { niceOnce(domain, tickStep(domain)) }
        }

        private fun tickStep(domain: DoubleArray, m: Double = 10.0): Double {
            val start = if (domain[0] < domain[1]) domain[0] else domain[1]
            val stop = if (domain[0] < domain[1]) domain[1] else domain[0]
            val span = stop - start
            var step = StrictMath.pow(10.0, floor(StrictMath.log(span / m) / LN10))
            val err = m / span * step
            if (err <= .15) step *= 10.0 else if (err <= .35) step *= 5.0 else if (err <= .75) step *= 2.0
            return step
        }

        private fun niceOnce(domain: DoubleArray, step: Double) {
            var i0 = 0
            var i1 = domain.size - 1
            var x0 = domain[i0]
            var x1 = domain[i1]
            if (x1 < x0) {
                i0 = i1.also { i1 = i0 }
                x0 = x1.also { x1 = x0 }
            }
            // `step ? {floor, ceil} : identity` (0 and NaN are falsy)
            if (step != 0.0 && !step.isNaN()) {
                domain[i0] = floor(x0 / step) * step
                domain[i1] = ceil(x1 / step) * step
            } else {
                domain[i0] = x0
                domain[i1] = x1
            }
        }
    }

    private const val LN10 = 2.302585092994046
}
