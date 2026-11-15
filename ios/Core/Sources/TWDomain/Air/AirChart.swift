import Foundation
import TWModel

/// The SVG ngAirChart (client/www/js/app.js L1552-L1704) draws for S05's hourly series in a `width` × `height` pt area:
/// an x axis `bottom` pt from the top with a tick at the middle of each date's band (`ticks`) and its line from
/// `domainStart` to `domainEnd`, then a bar per slot (`bars`), which covers the axis where it stands. A series with a slot
/// the apply did not reach draws nothing (the directive stops at it): `domainStart` is nil and there are no ticks or bars.
/// Port of the Android `AirChart` (AN-09).
public struct AirChart: Sendable, Equatable {
    /// A tick at `x`: a 6 pt line down from the axis, which for the 13th date (the current hour) reaches up to the top of
    /// the chart 2 pt wide (`current`); its `label` (the hour every three hours, else empty) 9 pt under the axis with
    /// `dy` 0.71 em, and under 0시 the `date` (`MM.DD`) 1.065 em lower.
    public struct Tick: Sendable, Equatable {
        public let x: Double
        public let label: String
        public let date: String?
        public let current: Bool
    }

    /// A bar of a slot: `fill` its grade color (nil: the class color); `current` the current hour (`chart-bar`).
    public struct Bar: Sendable, Equatable {
        public let x: Double
        public let y: Double
        public let width: Double
        public let height: Double
        public let fill: String?
        public let current: Bool
    }

    public let width: Double
    public let height: Double
    public let bottom: Double
    public let ticks: [Tick]
    public let domainStart: Double?
    public let domainEnd: Double?
    public let bars: [Bar]

    /// Margins of the directive: top -5, right 5, bottom 35, left 5.
    static let side = 5.0
    static let marginBottom = 35.0
    static let marginTop = -5.0

    /// The chart of `series` with the colors of `standard`; `hour` is `LOC_HOUR` (`strHour`).
    public static func build(_ series: AirSeries, standard: AirStandard?, hour: String, width: Double, height: Double = 100) -> AirChart {
        let bottom = height - marginBottom
        let slots = series.data
        if slots.contains(where: { $0 == nil || $0 == .null }) {
            return AirChart(width: width, height: height, bottom: bottom, ticks: [], domainStart: nil, domainEnd: nil, bars: [])
        }
        // d3.max(data, d => d.val + d.val/10): an undefined value is NaN and skipped, null counts as 0. A truthy standard
        // maximum raises it (Math.max: NaN when no slot has a value).
        var top: Double? = D3.max(slots.map { slot -> Double? in
            let v = value(slot)
            return v + v / 10
        })
        if let std = series.maxValue, std != 0, !std.isNaN {
            if let m = top { top = m.isNaN ? .nan : Swift.max(std, m) } else { top = .nan }
        }
        let y = D3.Linear(0, top, bottom, marginTop)
        let dates = slots.map { Js.string($0?.objectValue?["date"]) }
        // An ordinal domain keeps each date once, in order; the bands share the width between them.
        var domain: [String] = []
        for d in dates where !domain.contains(where: { JSString.equal($0, d) }) { domain.append(d) }
        let band = D3.band(side, width - side, domain.count)
        let ticks = domain.enumerated().map { i, date -> Tick in
            let hourOfDay = parseInt(substring(date, 11, 13))
            let shown = hourOfDay == 0 || (!hourOfDay.isNaN && hourOfDay.truncatingRemainder(dividingBy: 3) == 0)
            return Tick(x: side + band * Double(i) + band / 2,
                        label: shown ? Js.numberToString(hourOfDay) + hour : "",
                        date: hourOfDay == 0 ? substring(date, 5, 7) + "." + substring(date, 8, 10) : nil,
                        current: i == 12)
        }
        let bars = slots.enumerated().map { i, slot -> Bar in
            let row = slot?.objectValue
            let v = row?["val"]
            let present = Js.present(v)
            let color = AirQuality.gradeColor(standard, row?["grade"], nil)
            return Bar(x: band * Double(i) + 1 + side,
                       y: present ? y(Js.number(v)) : y(0),
                       width: band - 2,
                       height: present ? y(0) - y(Js.number(v)) : 0,
                       fill: color.isEmpty ? nil : color,
                       current: i == 12)
        }
        return AirChart(width: width, height: height, bottom: bottom, ticks: ticks, domainStart: side, domainEnd: width - side,
                        bars: bars)
    }

    /// `d.val` as the arithmetic reads it (the server sends numbers): NaN for undefined, 0 for null.
    private static func value(_ slot: JSONValue?) -> Double {
        guard let v = slot?.objectValue?["val"] else { return .nan }
        return Js.number(v)
    }

    /// `s.substr(from, to - from)` by UTF-16 code units, clamped to the string.
    private static func substring(_ s: String, _ from: Int, _ to: Int) -> String {
        let units = Array(s.utf16)
        let a = Swift.min(from, units.count), b = Swift.min(to, units.count)
        return String(decoding: units[a..<b], as: UTF16.self)
    }

    /// JavaScript `parseInt(s)`: leading white space, a sign and the digits before anything else; NaN without digits.
    private static func parseInt(_ s: String) -> Double {
        var chars = Substring(s)
        while let c = chars.first, c.isWhitespace { chars.removeFirst() }
        var negative = false
        if let c = chars.first, c == "+" || c == "-" {
            negative = c == "-"
            chars.removeFirst()
        }
        let digits = chars.prefix { $0.isASCII && $0.isNumber }
        guard !digits.isEmpty, let n = Double(digits) else { return .nan }
        return negative ? -n : n
    }
}
