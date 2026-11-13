import Foundation

/// The D3 v3.5.17 arithmetic the chart directives use (client/www/lib/d3/d3.js), with the same operations (port of
/// Kotlin `chart/D3.kt`). `log` and `pow` are the platform's, as JavaScriptCore's `Math.log` and `Math.pow` on iOS.
enum D3 {
    /// `rangeBand()` of `d3.scale.ordinal().rangeBands([start, stop])` over `d3.range(n)` (no padding).
    static func band(_ start: Double, _ stop: Double, _ n: Int) -> Double { (stop - start) / Double(n) }

    /// `d3.min(values)`: the first defined, non-NaN value, then smaller ones (`a > b`). Nil is JavaScript undefined
    /// or null.
    static func min(_ values: [Double?]) -> Double? {
        let v = values.compactMap { $0 }.filter { !$0.isNaN }
        guard var a = v.first else { return nil }
        for b in v.dropFirst() where a > b { a = b }
        return a
    }

    static func max(_ values: [Double?]) -> Double? {
        let v = values.compactMap { $0 }.filter { !$0.isNaN }
        guard var a = v.first else { return nil }
        for b in v.dropFirst() where b > a { a = b }
        return a
    }

    /// `d3.scale.linear().range([r0, r1]).domain([d0, d1]).nice()`; undefined domain values give NaN.
    struct Linear {
        private(set) var domain: [Double]
        private let r0: Double
        private let r1: Double

        init(_ d0: Double?, _ d1: Double?, _ r0: Double, _ r1: Double) {
            self.r0 = r0
            self.r1 = r1
            domain = [d0 ?? .nan, d1 ?? .nan]
            for _ in 0..<2 { Self.niceOnce(&domain, Self.tickStep(domain)) }
        }

        /// `d3_interpolateNumber(r0, r1)(d3_uninterpolateNumber(d0, d1)(x))`.
        func callAsFunction(_ x: Double?) -> Double {
            let a = domain[0]
            var b = domain[1] - a
            if b == 0 || b.isNaN { b = 1 / b } // `b = (b -= a) || 1 / b`
            let t = ((x ?? .nan) - a) / b
            return r0 * (1 - t) + r1 * t
        }

        private static func tickStep(_ domain: [Double], _ m: Double = 10) -> Double {
            let start = domain[0] < domain[1] ? domain[0] : domain[1]
            let stop = domain[0] < domain[1] ? domain[1] : domain[0]
            let span = stop - start
            var step = Foundation.pow(10.0, (Foundation.log(span / m) / ln10).rounded(.down))
            let err = m / span * step
            if err <= 0.15 { step *= 10 } else if err <= 0.35 { step *= 5 } else if err <= 0.75 { step *= 2 }
            return step
        }

        private static func niceOnce(_ domain: inout [Double], _ step: Double) {
            var i0 = 0
            var i1 = domain.count - 1
            var x0 = domain[i0]
            var x1 = domain[i1]
            if x1 < x0 {
                swap(&i0, &i1)
                swap(&x0, &x1)
            }
            // `step ? {floor, ceil} : identity` (0 and NaN are falsy)
            if step != 0 && !step.isNaN {
                domain[i0] = (x0 / step).rounded(.down) * step
                domain[i1] = (x1 / step).rounded(.up) * step
            } else {
                domain[i0] = x0
                domain[i1] = x1
            }
        }

        private static let ln10 = 2.302585092994046
    }
}
