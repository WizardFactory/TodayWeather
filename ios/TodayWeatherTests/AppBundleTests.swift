import Foundation
import Testing
import TWResources

/// Runs inside the app on a simulator: the built app has the identity of the store app and carries the
/// copies from client/.
struct AppBundleTests {
    let info = Bundle.main.infoDictionary ?? [:]

    @Test func identityMatchesTheStoreApp() {
        #expect(Bundle.main.bundleIdentifier == "net.wizardfactory.todayweather")
        #expect(info["MinimumOSVersion"] as? String == "17.0")
        #expect(Set(info["UIDeviceFamily"] as? [Int] ?? []) == [1, 2])
        #expect(info["CFBundleDisplayName"] as? String == "TodayWeather")
    }

    @Test func appIconIsCompiled() {
        let icons = info["CFBundleIcons"] as? [String: Any]
        let primary = icons?["CFBundlePrimaryIcon"] as? [String: Any]
        #expect(primary?["CFBundleIconName"] as? String == "AppIcon")
    }

    @Test func resourcesShipInsideTheApp() throws {
        #expect(TWResources.bundle.bundleURL.path.hasPrefix(Bundle.main.bundleURL.path))
        let images = FileManager.default.enumerator(at: TWResources.root.appendingPathComponent("img"),
                                                    includingPropertiesForKeys: nil)!
            .compactMap { $0 as? URL }.filter { $0.pathExtension == "png" }
        #expect(images.count == 342)
        let ko = try #require(TWResources.strings(catalog: "ko"))
        #expect(ko.localizedString(forKey: "LOC_TODAYWEATHER", value: nil, table: nil) == "오늘날씨")
        #expect(TWResources.url("data/towns.json") != nil)
    }
}
