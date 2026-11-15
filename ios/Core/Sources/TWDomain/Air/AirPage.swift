import Foundation
import TWModel

/// The main box (`.main-box`): the `title` (대기상태 or the pollutant), the `value` (the overall grade, sized
/// `bigFontSize × 0.55` when `grade`, else the pollutant's value at `bigFontSize`) with its `unit`, in `color`; the grade
/// line (`lead` text, the face in `color`, the `advice`) and the current weather, which opens S03.
public struct AirMain: Sendable, Equatable {
    public let title: String
    public let value: String
    public let unit: String
    public let grade: Bool
    public let color: String?
    public let lead: String
    public let glyph: String
    public let advice: String?
    public let weather: AirWeather
}

/// The current weather of the main box: the sky image, `weather t1h` (raw) and the degree sign when there is weather.
public struct AirWeather: Sendable, Equatable {
    public let image: PageImage
    public let text: String
    public let degree: Bool
}

/// A band of the gauge: its color (the top border), the grade's name and `~ ` its upper bound for the pollutant.
public struct AirBand: Sendable, Equatable {
    public let color: String
    public let label: String
    public let bound: String
}

/// The gauge (`.air-std-table`): the standard's `bands` and the value label (`label` in `color`, with its pointer)
/// placed by `labelPosition`.
public struct AirGauge: Sendable, Equatable {
    public let bands: [AirBand]
    public let label: String
    public let color: String
    let grade: JSONValue?
    let value: JSONValue?
    let code: String?
    let standard: AirStandard?

    /// `getLabelPosition(airCodeGrade, airCodeValue)`: the label's left edge over a gauge `width` pt wide for a label
    /// `labelWidth` pt wide (both whole points, as `offsetWidth`; 0 counts as 52). 0 where the Cordova code fails or gives
    /// NaN, which leaves the label at the left.
    public func labelPosition(width: Double, labelWidth: Double) -> Double {
        let g = Js.number(Js.present(grade) ? grade : nil)
        guard !g.isNaN, g == g.rounded(.down), let code else { return 0 }
        let x = AirQuality.labelPosition(standard, code: code, grade: Int(g), value: Js.number(value), width: width,
                                         labelWidth: labelWidth == 0 ? 52 : labelWidth)
        return x.isNaN ? 0 : x
    }
}

/// A cell of the daily, detail or station card: heading, the face and the text under it in `color`; `selected` has a
/// gray background.
public struct AirCell: Sendable, Equatable {
    public let heading: String
    public let glyph: String
    public let color: String?
    public let text: String
    public var selected = false
    public var code: String? = nil
}

/// What tab-air.html shows for an `AirScope`, with TabCtrl's helpers: texts as AngularJS interpolates them (values as
/// they came, no rounding), then HTML white-space collapsing. `texts` are the translated catalog strings. Port of the
/// Android `AirPage` (AN-09).
public struct AirPage: Sendable {
    /// The bar title (`address`) and whether the current position's location glyph shows (unless loading).
    public let title: String
    public let currentPosition: Bool
    public let hasPush: Bool
    /// The arrows beside the main box (`cityCount > 1`).
    public let arrows: Bool
    /// The main box (`ng-if="airInfo"`).
    public let main: AirMain?
    /// The gauge, always there (no bands without a standard).
    public let gauge: AirGauge
    /// The hourly chart card's title (`airChart.data.length > 1`); nil without the card.
    public let chartTitle: String?
    /// The daily forecast card (`dayForecast.length`): the day and the face and grade text in the grade color, white
    /// without one.
    public let daily: [AirCell]?
    public let dailyTitle: String
    /// The detail card (`aqiList.length > 1`): each pollutant; a tap selects it.
    public let detail: [AirCell]?
    public let detailTitle: String
    /// The info card (`airInfo.dataTime`): station, publication, standard (opens the units page), forecast and its source
    /// (O08).
    public let info: [AirRow]?
    /// The station card (`stnList`): each station; a tap selects it.
    public let stations: [AirCell]?
    public let stationsTitle: String

    public init(scope: AirScope, texts: ChartTexts) {
        let b = Builder(scope: scope, texts: texts)
        let collapse = ForecastPage.collapse
        title = collapse(Js.display(scope.address))
        currentPosition = Js.truthy(scope.currentPosition)
        hasPush = scope.hasPush == true
        arrows = (scope.cityCount ?? 0) > 1
        main = b.main()
        let standard = scope.standard
        let code = scope.aqiCode
        gauge = AirGauge(
            bands: standard?.grades.map { g in
                AirBand(color: g.color, label: b.translate(g.str),
                        bound: collapse("~ " + (code.flatMap { c in g.upperBound.first { JSString.equal($0.key, c) }?.value }
                            .map(Js.numberToString) ?? "")))
            } ?? [],
            label: collapse(Js.display(scope.airCodeValue)),
            color: AirQuality.gradeColor(standard, scope.airCodeGrade, "white"),
            grade: scope.airCodeGrade, value: scope.airCodeValue, code: code, standard: standard)
        if let chart = scope.airChart, chart.data.count > 1 {
            chartTitle = collapse(b.translate(scope.hourlyChartTitle) + " (beta)")
        } else {
            chartTitle = nil
        }
        if let days = scope.dayForecast, !days.isEmpty {
            daily = days.map { day in
                let d = day.objectValue
                let grade = d?["grade"]
                return AirCell(heading: collapse(Js.display(ForecastFormat.dd(d?["date"])) + " " + b.dayLabel(d)),
                               glyph: b.glyph(grade), color: b.color(grade, "white"), text: collapse(Js.display(d?["str"])))
            }
        } else {
            daily = nil
        }
        dailyTitle = texts["LOC_DAILY_AQI_FORECAST"]
        if let list = scope.aqiList, list.count > 1 {
            detail = list.map { item in
                let o = item.objectValue
                let grade = o?["grade"]
                let name = o?["name"]?.stringValue
                return AirCell(heading: b.translate(name), glyph: b.glyph(grade), color: b.color(grade, nil),
                               text: collapse(Js.display(o?["value"])),
                               selected: name.map { n in scope.airCodeName.map { JSString.equal(n, $0) } ?? false } ?? false,
                               code: o?["code"]?.stringValue)
            }
        } else {
            detail = nil
        }
        detailTitle = texts["LOC_DETAIL_AQI"]
        if Js.truthy(scope.airInfo), Js.truthy(scope.airInfo?.objectValue?["dataTime"]) {
            info = b.infoRows()
        } else {
            info = nil
        }
        stations = scope.stnList?.enumerated().map { i, s in
            let grade = s["grade"]
            return AirCell(heading: collapse(Js.display(s["stationName"])), glyph: b.glyph(grade), color: b.color(grade, nil),
                           text: collapse(Js.display(code.map { JSString.equal($0, "aqi") } == true ? s["str"] : s["value"])),
                           selected: i == scope.stnIndex)
        }
        stationsTitle = collapse(texts["LOC_STATION"] + " (" + b.translate(scope.airCodeName) + ")")
    }

    /// The translation keys S05 reads, for the app to load from its catalog.
    public static let keys = [
        "LOC_AIR_STATUS", "LOC_AQI", "LOC_PM25", "LOC_PM10", "LOC_O3", "LOC_NO2", "LOC_SO2", "LOC_CO",
        "LOC_HOURLY_AQI_FORECAST", "LOC_HOURLY_AQI_INFORMATION", "LOC_DAILY_AQI_FORECAST", "LOC_DETAIL_AQI", "LOC_STATION", "LOC_PUBLIC",
        "LOC_AIR_QUALITY_INDEX_UNIT", "LOC_AIR_QUALITY_INDEX_KR", "LOC_AIR_QUALITY_INDEX_KR_WHO", "LOC_AIR_QUALITY_INDEX_US",
        "LOC_AIR_QUALITY_INDEX_CN", "LOC_FORECAST", "LOC_AIR_FORECAST_SOURCE", "LOC_GOOD", "LOC_MODERATE",
        "LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS", "LOC_UNHEALTHY", "LOC_VERY_UNHEALTHY", "LOC_HAZARDOUS", "LOC_TODAY",
        "LOC_SUN", "LOC_MON", "LOC_TUE", "LOC_WED", "LOC_THU", "LOC_FRI", "LOC_SAT", "LOC_HOUR",
        "LOC_KAQ_DESCRIPTION", "LOC_AIRKOREA_DESCRIPTION", "LOC_CLOSE",
    ]

    private struct Builder {
        let scope: AirScope
        let texts: ChartTexts

        func main() -> AirMain? {
            guard Js.truthy(scope.airInfo) else { return nil }
            let cw = scope.currentWeather?.objectValue
            let advice = Js.truthy(scope.airCodeActionGuide) ? ForecastPage.collapse(Js.display(scope.airCodeActionGuide)) : nil
            return AirMain(
                title: translate(scope.mainName),
                value: ForecastPage.collapse(Js.display(scope.mainInfo)),
                unit: AirQuality.codeUnit(scope.aqiCode ?? "undefined"),
                grade: scope.aqiCode.map { JSString.equal($0, "aqi") } ?? false,
                color: color(scope.airCodeGrade, nil),
                lead: ForecastPage.collapse(Js.display(scope.airCodeStr)),
                glyph: glyph(scope.airCodeGrade),
                advice: advice,
                weather: AirWeather(image: PageImage(weather: true, name: Js.display(cw?["skyIcon"]) + ".png"),
                                    text: ForecastPage.collapse(Js.display(cw?["weather"]) + " " + Js.display(cw?["t1h"])),
                                    degree: Js.truthy(scope.currentWeather)))
        }

        func infoRows() -> [AirRow] {
            guard let a = scope.airInfo?.objectValue else { return [] }
            var rows: [AirRow] = []
            if Js.truthy(a["stationName"]) {
                rows.append(AirRow(label: texts["LOC_STATION"], glyph: ForecastPage.station, color: nil,
                                   text: ForecastPage.runs(TextRun(Js.display(a["stationName"])))))
            }
            if Js.truthy(a["dataTime"]) {
                rows.append(AirRow(label: texts["LOC_PUBLIC"], glyph: ForecastPage.time, color: nil,
                                   text: ForecastPage.runs(TextRun(Js.display(a["dataTime"])))))
            }
            rows.append(AirRow(label: texts["LOC_AIR_QUALITY_INDEX_UNIT"], glyph: ForecastPage.info, color: nil,
                               text: ForecastPage.runs(TextRun(translate(ForecastFormat.airUnitKey(scope.airUnit)) + " ", .link),
                                                       ForecastPage.linkArrow),
                               action: .units))
            if Js.truthy(scope.forecastPubdate) {
                rows.append(AirRow(label: texts["LOC_FORECAST"], glyph: ForecastPage.time, color: nil,
                                   text: ForecastPage.runs(TextRun(Js.display(scope.forecastPubdate)))))
            }
            let source = scope.forecastSource
            if Js.truthy(source) {
                let text = source?.stringValue
                rows.append(AirRow(label: texts["LOC_AIR_FORECAST_SOURCE"], glyph: ForecastPage.info, color: nil,
                                   text: ForecastPage.runs(TextRun((text.map(Self.upper) ?? "") + " ", .link), ForecastPage.linkArrow),
                                   action: text.map { .airForecastInfo($0) }))
            }
            return rows
        }

        /// `{{day.fromToday==0?getDayString(day.fromToday):dayToString(day.dayOfWeek)|translate}}`.
        func dayLabel(_ d: JSONObject?) -> String {
            translate(Js.looseEquals(d?["fromToday"], 0)
                      ? ForecastFormat.dayString(d?["fromToday"]) : ForecastFormat.dayName(d?["dayOfWeek"], full: false))
        }

        /// The translate filter: a missing key shows itself; no key shows nothing.
        func translate(_ key: String?) -> String { key.map { texts[$0] } ?? "" }

        func glyph(_ grade: JSONValue?) -> String { ForecastPage.entity(AirQuality.sentimentIcon(scope.airUnit, grade)) }

        func color(_ grade: JSONValue?, _ defaultColor: String?) -> String? {
            let c = AirQuality.gradeColor(scope.standard, grade, defaultColor)
            return c.isEmpty ? nil : c
        }

        /// `String.prototype.toUpperCase` (full case mapping, as JavaScript's).
        static func upper(_ s: String) -> String { s.uppercased(with: Locale(identifier: "en_US_POSIX")) }
    }
}
