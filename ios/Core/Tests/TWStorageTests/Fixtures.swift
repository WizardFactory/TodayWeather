import Foundation
@testable import TWStorage

/// The storage fixtures (README of ios/tools/upgrade/make_fixtures.py and "Data migration from the Cordova app").
enum Fixtures {
    static let root = Bundle.module.url(forResource: "Fixtures", withExtension: nil)!

    /// A data container with WebKit files: `simulator` and `device` (per-origin layout captured from a seeded
    /// Cordova 1.1.1 run, at the simulator and the device path), `legacy` (single-directory layout),
    /// `other-origin` (an `https://localhost` origin only).
    static func container(_ name: String) -> URL {
        root.appendingPathComponent("containers/\(name)", isDirectory: true)
    }

    /// A suite property list as `UserDefaults` stores it: `current` (captured), `types`, `v1.0.10`.
    static func suite(_ name: String) -> [String: Any] {
        let data = try! Data(contentsOf: root.appendingPathComponent("suites/\(name).plist"))
        return try! PropertyListSerialization.propertyList(from: data, format: nil) as! [String: Any]
    }

    static func suiteKeys(_ name: String) -> [String: Any] {
        suite(name).filter { CordovaSources.suiteKeys.contains($0.key) }
    }

    static let seoul = TimeZone(identifier: "Asia/Seoul")!
    /// 2026-11-13 15:00 KST.
    static let now = Date(timeIntervalSince1970: 1_794_549_600)

    static func migrate(_ sources: CordovaSources, region: String? = "KR", zone: TimeZone = seoul,
                        now: Date = now) -> AppState {
        CordovaMigration.migrate(sources, region: region, now: now, zone: zone)
    }

    static func json(_ text: String) -> JSONValue { JSONValue.parse(text)! }
}
