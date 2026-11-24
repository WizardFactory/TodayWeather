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
        #expect(files.readChoice() == "yes", "other content is a stored record, not a missing choice")
    }

    /// A stored decline whose file cannot be read must not turn into the region default (CODEX-3187-3): only a missing
    /// file is no choice; any other unreadable or unexpected record leaves collection off, also in Korea.
    @Test(arguments: ["false", "yes"])
    func anUnreadableOrUnexpectedChoiceLeavesCollectionOff(content: String) throws {
        let dir = directory()
        let choiceFile = dir.appendingPathComponent("analytics-choice")
        defer {
            try? FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: choiceFile.path)
            try? FileManager.default.removeItem(at: dir)
        }
        let files = AnalyticsConsentFiles(directory: dir)
        #expect(files.writeCollection(true))
        try Data(content.utf8).write(to: choiceFile)
        if content == "false" {
            try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: choiceFile.path)
            #expect(files.readChoice() == AnalyticsConsentFiles.unreadable)
        }
        let sdk = PrivacyRowsTests.Sdk()
        let analytics = UsageAnalytics(sdk: sdk, records: files, trafficType: "development", region: "KR")
        analytics.start()
        #expect(!analytics.choice && sdk.calls == ["collection false", "consent false"], "\(sdk.calls)")
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
        let analytics = UsageAnalytics(sdk: sdk, records: files, trafficType: "development", region: "DE")
        analytics.start()
        #expect(analytics.choice)
        try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: dir.path)
        #expect(!analytics.setCollectionEnabled(false))
        #expect(!analytics.choice && sdk.calls.suffix(2) == ["collection false", "consent false"])
    }

    /// The region's default (on in Korea, 2026-11-24) records the collection state but no choice file, so the choice file
    /// still means the user chose; where it cannot record the collection state everything stays off, and still no choice
    /// is written.
    @Test func theRegionDefaultWritesNoChoiceFile() throws {
        let dir = directory()
        defer {
            try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: dir.path)
            try? FileManager.default.removeItem(at: dir)
        }
        let choiceFile = dir.appendingPathComponent("analytics-choice")
        let files = AnalyticsConsentFiles(directory: dir)
        let sdk = PrivacyRowsTests.Sdk()
        let analytics = UsageAnalytics(sdk: sdk, records: files, trafficType: "development", region: "KR")
        analytics.start()
        #expect(analytics.choice && files.readCollection())
        #expect(!FileManager.default.fileExists(atPath: choiceFile.path))

        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: dir.appendingPathComponent("analytics-collection"))
        try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: dir.path)
        let failing = PrivacyRowsTests.Sdk()
        let restarted = UsageAnalytics(sdk: failing, records: files, trafficType: "development", region: "KR")
        restarted.start()
        #expect(!restarted.choice && failing.calls.suffix(2) == ["collection false", "consent false"])
        #expect(!FileManager.default.fileExists(atPath: choiceFile.path))
    }
}
