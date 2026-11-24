import Foundation
import SwiftUI
import Testing
import TWDomain
import TWResources
import UIKit
@testable import TodayWeather

/// The menu's privacy rows and the screens reported (IN-15, #2964), through the shell's hooks: 이용 통계 opens the Ionic
/// popup (on by default outside the EEA, the United Kingdom and Switzerland, off until the user agrees there, 2026-11-24;
/// either can be changed; a failed save shows the message), 광고 개인정보 선택 shows UMP's form or the cannot-open
/// message, the policy and the terms open in the browser in the app's language. The menu stays open. The analytics SDK
/// and its records are doubles; nothing reaches Firebase.
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

    /// `region` is the device region (`Locale.current.region`); the tests of the opt-in rows use an EEA region.
    func setup(languages: [String] = ["ko-KR"], records: Records = Records(), region: String? = "DE") -> Setup {
        let sdk = Sdk()
        let opened = Opened()
        let monetization = Monetization(analytics: UsageAnalytics(sdk: sdk, records: records, trafficType: "development",
                                                                  region: region),
                                        settings: nil, openURL: { opened.urls.append($0) })
        let shell = ShellFixture.shell(languages: languages)
        monetization.attach(shell)
        return Setup(shell: shell, sdk: sdk, records: records, monetization: monetization, opened: opened)
    }

    /// In the EEA, the United Kingdom, Switzerland and an unknown region: off until the user agrees, as before.
    @Test func analyticsIsOffByDefaultAndTheDialogGrantsAndWithdraws() throws {
        let s = setup(region: "DE")
        let catalog = Catalog(code: "ko")
        #expect(!s.shell.analyticsAllowed)
        s.shell.openMenu()
        s.shell.chooseMenuRow(.analytics)
        #expect(s.shell.menuOpen, "the menu stays open")
        let popup = try #require(s.shell.popups.first)
        #expect(popup.title == "이용 통계" && popup.lines == [catalog("LOC_ANALYTICS_DETAIL")])
        #expect(popup.lines[0].contains("동의하시겠습니까?"), "the consent question of the client catalog")
        #expect(popup.buttons.map(\.text) == ["거부 / 철회", "동의"])
        s.shell.tapPopupButton(1)
        #expect(s.shell.analyticsAllowed && s.records.choice == "true")
        #expect(s.sdk.calls.suffix(4) == ["collection false", "consent false", "consent true", "collection true"])
        #expect(s.shell.popups.isEmpty)

        s.shell.chooseMenuRow(.analytics)
        s.shell.tapPopupButton(0)
        #expect(!s.shell.analyticsAllowed && s.records.choice == "false")
        #expect(s.sdk.calls.suffix(2) == ["collection false", "consent false"])
    }

    /// Outside them (here Korea) analytics is on without a choice, no choice is written, and the popup says it stays on
    /// unless turned off here: 끄기 writes "false", 켜기 writes "true" (AK, 2026-11-24).
    @Test(arguments: [("ko-KR", "ko"), ("en-US", "en"), ("ja-JP", "ja")])
    func analyticsIsOnByDefaultElsewhereAndTheDialogTurnsItOffAndOn(language: String, code: String) throws {
        let s = setup(languages: [language], region: "KR")
        let catalog = Catalog(code: code)
        #expect(s.shell.analyticsAllowed)
        #expect(s.records.choice == nil && s.records.collection)
        #expect(s.sdk.calls == ["collection false", "consent false", "consent true", "collection true"])
        s.shell.openMenu()
        s.shell.chooseMenuRow(.analytics)
        let popup = try #require(s.shell.popups.first)
        #expect(popup.title == catalog("LOC_ANALYTICS_CHOICE") && popup.lines == [catalog("LOC_ANALYTICS_DETAIL_ON_BY_DEFAULT")])
        #expect(popup.buttons.map(\.text) == [catalog("LOC_ANALYTICS_TURN_OFF"), catalog("LOC_ANALYTICS_TURN_ON")])
        if code == "ko" {
            #expect(popup.title == "이용 통계" && popup.buttons.map(\.text) == ["끄기", "켜기"])
            #expect(popup.lines[0].contains("이 메뉴에서 끄지 않는 한 켜져 있으며"))
        }
        s.shell.tapPopupButton(0)
        #expect(!s.shell.analyticsAllowed && s.records.choice == "false" && !s.records.collection)
        #expect(s.sdk.calls.suffix(2) == ["collection false", "consent false"])
        #expect(s.shell.popups.isEmpty)

        s.shell.chooseMenuRow(.analytics)
        s.shell.tapPopupButton(1)
        #expect(s.shell.analyticsAllowed && s.records.choice == "true")
        #expect(s.sdk.calls.suffix(4) == ["collection false", "consent false", "consent true", "collection true"])
    }

    /// A stored "false" stays off in Korea; a stored grant stays on in Germany.
    @Test func aStoredChoiceWinsOverTheRegion() {
        let declined = Records()
        declined.choice = "false"
        #expect(!setup(records: declined, region: "KR").shell.analyticsAllowed)
        let granted = Records()
        granted.choice = "true"
        granted.collection = true
        #expect(setup(records: granted, region: "DE").shell.analyticsAllowed)
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
        let monetization = Monetization(analytics: UsageAnalytics(sdk: sdk, records: Records(), trafficType: "development",
                                                                  region: "DE"),
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

    /// The settings pages over the tabs (IN-12) are screens too, as the Cordova `units` and `setting-radio` states and
    /// the Android `screenName` (CODEX-IN15-3): opening S07, then an S08 list, and going back to the tabs.
    @Test func settingsPagesAreScreens() async throws {
        let records = Records()
        records.choice = "true"
        records.collection = true
        let pages = PageStack()
        let sdk = Sdk()
        let monetization = Monetization(analytics: UsageAnalytics(sdk: sdk, records: records, trafficType: "development",
                                                                  region: "DE"),
                                        settings: nil, openURL: { _ in })
        monetization.pageScreen = { pages.top.map(SettingsScreens.screenName) }
        let shell = ShellFixture.shell(languages: ["ko-KR"])
        monetization.attach(shell)
        pages.top = .units
        try await Task.sleep(for: .milliseconds(50))
        pages.top = .list("temperatureUnit")
        try await Task.sleep(for: .milliseconds(50))
        pages.top = nil
        try await Task.sleep(for: .milliseconds(50))
        #expect(sdk.events == ["screen_view tab.forecast", "screen_view units", "screen_view setting-radio",
                               "screen_view tab.forecast"])
    }

    @MainActor @Observable final class PageStack { var top: SettingsPage? }
}

extension HostedShellTests {
    /// The analytics row in the side menu reads 이용 통계 · 켜짐 or 이용 통계 · 꺼짐 (2026-11-24; the Cordova row read
    /// 선택적 이용 통계 · 꺼짐 or · 동의함).
    @MainActor
    struct AnalyticsRowTests {
        @Test func theRowShowsWhetherAnalyticsIsOn() async throws {
            for (region, expected) in [("KR", "이용 통계 · 켜짐"), ("DE", "이용 통계 · 꺼짐")] {
                let s = PrivacyRowsTests().setup(region: region)
                let menu = SideMenu(model: s.shell, catalog: Catalog(code: "ko"), insets: ShellScreenshotTests.insets,
                                    scrolls: false)
                let host = try HostedView(menu.frame(height: 1200, alignment: .top), size: CGSize(width: 393, height: 1200))
                defer { host.close() }
                try await host.settle()
                #expect(host.element("shell-menu-analytics")?.accessibilityLabel == expected, "\(region)")
                s.shell.chooseMenuRow(.analytics)
                s.shell.tapPopupButton(region == "KR" ? 0 : 1)
                try await host.settle()
                let after = region == "KR" ? "이용 통계 · 꺼짐" : "이용 통계 · 켜짐"
                #expect(host.element("shell-menu-analytics")?.accessibilityLabel == after, "\(region) after the popup")
            }
        }

        /// The row and the popup in the app's shell, tapped as VoiceOver activates them, for Korea (on by default) and
        /// Germany (asks first); the attachments illustrate the usage analytics guide (docs/user/ios-app/usage-analytics).
        @Test func theRowOpensThePopupOfTheRegion() async throws {
            let size = CGSize(width: 402, height: 874)
            let insets = ShellInsets(statusBar: 54, top: 8, bottom: 34, leading: 0, trailing: 0)
            let ko = Catalog(code: "ko")
            for (region, detail, buttons) in [("KR", "LOC_ANALYTICS_DETAIL_ON_BY_DEFAULT", ["끄기", "켜기"]),
                                              ("DE", "LOC_ANALYTICS_DETAIL", ["거부 / 철회", "동의"])] {
                let s = PrivacyRowsTests().setup(region: region)
                let host = try HostedView(ShellFrame(model: s.shell, insets: insets).ignoresSafeArea(), size: size)
                defer { host.close() }
                func capture(_ name: String) {
                    let data = UIGraphicsImageRenderer(size: size).pngData { _ in
                        host.window.drawHierarchy(in: host.window.bounds, afterScreenUpdates: true)
                    }
                    Attachment.record(data, named: "usage-analytics-\(region)-\(name).png")
                }
                s.shell.openMenu()
                #expect(try await host.menuInPlace())
                for case let scroll as UIScrollView in host.elements() where scroll.contentSize.height > scroll.bounds.height {
                    let end = scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom
                    scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: end), animated: false)
                }
                try await host.settle()
                capture("menu")
                try host.tap("shell-menu-analytics")
                try await host.settle()
                let popup = try #require(s.shell.popups.first)
                #expect(popup.title == "이용 통계" && popup.lines == [ko(detail)] && popup.buttons.map(\.text) == buttons, "\(region)")
                capture("popup")
                s.shell.tapPopupButton(region == "KR" ? 0 : 1)
                try await host.settle()
                capture("after")
            }
        }
    }
}
