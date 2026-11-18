import Foundation
import TWModel

/// A city shortcut of S01: the place a tap adds, with its name, country, address and coordinates.
public struct CityShortcut: Equatable, Sendable {
    public let name: String
    public let country: String
    public let address: String
    public let lat: Double
    public let long: Double

    public init(_ name: String, _ country: String, _ address: String, _ lat: Double, _ long: Double) {
        self.name = name
        self.country = country
        self.address = address
        self.lat = lat
        self.long = long
    }
}

/// `_makeFavoriteList` of StartCtrl (controller.start.js L145-L199): the S01 shortcuts, copied verbatim with their data
/// quirks (New York's coordinates lie about 290 km north of the city; Kinshasa's country is CG). The list grows with the
/// screen height in CSS pixels (`window.screen.height`, points on iOS): 6 cities, 11 from 568, 17 from 731 and 26 from
/// 960. Port of the Android `CityShortcuts` (AN-10).
public enum CityShortcuts {
    /// `favoriteList1`.
    static let list1 = [
        CityShortcut("서울", "KR", "대한민국 서울특별시", 37.567, 126.978),
        CityShortcut("New York", "US", "New York, NY, United States", 43.299, -74.218),
        CityShortcut("東京", "JP", "日本 東京", 35.709, 139.732),
        CityShortcut("Berlin", "DE", "Berlin, Deutschland", 52.520, 13.405),
        CityShortcut("北京", "CN", "中国北京市", 39.904, 116.407),
        CityShortcut("臺北市", "TW", "台灣臺北市", 25.033, 121.565),
    ]

    /// `favoriteList2`.
    static let list2 = [
        CityShortcut("दिल्ली", "IN", "दिल्ली, भारत", 28.704, 77.102),
        CityShortcut("Hồ Chí Minh", "VN", "Hồ Chí Minh, Việt Nam", 10.823, 106.630),
        CityShortcut("Москва", "RU", "Москва, Россия", 55.756, 37.617),
        CityShortcut("Roma", "IT", "Roma, Italia", 41.903, 12.496),
        CityShortcut("İstanbul", "TR", "İstanbul, Türkiye", 41.008, 28.978),
    ]

    /// `favoriteList3`.
    static let list3 = [
        CityShortcut("香港", "HK", "香港香港島", 22.259, 114.191),
        CityShortcut("São Paulo", "BR", "São Paulo, Brasil", -23.551, -46.633),
        CityShortcut("กรุงเทพมหานคร", "TH", "กรุงเทพมหานคร ประเทศไทย", 13.756, 100.502),
        CityShortcut("Madrid", "ES", "Madrid, España", 40.417, -3.704),
        CityShortcut("Warszawa", "PL", "Warszawa, Polska", 52.230, 21.012),
        CityShortcut("كراچى", "PK", "کراچی, سندھ, پاکستان", 24.861, 67.010),
    ]

    /// `favoriteList4`.
    static let list4 = [
        CityShortcut("وهران", "DZ", "وهران\u{200e}, الجزائر", 35.698, -0.634),
        CityShortcut("Sydney", "AU", "Sydney, New South Wales, Australia", -33.869, 151.209),
        CityShortcut("London", "GB", "London, United Kingdom", 51.507, -0.128),
        CityShortcut("Paris", "FR", "Paris, France", 48.857, 2.352),
        CityShortcut("Kinshasa", "CG", "Kinshasa, République démocratique du Congo", -4.441, 15.266),
        CityShortcut("القاهرة", "EG", "القاهرة, مصر", 30.044, 31.236),
        CityShortcut("Jakarta", "ID", "Jakarta, DKI Jakarta, Indonesia", -6.209, 106.846),
        CityShortcut("Ciudad de México", "MX", "Ciudad de México, México", 19.432, -99.133),
        CityShortcut("تهران", "IR", "تهران, استان تهران, ایران", 35.689, 51.389),
    ]

    /// The shortcuts for a screen `height` in CSS pixels: `bodyHeight >= 568`, `>= 731`, `>= 960`.
    public static func forScreenHeight(_ height: Double) -> [CityShortcut] {
        var list = list1
        if height >= 568 { list += list2 }
        if height >= 731 { list += list3 }
        if height >= 960 { list += list4 }
        return list
    }
}

/// StartCtrl's name of a chosen Places prediction (controller.start.js L321-L331): the term whose offset is the first
/// matched substring's, else the typed word. The Places SDK's full text stands for the legacy `description`; its terms
/// are the parts between ", ", or between spaces when it has no comma (a Korean description). Offsets count UTF-16 code
/// units, as JavaScript and the SDK's attributed text do. Port of the Android `PredictionName`.
public enum PredictionName {
    public static func of(fullText: String, firstMatch: Int?, word: String) -> String {
        guard let offset = firstMatch, let term = terms(fullText).first(where: { $0.offset == offset }) else { return word }
        return term.text
    }

    /// The terms of `fullText` with their UTF-16 offsets.
    public static func terms(_ fullText: String) -> [(offset: Int, text: String)] {
        let separator = JSString.includes(fullText, ", ") ? ", " : " "
        let units = Array(fullText.utf16)
        let sep = Array(separator.utf16)
        var terms: [(Int, String)] = []
        var start = 0
        while start <= units.count {
            let end = JSString.indexOf(fullText, separator, from: start) ?? units.count
            if end > start { terms.append((start, String(decoding: units[start..<end], as: UTF16.self))) }
            start = end + sep.count
        }
        return terms
    }
}

/// A bundled town (`window.towns` of town.js, the copy `Client/data/towns.json` of IN-01).
public struct BundledTown: Decodable, Equatable, Sendable {
    public let first: String
    public let second: String
    public let third: String
    public let lat: Double
    public let long: Double

    public init(first: String, second: String, third: String, lat: Double, long: Double) {
        self.first = first
        self.second = second
        self.third = third
        self.lat = lat
        self.long = long
    }

    /// The towns of `towns.json`, in file order; nil when the file is no list of towns.
    public static func list(_ data: Data) -> [BundledTown]? {
        guard let items = (try? JSONValue.parse(data))?.arrayValue else { return nil }
        var towns: [BundledTown] = []
        towns.reserveCapacity(items.count)
        for item in items {
            guard let first = item["first"]?.stringValue, let second = item["second"]?.stringValue,
                  let third = item["third"]?.stringValue, let lat = item["lat"]?.numberValue?.double,
                  let long = item["long"]?.numberValue?.double else { return nil }
            towns.append(BundledTown(first: first, second: second, third: third, lat: lat, long: long))
        }
        return towns
    }

    /// The `geoInfo` of a town (controller.start.js L260-L288, controller.searchctrl.js L373-L401): "대한민국" and the
    /// town's parts, a 도's 구 split after its first 시, named by the last part present. The branch for a second part with
    /// a space (no town has one) is left out, as on Android.
    public var placeInfo: PlaceInfo {
        var address = "대한민국 " + first
        var name = first
        if !second.isEmpty {
            name = second
            if JSString.endsWith(first, "도") && JSString.endsWith(second, "구") {
                let units = Array(second.utf16)
                let si = (JSString.indexOf(second, "시") ?? -1) + 1
                address += " " + String(decoding: units[0..<si], as: UTF16.self)
                address += " " + String(decoding: units[si...], as: UTF16.self)
            } else {
                address += " " + second
            }
        }
        if !third.isEmpty {
            name = third
            address += " " + third
        }
        return PlaceInfo(name: name, address: address, country: "KR", lat: lat, long: long)
    }
}

/// A place S01 or S02 adds, as its `geoInfo`: the name, the address, the country and the coordinates.
public struct PlaceInfo: Equatable, Sendable {
    public let name: String?
    public let address: String
    public let country: String
    public let lat: Double
    public let long: Double

    public init(name: String?, address: String, country: String, lat: Double, long: Double) {
        self.name = name
        self.address = address
        self.country = country
        self.lat = lat
        self.long = long
    }
}

/// A page of town matches and where the next one starts, -1 at the end of the list (`searchIndex`).
public struct TownPage: Equatable, Sendable {
    public let towns: [BundledTown]
    public let next: Int

    public init(towns: [BundledTown], next: Int) {
        self.towns = towns
        self.next = next
    }
}

/// S02's town scan (`OnScrollResults`, controller.searchctrl.js L288-L303), which S01 uses without a Places key (as on
/// Android): a case-sensitive substring (UTF-16 `indexOf`) of `first`, `second` or `third`, in file order, 10 matches at
/// a time.
public struct TownSearch: Sendable {
    public static let page = 10
    public let towns: [BundledTown]

    public init(towns: [BundledTown]) { self.towns = towns }

    public func search(_ word: String, from: Int = 0) -> TownPage {
        var found: [BundledTown] = []
        var i = max(from, 0)
        while i < towns.count {
            let town = towns[i]
            if JSString.includes(town.first, word) || JSString.includes(town.second, word) || JSString.includes(town.third, word) {
                found.append(town)
                if found.count % Self.page == 0 { return TownPage(towns: found, next: i + 1) }
            }
            i += 1
        }
        return TownPage(towns: found, next: -1)
    }
}
