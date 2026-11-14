import Foundation
import SwiftUI
import Testing
import TWDomain
import TWResources
@testable import TodayWeather

/// The menu's privacy rows and the screens reported (IN-15, #2964), through the shell's hooks: 선택적 이용 통계 opens
/// the Ionic popup (off by default, can be withdrawn; a failed save shows the message), 광고 개인정보 선택 shows UMP's
/// form or the cannot-open message, the policy and the terms open in the browser in the app's language. The menu stays
/// open. The analytics SDK and its records are doubles; nothing reaches Firebase.
@MainActor
struct PrivacyRowsTests {
    final class Sdk: AnalyticsSdk {
        var calls: [String] = []
        var events: [String] = []
        func setCollectionEnabled(_ enabled: Bool) { calls.append("collection \(enabled)") }
        func setConsent(analytics: Bool) { calls.append("consent \(analytics)") }
        func logEvent(_ name: String, _ parameters: [(String, AnalyticsParameter)]) {
            events.append(([name] + parameters.compactMap { if case .text(let t) = $0.1, $0.0 == "screen_name" { t } else { nil } })
                .joined(separator: " "))
        }
        func setUserProperty(_ value: String, forName name: String) {}
    }

    final class Records: AnalyticsConsentRecords {
        var choice: String?
        var collection = false
        var failWrites = false
        func readChoice() -> String? { choice }
        func writeChoice(_ value: Bool) -> Bool {
            guard !failWrites else { return false }
            choice = String(value)
            return true
        }
        func removeChoice() -> Bool { choice = nil; return true }
        func readCollection() -> Bool { collection }
        func writeCollection(_ enabled: Bool) -> Bool {
            guard !failWrites else { return false }
            collection = enabled
            return true
        }
    }

    struct Setup {
        let shell: ShellModel
        let sdk: Sdk
        let records: Records
        let monetization: Monetization
        let opened: Opened
    }

    final class Opened { var urls: [URL] = [] }

    func setup(languages: [String] = ["ko-KR"], records: Records = Records()) -> Setup {
        let sdk = Sdk()
        let opened = Opened()
        let monetization = Monetization(analytics: UsageAnalytics(sdk: sdk, records: records, trafficType: "development"),
                                        settings: nil, openURL: { opened.urls.append($0) })
        let shell = ShellFixture.shell(languages: languages)
        monetization.attach(shell)
        return Setup(shell: shell, sdk: sdk, records: records, monetization: monetization, opened: opened)
    }

    @Test func analyticsIsOffByDefaultAndTheDialogGrantsAndWithdraws() throws {
        let s = setup()
        let catalog = Catalog(code: "ko")
        #expect(!s.shell.analyticsAllowed)
        s.shell.openMenu()
        s.shell.chooseMenuRow(.analytics)
        #expect(s.shell.menuOpen, "the menu stays open")
        let popup = try #require(s.shell.popups.first)
        #expect(popup.title == catalog("LOC_ANALYTICS_CHOICE") && popup.lines == [catalog("LOC_ANALYTICS_DETAIL")])
        #expect(popup.buttons.map(\.text) == [catalog("LOC_ANALYTICS_DENY"), catalog("LOC_ANALYTICS_ALLOW")])
        s.shell.tapPopupButton(1)
        #expect(s.shell.analyticsAllowed && s.records.choice == "true")
        #expect(s.sdk.calls.suffix(3) == ["collection false", "consent true", "collection true"])
        #expect(s.shell.popups.isEmpty)

        s.shell.chooseMenuRow(.analytics)
        s.shell.tapPopupButton(0)
        #expect(!s.shell.analyticsAllowed && s.records.choice == "false")
        #expect(s.sdk.calls.suffix(2) == ["collection false", "consent false"])
    }

    @Test func aFailedSaveShowsTheMessageAndLeavesAnalyticsOff() throws {
        let records = Records()
        records.failWrites = true
        let s = setup(records: records)
        s.shell.chooseMenuRow(.analytics)
        s.shell.tapPopupButton(1)
        #expect(!s.shell.analyticsAllowed)
        let alert = try #require(s.shell.popups.first)
        #expect(alert.title == "TodayWeather" && alert.lines == [Catalog(code: "ko")("LOC_PRIVACY_SAVE_FAILED")])
        #expect(alert.buttons.map(\.text) == [Catalog(code: "ko")("LOC_OK")] && alert.buttons[0].style == .positive)
    }

    @Test func aStoredGrantShowsInTheRow() {
        let records = Records()
        records.choice = "true"
        records.collection = true
        let s = setup(records: records)
        #expect(s.shell.analyticsAllowed)
    }

    @Test func adPrivacyWithoutAdsShowsTheCannotOpenMessage() throws {
        let s = setup(languages: ["en-US"])
        s.shell.chooseMenuRow(.adPrivacy)
        let alert = try #require(s.shell.popups.first)
        #expect(alert.lines == [Catalog(code: "en")("LOC_AD_PRIVACY_UNAVAILABLE")])
    }

    /// B13 of AN-15: the pages follow the app's language (Korean without a suffix, Japanese, otherwise English).
    @Test func policyAndTermsOpenInTheAppsLanguage() {
        let korean = setup()
        korean.shell.openMenu()
        korean.shell.chooseMenuRow(.privacyPolicy)
        korean.shell.chooseMenuRow(.terms)
        #expect(korean.opened.urls.map(\.absoluteString) == ["https://todayweather.ai/mobile/privacy.html",
                                                            "https://todayweather.ai/mobile/terms.html"])
        #expect(korean.shell.menuOpen && korean.shell.popups.isEmpty)
        let japanese = setup(languages: ["ja-JP"])
        japanese.shell.chooseMenuRow(.privacyPolicy)
        let german = setup(languages: ["de-DE"])
        german.shell.chooseMenuRow(.terms)
        #expect(japanese.opened.urls.map(\.absoluteString) == ["https://todayweather.ai/mobile/privacy.ja.html"])
        #expect(german.opened.urls.map(\.absoluteString) == ["https://todayweather.ai/mobile/terms.en.html"])
    }

    /// Other rows still reach the hook that was there before (IN-12, IN-13).
    @Test func otherRowsKeepTheirHook() {
        let sdk = Sdk()
        let monetization = Monetization(analytics: UsageAnalytics(sdk: sdk, records: Records(), trafficType: "development"),
                                        settings: nil, openURL: { _ in })
        let shell = ShellFixture.shell()
        var rows: [MenuRow] = []
        shell.onMenuRow = { rows.append($0) }
        monetization.attach(shell)
        shell.chooseMenuRow(.units)
        shell.chooseMenuRow(.analytics)
        #expect(rows == [.units])
    }

    /// `screen_view` with the Cordova state names, only after an opt-in.
    @Test func screensFollowTheTabsAfterAnOptIn() async throws {
        let records = Records()
        records.choice = "true"
        records.collection = true
        let s = setup(records: records)
        #expect(s.sdk.events == ["screen_view tab.forecast"])
        s.shell.tapTab(.air)
        try await Task.sleep(for: .milliseconds(50))
        s.shell.tapTab(.search)
        try await Task.sleep(for: .milliseconds(50))
        #expect(s.sdk.events == ["screen_view tab.forecast", "screen_view tab.air", "screen_view tab.search"])

        let off = setup()
        off.shell.tapTab(.air)
        try await Task.sleep(for: .milliseconds(50))
        #expect(off.sdk.events.isEmpty)
    }
}
