import Foundation
import Testing
import TWModel
@testable import TWDomain

/// S02's rules (IN-11, #2960; the Android `PlacesDomainTest` of AN-11 with the Cordova iOS branches): the rows of
/// SearchCtrl's `init` and tab-search.html, `goPage`, the Places query and SearchCtrl's lookup with O03 `search`.
struct PlacesRulesTests {
    static let ko = PlaceRows.Texts(current: "현재", location: "위치")
    static let en = PlaceRows.Texts(current: "Current", location: "Location")

    @Test func aRowIsLabelledByNameElseItsShortAddress() {
        #expect(PlaceRows.label(name: "서울", address: "대한민국 서울특별시", currentPosition: false, language: "ko-KR", texts: Self.ko) == ["서울"])
        // `getShortenAddress(address).split(",")`: two lines.
        #expect(PlaceRows.label(name: nil, address: "대한민국 서울특별시 중구 명동", currentPosition: false, language: "ko-KR", texts: Self.ko)
                == ["서울시", "명동"])
        #expect(PlaceRows.label(name: "", address: "", currentPosition: false, language: "ko-KR", texts: Self.ko) == [""])
        // A current position with an address reads like any place.
        #expect(PlaceRows.label(name: "회현동", address: "서울특별시 중구 회현동", currentPosition: true, language: "ko-KR", texts: Self.ko)
                == ["회현동"])
    }

    /// The current position without an address: 현재위치, joined for ko, ja and zh-CN, and for zh-TW with a space (A13).
    @Test(arguments: [("ko-KR", "현재위치"), ("ja", "현재위치"), ("zh-CN", "현재위치"), ("zh-TW", "현재 위치"), ("en-US", "현재 위치")])
    func theCurrentPositionWithoutAnAddress(language: String, expected: String) {
        #expect(PlaceRows.label(name: "x", address: nil, currentPosition: true, language: language, texts: Self.ko) == [expected])
    }

    @Test func aRowShowsTheTemperatureAndTodaysRange() throws {
        let weather = try JSONValue.parse(Data(#"{"skyIcon":"cloud","t1h":12.5,"today":{"tmn":-0.4,"tmx":18.51}}"#.utf8)).objectValue
        let row = PlaceRows.row(name: "서울", address: nil, currentPosition: false, disable: false, currentWeather: weather,
                                hasPush: true, language: "ko-KR", texts: Self.ko)
        // `toFixed(0)`: 12.5 → 13, -0.4 → -0, 18.51 → 19.
        #expect(row == PlaceRow(lines: ["서울"], currentPosition: false, disabled: false, skyIcon: "cloud", temperature: "13˚",
                                minMax: "-0˚/19˚", hasPush: true))
    }

    @Test func aRowWithoutWeatherShowsTheSunAndNoTemperature() throws {
        let none = PlaceRows.row(name: "서울", address: nil, currentPosition: false, disable: true, currentWeather: nil,
                                 hasPush: false, language: "en-US", texts: Self.en)
        #expect(none.skyIcon == "sun" && none.temperature == nil && none.minMax == nil && none.disabled)
        let dash = try JSONValue.parse(Data(#"{"skyIcon":"","t1h":"-"}"#.utf8)).objectValue
        #expect(PlaceRows.row(name: "a", address: nil, currentPosition: false, disable: false, currentWeather: dash, hasPush: false,
                              language: "en-US", texts: Self.en).temperature == nil)
        // A null temperature passes `!= '-'` and prints nothing; a missing `today` prints its two degrees only.
        let null = try JSONValue.parse(Data(#"{"t1h":null}"#.utf8)).objectValue
        let row = PlaceRows.row(name: "a", address: nil, currentPosition: false, disable: false, currentWeather: null, hasPush: false,
                                language: "en-US", texts: Self.en)
        #expect(row.temperature == "˚" && row.minMax == "˚/˚" && row.skyIcon == "sun")
    }

    @Test func goPageOpensTheStartupPagesTab() {
        #expect(PlaceRows.startTab("0") == .forecast)
        #expect(PlaceRows.startTab("1") == .dailyforecast)
        #expect(PlaceRows.startTab("2") == .forecast)
        #expect(PlaceRows.startTab("3") == .air)
        #expect(PlaceRows.startTab("4") == .forecast)
        #expect(PlaceRows.startTab(nil) == .forecast)
    }

    @Test func aPredictionIsGeocodedByItsTermsJoinedWithCommas() {
        #expect(SearchQuery.of("London, UK") == "London,UK")
        #expect(SearchQuery.of("대한민국 부산광역시") == "대한민국,부산광역시")
        #expect(SearchQuery.of("London, ON, Canada") == "London,ON,Canada")
    }

    /// SearchCtrl's iOS branch: a recorded grant locates and records nothing; the other steps are StartCtrl's.
    @Test func searchCtrlRecordsNothingForAGrant() {
        let granted = SearchLocation.decide(record: .authorizedWhenInUse, current: .authorizedWhenInUse)
        #expect(granted.step == .locate && granted.records == nil)
        #expect(SearchLocation.decide(record: .notDetermined, current: .notDetermined).step == .ask(hideLoading: true))
        let denied = SearchLocation.decide(record: .deniedAlways, current: .deniedAlways)
        #expect(denied.step == .fail(.denied) && denied.records == .deniedAlways)
        let off = SearchLocation.decide(record: nil, current: .authorizedWhenInUse)
        #expect(off.step == .fail(.turnOn) && off.records == .authorizedWhenInUse)
        #expect(SearchLocation.decide(record: nil, current: .notDetermined).step == .ask(hideLoading: false))
    }

    /// O03 `search` on iOS: Close first; no hint and no Search button.
    @Test func searchRetryConfirmVariants() {
        let lines = ["LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION"]
        #expect(SearchLocation.retry(.notFound, recorded: nil, enabled: false) == RetryConfirm(lines: lines, buttons: [.close, .retry]))
        #expect(SearchLocation.retry(.denied, recorded: .deniedAlways, enabled: false)
                == RetryConfirm(lines: ["LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED"], buttons: [.close, .settings, .retry]))
        #expect(SearchLocation.retry(.turnOn, recorded: .authorizedWhenInUse, enabled: false).buttons == [.close, .settings, .retry])
        #expect(SearchLocation.retry(.noInformation, recorded: .authorizedWhenInUse, enabled: true)
                == RetryConfirm(lines: ["LOC_FAIL_TO_GET_LOCATION_INFORMATION"], buttons: [.close, .retry]))
    }
}
