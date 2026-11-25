import Foundation

/// The tab a `link.todayweather.ai` link opens (`view`): unknown or missing values are Hourly.
public enum WeatherView: String, Sendable, Equatable, CaseIterable {
    case hourly, daily, air

    public static func of(_ raw: String?) -> WeatherView { raw.flatMap(WeatherView.init(rawValue:)) ?? .hourly }
}

/// What a link opens (specs/deeplink.md §6.1). A pollutant is set only for the Air view.
public enum DeepLinkTarget: Sendable, Equatable {
    /// `/` or `/open`: the app on its current or startup tab.
    case open(lang: String?)
    /// `/place/{slug}` or `/air/{slug}`: a catalog city, which may be unknown to `DeepLinkCatalog`.
    case place(slug: String, view: WeatherView, pollutant: String?)
    /// `/loc`: coordinates rounded to three decimals, with an optional display name.
    case coordinate(lat: Double, lon: Double, name: String?, view: WeatherView, pollutant: String?)
    case nationWeather
    case nationAir
    case warnings
    /// `todayweather://widget?place=`, the widget's place (IN-16), which `WidgetSharing.Link` resolves.
    case legacyWidget(placeID: String?)
}

/// A city of the shared catalog (packages/weather-core `PLACES`): its slug, name, address, country and coordinates.
public struct CatalogPlace: Sendable, Equatable {
    public let id: String
    public let name: String
    public let address: String
    public let country: String
    public let lat: Double
    public let lon: Double

    public init(id: String, name: String, address: String, country: String, lat: Double, lon: Double) {
        self.id = id
        self.name = name
        self.address = address
        self.country = country
        self.lat = lat
        self.lon = lon
    }
}

/// The web app's `PLACES`, in its order; `DeepLinkTests` checks it against the web catalog and the golden vectors.
public enum DeepLinkCatalog {
    public static let places: [CatalogPlace] = [
        CatalogPlace(id: "seoul", name: "서울", address: "서울특별시 중구", country: "KR", lat: 37.567, lon: 126.978),
        CatalogPlace(id: "busan", name: "부산", address: "부산광역시 중구", country: "KR", lat: 35.179, lon: 129.076),
        CatalogPlace(id: "incheon", name: "인천", address: "인천광역시 남동구", country: "KR", lat: 37.456, lon: 126.705),
        CatalogPlace(id: "daegu", name: "대구", address: "대구광역시 중구", country: "KR", lat: 35.871, lon: 128.601),
        CatalogPlace(id: "daejeon", name: "대전", address: "대전광역시 서구", country: "KR", lat: 36.35, lon: 127.385),
        CatalogPlace(id: "gwangju", name: "광주", address: "광주광역시 서구", country: "KR", lat: 35.16, lon: 126.852),
        CatalogPlace(id: "ulsan", name: "울산", address: "울산광역시 남구", country: "KR", lat: 35.539, lon: 129.311),
        CatalogPlace(id: "jeju", name: "제주", address: "제주특별자치도 제주시", country: "KR", lat: 33.499, lon: 126.531),
        CatalogPlace(id: "gangneung", name: "강릉", address: "강원특별자치도 강릉시", country: "KR", lat: 37.752, lon: 128.876),
        CatalogPlace(id: "suwon", name: "수원", address: "경기도 수원시", country: "KR", lat: 37.263, lon: 127.029),
        CatalogPlace(id: "chuncheon", name: "춘천", address: "강원특별자치도 춘천시", country: "KR", lat: 37.881, lon: 127.73),
        CatalogPlace(id: "cheongju", name: "청주", address: "충청북도 청주시", country: "KR", lat: 36.642, lon: 127.489),
        CatalogPlace(id: "jeonju", name: "전주", address: "전북특별자치도 전주시", country: "KR", lat: 35.824, lon: 127.148),
        CatalogPlace(id: "pohang", name: "포항", address: "경상북도 포항시", country: "KR", lat: 36.019, lon: 129.343),
        CatalogPlace(id: "mokpo", name: "목포", address: "전라남도 목포시", country: "KR", lat: 34.811, lon: 126.392),
        CatalogPlace(id: "yeosu", name: "여수", address: "전라남도 여수시", country: "KR", lat: 34.761, lon: 127.662),
        CatalogPlace(id: "andong", name: "안동", address: "경상북도 안동시", country: "KR", lat: 36.569, lon: 128.729),
        CatalogPlace(id: "tokyo", name: "도쿄", address: "Tokyo, Japan", country: "JP", lat: 35.69, lon: 139.692),
        CatalogPlace(id: "london", name: "런던", address: "London, United Kingdom", country: "GB", lat: 51.507, lon: -0.128),
        CatalogPlace(id: "new-york", name: "뉴욕", address: "New York, United States", country: "US", lat: 40.713, lon: -74.006),
        CatalogPlace(id: "berlin", name: "베를린", address: "Berlin, Germany", country: "DE", lat: 52.52, lon: 13.405),
        CatalogPlace(id: "singapore", name: "싱가포르", address: "Singapore", country: "SG", lat: 1.352, lon: 103.82),
    ]

    public static func find(_ slug: String) -> CatalogPlace? { places.first { $0.id == slug } }

    /// The first city within 0.04° on both axes (`nearbyCatalog`), as a share link prefers it to coordinates.
    public static func nearby(lat: Double, lon: Double) -> CatalogPlace? {
        places.first { abs($0.lat - lat) < DeepLink.catalogMatchDegrees && abs($0.lon - lon) < DeepLink.catalogMatchDegrees }
    }
}

/// The `link.todayweather.ai` contract (specs/deeplink.md §2, §7): `parse` reads a link that opened the app, `shareURL`
/// builds the link a share message ends with. Both follow the reference parser of
/// scripts/verification/deeplink-golden.test.mjs, as the Android `DeepLink` does (#3096).
public enum DeepLink {
    public static let host = "link.todayweather.ai"
    public static let origin = "https://\(host)"
    public static let catalogMatchDegrees = 0.04
    public static let pollutants = ["aqi", "pm25", "pm10", "o3", "no2", "so2", "co"]
    private static let maxName = 80
    private static let legacyScheme = "todayweather://"

    /// The target of `url`, or nil for another host or scheme, an unknown path or invalid required parameters.
    public static func parse(_ url: String) -> DeepLinkTarget? {
        if url.hasPrefix(legacyScheme) { return legacy(url) }
        guard let (scheme, authority, pathAndQuery) = split(url), scheme.lowercased() == "https" else { return nil }
        let hostAndPort = authority.split(separator: "@", omittingEmptySubsequences: false).last.map(String.init) ?? ""
        guard hostName(hostAndPort)?.lowercased() == host else { return nil }
        let rawPathPart = pathAndQuery.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        let rawPath = rawPathPart.isEmpty ? "/" : rawPathPart
        let query = Query(pathAndQuery.contains("?") ? String(pathAndQuery[pathAndQuery.index(after: pathAndQuery.firstIndex(of: "?")!)...]) : "")
        guard let path = decodePath(rawPath) else { return nil }
        let trimmed = path.count > 1 && path.hasSuffix("/") ? String(path.dropLast()) : path
        func pollutant(_ view: WeatherView) -> String? { view == .air ? normalizePollutant(query["pollutant"]) : nil }
        // Compared by segment: the link paths are not server paths.
        let segments = trimmed.hasPrefix("/") ? trimmed.dropFirst().split(separator: "/", omittingEmptySubsequences: false).map(String.init) : []
        if path == "/" || trimmed == "/open" {
            let lang = query["lang"].map { jsTrim($0).lowercased() }.flatMap { isLang($0) ? $0 : nil }
            return .open(lang: lang)
        }
        if segments == ["nation", "weather"] { return .nationWeather }
        if segments == ["nation", "air"] { return .nationAir }
        if segments == ["warnings"] { return .warnings }
        if trimmed.hasPrefix("/place/") {
            let slug = String(trimmed.dropFirst("/place/".count))
            guard isSlug(slug) else { return nil }
            let view = WeatherView.of(query["view"])
            return .place(slug: slug, view: view, pollutant: pollutant(view))
        }
        if trimmed.hasPrefix("/air/") {
            let slug = String(trimmed.dropFirst("/air/".count))
            guard isSlug(slug) else { return nil }
            return .place(slug: slug, view: .air, pollutant: normalizePollutant(query["pollutant"]))
        }
        if trimmed == "/loc" {
            guard let lat = coordinate(query["lat"], bound: 90), let lon = coordinate(query["lon"], bound: 180) else { return nil }
            let view = WeatherView.of(query["view"])
            return .coordinate(lat: lat, lon: lon, name: sanitizeName(query["name"]), view: view, pollutant: pollutant(view))
        }
        return nil
    }

    /// The link for a shared place (§7): a catalog city (`placeID`, else the first within 0.04°) as `/place/{slug}`
    /// (`?view=daily`) or `/air/{slug}` (`?pollutant=` unless `aqi`); else valid coordinates as `/loc` rounded to three
    /// decimals with the name; else `/open`.
    public static func shareURL(lat: Double?, lon: Double?, name: String?, view: WeatherView, pollutant: String?,
                                placeID: String? = nil) -> String {
        let selected = view == .air ? normalizePollutant(pollutant) : nil
        let validLat = lat.flatMap { $0.isFinite && $0 >= -90 && $0 <= 90 ? $0 : nil }
        let validLon = lon.flatMap { $0.isFinite && $0 >= -180 && $0 <= 180 ? $0 : nil }
        let slug = placeID.flatMap(DeepLinkCatalog.find)?.id
            ?? { () -> String? in
                guard let la = validLat, let lo = validLon else { return nil }
                return DeepLinkCatalog.nearby(lat: la, lon: lo)?.id
            }()
        if let slug {
            switch view {
            case .air: return "\(origin)/air/\(slug)" + (selected != "aqi" ? "?pollutant=\(selected!)" : "")
            case .daily: return "\(origin)/place/\(slug)?view=daily"
            case .hourly: return "\(origin)/place/\(slug)"
            }
        }
        guard let la = validLat, let lo = validLon else { return "\(origin)/open" }
        var parts = ["lat=\(Js.numberToString(round(la)))", "lon=\(Js.numberToString(round(lo)))"]
        if let name = sanitizeName(name) { parts.append("name=\(encodeComponent(name))") }
        if view != .hourly { parts.append("view=\(view.rawValue)") }
        if view == .air, let selected, selected != "aqi" { parts.append("pollutant=\(selected)") }
        return "\(origin)/loc?" + parts.joined(separator: "&")
    }

    /// A saved place within 0.01° of a link on both axes, compared in millidegrees as the web app does (`nearbySaved`).
    public static func nearSaved(_ aLat: Double, _ aLon: Double, _ bLat: Double, _ bLon: Double) -> Bool {
        func distance(_ a: Double, _ b: Double) -> Double { abs(Js.round(a * 1000) - Js.round(b * 1000)) }
        return distance(aLat, bLat) <= 10 && distance(aLon, bLon) <= 10
    }

    /// "lat, lon" as JavaScript prints the numbers: the title of a linked place without a name.
    public static func coordinateText(lat: Double, lon: Double) -> String {
        Js.numberToString(lat) + ", " + Js.numberToString(lon)
    }

    // MARK: - Parts

    /// `todayweather://widget?place=`: the widget's link. Other custom links (Android's `todayweather://N`, a bare
    /// `todayweather://`) open nothing on iOS.
    private static func legacy(_ url: String) -> DeepLinkTarget? {
        let rest = url.dropFirst(legacyScheme.count)
        guard rest == "widget" || rest.hasPrefix("widget?") else { return nil }
        let place = URLComponents(string: url)?.queryItems?.first { $0.name == "place" }?.value
        return .legacyWidget(placeID: place)
    }

    /// `^([A-Za-z][A-Za-z0-9+.-]*)://([^/?#]*)([^#]*)`: the scheme, the authority and the path with its query.
    private static func split(_ url: String) -> (String, String, String)? {
        guard let separator = url.range(of: "://") else { return nil }
        let scheme = url[..<separator.lowerBound]
        guard let first = scheme.unicodeScalars.first, isASCIILetter(first),
              scheme.unicodeScalars.allSatisfy({ isASCIILetter($0) || ("0"..."9").contains($0) || "+.-".unicodeScalars.contains($0) })
        else { return nil }
        let rest = url[separator.upperBound...]
        let authorityEnd = rest.firstIndex { $0 == "/" || $0 == "?" || $0 == "#" } ?? rest.endIndex
        let afterAuthority = rest[authorityEnd...]
        let pathEnd = afterAuthority.firstIndex(of: "#") ?? afterAuthority.endIndex
        return (String(scheme), String(rest[..<authorityEnd]), String(afterAuthority[..<pathEnd]))
    }

    /// The host of `host[:port]` as `new URL` accepts it: an empty port or one up to 65535; nil for an invalid port.
    private static func hostName(_ hostAndPort: String) -> String? {
        guard let colon = hostAndPort.lastIndex(of: ":") else { return hostAndPort }
        let port = hostAndPort[hostAndPort.index(after: colon)...]
        // `:(\d*)$`: a colon followed by anything but digits is part of no valid host here.
        guard port.unicodeScalars.allSatisfy({ ("0"..."9").contains($0) }) else { return hostAndPort }
        if !port.isEmpty, Decimal(string: String(port)).map({ $0 > 65535 }) ?? true { return nil }
        return String(hostAndPort[..<colon])
    }

    private static func isASCIILetter(_ c: Unicode.Scalar) -> Bool { ("a"..."z").contains(c) || ("A"..."Z").contains(c) }

    /// `^[a-z0-9-]{1,64}$`.
    private static func isSlug(_ s: String) -> Bool {
        let scalars = s.unicodeScalars
        return (1...64).contains(scalars.count) && scalars.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "-" }
    }

    /// `^[a-z]{2,3}$`.
    private static func isLang(_ s: String) -> Bool {
        (2...3).contains(s.unicodeScalars.count) && s.unicodeScalars.allSatisfy { ("a"..."z").contains($0) }
    }

    private static func normalizePollutant(_ raw: String?) -> String { raw.flatMap { pollutants.contains($0) ? $0 : nil } ?? "aqi" }

    /// `Math.round(v * 1000) / 1000` without a negative zero.
    private static func round(_ value: Double) -> Double {
        let r = Js.round(value * 1000) / 1000
        return r == 0 ? 0 : r
    }

    /// `^-?(?:\d+\.?\d*|\.\d+)$` with ASCII digits, then within ±`bound`, rounded to three decimals.
    private static func coordinate(_ raw: String?, bound: Double) -> Double? {
        guard let raw, !raw.isEmpty else { return nil }
        let text = jsTrim(raw)
        var digits = Substring(text)
        if digits.hasPrefix("-") { digits = digits.dropFirst() }
        let parts = digits.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
        func isDigits(_ s: Substring) -> Bool { s.unicodeScalars.allSatisfy { ("0"..."9").contains($0) } }
        let whole = parts[0]
        let fraction = parts.count > 1 ? parts[1] : nil
        guard isDigits(whole), fraction.map(isDigits) ?? true else { return nil }
        if whole.isEmpty && (fraction ?? "").isEmpty { return nil }
        guard let value = Double(text), value.isFinite, value >= -bound, value <= bound else { return nil }
        return round(value)
    }

    /// Control characters removed, trimmed, at most 80 Unicode scalar values; nil when nothing is left.
    private static func sanitizeName(_ raw: String?) -> String? {
        guard let raw else { return nil }
        var kept = String.UnicodeScalarView()
        for scalar in raw.unicodeScalars where scalar.value > 0x1f && scalar.value != 0x7f { kept.append(scalar) }
        let cleaned = jsTrim(String(kept))
        guard !cleaned.isEmpty else { return nil }
        return String(String.UnicodeScalarView(cleaned.unicodeScalars.prefix(maxName)))
    }

    /// `decodeURIComponent` of the path, refusing malformed escapes, `..`, `\` and NUL.
    private static func decodePath(_ raw: String) -> String? {
        guard let decoded = percentDecode(raw, strict: true, plusIsSpace: false) else { return nil }
        if decoded.contains("..") || decoded.contains("\\") || decoded.unicodeScalars.contains("\u{0}") { return nil }
        return decoded
    }

    /// `URLSearchParams.get`: the first value of a name, `+` as a space, lenient percent-decoding.
    private struct Query {
        let pairs: [(String, String)]

        init(_ raw: String) {
            pairs = raw.split(separator: "&").map { part in
                let pieces = part.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
                let name = String(pieces[0])
                let value = pieces.count > 1 ? String(pieces[1]) : ""
                return (DeepLink.percentDecode(name, strict: false, plusIsSpace: true) ?? name,
                        DeepLink.percentDecode(value, strict: false, plusIsSpace: true) ?? value)
            }
        }

        subscript(name: String) -> String? { pairs.first { $0.0 == name }?.1 }
    }

    /// Percent-decoding as UTF-8. `strict` (`decodeURIComponent`): a malformed escape or invalid UTF-8 gives nil;
    /// otherwise (`URLSearchParams`) a malformed escape stays as it is and invalid UTF-8 becomes U+FFFD.
    private static func percentDecode(_ s: String, strict: Bool, plusIsSpace: Bool) -> String? {
        let scalars = Array(s.unicodeScalars)
        var bytes: [UInt8] = []
        var i = 0
        while i < scalars.count {
            let c = scalars[i]
            if c == "%", i + 2 < scalars.count,
               let high = hex(scalars[i + 1]), let low = hex(scalars[i + 2]) {
                bytes.append(UInt8(high * 16 + low))
                i += 3
                continue
            }
            if c == "%" && strict { return nil }
            if c == "+" && plusIsSpace {
                bytes.append(0x20)
            } else {
                bytes.append(contentsOf: Array(String(c).utf8))
            }
            i += 1
        }
        if !strict { return String(decoding: bytes, as: UTF8.self) }
        return String(bytes: bytes, encoding: .utf8)
    }

    private static func hex(_ c: Unicode.Scalar) -> Int? {
        guard c.isASCII else { return nil }
        return Int(String(c), radix: 16)
    }

    /// `encodeURIComponent`.
    private static func encodeComponent(_ s: String) -> String {
        let unreserved = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()".utf8)
        let digits = Array("0123456789ABCDEF".utf8)
        var out: [UInt8] = []
        for b in s.utf8 {
            if unreserved.contains(b) {
                out.append(b)
            } else {
                out.append(UInt8(ascii: "%"))
                out.append(digits[Int(b >> 4)])
                out.append(digits[Int(b & 0xf)])
            }
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// `String.prototype.trim`: JavaScript's white space and line terminators.
    static func jsTrim(_ s: String) -> String {
        let scalars = s.unicodeScalars
        guard let start = scalars.firstIndex(where: { !isJSSpace($0) }) else { return "" }
        let end = scalars.lastIndex(where: { !isJSSpace($0) })!
        return String(scalars[start...end])
    }

    private static func isJSSpace(_ c: Unicode.Scalar) -> Bool {
        switch c.value {
        case 0x09...0x0d, 0x20, 0xa0, 0x1680, 0x2000...0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff: return true
        default: return false
        }
    }
}
