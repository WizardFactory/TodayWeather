import Foundation
import Testing
import TWDomain
import TWModel

/// The TWModel views read the captured responses and the converted weather without changing values; port of the
/// Android `ModelsTest` (which also lives with the domain tests, because it converts responses first).
struct ModelsTests {
    private func place(_ input: JSONValue) throws -> PlaceWeather {
        PlaceWeather(json: try #require(try WeatherConverter.convert(input)))
    }

    @Test func placeWeatherViewsMatchTheConvertedJson() throws {
        for name in ["kma-seoul", "kma-seoul-imperial", "vc-london", "vc-tokyo"] {
            let place = try place(Corpus.read("inputs/\(name).json"))
            let current = try #require(place.currentWeather, "\(name)")
            #expect(Double(s(place.json["currentWeather"]?["t1h"])!) == current.t1h, "\(name)")
            #expect(place.json["timeTable"]?.arrayValue?.count == place.timeTable.count, "\(name)")
            #expect(place.timeChart.count == 2, "\(name)")
            #expect(place.timeChart[1].name == "today")
            #expect(!place.dayTable.isEmpty, "\(name)")
            let todayIndex = place.dayTable.firstIndex { $0.fromToday == 0 }.map(Double.init) ?? -1
            #expect(current.today?.index == todayIndex, "\(name)")
            #expect(!place.airStations.isEmpty, "\(name)")
            #expect(place.location?.lat != nil && place.location?.long != nil, "\(name)")
        }
        #expect(try place(Corpus.read("inputs/kma-seoul.json")).source == "KMA")
        #expect(try place(Corpus.read("inputs/vc-london.json")).source == "VC")
    }

    @Test func rawValuesKeepCordovaSemantics() throws {
        let sentinels = try Corpus.read("conversion/kma-sentinels.json")
        let place = try place(try #require(sentinels["input"]))
        #expect(place.currentWeather?.t1h == -50, "sentinel kept")
        let strings = try self.place(try #require(try Corpus.read("conversion/kma-string-values.json")["input"]))
        let row = try #require(strings.timeTable.first { $0.raw("pop") != nil })
        guard case .string(let pop)? = row.raw("pop") else {
            Issue.record("raw keeps the string")
            return
        }
        #expect(Double(pop) == row.pop)
        #expect(strings.currentWeather?.raw("doesNotExist") == nil)
    }

    @Test func otherResponsesParse() throws {
        let nation = NationResponse(json: try #require(try Corpus.read("inputs/nation.json").objectValue))
        #expect(nation.weather.count == 15)
        #expect(nation.air.count == 17)
        #expect(nation.weather.allSatisfy { $0.current?.skyIcon != nil })
        let warnings = try #require(try Corpus.read("inputs/special.json").arrayValue).compactMap { $0.objectValue.map(WeatherWarning.init(json:)) }
        #expect(!warnings.isEmpty && warnings.allSatisfy { $0.announcement != nil && $0.comment != nil })
        let geo = GeocodeResponse(json: try #require(try Corpus.read("inputs/geocode-seoul.json").objectValue))
        #expect(geo.address == "서울특별시 중구 회현동")
        #expect(geo.location?.lat == 37.56)
    }
}
