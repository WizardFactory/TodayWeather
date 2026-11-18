import Foundation
import Testing
import TWModel

/// Keeps `RequestPathsTests` complete (AC3 of #2967); a port of the Android `RequestSitesTest` (AN-18). The app's and
/// the package's sources send HTTP requests only through the transports of the clients that test runs, write server
/// paths only in their request builders, and reach other hosts only as the register's E3 and E4
/// (`Golden/server-routes/exceptions.json`). A new request site, path, SDK or package fails here until its requests are
/// enumerated there and it is listed here. The sources are read from the repository's `ios/` directory.
struct RequestSitesTests {
    static let ios = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()

    /// The Swift sources of the app and the package by path under `ios/`, without their comment lines.
    static let sources: [String: String] = {
        var out: [String: String] = [:]
        for root in ["TodayWeather", "Core/Sources"] {
            let dir = ios.appendingPathComponent(root)
            guard let walker = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: nil) else { continue }
            for case let file as URL in walker where file.pathExtension == "swift" {
                let text = (try? String(contentsOf: file, encoding: .utf8)) ?? ""
                let code = text.split(separator: "\n", omittingEmptySubsequences: false).filter { line in
                    let t = line.drop { $0 == " " }
                    return !(t.hasPrefix("//") || t.hasPrefix("*") || t.hasPrefix("/*"))
                }.joined(separator: "\n")
                out[String(file.path.dropFirst(ios.path.count + 1))] = code
            }
        }
        return out
    }()

    /// The sources where `pattern` occurs in code, or anywhere including strings with `inStrings`.
    static func filesMatching(_ pattern: String, inStrings: Bool = false) -> [String] {
        sources.filter { _, code in
            let text = inStrings ? code : code.replacingOccurrences(of: string, with: "\"\"", options: .regularExpression)
            return text.range(of: pattern, options: .regularExpression) != nil
        }.keys.sorted()
    }

    static func entry(_ id: String) throws -> JSONValue {
        try #require(try ServerRoutes.golden("exceptions.json")["exceptions"]?.arrayValue?.first { $0["id"]?.stringValue == id })
    }

    @Test func theSourcesAreRead() {
        #expect(Self.sources.count > 100, "\(Self.sources.count) sources under \(Self.ios.path)")
    }

    @Test func httpRequestsGoThroughTheKnownTransports() throws {
        #expect(Self.filesMatching(Self.network) == [
            "Core/Sources/TWData/PushTransport.swift",
            "Core/Sources/TWData/WeatherPhotoFeed.swift",
            "TodayWeather/Weather/WeatherPageView.swift",
        ], "the sources using a network API")
        let sites = try Self.entry("E3")["sites"]?.arrayValue?.compactMap(\.stringValue)
        #expect(Self.filesMatching(Self.network).filter { $0.hasPrefix("TodayWeather/") } == sites,
                "E3: the feed's photos are the app's only own request outside the transports")
        #expect(Self.filesMatching(Self.transports) == [
            "Core/Sources/TWData/GeocodeClient.swift",
            "Core/Sources/TWData/NationSource.swift",
            "Core/Sources/TWData/PushSync.swift",
            "Core/Sources/TWData/PushTransport.swift",
            "Core/Sources/TWData/WeatherPhotoFeed.swift",
            "Core/Sources/TWData/WeatherRepository.swift",
            "TodayWeather/PushService.swift",
            "TodayWeather/Shell/AppLaunch.swift",
        ], "the sources using the transports: the clients RequestPathsTests runs, and the app's wiring")
    }

    /// The WKWebView of the settings is only asked for its user agent and loads nothing; Network's path monitor only
    /// watches the connection.
    @Test func webKitAndNetworkSendNothing() {
        #expect(Self.filesMatching(#"\bimport\s+WebKit\b"#) == ["TodayWeather/Settings/SettingsScreens.swift"])
        let webKit = Self.sources["TodayWeather/Settings/SettingsScreens.swift"] ?? ""
        #expect(webKit.range(of: #"\.load(HTML|FileURL|Request)?\(|\bload\("#, options: .regularExpression) == nil,
                "the WKWebView loads nothing")
        #expect(Self.filesMatching(#"\bimport\s+Network\b"#) == ["TodayWeather/Shell/AppLaunch.swift"])
        let launch = Self.sources["TodayWeather/Shell/AppLaunch.swift"] ?? ""
        #expect(launch.range(of: #"\bNW(Connection|Listener|Browser)\b"#, options: .regularExpression) == nil,
                "Network is only NWPathMonitor")
    }

    @Test func serverPathsAreWrittenOnlyInTheRequestBuilders() {
        #expect(Self.filesMatching(Self.serverPath, inStrings: true) == [
            "Core/Sources/TWData/GeocodeClient.swift",
            "Core/Sources/TWData/NationSource.swift",
            // The request log's route label (coord, kma-addr, addr), not a request.
            "Core/Sources/TWData/WeatherRepository.swift",
            "Core/Sources/TWDomain/Forecast/WeatherRequests.swift",
            // `TWModel.apiVersion`, the version constant.
            "Core/Sources/TWModel/TWModel.swift",
            "Core/Sources/TWStorage/PushRegistration.swift",
        ])
    }

    @Test func sdksAreUsedWhereTheRegisterSays() {
        #expect(Self.filesMatching(Self.sdk) == [
            "TodayWeather/Ads/AdMobBanner.swift",
            "TodayWeather/Ads/FirebaseBridges.swift",
            "TodayWeather/Ads/GoogleAdsPlatform.swift",
            "TodayWeather/Ads/Monetization.swift",
            "TodayWeather/AnalyticsGuard.swift",
            "TodayWeather/PushService.swift",
            "TodayWeather/Start/PlaceSearch.swift",
        ], "the sources using an E4 SDK")
    }

    /// Reads of a URL's contents (`Data(contentsOf:)`, `String(contentsOf:)`) are the reviewed local files: the state
    /// file, the consent files, the weather cache, the bundled fonts and towns and the file probe. A new one, which could
    /// read a remote URL past the transports, changes the list (CODEX-IN18P1-4).
    @Test func urlReadsAreTheReviewedLocalFiles() {
        #expect(Self.filesMatching(#"\b(?:Data|String|NSData|NSString)\(\s*contentsOf:"#) == [
            "Core/Sources/TWData/WeatherRepository.swift",
            "Core/Sources/TWStorage/AppStateStore.swift",
            "Core/Sources/TWStorage/FileProbe.swift",
            "TodayWeather/Ads/AnalyticsConsentFiles.swift",
            "TodayWeather/Chart/ChartStyle.swift",
            "TodayWeather/Start/BundledTownLoader.swift",
        ], "the sources reading a URL's contents")
    }

    /// Every package product the app links is reviewed: it sends no request (the local core), or it is an E4 SDK. The
    /// pins of `Package.resolved` are the E4 SDKs and their dependencies.
    @Test func everyProductIsReviewed() throws {
        let project = try String(contentsOf: Self.ios.appendingPathComponent("TodayWeather.xcodeproj/project.pbxproj"),
                                 encoding: .utf8)
        let products = Set(project.matches(of: /productName = ([A-Za-z0-9_]+);/).map { String($0.1) })
            .subtracting(["TodayWeather", "TodayWeatherTests", "TodayWeatherUITests"])
        let sdks = try Self.entry("E4")["sdks"]?.arrayValue?.compactMap(\.stringValue) ?? []
        #expect(products == Set(Self.local.keys).union(sdks), "the linked products")
        let resolved = try JSONValue.parse(Data(contentsOf: Self.ios.appendingPathComponent(
            "TodayWeather.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved")))
        let pins = Set((resolved["pins"]?.arrayValue ?? []).compactMap { $0["identity"]?.stringValue })
        #expect(pins == Self.pins, "the resolved packages: the E4 SDKs and their dependencies")
    }

    /// APIs that can send a request: URLSession, the image loader of SwiftUI, WebKit loads, sockets, other HTTP libraries.
    static let network = #"\b(?:URLSession|NSURLConnection|AsyncImage|CFNetwork|CFHTTP|NWConnection|URLSessionWebSocketTask|Alamofire|Kingfisher|SDWebImage)\b"#

    /// The transports of `RequestPathsTests`' clients.
    static let transports = #"\b(?:URLSessionGet|HTTPPushTransport|PushTransport|firstSettled)\b"#

    /// A server path or the API version written in a string.
    static let serverPath = #""[^"\n]*(?:v0[0-9]{5}|/(?:weather|geocode|kma|nation|push)\b)[^"\n]*""#

    /// The modules of E4's SDKs.
    static let sdk = #"\bimport\s+(?:Firebase[A-Za-z]*|GoogleMobileAds|UserMessagingPlatform|GooglePlaces)\b"#

    static let string = #""(?:[^"\\\n]|\\.)*""#

    /// The local package's products: no request of their own but through the transports above.
    static let local: [String: String] = [
        "TWData": "the clients and transports RequestPathsTests runs",
        "TWDomain": "rules, no I/O",
        "TWModel": "JSON, no I/O",
        "TWResources": "the copies from client/",
        "TWStorage": "the state file and the Cordova migration; the push requests are built here and sent by TWData",
    ]

    /// `Package.resolved`: Firebase 13.1.1, Google Mobile Ads, UMP, the Places SDK and the packages they depend on.
    static let pins: Set<String> = [
        "abseil-cpp-binary", "app-check", "firebase-ios-sdk", "google-ads-on-device-conversion-ios-sdk",
        "googleappmeasurement", "googledatatransport", "googleutilities", "grpc-binary", "gtm-session-fetcher",
        "interop-ios-for-google-sdks", "ios-places-sdk", "leveldb", "nanopb", "promises",
        "swift-package-manager-google-mobile-ads", "swift-package-manager-google-user-messaging-platform",
    ]
}
