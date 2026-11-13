import Foundation
import Testing
import TWDomain
import TWModel

/// Air, nationwide and warning display rules against the Cordova corpus (air.json, nation.json, special.json); port
/// of the Android `GoldenCorpusDisplayTest`.
struct GoldenCorpusDisplayTests {
    @Test func airStandardsColorsIconsAndGaugeMatchCordova() throws {
        let air = try Corpus.read("air.json")
        for (args, expected) in cases(air["standards"]) {
            let std = AirQuality.standard(s(args[0]))
            if expected["list"]?.isNull == true {
                #expect(std == nil, "standard \(args)")
                continue
            }
            let list = try #require(expected["list"]?.arrayValue)
            let standard = try #require(std, "standard \(args)")
            #expect(list.count == standard.grades.count, "grades \(args)")
            guard list.count == standard.grades.count else { continue }
            for (i, g) in list.enumerated() {
                #expect(sameText(s(g["color"]), standard.grades[i].color), "\(args) \(i)")
                #expect(sameText(s(g["str"]), standard.grades[i].str), "\(args) \(i)")
                let values = try #require(g["value"]?.objectValue)
                #expect(values.count == standard.grades[i].upperBound.count, "\(args) \(i) codes")
                for (code, v) in values {
                    #expect(standard.grades[i].upperBound[code] == double(v), "\(args) \(i) \(code)")
                }
            }
            let max = try #require(expected["maxValue"]?.objectValue)
            #expect(max.count == standard.maxValue.count, "max \(args)")
            for (code, v) in max { #expect(standard.maxValue[code] == double(v), "max \(args) \(code)") }
        }
        for (args, expected) in cases(air["gradeColor"]) {
            #expect(sameText(AirQuality.gradeColor(AirQuality.standard(s(args[0])), arg(args[1]), s(args[2])), s(expected)), "gradeColor \(args)")
        }
        for (args, expected) in cases(air["airkoreaGradeColor"]) {
            #expect(sameText(AirQuality.airkoreaGradeColor(arg(args[0])), s(expected)), "airkoreaGradeColor \(args)")
        }
        for (args, expected) in cases(air["sentimentIcon"]) {
            #expect(sameText(AirQuality.sentimentIcon(s(args[0]), arg(args[1])), s(expected)), "icon \(args)")
        }
        let labels = cases(air["labelPosition"])
        #expect(!labels.isEmpty)
        for (args, expected) in labels {
            let x = AirQuality.labelPosition(AirQuality.standard(s(args[0])), code: s(args[1])!, grade: int(args[3]),
                                             value: double(args[4]), width: double(args[2]),
                                             labelWidth: args.count > 5 ? double(args[5]) : 52)
            #expect(abs(x - double(expected)) <= 1e-9, "labelPosition \(args)")
        }
        for (args, expected) in cases(air["airCodeUnit"]) {
            #expect(sameText(AirQuality.codeUnit(s(args[0])!), s(expected)), "airCodeUnit \(args)")
        }
    }

    @Test func airListsAndForecastsMatchCordova() throws {
        let air = try Corpus.read("air.json")
        func stations(_ name: String) throws -> [JSONObject] {
            let data = try Corpus.read("inputs/\(name).json")
            if let list = data["airInfoList"]?.arrayValue { return list.compactMap(\.objectValue) }
            return data["airInfo"]?.objectValue.map { [$0] } ?? []
        }
        for (args, expected) in cases(air["aqiList"]) {
            let actual: [JSONValue]
            if s(args[0]) == "missing-air" {
                actual = AirQuality.pollutantList(JSONObject(), nil)
            } else {
                let station = try stations(s(args[0])!)[int(args[1])]
                actual = AirQuality.pollutantList(station["last"]?.objectValue ?? JSONObject(), station["pollutants"]?.objectValue)
            }
            expectJSON(expected, .array(actual), "aqiList \(args)")
        }
        for c in air["hourlyForecast"]?.arrayValue ?? [] {
            let args = c["args"]!.arrayValue!
            let expected = c["expected"] ?? .null
            let hourly = try c["input"] ?? stations(s(args[0])!)[int(args[1])]["pollutants"]?["aqi"]?["hourly"]
            let actual = AirQuality.hourlyForecast(current: s(args[2])!, hourly)
            expectJSON(expected, actual.map(JSONValue.array) ?? .null, "hourly \(args)")
        }
        for (args, expected) in cases(air["dustForecast"]) {
            let data = try Corpus.read("inputs/\(s(args[0])!).json")
            let days = data["midData"]?["dailyData"] ?? data["daily"]
            let actual = AirQuality.dustForecast(days, code: s(args[1])!)
            expectJSON(expected, actual.map(JSONValue.array) ?? .null, "dust \(args)")
        }
    }

    @Test func nationwideMapsMatchCordova() throws {
        let nationJSON = try Corpus.read("nation.json")
        let nation = NationResponse(json: try #require(try Corpus.read("inputs/nation.json").objectValue))
        #expect(nationJSON["weatherCities"]?.arrayValue?.map(label) == Nationwide.weatherCities)
        #expect(nationJSON["airCities"]?.arrayValue?.map(label) == Nationwide.airCities)
        let units = ["precipitationUnit": "mm", "windSpeedUnit": "m/s"]
        let weather = cases(nationJSON["weather"])
        #expect(weather.count == 45)
        for (args, e) in weather {
            let mode = try #require(Nationwide.Mode(rawValue: int(args[0])))
            let label = Nationwide.weatherLabel(nation, mode: mode, name: s(args[1])!)
            #expect(sameText(s(e["icon"]), label.icon), "icon \(args)")
            expectJSON(e["text1"], label.text1 ?? .null, "text1 \(args)")
            expectJSON(e["text2"], label.text2 ?? .null, "text2 \(args)")
            let (u1, u2) = Nationwide.unitKeys(mode)
            #expect(sameText(s(e["text1Unit"]), u1.flatMap { units[$0] }), "unit1 \(args)")
            #expect(sameText(s(e["text2Unit"]), u2.flatMap { units[$0] }), "unit2 \(args)")
        }
        let air = cases(nationJSON["air"])
        #expect(air.count == 6 * 17 * 2)
        for (args, e) in air {
            expectJSON(e["text1"], Nationwide.airValue(nation, type: s(args[1])!, name: s(args[2])!) ?? .null, "air \(args)")
            #expect(sameText(s(e["color"]), Nationwide.airColor(nation, type: s(args[1])!, name: s(args[2])!, airUnit: s(args[0]))), "color \(args)")
        }
    }

    /// The warning times follow JavaScriptCore where it reads a date string differently from V8: for the values
    /// recorded in JavaScriptCore/differences.json the expectation is the JavaScriptCore output (ios/tools/corpus/
    /// differences.md); every other value is the Node corpus's.
    @Test func warningsMatchCordova() throws {
        let list = try #require(try Corpus.read("special.json").arrayValue)
        #expect(list.count == 21)
        let differences = try JavaScriptCoreDifference.all().filter { $0.file == "special.json" }
        var applied = 0
        for (i, original) in list.enumerated() {
            var c = original
            for d in differences where d.index == i && d.section == nil {
                c = d.apply(to: c)
                applied += 1
            }
            let args = c["args"]!.arrayValue!
            let input = try c["input"] ?? Corpus.read("inputs/special.json")
            expectJSON(c["expected"], Warnings.parse(input, languageTag: s(args[0])!, timeZoneId: s(args[1])!), "special \(args)")
        }
        #expect(applied == differences.count, "every recorded special.json difference names a case")
    }

    /// Every value where JavaScriptCore differs from the Node corpus is one these tests check with the JavaScriptCore
    /// output; a difference in another file needs its test to apply it first.
    @Test func javaScriptCoreDifferencesAreAppliedByTheTests() throws {
        let differences = try JavaScriptCoreDifference.all()
        #expect(!differences.isEmpty)
        #expect(Set(differences.map(\.file)) == ["special.json"], "files with JavaScriptCore differences")
    }

    private func label(_ e: JSONValue) -> MapLabel { MapLabel(s(e["name"])!, int(e["top"]), int(e["left"])) }
}
