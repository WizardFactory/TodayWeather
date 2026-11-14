import Foundation
import Observation
import os
import SwiftUI
import TWData
import TWDomain
import TWStorage
import UIKit
import WebKit

/// Opens a URL with the system, as `cordova.InAppBrowser.open(url, "_system")` and the WKWebView's hand-off of a
/// `mailto:` navigation do on iOS (`UIApplication.openURL`). The app uses `SystemURLOpener`; tests inject a recorder.
@MainActor
protocol URLOpening {
    func open(_ url: URL)
}

struct SystemURLOpener: URLOpening {
    func open(_ url: URL) { UIApplication.shared.open(url) }
}

/// `navigator.userAgent` of a WKWebView, which the Cordova app sent in the feedback mail as its own (`ionic.Platform.ua`).
@MainActor
protocol UserAgentProviding {
    func userAgent() async -> String
}

/// The user agent of a plain WKWebView: cordova-ios 8 keeps WebKit's default (`applicationNameForUserAgent`
/// `Mobile/15E148`, no `OverrideUserAgent` or `AppendUserAgent` in config.xml). Read once per process; "" when the web
/// view cannot answer.
@MainActor
final class WebViewUserAgent: UserAgentProviding {
    private var cached: String?

    func userAgent() async -> String {
        if let cached { return cached }
        let view = WKWebView(frame: .zero)
        // WebKit calls the completion handler once, with the result or an error.
        let text: String = await withCheckedContinuation { continuation in
            view.evaluateJavaScript("navigator.userAgent") { result, _ in
                continuation.resume(returning: result as? String ?? "")
            }
        }
        withExtendedLifetime(view) {}
        if !text.isEmpty { cached = text }
        return text
    }
}

/// The feedback mail's inputs (`Util.sendMail`): the feedback address (`clientConfig.mailTo`, the private build input
/// `TW_MAIL_TO`, Info.plist `TWMailTo`; empty without it, so the mail has no recipient), the app's version
/// (`Util.version`), the device UUID (`device.uuid`: the `CDVUUID` of `DeviceIdentity`, D37) and the WebView's user agent.
@MainActor
struct FeedbackMail {
    var to: String
    var version: String
    var deviceId: @MainActor () -> String
    var userAgent: any UserAgentProviding
}

/// A page of the settings over the tabs: S07 (the units) or S08 (a list).
enum SettingsPage: Equatable {
    case units
    case list(String)
}

/// The settings pages S07 and S08 and the menu's hand-offs (IN-12, #2961), connected to the shell's menu rows
/// (`ShellModel.onMenuRow`): 단위설정 and the three lists open their page (the menu closed first), 널스쿨 풍향 opens the wind
/// map and keeps the menu open, 의견보내기 opens the mail and 응원리뷰쓰기 the App Store page (the menu closed first), About
/// (O10) opens over the menu. S03's and S05's standard row (`goUnitsPage`) opens S07 through the same hook. A page shows
/// over the tab page and the tab bar (the Cordova `units` and `setting-radio` states are outside the tabs, which stay as
/// they were); its back button returns to the page before it. Changes go through `SettingsActions` (the state through
/// the `AppStateHolder`, the weather reload, the push hook).
@MainActor
@Observable
final class SettingsScreens {
    /// The pages shown, the last on top; empty: the tabs.
    private(set) var pages: [SettingsPage] = []

    @ObservationIgnored let shell: ShellModel
    @ObservationIgnored let actions: SettingsActions
    @ObservationIgnored private let opener: any URLOpening
    @ObservationIgnored private let mail: FeedbackMail
    @ObservationIgnored let catalog: Catalog
    /// The rows this does not handle (IN-13's pages, IN-15's privacy rows): the shell's hook as it was before.
    @ObservationIgnored private let otherRows: (MenuRow) -> Void
    @ObservationIgnored private let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "settings")

    init(shell: ShellModel, actions: SettingsActions, opener: any URLOpening, mail: FeedbackMail) {
        self.shell = shell
        self.actions = actions
        self.opener = opener
        self.mail = mail
        catalog = Catalog(code: shell.locale.catalog)
        otherRows = shell.onMenuRow
        shell.onMenuRow = { [weak self] row in self?.menuRow(row) }
    }

    var top: SettingsPage? { pages.last }

    /// The shell's page slot: the page on top in the shell's insets, nil while none shows.
    var pageView: (ShellInsets) -> AnyView? {
        { [weak self] insets in
            guard let self, top != nil else { return nil }
            return AnyView(SettingsPageView(screens: self, insets: insets))
        }
    }

    /// A menu row was chosen (after the menu closed when the row closes it).
    func menuRow(_ row: MenuRow) {
        switch row {
        case .units: openUnits()
        case .startupPage: openList("startupPage")
        case .refreshInterval: openList("refreshInterval")
        case .theme: openList("theme")
        case .nullschoolWind: open(Handoffs.nullschool)
        case .rateApp: open(Handoffs.appStore)
        case .sendFeedback: sendFeedback()
        case .about: showAbout()
        default: otherRows(row)
        }
    }

    /// S07 (`clickMenu('units')`, `goUnitsPage`).
    func openUnits() {
        pages.append(.units)
    }

    /// S08 for `name` (`settingRadio`, from S07 or the menu): the list's value is set as it opens.
    func openList(_ name: String) {
        actions.opened(name)
        pages.append(.list(name))
    }

    /// The page's back button (`onClose`, `$ionicHistory.goBack()`).
    func back() {
        _ = pages.popLast()
    }

    /// A tap on a choice of the shown S08 list: another value is chosen (`valueChanged`); the checked one does nothing,
    /// as the radio's `ng-change` does not fire for it. The page stays.
    func choose(_ value: String) {
        guard case .list(let name)? = top, actions.value(name) != value else { return }
        actions.choose(name, value: value)
    }

    /// The App Store page or the wind map: `cordova.InAppBrowser.open(url, "_system")`.
    private func open(_ text: String) {
        guard let url = URL(string: text) else { return }
        opener.open(url)
    }

    /// 의견보내기 (`Util.sendMail`): the `mailto:` link the Cordova code navigates to, as WebKit parses it.
    func sendFeedback() {
        let mail = self.mail
        let subject = catalog("LOC_SEND_FEEDBACK")
        let uuid = mail.deviceId()
        Task { [weak self] in
            let agent = await mail.userAgent.userAgent()
            let text = Handoffs.feedbackMail(to: mail.to, subject: subject, version: mail.version, uuid: uuid, userAgent: agent)
            guard let self, let url = Handoffs.webKitURL(text) else { return }
            log.info("feedback mail opened")
            opener.open(url)
        }
    }

    /// About (O10, `openInfo`): `$rootScope.showAlert(title, lines)` with the OK button (`button-positive`), over the
    /// menu.
    func showAbout() {
        let about = About(text: catalog.callAsFunction)
        shell.show(Popup(title: about.title, lines: about.lines, buttons: [Popup.Button(text: about.ok, style: .positive)]))
    }
}
