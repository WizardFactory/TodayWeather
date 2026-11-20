import Foundation
import Testing
import TWDomain
import TWModel

struct HourlyDetailsTests {
    @Test func convertsSupplementalForecastWithoutChangingTheChart() throws {
        let payload = try JSONValue.parse(Data(#"""
        {"daily":[],"hourly":[],"thisTime":[{},{}],"pubDate":{"VC":{}},"hourlyDetails":[
          {"at":"2026-09-23T08:00:00.000Z","uvIndex":0,"windGustMps":8,"wbgtC":-3}
        ]}
        """#.utf8))
        let input = try #require(payload.objectValue)
        let weather = PlaceWeather(json: try #require(try WeatherConverter.convert(payload)))
        let detail = try #require(weather.hourlyDetails.first)
        #expect(detail.at == "2026-09-23T08:00:00.000Z")
        #expect(detail.uvIndex == 0)
        #expect(detail.windGustMps == 8)
        #expect(detail.wbgtC == -3)
        #expect(detail.severeRisk == nil)
        let legacy = try #require(try WeatherConverter.convert(.object(input.removing("hourlyDetails"))))
        #expect(weather.timeTable == PlaceWeather(json: legacy).timeTable)
        #expect(PlaceWeather(json: legacy).hourlyDetails.isEmpty)
    }
}
