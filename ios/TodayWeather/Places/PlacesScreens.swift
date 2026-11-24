import Foundation
import Observation
import SwiftUI
import TWData
import TWDomain
import TWModel
import TWStorage
import UIKit

/// The Locations tab, S02 (tab-search.html and SearchCtrl, #2960), in the shell: a new visit (`PlacesPage`) each time the
/// tab opens (`cache: false`), the search with IN-10's component (`PlaceQuery`: Google's predictions with the Places key
/// and the bundled towns), the modes of the header's button, and the hand-offs: a row tap or an add selects the place
/// and opens the startup page (`goPage()`: `reloadEvent 'search'`), the bell opens the place's alarms (IN-14 connects
/// `onBell`), O03 `search` shows through the shell's popups, and `$ionicLoading` covers the shell. Port of the Android
/// `PlacesTab` (AN-11) with the Cordova iOS branches (no input focus on an empty list: `setInputFocus` does not work on
/// iOS). #3180, #3097: a chosen result is not saved; it opens as the unsaved place (`onOpenPlace`) on the tab the search
/// came from. The weather header's search button opens the visit in search mode with the input focused
/// (`openSearch(from:)`), and 취소 returns to that tab.
@MainActor
@Observable
final class PlacesScreens {
    @ObservationIgnored let shell: ShellModel
    @ObservationIgnored let session: WeatherSession
    @ObservationIgnored let catalog: Catalog
    @ObservationIgnored private let makePage: () -> PlacesPage
    @ObservationIgnored private let search: (any PlaceSearch)?
    @ObservationIgnored private let towns: BundledTownLoader
    @ObservationIgnored private let openURL: (URL) -> Void
    /// The bell of a row (`OnOpenSettingPush(index)`, the alarms page S09, IN-14).
    @ObservationIgnored var onBell: (Int) -> Void = { _ in }
    /// A chosen search result, shown without saving it (#3180: `LinkOpener.show`).
    @ObservationIgnored var onOpenPlace: (Place) -> Void = { _ in }
    /// The tab the header's search button opened the search from; 취소 and a chosen result return there (#3180).
    private(set) var searchFrom: ShellTab?
    /// The header's search button asked for the next visit to start searching from this tab.
    @ObservationIgnored private var pendingSearch: ShellTab?
    /// Incremented to give the input the focus (the header's search button, #3180).
    private(set) var focusIn = 0
    @ObservationIgnored private var focusPending = false

    /// The visit shown now; a new one each time the tab opens.
    private(set) var page: PlacesPage
    /// The search of the visit.
    private(set) var query: PlaceQuery
    /// `isEditing`.
    private(set) var editing = false
    /// `isSearching`.
    private(set) var searching = false
    /// The input has the focus (the keyboard shows).
    @ObservationIgnored private(set) var inputFocused = false
    /// Incremented to take the focus from the input (`cordova.plugins.Keyboard.close()`).
    private(set) var focusRequest = 0
    /// Visits opened so far.
    private(set) var visits = 0
    @ObservationIgnored private var visitOpen = false
    /// The page's found positions already shown in the search (`PlacesPage.finds`).
    @ObservationIgnored private var shownFinds = 0

    init(shell: ShellModel, session: WeatherSession, makePage: @escaping () -> PlacesPage, search: (any PlaceSearch)?,
         towns: BundledTownLoader, openURL: @escaping (URL) -> Void = { UIApplication.shared.open($0) }) {
        self.shell = shell
        self.session = session
        self.makePage = makePage
        self.search = search
        self.towns = towns
        self.openURL = openURL
        catalog = Catalog(code: shell.locale.catalog)
        page = makePage()
        query = PlaceQuery(search: search, towns: towns, scansTowns: true, keepsLastTowns: false)
        shownFinds = page.finds
        observe()
    }

    // MARK: The visit

    private func observe() {
        withObservationTracking {
            _ = shell.selected
            _ = shell.screen
            _ = page.found
            _ = page.finds
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                self?.update()
                self?.observe()
            }
        }
        update()
    }

    private func update() {
        let shown: Bool
        if case .tab = shell.screen { shown = shell.selected == .search } else { shown = false }
        if shown && !visitOpen { openVisit() }
        if !shown && visitOpen {
            query.clear()
            searchFrom = nil
            // A result still loading opens nothing once the tab is left (another tab, a link; CODEX-3195-2).
            page.close()
        }
        visitOpen = shown
        // `OnSearchCurrentPosition`: each found position replaces the results with the found row, named in the input
        // (`search.word`), also when the word already is its name.
        if page.finds != shownFinds {
            shownFinds = page.finds
            if let name = page.found?["name"]?.stringValue { query.show(word: name) }
        }
    }

    /// Back from S09 (IN-14): the tab's page starts anew while it shows (`cache: false`), so the bells are read again.
    func reopen() {
        guard visitOpen else { return }
        openVisit()
    }

    /// SearchCtrl's `init` for a new visit.
    private func openVisit() {
        query.clear()
        page = makePage()
        page.onPopup = { [weak self] in self?.show($0) }
        page.onOpen = { [weak self] in self?.onOpenPlace($0) }
        page.onOpened = { [weak self] in self?.opened() }
        query = PlaceQuery(search: search, towns: towns, scansTowns: true, keepsLastTowns: false)
        shownFinds = page.finds
        editing = false
        searching = false
        searchFrom = nil
        if let from = pendingSearch {
            pendingSearch = nil
            searchFrom = from
            searching = true
            focusPending = true
            focusIn += 1
        }
        visits += 1
        page.open()
    }

    /// The weather header's search button (#3180): S02 opens in search mode with the input focused; 취소 returns to `tab`.
    func openSearch(from tab: ShellTab) {
        pendingSearch = tab
        // Always a new visit, also when the tab's close has not been observed yet (a search right after 취소).
        visitOpen = false
        shell.select(.search)
        update()
    }

    /// True once after `openSearch`: the header gives the input the focus.
    func takeFocusRequest() -> Bool {
        defer { focusPending = false }
        return focusPending
    }

    /// The rows of the list: each place with its stored weather and the visit's bell.
    var rows: [PlaceRow] {
        guard let state = shell.holder.state else { return [] }
        let texts = PlaceRows.Texts(current: catalog("LOC_CURRENT"), location: catalog("LOC_LOCATION"))
        return state.places.enumerated().map { i, place in
            let weather = session.repository.weather[WeatherRepository.key(place)]?.weather["currentWeather"]?.objectValue
            return PlaceRows.row(name: place.name, address: place.address, currentPosition: place.currentPosition, disable: place.disable,
                                 currentWeather: weather, hasPush: page.hasPush.indices.contains(i) && page.hasPush[i],
                                 language: shell.locale.webLanguage, texts: texts)
        }
    }

    // MARK: The header

    /// `OnFocusInput`.
    func focusChanged(_ focused: Bool) {
        inputFocused = focused
        guard focused else { return }
        editing = false
        searching = true
    }

    /// `OnChangeSearchWord` (the found row goes with a new word, as AN-11).
    func wordChanged(_ text: String) {
        guard text != query.word else { return }
        editing = false
        page.clearFound()
        query.change(text)
    }

    /// `OnEdit`: 확인 ends edit mode; 취소 ends search mode and closes the keyboard; 편집 enters edit mode. Both of the
    /// latter clear the search.
    func modeTapped() {
        if editing {
            editing = false
            return
        }
        if searching {
            searching = false
            focusRequest += 1
            // A search from the weather header returns to its tab (#3180).
            if let from = searchFrom {
                searchFrom = nil
                query.clear()
                page.clearFound()
                shell.select(from)
                return
            }
        } else {
            editing = true
        }
        query.clear()
        page.clearFound()
    }

    // MARK: The page

    /// `OnSelectCity(index)`: nothing while editing; a tap while the keyboard shows only closes it.
    func selectRow(_ index: Int) {
        if editing { return }
        if keyboardOnly() { return }
        goPage(index)
    }

    /// `OnOpenSettingPush(index)`.
    func bellTapped(_ index: Int) {
        onBell(index)
    }

    /// `OnSearchCurrentPosition`: at once, also while the keyboard shows.
    func findByLocation() {
        page.findByLocation()
    }

    /// `OnSelectResult` of a town: opened unsaved (#3180).
    func addTown(_ town: BundledTown) {
        if keyboardOnly() { return }
        page.openTown(town)
    }

    /// `OnSelectResult` of the n-th Google row: the found position, or a prediction named from the word typed for it;
    /// opened unsaved (#3180).
    func addPlace(_ n: Int) {
        if keyboardOnly() { return }
        if page.found != nil {
            page.openFound()
        } else if let predictions = query.predictions, predictions.list.indices.contains(n) {
            let p = predictions.list[n]
            page.openPrediction(fullText: p.fullText, firstMatch: p.firstMatch, word: predictions.word)
        }
    }

    private func keyboardOnly() -> Bool {
        guard inputFocused else { return false }
        focusRequest += 1
        return true
    }

    /// A result was opened (selected, unsaved or the saved place near it): the search closes and the tab it came from, or
    /// else the startup page's tab, opens.
    private func opened() {
        query.clear()
        page.clearFound()
        searching = false
        focusRequest += 1
        goPage(nil)
    }

    /// `goPage()`: the tab the header's search came from, else the startup page's tab, then `reloadEvent 'search'`.
    private func goPage(_ index: Int?) {
        let tab = searchFrom ?? PlaceRows.startTab(shell.holder.state?.settings.startupPage)
        searchFrom = nil
        shell.select(tab)
        session.openFromSearch(index)
    }

    // MARK: Popups

    private func show(_ outcome: StartFlow.Outcome) {
        switch outcome {
        case .alert(let key):
            // `$rootScope.showAlert(strError, msg)`.
            shell.show(Popup(title: catalog("LOC_ERROR"), lines: [catalog(key)],
                             buttons: [Popup.Button(text: catalog("LOC_OK"), style: .positive)]))
        case .confirm(let confirm):
            shell.show(retryPopup(confirm))
        case .added, .none:
            break
        }
    }

    /// O03 `search` (`showRetryConfirm(strError, msg, 'search')`): Close, Settings (the app's page) and OK, which finds
    /// by location again (A26).
    func retryPopup(_ confirm: RetryConfirm) -> Popup {
        Popup(title: catalog("LOC_ERROR"), lines: confirm.lines.map(catalog.callAsFunction),
              buttons: confirm.buttons.map { button in
                  Popup.Button(text: catalog(button.key), style: button.positive ? .positive : .standard) { [weak self] in
                      guard let self else { return }
                      if button == .settings, let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                      page.retryButton(button)
                  }
              })
    }

    // MARK: In the shell

    /// What the shell shows on the Locations tab: the search header, the page and the loading overlay.
    /// `live` false: without a text field and a scroll view (the screenshot tests render it with `ImageRenderer`).
    func content(_ tab: ShellTab, live: Bool = true) -> TabContent? {
        guard tab == .search, let state = shell.holder.state else { return nil }
        let theme = Theme.of(state.settings.theme)
        let colors = ShellColors.of(theme, tab: .search)
        return TabContent(
            page: AnyView(PlacesPageView(screens: self, theme: theme, scrolls: live)),
            titleView: AnyView(PlacesHeader(screens: self, colors: colors, live: live)),
            overlay: page.loading ? AnyView(IonicLoadingView()) : nil)
    }
}

/// `Push.removePushListByCityIndex(index)` for the app's push service (IN-04), which `AppStartup` creates after the shell;
/// nothing is sent while it does not exist (no server URL, or the `Device-Id` not read yet).
struct AppPushRemoval {
    @MainActor
    func removeCity(_ index: Int) {
        AppStartup.shared.push?.removeCity(index)
    }
}
