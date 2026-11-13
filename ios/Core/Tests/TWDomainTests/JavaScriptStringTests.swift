import Foundation
import Testing
import TWDomain
import TWModel

/// JavaScript compares strings by UTF-16 code units; Swift's `String` by canonical equivalence (CODEX-IN02-2).
/// JavaScriptCore: `"é" == "é"` is false, `"é" > "é"` is true, `"K" == "K"` is false and
/// `"｡" < "🌧"` is false (jsc json-js.js, JavaScriptCore 21624.5.1.11.3, 2026-11-13).
struct JavaScriptStringTests {
    let composed = "\u{E9}"
    let decomposed = "e\u{301}"

    @Test func equalityIsByCodeUnits() {
        #expect(!Js.looseEquals(.string(composed), .string(decomposed)))
        #expect(!Js.looseEquals(.string("K"), .string("\u{212A}")))
        #expect(Js.looseEquals(.string(composed), .string("\u{E9}")))
    }

    @Test func relationalComparisonIsByCodeUnits() {
        #expect(Js.greaterOrEqual(.string(composed), .string(decomposed)))
        #expect(!Js.greaterOrEqual(.string(decomposed), .string(composed)))
        // U+FF61 is above the high surrogate D83C of U+1F327, though below it as a scalar.
        #expect(Js.greaterOrEqual(.string("\u{FF61}"), .string("\u{1F327}")))
        #expect(!Js.greaterOrEqual(.string("\u{1F327}"), .string("\u{FF61}")))
    }

    /// `weather.source === "KMA"`: a source written with the Kelvin sign is not KMA, so the response goes the overseas
    /// way and fails there without `daily` (null), as in the Cordova code.
    @Test func kmaSourceIsMatchedByCodeUnits() throws {
        let input = try Corpus.read("inputs/kma-seoul.json")
        #expect(try WeatherConverter.convert(input) != nil)
        let kelvin = JSONValue.object(try #require(input.objectValue).setting("source", .string("\u{212A}MA")))
        #expect(try WeatherConverter.convert(kelvin) == nil)
    }

    /// Province names and city names are found by code units (`sidoName === name`, `indexOf`).
    @Test func nationwideNamesAreMatchedByCodeUnits() throws {
        let nation = NationResponse(json: try #require(try JSONValue.parse(#"""
            {"weather":[{"regionName":"é","cityName":"x","townName":"y","current":{"skyIcon":"Sun","t1h":1}}],
             "air":[{"sidoName":"é","pm10Value":5,"pm10Grade":1}]}
            """#).objectValue))
        #expect(Nationwide.airValue(nation, type: "pm10", name: decomposed) == 5)
        #expect(Nationwide.airValue(nation, type: "pm10", name: composed) == nil)
        #expect(sameText(Nationwide.weatherLabel(nation, mode: .skyTemperature, name: decomposed).icon, "Sun"))
        #expect(Nationwide.weatherLabel(nation, mode: .skyTemperature, name: composed).icon == nil)
    }

    /// The dust forecast matches pollutant keys by code units (`key.indexOf(code)`).
    @Test func airCodesAreMatchedByCodeUnits() {
        let days: JSONValue = .array([.object(JSONObject([("fromToday", 0), ("dustForecast", .object(JSONObject([
            ("e\u{301}Grade", 2), ("\u{E9}Grade", 3),
        ])))]))])
        let result = AirQuality.dustForecast(days, code: decomposed)
        #expect(result?.first?["grade"] == 2)
    }

    /// The corpus comparison itself tells canonically equivalent strings and keys apart.
    @Test func corpusComparisonReportsCanonicallyEquivalentStrings() {
        #expect(jsonDifference(.string(composed), .string(decomposed), "s") != nil)
        #expect(jsonDifference(.object(JSONObject([(composed, 1)])), .object(JSONObject([(decomposed, 1)])), "o") != nil)
        #expect(jsonDifference(.string(composed), .string("\u{E9}"), "s") == nil)
        #expect(!sameText(composed, decomposed) && sameText(composed, "\u{E9}"))
    }
}
