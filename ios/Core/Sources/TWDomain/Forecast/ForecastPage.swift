import Foundation
import TWModel

/// The unit settings the weather pages show (`Units.getUnit`).
public struct PageUnits: Sendable, Equatable {
    public var temperature: String?
    public var windSpeed: String?
    public var pressure: String?
    public var distance: String?
    public var precipitation: String?
    public var air: String?

    public init(temperature: String?, windSpeed: String?, pressure: String?, distance: String?, precipitation: String?,
                air: String?) {
        self.temperature = temperature
        self.windSpeed = windSpeed
        self.pressure = pressure
        self.distance = distance
        self.precipitation = precipitation
        self.air = air
    }
}

/// How a piece of a row's text is set: the row's font, `<small>` (0.8 em), `.sub-text` (13 px, #666), `<small>` in it,
/// a link, or the arrow after a link (`.colgroup-box a:after`, the Ionicons glyph U+F3D3).
public enum RunStyle: Sendable, Equatable {
    case plain, small, sub, subSmall, link, linkArrow
}

/// A piece of a row's text; `color` is a grade color (`grade2Color`), nil for the row's own color.
public struct TextRun: Sendable, Equatable {
    public let text: String
    public let style: RunStyle
    public let color: String?

    public init(_ text: String, _ style: RunStyle = .plain, color: String? = nil) {
        self.text = text
        self.style = style
        self.color = color
    }

    func with(text: String) -> TextRun { TextRun(text, style, color: color) }

    public static func == (a: TextRun, b: TextRun) -> Bool {
        JSString.equal(a.text, b.text) && a.style == b.style && a.color == b.color
    }
}

/// An image from the theme's folders: a weather image (`weatherImgPath`) or an icon (`iconsImgPath`), by file name.
public struct PageImage: Sendable, Equatable {
    public let weather: Bool
    public let name: String
}

/// What tapping a part of a weather page opens.
public enum PageAction: Sendable, Equatable {
    /// S05 for a pollutant (`goAirInfoPage(code)`).
    case airInfo(String)
    /// The units page (`goUnitsPage()`).
    case units
    /// The air forecast source's description (`popUpAirForecastInfo(source)`).
    case airForecastInfo(String)
    /// The pollen popup (`showPollenInfo(currentWeather.today)`).
    case pollen([PollenRow])
    /// An outside page (`openUrl`).
    case url(String)
}

/// A pollen type of the pollen popup: translation keys and the grade text as `showPollenInfo` builds them.
public struct PollenRow: Sendable, Equatable {
    public let labelKey: String
    public let gradeLabel: String
    public let infoKey: String
    public let adviceKey: String

    public init(labelKey: String, gradeLabel: String, infoKey: String, adviceKey: String) {
        self.labelKey = labelKey
        self.gradeLabel = gradeLabel
        self.infoKey = infoKey
        self.adviceKey = adviceKey
    }
}

/// The header block's weather (`.main-box`): temperature, sky image and the summary lines.
public struct Hero: Sendable, Equatable {
    public let temperature: String
    public let sky: PageImage
    public let summary: String
    public let summaryAir: String?
}

/// A cell of an AQI table: heading, the sentiment glyph in the grade color, the grade text and a value under it.
public struct AqiCell: Sendable, Equatable {
    public let heading: String
    public let glyph: String
    public let color: String?
    public let grade: String
    public var value: [TextRun] = []
    public var action: PageAction? = nil
}

/// A row of the detail weather card (S03): an image and its text; the pollen row is a button.
public struct WeatherRow: Sendable, Equatable {
    public let image: PageImage
    public let text: [TextRun]
    public var pollen: [PollenRow]? = nil
}

/// A row of the detail AQI card (S03): label, then a glyph (in the grade color) and its text.
public struct AirRow: Sendable, Equatable {
    public let label: String
    public let glyph: String
    public let color: String?
    public let text: [TextRun]
    public var action: PageAction? = nil
}

/// A day of the daily detail card (S04): the calendar title and the rows under it.
public struct DayCell: Sendable, Equatable {
    public let title: String
    public let rows: [DayRow]
}

/// A row of a day: image, value and the label under the value.
public struct DayRow: Sendable, Equatable {
    public let image: PageImage
    public let value: [TextRun]
    public let label: String
}

/// A row of the legacy daily dust table (S04, `dailyAqiForecast` undefined): the day and its pollutant cells.
public struct DustRow: Sendable, Equatable {
    public let weekday: String
    public let date: String
    public let dayString: String
    public let cells: [AqiCell]
}

/// The daily AQI card (S04): the forecast list, or the legacy rows at positions 7 and 8 of the daily chart.
public struct DailyAqi: Sendable, Equatable {
    public let title: String
    public let cells: [AqiCell]?
    public let legacyRows: [DustRow]?
}

/// The data-source notice under the cards (`source == 'DSF'` or `'VC'`).
public enum Attribution: Sendable, Equatable {
    case darkSky
    case visualCrossing

    public var url: String {
        switch self {
        case .darkSky: "https://darksky.net/poweredby"
        case .visualCrossing: "https://www.visualcrossing.com/"
        }
    }

    public static let visualCrossingText = "Weather Data Provided by Visual Crossing"
}

/// What the weather page templates show for a `ForecastScope`: tab-forecast.html (S03) and tab-dailyforecast.html (S04)
/// with TabCtrl's helpers. Texts are as the WebView renders them: AngularJS interpolation, then HTML white-space
/// collapsing. `texts` are the translated catalog strings. Port of the Android `ForecastPage`.
public struct ForecastPage: Sendable {
    public let title: String
    /// The current position's location glyph shows (unless loading).
    public let currentPosition: Bool
    public let hasPush: Bool
    /// The arrows beside the header (`cityCount > 1`).
    public let arrows: Bool
    public let hero: Hero?
    /// S03's chart block (`ng-if="timeWidth"`); S04's chart is always there.
    public let showChart: Bool
    public let hourlyAqiTitle: String
    public let detailWeatherTitle: String
    public let detailAirTitle: String
    /// The hourly AQI forecast card (S03), more than one row.
    public let hourlyAqi: [AqiCell]?
    /// The current air card (S03) in place of the hourly forecast: PM2.5, PM10 and AQI, each when it has a value.
    public let currentAir: [AqiCell]?
    /// The detail weather card (S03).
    public let detailWeather: [WeatherRow]?
    /// The detail AQI card (S03).
    public let detailAir: [AirRow]?
    /// The daily AQI card (S04, `hasDustForecast()`).
    public let dailyAqi: DailyAqi?
    /// The daily detail card (S04, `ng-if="dayChart"`): yesterday, today and tomorrow.
    public let dayDetails: [DayCell]?
    /// The provider attribution under the cards; S03 waits for the first apply, S04 does not.
    public let attribution: Attribution?

    public init(scope: ForecastScope, units: PageUnits, texts: ChartTexts) {
        let b = Builder(scope: scope, units: units, texts: texts)
        title = Self.collapse(Js.display(scope.address))
        currentPosition = Js.truthy(scope.currentPosition)
        hasPush = scope.hasPush == true
        arrows = (scope.cityCount ?? 0) > 1
        hero = b.hero()
        showChart = scope.type == .mid || scope.timeWidth.map { $0 != 0 && !$0.isNaN } == true
        hourlyAqiTitle = texts["LOC_HOURLY_AQI_FORECAST"] + " (beta)"
        detailWeatherTitle = texts["LOC_DETAIL_WEATHER"]
        detailAirTitle = texts["LOC_DETAIL_AQI"]
        let short = scope.type == .short && scope.showDetailWeather
        hourlyAqi = short && scope.showHourlyAqiForecast() ? b.hourlyAqi() : nil
        currentAir = short && !scope.showHourlyAqiForecast() && b.showArpltn ? b.currentAir() : nil
        detailWeather = short ? b.weatherRows() : nil
        detailAir = short && b.showArpltn ? b.airRows() : nil
        dailyAqi = scope.type == .mid && scope.hasDustForecast() ? b.dailyAqi() : nil
        dayDetails = scope.type == .mid && Js.truthy(scope.dayChart) ? b.dayCells() : nil
        if scope.type == .short && !scope.showDetailWeather {
            attribution = nil
        } else if Js.looseEquals(scope.source, .string("DSF")) {
            attribution = .darkSky
        } else if Js.looseEquals(scope.source, .string("VC")) {
            attribution = .visualCrossing
        } else {
            attribution = nil
        }
    }

    /// Material Icons of the detail AQI card: place (`&#xE55C`), schedule and info.
    public static let station = "\u{E55C}"
    public static let time = "\u{E192}"
    public static let info = "\u{E88F}"
    /// `.colgroup-box a:after`: the Ionicons arrow after a link's text.
    static let linkArrow = TextRun("\u{F3D3}", .linkArrow)

    /// The translation keys the pages read, for the app to load from its catalog.
    public static let keys = [
        "LOC_HOUR", "LOC_HOURLY_AQI_FORECAST", "LOC_DAILY_AQI_FORECAST", "LOC_DETAIL_WEATHER", "LOC_DETAIL_AQI", "LOC_WEATHER",
        "LOC_HUMIDITY", "LOC_WIND", "LOC_VISIBILITY", "LOC_PRESSURE", "LOC_DISCOMFORT_INDEX", "LOC_FEELS_LIKE",
        "LOC_HOURLY_PRECIPITATION", "LOC_UV", "LOC_POLLEN_RISK", "LOC_FOOD_POISONING", "LOC_SUNRISE", "LOC_SUNSET",
        "LOC_PM25", "LOC_PM10", "LOC_O3", "LOC_NO2", "LOC_CO", "LOC_SO2", "LOC_AQI", "LOC_STATION", "LOC_PUBLIC",
        "LOC_FORECAST", "LOC_AIR_QUALITY_INDEX_UNIT", "LOC_AIR_FORECAST_SOURCE", "LOC_AIR_QUALITY_INDEX_KR",
        "LOC_AIR_QUALITY_INDEX_KR_WHO", "LOC_AIR_QUALITY_INDEX_US", "LOC_AIR_QUALITY_INDEX_CN",
        "LOC_PROBABILITY_OF_PRECIPITATION", "LOC_DAILY_SNOWFALL", "LOC_DAILY_PRECIPITATION",
        "LOC_SAME_AS_YESTERDAY", "LOC_THAN_YESTERDAY", "LOC_THIS_DAY_TEMP", "LOC_PREVIOUS_DAY_TEMP",
        "LOC_A_COUPLE_OF_DAYS_AGO", "LOC_THE_DAY_BEFORE_YESTERDAY", "LOC_YESTERDAY", "LOC_TODAY", "LOC_TOMORROW",
        "LOC_THE_DAY_AFTER_TOMORROW", "LOC_TWO_DAYS_AFTER_TOMORROW", "LOC_FROM_TODAY",
        "LOC_SUN", "LOC_MON", "LOC_TUE", "LOC_WED", "LOC_THU", "LOC_FRI", "LOC_SAT",
        "LOC_SUNDAY", "LOC_MONDAY", "LOC_TUESDAY", "LOC_WEDNESDAY", "LOC_THURSDAY", "LOC_FRIDAY", "LOC_SATURDAY",
        "LOC_POLLEN_OAK", "LOC_POLLEN_PINE", "LOC_POLLEN_WEEDS", "LOC_POLLEN_OAK_INFO", "LOC_POLLEN_PINE_INFO",
        "LOC_POLLEN_WEEDS_INFO", "LOC_POLLEN_ADVICE_0", "LOC_POLLEN_ADVICE_1", "LOC_POLLEN_ADVICE_2",
        "LOC_POLLEN_ADVICE_3", "LOC_POLLEN_SOURCE", "LOC_CLOSE", "LOC_KAQ_DESCRIPTION", "LOC_AIRKOREA_DESCRIPTION",
    ]

    /// `"&#xE815;"` to its character.
    public static func entity(_ html: String) -> String {
        var out = ""
        var rest = Substring(html)
        while let start = rest.range(of: "&#x") {
            out += rest[..<start.lowerBound]
            var hex = ""
            var cursor = start.upperBound
            while cursor < rest.endIndex, rest[cursor].isHexDigit, rest[cursor].isASCII {
                hex.append(rest[cursor])
                cursor = rest.index(after: cursor)
            }
            if hex.isEmpty || UInt32(hex, radix: 16).flatMap(Unicode.Scalar.init) == nil {
                out += rest[start.lowerBound..<start.upperBound]
                rest = rest[start.upperBound...]
                continue
            }
            out.unicodeScalars.append(Unicode.Scalar(UInt32(hex, radix: 16)!)!)
            if cursor < rest.endIndex, rest[cursor] == ";" { cursor = rest.index(after: cursor) }
            rest = rest[cursor...]
        }
        return out + rest
    }

    /// `reh ? reh - reh%10 : '00'`: the humidity image's bucket.
    static func humidityBucket(_ reh: JSONValue?) -> String {
        if !Js.truthy(reh) { return "00" }
        let n = Js.number(reh)
        return Js.numberToString(n - n.truncatingRemainder(dividingBy: 10))
    }

    /// `value.toFixed(digits)` of a number; nil where it fails (anything but a number), which empties its text.
    static func fixed(_ value: JSONValue?, _ digits: Int) -> String? {
        guard case .number(let n)? = value else { return nil }
        return Js.toFixed(n.double, digits)
    }

    /// `s.substr(start, length)` by UTF-16 code units.
    static func substr(_ s: String, _ start: Int, _ length: Int) -> String {
        let units = Array(s.utf16)
        if start >= units.count { return "" }
        return String(decoding: units[start..<min(units.count, start + length)], as: UTF16.self)
    }

    /// HTML white-space collapsing of one text.
    public static func collapse(_ text: String) -> String { runs(TextRun(text)).first?.text ?? "" }

    /// HTML white-space collapsing over a row's runs: each run of white space becomes one space, none at the ends.
    public static func runs(_ runs: TextRun...) -> [TextRun] { collapseRuns(runs) }

    static func collapseRuns(_ runs: [TextRun]) -> [TextRun] {
        var space = true
        var out = runs.map { run -> TextRun in
            var b = ""
            for ch in run.text.unicodeScalars {
                if ch == " " || ch == "\n" || ch == "\t" || ch == "\r" || ch == "\u{000C}" {
                    if !space { b += " " }
                    space = true
                } else {
                    b.unicodeScalars.append(ch)
                    space = false
                }
            }
            return run.with(text: b)
        }
        for i in out.indices.reversed() {
            var trimmed = out[i].text
            while trimmed.hasSuffix(" ") { trimmed.removeLast() }
            out[i] = out[i].with(text: trimmed)
            if !trimmed.isEmpty { break }
        }
        return out.filter { !$0.text.isEmpty }
    }

    /// The page model's pieces from one scope (the Kotlin class body).
    private struct Builder {
        let scope: ForecastScope
        let units: PageUnits
        let texts: ChartTexts
        let standard: AirStandard?
        let cw: JSONObject?
        let today: JSONObject?
        let arpltn: JSONObject?
        let showArpltn: Bool

        init(scope: ForecastScope, units: PageUnits, texts: ChartTexts) {
            self.scope = scope
            self.units = units
            self.texts = texts
            standard = AirQuality.standard(units.air)
            cw = scope.currentWeather?.objectValue
            today = cw?["today"]?.objectValue
            arpltn = cw?["arpltn"]?.objectValue
            showArpltn = Js.truthy(scope.currentWeather) && arpltn != nil && Js.truthy(arpltn?["dataTime"])
        }

        func hero() -> Hero? {
            guard Js.truthy(scope.currentWeather) else { return nil }
            return Hero(temperature: collapse(scope.temp(cw?["t1h"])),
                        sky: PageImage(weather: true, name: Js.display(cw?["skyIcon"]) + ".png"),
                        summary: collapse(Js.display(scope.summary)),
                        summaryAir: Js.truthy(scope.summaryAir) ? collapse(Js.display(scope.summaryAir)) : nil)
        }

        func hourlyAqi() -> [AqiCell] {
            (scope.hourlyAqiForecast ?? []).map { row in
                let o = row.objectValue
                let grade = o?["grade"]
                let heading: String
                if case .string(let date)? = o?["date"] {
                    heading = collapse(substr(date, 11, 2) + texts["LOC_HOUR"])
                } else {
                    heading = ""
                }
                let str = o?["str"]
                return AqiCell(heading: heading, glyph: glyph(grade), color: color(grade),
                               grade: collapse(Js.present(str) ? Js.display(str) : "-"), action: .airInfo("aqi"))
            }
        }

        func currentAir() -> [AqiCell] {
            guard let a = arpltn else { return [] }
            return [("pm25", "LOC_PM25"), ("pm10", "LOC_PM10"), ("aqi", "LOC_AQI")]
                .filter { Js.truthy(a["\($0.0)Value"]) }
                .map { code, label in
                    let grade = a["\(code)Grade"]
                    let value = fixed(a["\(code)Value"], 0)
                    let runs: [TextRun]
                    if let value {
                        runs = code == "aqi" ? [TextRun(value, .sub)] : [TextRun(value, .sub), TextRun("㎍/㎥", .subSmall)]
                    } else {
                        runs = []
                    }
                    return AqiCell(heading: texts[label], glyph: glyph(grade), color: color(grade),
                                   grade: collapse(Js.display(a["\(code)Str"])), value: runs, action: .airInfo(code))
                }
        }

        func weatherRows() -> [WeatherRow] {
            var rows: [WeatherRow] = []
            func icon(_ name: String) -> PageImage { PageImage(weather: false, name: name) }
            func get(_ key: String) -> JSONValue? { cw?[key] }
            if Js.present(get("weatherType")) {
                rows.append(WeatherRow(image: PageImage(weather: true, name: Js.display(get("skyIcon")) + ".png"),
                                       text: runs(TextRun(texts["LOC_WEATHER"] + " " + Js.display(get("weather"))))))
            }
            rows.append(WeatherRow(image: icon("temp_50.png"), text: runs(TextRun(scope.diffTempStr ?? ""))))
            rows.append(WeatherRow(image: icon("humidity_\(humidityBucket(get("reh"))).png"),
                                   text: runs(TextRun(texts["LOC_HUMIDITY"] + " " + Js.display(get("reh"))), TextRun("%", .small))))
            rows.append(WeatherRow(image: icon("wind.png"),
                                   text: runs(TextRun(texts["LOC_WIND"] + " " + Js.display(get("wdd")) + " " + Js.display(get("wsd"))),
                                              TextRun(units.windSpeed ?? "", .small))))
            if Js.greater(get("visibility"), 0) {
                rows.append(WeatherRow(image: icon("visibility.png"),
                                       text: runs(TextRun(texts["LOC_VISIBILITY"] + " " + Js.display(get("visibility"))),
                                                  TextRun(units.distance ?? "", .small))))
            }
            if Js.truthy(get("hPa")) {
                rows.append(WeatherRow(image: icon("pressure.png"),
                                       text: runs(TextRun(texts["LOC_PRESSURE"] + " " + Js.display(get("hPa"))),
                                                  TextRun(units.pressure ?? "", .small))))
            }
            if Js.truthy(get("dspls")) && Js.greater(get("dspls"), 60) {
                rows.append(WeatherRow(image: icon("discomport_index.png"),
                                       text: runs(TextRun(texts["LOC_DISCOMFORT_INDEX"] + " " + Js.display(get("dsplsStr")) + " "),
                                                  TextRun("(" + Js.display(get("dspls")) + ")", .sub))))
            }
            if Js.truthy(get("sensorytem")) {
                rows.append(WeatherRow(image: icon("feels_like.png"),
                                       text: runs(TextRun(texts["LOC_FEELS_LIKE"] + " " + scope.temp(get("sensorytem")) + "˚"))))
            }
            if Js.truthy(get("rn1")) {
                rows.append(WeatherRow(image: icon("precipitation.png"),
                                       text: runs(TextRun(texts["LOC_HOURLY_PRECIPITATION"] + " " + Js.display(get("rn1"))),
                                                  TextRun(units.precipitation ?? "", .small))))
            }
            if Js.present(today?["ultrvGrade"]) {
                rows.append(WeatherRow(image: icon("ultrv.png"),
                                       text: runs(TextRun(texts["LOC_UV"] + " " + Js.display(today?["ultrvStr"]) + " "),
                                                  TextRun("(" + Js.display(today?["ultrv"]) + ")", .sub))))
            }
            if Js.present(today?["pollenGrade"]) {
                rows.append(WeatherRow(image: icon("pollen.png"),
                                       text: runs(TextRun(texts["LOC_POLLEN_RISK"] + ": " + Js.display(today?["pollenStr"]))),
                                       pollen: ForecastFormat.pollenRows(today) ?? []))
            }
            if Js.present(today?["fsnGrade"]) {
                rows.append(WeatherRow(image: icon("food_poisoning.png"),
                                       text: runs(TextRun(texts["LOC_FOOD_POISONING"] + " " + Js.display(today?["fsnStr"])))))
            }
            for (key, label, image) in [("sunrise", "LOC_SUNRISE", "sunrise.png"), ("sunset", "LOC_SUNSET", "sunset.png")] {
                let value = today?[key]
                if Js.truthy(value) {
                    // `sunrise.split(' ')[1]`: the time of "YYYY.MM.DD HH:MM"; anything but a string fails the whole text.
                    var time = ""
                    if case .string(let s)? = value {
                        let parts = JSString.split(s, " ")
                        time = texts[label] + " " + (parts.count > 1 ? parts[1] : "")
                    }
                    rows.append(WeatherRow(image: icon(image), text: runs(TextRun(time))))
                }
            }
            rows.append(WeatherRow(image: icon("time.png"), text: runs(TextRun(scope.updateTime ?? ""))))
            return rows
        }

        func airRows() -> [AirRow] {
            guard let a = arpltn else { return [] }
            var rows: [AirRow] = []
            for code in ["pm25", "pm10", "o3", "no2", "co", "so2"] {
                if !Js.present(a["\(code)Value"]) { continue }
                let grade = a["\(code)Grade"]
                let pm = code == "pm25" || code == "pm10"
                let value = fixed(a["\(code)Value"], pm ? 0 : 3)
                let stationValue = a["\(code)StationName"]
                let station = Js.truthy(stationValue) ? " " + Js.display(stationValue) : ""
                rows.append(AirRow(label: texts[AirQuality.codeName(code)], glyph: glyph(grade), color: color(grade), text: runs(
                    TextRun(Js.display(a["\(code)Str"]) + " ", color: color(grade)),
                    TextRun(value.map { "(" + $0 + (pm ? "㎍/㎥" : "ppm") + station + ")" } ?? "", .sub))))
            }
            if Js.present(a["khaiValue"]) {
                let grade = a["khaiGrade"]
                let khai = a["khaiValue"]
                let shown = Js.truthy(khai) && !Js.looseEquals(khai, -1)
                rows.append(AirRow(label: texts["LOC_AQI"], glyph: glyph(grade), color: color(grade), text: runs(
                    TextRun(Js.display(a["khaiStr"]) + " ", color: color(grade)),
                    TextRun(shown ? (fixed(khai, 0).map { "(\($0))" } ?? "") : "", .sub))))
            }
            if Js.truthy(a["stationName"]) {
                rows.append(AirRow(label: texts["LOC_STATION"], glyph: ForecastPage.station, color: nil,
                                   text: runs(TextRun(Js.display(a["stationName"])))))
            }
            if Js.truthy(a["dataTime"]) {
                rows.append(AirRow(label: texts["LOC_PUBLIC"], glyph: ForecastPage.time, color: nil,
                                   text: runs(TextRun(Js.display(a["dataTime"])))))
            }
            rows.append(AirRow(label: texts["LOC_AIR_QUALITY_INDEX_UNIT"], glyph: ForecastPage.info, color: nil,
                               text: runs(TextRun((ForecastFormat.airUnitKey(units.air).map { texts[$0] } ?? "") + " ", .link),
                                          ForecastPage.linkArrow),
                               action: .units))
            if Js.truthy(scope.airForecastPubdate) {
                rows.append(AirRow(label: texts["LOC_FORECAST"], glyph: ForecastPage.time, color: nil,
                                   text: runs(TextRun(Js.display(scope.airForecastPubdate)))))
            }
            let source = scope.airForecastSource
            if Js.truthy(source) {
                let text = source?.stringValue
                rows.append(AirRow(label: texts["LOC_AIR_FORECAST_SOURCE"], glyph: ForecastPage.info, color: nil,
                                   text: runs(TextRun((text.map { jsUpper($0) } ?? "") + " ", .link), ForecastPage.linkArrow),
                                   action: text.map { .airForecastInfo($0) }))
            }
            return rows
        }

        func dailyAqi() -> DailyAqi {
            let list = scope.dailyAqiForecast
            var cells: [AqiCell]?
            if Js.truthy(list), let days = list?.arrayValue, !days.isEmpty {
                cells = days.map { day in
                    let d = day.objectValue
                    let grade = d?["grade"]
                    return AqiCell(heading: collapse(Js.display(ForecastFormat.dd(d?["date"])) + " " + dayLabel(d)),
                                   glyph: glyph(grade), color: color(grade), grade: collapse(Js.display(d?["str"])),
                                   action: .airInfo("aqi"))
                }
            }
            var legacy: [DustRow]?
            let values = scope.dayValues()
            if list == nil, let values, Js.truthy(.array(values)) {
                legacy = values.enumerated().compactMap { i, day -> DustRow? in
                    guard let d = day.objectValue else { return nil }
                    let dust = d["dustForecast"]
                    if (i != 7 && i != 8) || !Js.truthy(dust) { return nil }
                    let o = dust?.objectValue
                    let dustCells = [("pm25", "LOC_PM25"), ("pm10", "LOC_PM10"), ("o3", "LOC_O3")]
                        .filter { $0.0 != "o3" || Js.present(o?["o3Grade"]) }
                        .map { code, label in
                            let grade = o?["\(code)Grade"]
                            return AqiCell(heading: texts[label], glyph: glyph(grade), color: color(grade),
                                           grade: collapse(Js.display(o?["\(code)Str"])), action: .airInfo(code))
                        }
                    var date = ""
                    if case .string(let s)? = d["date"] { date = substr(s, 6, 2) }
                    return DustRow(weekday: translate(ForecastFormat.dayName(d["dayOfWeek"], full: true)), date: date,
                                   dayString: translate(ForecastFormat.dayString(d["fromToday"])), cells: dustCells)
                }
            }
            return DailyAqi(title: texts["LOC_DAILY_AQI_FORECAST"], cells: cells, legacyRows: legacy)
        }

        func dayCells() -> [DayCell] {
            guard let values = scope.dayValues() else { return [] }
            let pop = scope.hasPropertyInThreeDays(["pop"])
            let uv = scope.hasPropertyInThreeDays(["ultrvGrade"])
            let rain = scope.hasPropertyInThreeDays(["pty", "rn1", "r06", "s06"])
            return values.filter { scope.checkDailyDetailWeather($0) }.compactMap { day -> DayCell? in
                guard let d = day.objectValue else { return nil }
                var rows: [DayRow] = []
                func icon(_ name: String) -> PageImage { PageImage(weather: false, name: name) }
                if Js.truthy(d["reh"]) {
                    rows.append(DayRow(image: icon("humidity_\(humidityBucket(d["reh"])).png"),
                                       value: runs(TextRun(Js.display(d["reh"])), TextRun("%", .small)), label: texts["LOC_HUMIDITY"]))
                }
                if Js.truthy(d["wsd"]) {
                    rows.append(DayRow(image: icon("wind.png"),
                                       value: runs(TextRun(Js.display(d["wsd"])), TextRun(units.windSpeed ?? "", .small)),
                                       label: texts["LOC_WIND"]))
                }
                if pop {
                    rows.append(DayRow(image: icon("umbrella.png"), value: runs(TextRun(Js.display(d["pop"])), TextRun("%", .small)),
                                       label: texts["LOC_PROBABILITY_OF_PRECIPITATION"]))
                }
                if uv {
                    rows.append(DayRow(image: icon("ultrv.png"),
                                       value: runs(TextRun(Js.display(d["ultrvStr"]) + " "), TextRun("(" + Js.display(d["ultrv"]) + ")", .small)),
                                       label: texts["LOC_UV"]))
                }
                if Js.present(d["fsnGrade"]) {
                    rows.append(DayRow(image: icon("food_poisoning.png"), value: runs(TextRun(Js.display(d["fsnStr"]))),
                                       label: texts["LOC_FOOD_POISONING"]))
                }
                if rain {
                    let label = ForecastText.rainSnowFallSymbol(d) == "snow" ? "LOC_DAILY_SNOWFALL" : "LOC_DAILY_PRECIPITATION"
                    rows.append(DayRow(image: icon("precipitation.png"),
                                       value: runs(TextRun(Js.display(ForecastText.rainSnowFall(d))),
                                                   TextRun(units.precipitation ?? "", .small)),
                                       label: texts[label]))
                }
                return DayCell(title: collapse(Js.display(ForecastFormat.mmdd(d["dateObj"])) + " " + dayLabel(d)), rows: rows)
            }
        }

        /// `{{day.fromToday==0?getDayString(day.fromToday):dayToString(day.dayOfWeek)|translate}}`.
        func dayLabel(_ d: JSONObject?) -> String {
            translate(Js.looseEquals(d?["fromToday"], 0)
                      ? ForecastFormat.dayString(d?["fromToday"]) : ForecastFormat.dayName(d?["dayOfWeek"], full: false))
        }

        /// The translate filter: a missing key shows itself; no key shows nothing.
        func translate(_ key: String?) -> String { key.map { texts[$0] } ?? "" }

        func glyph(_ grade: JSONValue?) -> String { entity(AirQuality.sentimentIcon(units.air, grade)) }

        func color(_ grade: JSONValue?) -> String? {
            let c = AirQuality.gradeColor(standard, grade, nil)
            return c.isEmpty ? nil : c
        }

        /// `String.prototype.toUpperCase` (full case mapping, as JavaScript's).
        func jsUpper(_ s: String) -> String { s.uppercased(with: Locale(identifier: "en_US_POSIX")) }
    }
}

/// TabCtrl's helpers of the weather templates (controller.tabctrl.js) and `Units.getAirUnitStr`.
public enum ForecastFormat {
    private static let dayStrings = ["LOC_A_COUPLE_OF_DAYS_AGO", "LOC_THE_DAY_BEFORE_YESTERDAY", "LOC_YESTERDAY", "LOC_TODAY",
                                     "LOC_TOMORROW", "LOC_THE_DAY_AFTER_TOMORROW", "LOC_TWO_DAYS_AFTER_TOMORROW", "LOC_FROM_TODAY"]
    private static let days = ["LOC_SUN", "LOC_MON", "LOC_TUE", "LOC_WED", "LOC_THU", "LOC_FRI", "LOC_SAT"]
    private static let fullDays = ["LOC_SUNDAY", "LOC_MONDAY", "LOC_TUESDAY", "LOC_WEDNESDAY", "LOC_THURSDAY", "LOC_FRIDAY",
                                   "LOC_SATURDAY"]

    /// `getDayString(day)`: -3 to 3 from today, otherwise LOC_FROM_TODAY; nil where the lookup finds nothing.
    public static func dayString(_ day: JSONValue?) -> String? {
        let n = Js.number(day)
        if !(-3 <= n && n <= 3) { return dayStrings.last }
        if day?.stringValue != nil { return nil } // "0" + 3 is "03"
        let i = n + 3
        return i == i.rounded(.down) ? dayStrings[Int(i)] : nil
    }

    /// `dayToString(day)` and `dayToFullString(day)`: the weekday key at index `day` (0 is Sunday).
    public static func dayName(_ day: JSONValue?, full: Bool) -> String? {
        let list = full ? fullDays : days
        guard let day, !day.isNull else { return nil }
        let key: String
        switch day {
        case .string(let s): key = s
        case .bool: return nil
        case .number: key = Js.string(day)
        default: return nil
        }
        guard let i = Int(key), String(i) == key, list.indices.contains(i) else { return nil }
        return list[i]
    }

    /// `convertMMDD(value)`: "MM/DD" of "YYYY.MM.DD HH:MM"; anything but a string as it is.
    public static func mmdd(_ value: JSONValue?) -> JSONValue? {
        guard case .string(let s)? = value else { return value }
        return .string(ForecastPage.substr(s, 5, 2) + "/" + ForecastPage.substr(s, 8, 2))
    }

    /// `convertDD(value)`: the day of "YYYY-MM-DD"; anything but a string as it is.
    public static func dd(_ value: JSONValue?) -> JSONValue? {
        guard case .string(let s)? = value else { return value }
        return .string(ForecastPage.substr(s, 8, 2))
    }

    /// `Units.getAirUnitStr(unit)`: the standard's translation key.
    public static func airUnitKey(_ airUnit: String?) -> String? {
        switch airUnit {
        case "airkorea": "LOC_AIR_QUALITY_INDEX_KR"
        case "airkorea_who": "LOC_AIR_QUALITY_INDEX_KR_WHO"
        case "airnow": "LOC_AIR_QUALITY_INDEX_US"
        case "aqicn": "LOC_AIR_QUALITY_INDEX_CN"
        default: nil
        }
    }

    /// `showPollenInfo(day)`: the popup's rows, nil when it does not open (no pollen grade).
    public static func pollenRows(_ day: JSONObject?) -> [PollenRow]? {
        guard let day, day["pollenGrade"] != nil else { return nil }
        return [("flowerWoody", "LOC_POLLEN_OAK"), ("flowerPine", "LOC_POLLEN_PINE"), ("flowerWeeds", "LOC_POLLEN_WEEDS")]
            .filter { day["\($0.0)Grade"] != nil }
            .map { field, label in
                PollenRow(labelKey: label, gradeLabel: Js.display(day["\(field)Str"]), infoKey: label + "_INFO",
                          adviceKey: "LOC_POLLEN_ADVICE_" + Js.string(day["\(field)Grade"]))
            }
    }
}
