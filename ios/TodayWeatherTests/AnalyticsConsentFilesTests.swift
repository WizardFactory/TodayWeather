import Foundation
import Testing
import TWDomain
@testable import TodayWeather

/// The analytics choice and collection state on disk (IN-15): written atomically, read back, and a write that fails
/// reports it, so `UsageAnalytics` withdraws (V22).
@MainActor
struct AnalyticsConsentFilesTests {
    func directory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("in15-consent-\(UUID().uuidString)", isDirectory: true)
    }

    @Test func writesAndReadsBothRecords() throws {
        let dir = directory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let files = AnalyticsConsentFiles(directory: dir)
        #expect(files.readChoice() == nil && !files.readCollection())
        #expect(files.writeChoice(true) && files.writeCollection(true))
        #expect(files.readChoice() == "true" && files.readCollection())
        #expect(files.writeChoice(false) && files.readChoice() == "false")
        #expect(files.removeChoice() && files.readChoice() == nil)
        #expect(files.removeChoice(), "removing a missing choice succeeds")
        try Data("yes".utf8).write(to: dir.appendingPathComponent("analytics-choice"))
        #expect(files.readChoice() == nil, "anything but true or false is no choice")
    }

    @Test func aWriteThatFailsIsReportedAndTheGrantIsWithdrawn() throws {
        let dir = directory()
        defer {
            try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: dir.path)
            try? FileManager.default.removeItem(at: dir)
        }
        let files = AnalyticsConsentFiles(directory: dir)
        #expect(files.writeChoice(true) && files.writeCollection(true))
        try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: dir.path)
        #expect(!files.writeChoice(false))
        #expect(!files.writeCollection(false))

        // Through the analytics consent: a withdrawal that cannot be written still holds after a restart only when
        // the collection state was written; here neither was, so the start corroboration is what remains.
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: dir.path)
        let sdk = PrivacyRowsTests.Sdk()
        let analytics = UsageAnalytics(sdk: sdk, records: files, trafficType: "development")
        analytics.start()
        #expect(analytics.choice)
        try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: dir.path)
        #expect(!analytics.setCollectionEnabled(false))
        #expect(!analytics.choice && sdk.calls.suffix(2) == ["collection false", "consent false"])
    }
}
