import Foundation
import Testing
import TWDomain
import TWResources

/// S01's shortcuts, the Places prediction's name and the bundled town scan (IN-10, #2959), from StartCtrl and SearchCtrl
/// (controller.start.js, controller.searchctrl.js). Ported from the Android `StartDomainTest` (AN-10).
struct StartRulesTests {
    @Test func theShortcutsGrowWithTheScreenHeight() throws {
        #expect(CityShortcuts.forScreenHeight(480).count == 6)
        #expect(CityShortcuts.forScreenHeight(568).count == 11)
        #expect(CityShortcuts.forScreenHeight(667).count == 11, "iPhone SE (375×667)")
        #expect(CityShortcuts.forScreenHeight(730.9).count == 11)
        #expect(CityShortcuts.forScreenHeight(731).count == 17)
        #expect(CityShortcuts.forScreenHeight(852).count == 17, "iPhone 16 (393×852)")
        #expect(CityShortcuts.forScreenHeight(956).count == 17, "iPhone 16 Pro Max (440×956)")
        #expect(CityShortcuts.forScreenHeight(960).count == 26)
        #expect(CityShortcuts.forScreenHeight(1366).count == 26, "iPad Pro 13")
        let all = CityShortcuts.forScreenHeight(960)
        try #require(all.count == 26)
        #expect(all.map(\.name).prefix(6) == ["서울", "New York", "東京", "Berlin", "北京", "臺北市"])
        #expect(all[0] == CityShortcut("서울", "KR", "대한민국 서울특별시", 37.567, 126.978))
        // Cordova's data quirks, kept: New York far north of the city, Kinshasa with the country CG.
        #expect(all[1].lat == 43.299 && all[1].long == -74.218)
        #expect(all.first { $0.name == "Kinshasa" }?.country == "CG")
        #expect(all.first { $0.name == "وهران" }?.address == "وهران\u{200e}, الجزائر")
        #expect(all.last?.name == "تهران")
    }

    @Test func aPredictionIsNamedByTheTermOfItsFirstMatch() {
        // A Korean description without commas: terms between spaces.
        #expect(PredictionName.of(fullText: "대한민국 서울특별시 중구", firstMatch: 11, word: "중") == "중구")
        #expect(PredictionName.of(fullText: "대한민국 서울특별시", firstMatch: 5, word: "서울") == "서울특별시")
        // Terms between ", " when the description has a comma.
        #expect(PredictionName.of(fullText: "London, UK", firstMatch: 0, word: "lon") == "London")
        #expect(PredictionName.of(fullText: "Paris, Texas, USA", firstMatch: 7, word: "tex") == "Texas")
        // No term starts at the match, or no match: the typed word.
        #expect(PredictionName.of(fullText: "London, UK", firstMatch: 2, word: "nd") == "nd")
        #expect(PredictionName.of(fullText: "London, UK", firstMatch: nil, word: "lon") == "lon")
        // Offsets are UTF-16 code units, as JavaScript and the SDK count them.
        #expect(PredictionName.terms("😀 Tokyo").map(\.offset) == [0, 3])
        #expect(PredictionName.of(fullText: "😀 Tokyo", firstMatch: 3, word: "To") == "Tokyo")
    }

    @Test func aTownIsNamedAndAddressedAsTheStartPageBuildsIt() {
        let gu = BundledTown(first: "경기도", second: "고양시덕양구", third: "고양동", lat: 37.7, long: 126.9)
        #expect(gu.placeInfo == PlaceInfo(name: "고양동", address: "대한민국 경기도 고양시 덕양구 고양동", country: "KR", lat: 37.7, long: 126.9))
        let city = BundledTown(first: "강원도", second: "강릉시", third: "", lat: 37.75, long: 128.88)
        #expect(city.placeInfo == PlaceInfo(name: "강릉시", address: "대한민국 강원도 강릉시", country: "KR", lat: 37.75, long: 128.88))
        let province = BundledTown(first: "서울특별시", second: "", third: "", lat: 37.56, long: 126.98)
        #expect(province.placeInfo.name == "서울특별시")
        #expect(province.placeInfo.address == "대한민국 서울특별시")
        // A 구 of a 광역시 is not split.
        let metro = BundledTown(first: "서울특별시", second: "중구", third: "회현동", lat: 37.56, long: 126.98)
        #expect(metro.placeInfo.address == "대한민국 서울특별시 중구 회현동")
    }

    @Test func theBundledTownsAreScannedTenAtATime() throws {
        let url = try #require(TWResources.url("data/towns.json"))
        let towns = try #require(BundledTown.list(Data(contentsOf: url)))
        #expect(towns.count == 4206)
        #expect(towns.first == BundledTown(first: "강원도", second: "강릉시", third: "", lat: 37.75, long: 128.88))
        let search = TownSearch(towns: towns)
        let first = search.search("중구")
        #expect(first.towns.count == 10)
        #expect(first.next > 0)
        var all = first.towns
        var next = first.next
        while next != -1 {
            let page = search.search("중구", from: next)
            all += page.towns
            next = page.next
        }
        #expect(all.count == towns.filter { $0.first.contains("중구") || $0.second.contains("중구") || $0.third.contains("중구") }.count)
        #expect(search.search("회현").towns.map(\.third).contains("회현동"))
        #expect(search.search("zzz") == TownPage(towns: [], next: -1))
        // Case-sensitive, as `indexOf`.
        #expect(TownSearch(towns: [BundledTown(first: "Seoul", second: "", third: "", lat: 1, long: 2)]).search("seoul").towns.isEmpty)
        #expect(BundledTown.list(Data("{}".utf8)) == nil)
    }
}
