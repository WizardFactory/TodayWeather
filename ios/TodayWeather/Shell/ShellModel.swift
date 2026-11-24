import Foundation
import SwiftUI
import UIKit
import TWDomain
import TWStorage

/// A popup of the Cordova app (`$ionicPopup.show`, `.alert`, `.confirm`): a title, lines of text and buttons. A tap on
/// a button runs its action and closes the popup; nothing else closes it (no backdrop tap, and iOS has no back button).
struct Popup: Identifiable {
    struct Button {
        enum Style { case standard, positive, dark }
        var text: String
        var style: Style = .standard
        var action: () -> Void = {}
    }

    let id = UUID()
    var title: String
    var lines: [String]
    var buttons: [Button]
    /// A popup with its own box over the backdrop instead of the title, lines and buttons (IN-10: the start choice O02,
    /// `.ionic_popup`).
    var custom: AnyView? = nil
}

/// What the shell shows and how it reacts (IN-07, #2956): the start screen or the selected tab, the side menu, the
/// popups, and the hooks the screens of IN-08 and later connect (menu rows, the start choice, entry events).
@MainActor
@Observable
final class ShellModel {
    /// S01 (IN-10) or the shell on a tab.
    private(set) var screen: StartScreen
    /// The selected tab (also while S01 shows: the tab the shell opens on).
    private(set) var selected: ShellTab
    private(set) var menuOpen = false
    /// The popups in order; the first shows (Ionic shows one popup at a time and the next after it closes).
    private(set) var popups: [Popup] = []
    /// A short notice over the tabs (#3180: the star saved a place), gone after `noticeDuration`.
    private(set) var notice: String?
    @ObservationIgnored private var noticeTask: Task<Void, Never>?
    static let noticeDuration = Duration.seconds(2)

    let holder: AppStateHolder
    let locale: ShellLocale
    let version: String

    /// The analytics choice the menu shows (`Monetization.getCollectionChoice()`); off until the user opts in. IN-15
    /// keeps it.
    var analyticsAllowed = false
    var trackingStatus: TrackingStatus = .unavailable

    @ObservationIgnored var onMenuOpen: () -> Void = {}
    /// A menu row was chosen (after the menu closed when the row closes it). IN-12, IN-13 and IN-15 connect the rows.
    @ObservationIgnored var onMenuRow: (MenuRow) -> Void = { _ in }
    /// A tap on a tab before the shell handles it: true when the app took it (no enabled place: the start choice O02,
    /// IN-10).
    @ObservationIgnored var onTabTap: (ShellTab) -> Bool = { _ in false }
    /// A deliberate transition, after the no-place/start handler has had first refusal.
    @ObservationIgnored var onForecastTap: (ShellTab) -> Bool = { _ in false }
    private(set) var selectionRevision = 0

    /// The places as the weather pages show them: the saved state, or with an unsaved place as its last place (#3097).
    @ObservationIgnored var shownState: () -> AppState? = { nil }

    /// An entry event after the migration (IN-04, IN-14 and IN-16 handle notification taps and links).
    @ObservationIgnored var onEntry: (EntryEvent) -> Void = { _ in }

    init(holder: AppStateHolder, locale: ShellLocale, version: String) {
        self.holder = holder
        self.locale = locale
        self.version = version
        let state = holder.state
        screen = StartScreen.first(startVersion: state?.cordovaExtras["startVersion"], startupPage: state?.settings.startupPage)
        selected = StartupPage.tab(state?.settings.startupPage)
    }

    struct AdVisit: Hashable {
        let selection: Int
        let place: Int?
        let location: Location?
        let address: String?
    }

    var adVisit: AdVisit {
        let state = holder.state
        let place = state.flatMap { $0.places.indices.contains($0.placeIndex) ? $0.places[$0.placeIndex] : nil }
        return AdVisit(selection: selectionRevision, place: state?.placeIndex, location: place?.location,
                       address: place?.address)
    }

    var theme: Theme { Theme.of(holder.state?.settings.theme) }

    /// The rows of the side menu for the region.
    var menuRows: [MenuRow] { MenuRow.rows(region: locale.region, tracking: trackingStatus) }

    /// The value at the right of a menu row, as a catalog key or a literal (the version).
    func menuValue(_ row: MenuRow) -> MenuValue? {
        let settings = holder.state?.settings
        switch row {
        case .startupPage: return .key(StartupPage.textKey(settings?.startupPage ?? "0"))
        case .refreshInterval: return .key(RefreshInterval.textKey(settings?.refreshInterval ?? "0"))
        case .theme: return .key(RefreshInterval.themeTextKey(settings?.theme ?? "light"))
        case .version: return .text(version)
        default: return nil
        }
    }

    enum MenuValue: Equatable {
        case key(String)
        case text(String)
    }

    /// A tap on the tab bar.
    func tapTab(_ tab: ShellTab) {
        if onTabTap(tab) { return }
        if onForecastTap(tab) { return }
        if selected != tab { select(tab) }
    }

    /// A page changes the tab (S03's air cells open the Air tab; S01 closes onto the startup page's tab).
    func select(_ tab: ShellTab) {
        selectionRevision += 1
        selected = tab
    }

    /// S01 closed (IN-10 stores `startVersion` through the holder first): the shell shows the selected tab.
    func closeStart() {
        screen = .tab(selected)
    }

    func openMenu() {
        onMenuOpen()
        menuOpen = true
    }

    /// The menu's back button (`menu-toggle`).
    func closeMenu() {
        menuOpen = false
    }

    /// A tap on a menu row: the rows that leave the menu close it first (`toggleLeft`), then the row's action runs.
    func chooseMenuRow(_ row: MenuRow) {
        if row == .version { return }
        if row.closesMenu { menuOpen = false }
        onMenuRow(row)
    }

    /// Shows `text` as the short notice, in place of one shown, and announces it to VoiceOver.
    func showNotice(_ text: String) {
        notice = text
        noticeTask?.cancel()
        noticeTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: Self.noticeDuration)
            guard !Task.isCancelled else { return }
            self?.notice = nil
        }
        UIAccessibility.post(notification: .announcement, argument: text)
    }

    /// Shows a popup after those already shown.
    func show(_ popup: Popup) {
        popups.append(popup)
    }

    /// Closes a popup without a tap (IN-10: `confirmPopup.close()`, a new retry confirmation closing the open one, and
    /// the start choice's own OK).
    func dismiss(_ id: UUID) {
        popups.removeAll { $0.id == id }
    }

    /// A tap on a button of the popup shown: it closes, then the button's action runs (`onTap`, then the promise).
    func tapPopupButton(_ index: Int) {
        guard let popup = popups.first, popup.buttons.indices.contains(index) else { return }
        popups.removeFirst()
        popup.buttons[index].action()
    }

    func handle(_ event: EntryEvent) {
        onEntry(event)
    }
}
