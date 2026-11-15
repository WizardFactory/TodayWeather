import Foundation
import Testing
import TWDomain
import TWModel

/// The grade and scale mapping of every air standard and pollutant (V32, IN-09 #2958) against the Cordova code run in
/// JavaScriptCore, the Cordova iOS app's engine (AirReference/air-scale.json, written by ios/tools/air/generate.py with
/// the sources' commits and hashes): the gauge's bands per standard and pollutant as S05 shows them, the grade colors and
/// faces for grades inside, at and beyond each table, and the value label's position at the gauge widths of the iOS
/// screens. The page model (`AirScope`, `AirPage`) is checked, not only the tables.
struct AirScaleTests {
    static let golden: JSONValue = {
        let url = Bundle.module.resourceURL!.appendingPathComponent("AirReference/air-scale.json")
        return (try? JSONValue.parse(Data(contentsOf: url))) ?? .null
    }()
    static let codes = ["aqi", "pm25", "pm10", "o3", "no2", "co", "so2"]

    @Test func goldenComesFromTheCordovaSources() throws {
        let sources = try #require(Self.golden["sources"]?.arrayValue)
        #expect(sources.compactMap { s($0["path"]) } == ["client/www/js/service.weatherutil.js", "client/www/js/controller.tabctrl.js",
                                                         "client/www/js/controller.air.js"])
        for source in sources {
            #expect(s(source["commit"])?.utf8.count == 40)
            #expect(s(source["sha256"])?.utf8.count == 64)
        }
        #expect(s(Self.golden["generator"])?.contains("JavaScriptCore") == true)
    }

    /// `setAirUnit` and the gauge's bands: for each standard and pollutant, each band's color, grade name and `~ bound`
    /// on the page; no bands without a known standard.
    @Test func everyStandardShowsItsScaleForEveryPollutant() throws {
        let standards = try #require(Self.golden["standards"]?.arrayValue)
        #expect(standards.count == 8)
        var bandsChecked = 0
        for std in standards {
            let airUnit = s(std["airUnit"])
            let standard = AirQuality.standard(airUnit)
            #expect((standard != nil) == (std["hasStandard"]?.boolValue == true), "\(airUnit ?? "undefined"): standard")
            for code in Self.codes + ["undefined"] {
                let expected = std["bands"]?[code]?.arrayValue ?? []
                #expect(jsonDifference(std["maxValue"]?[code], standard?.maxValue[code].map { .number($0) }, "") == nil,
                        "\(airUnit ?? "undefined") \(code): maxValue")
                if code == "undefined" {
                    // An unset pollutant (after the fallback found none) shows `~ ` alone.
                    #expect(expected.allSatisfy { s($0["text"]) == "~ " }, "\(airUnit ?? "undefined"): undefined code")
                    continue
                }
                let page = AirPage(scope: Self.scope(airUnit, code: code, grade: 1, value: .number(1)), texts: AirPageTests.ko)
                #expect(page.gauge.bands.count == expected.count, "\(airUnit ?? "undefined") \(code): bands")
                for (e, band) in zip(expected, page.gauge.bands) {
                    #expect(band.color == s(e["color"]), "\(airUnit ?? "undefined") \(code): color")
                    #expect(sameText(band.label, AirPageTests.ko[s(e["str"]) ?? ""]), "\(airUnit ?? "undefined") \(code): name")
                    #expect(sameText(band.bound, s(e["text"])), "\(airUnit ?? "undefined") \(code): \(band.bound) != \(s(e["text"]) ?? "")")
                    bandsChecked += 1
                }
            }
        }
        #expect(bandsChecked == 2 * 7 * 4 + 2 * 7 * 6)
    }

    /// `grade2Color(grade)`, `grade2Color(grade, 'white')` and `getSentimentIcon(grade)` for every standard, including
    /// grades above the table, 0, missing, null, strings, fractions and booleans.
    @Test func gradesMapToTheirColorsAndFaces() throws {
        let grades = try #require(Self.golden["grades"]?.arrayValue)
        #expect(grades.count == 8 * 19)
        for g in grades {
            let airUnit = s(g["airUnit"])
            let grade = g["grade"]
            let standard = AirQuality.standard(airUnit)
            let what = "\(airUnit ?? "undefined") grade \(grade?.jsonText ?? "undefined")"
            #expect(sameText(AirQuality.gradeColor(standard, grade, nil), s(g["color"])), "\(what): color")
            #expect(sameText(AirQuality.gradeColor(standard, grade, "white"), s(g["white"])), "\(what): white")
            #expect(sameText(AirQuality.sentimentIcon(airUnit, grade), s(g["icon"])), "\(what): face")
        }
    }

    /// The main box and the value label of S05 take the grade's color and face (the page model, not only the table).
    @Test func thePageTakesTheGradesColorAndFace() throws {
        for airUnit in ["airkorea", "airkorea_who", "airnow", "aqicn"] {
            let count = AirQuality.standard(airUnit)?.grades.count ?? 0
            for code in Self.codes {
                for grade in 1...(count + 1) {
                    let page = AirPage(scope: Self.scope(airUnit, code: code, grade: grade, value: .number(1)), texts: AirPageTests.ko)
                    let expected = AirQuality.gradeColor(AirQuality.standard(airUnit), .number(grade), nil)
                    #expect(page.main?.color == expected, "\(airUnit) \(code) \(grade): main color")
                    #expect(page.gauge.color == expected, "\(airUnit) \(code) \(grade): label color")
                    #expect(page.main?.glyph == ForecastPage.entity(AirQuality.sentimentIcon(airUnit, .number(grade))),
                            "\(airUnit) \(code) \(grade): face")
                    #expect(page.main?.unit == AirQuality.codeUnit(code))
                }
            }
        }
    }

    /// `getLabelPosition(grade, value)` through the page's gauge: for each standard, pollutant, gauge width and label
    /// width, at the bands' bounds and middles, beyond the table, and at airnow so2 0.05 and 0.1 (the A17 bound). NaN
    /// (a value shown as `-`) is an invalid `left`, which leaves the label at 0.
    @Test func theValueLabelSitsWhereTheCordovaPagePutsIt() throws {
        let labels = try #require(Self.golden["labels"]?.arrayValue)
        #expect(labels.count == 4160)
        for row in labels {
            let r = row.arrayValue ?? []
            let airUnit = s(r[0]) ?? "", code = s(r[1]) ?? "", width = double(r[2]), labelWidth = double(r[3])
            let grade = int(r[4])
            let value: JSONValue? = r[5].stringValue == "-" ? nil : r[5]
            let expected = r[6].stringValue == "NaN" ? 0 : double(r[6])
            let page = AirPage(scope: Self.scope(airUnit, code: code, grade: grade, value: value), texts: AirPageTests.ko)
            let x = page.gauge.labelPosition(width: width, labelWidth: labelWidth)
            #expect(abs(x - expected) < 1e-9, "\(r.map(\.jsonText)): \(x)")
        }
    }

    /// A visit of S05 on a place whose observation has `grade` and `value` (nil: no value, shown as `-`) for `code`.
    static func scope(_ airUnit: String?, code: String, grade: Int, value: JSONValue?) -> AirScope {
        var arpltn = JSONObject([("\(code)Grade", .number(grade)), ("dataTime", "2026-11-08 00:00")])
        if let value { arpltn["\(code)Value"] = value }
        let city = JSONObject([("name", "회현동"), ("currentWeather", .object(JSONObject([("arpltn", .object(arpltn))])))])
        var scope = AirScope(metrics: ChartMetrics(bodyWidth: 393, bodyHeight: 852), airUnit: airUnit)
        scope.open(city, code: code, enabledCount: 1, hasPush: false)
        return scope
    }
}
