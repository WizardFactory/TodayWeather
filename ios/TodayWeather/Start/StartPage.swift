import Foundation
import Observation
import TWData
import TWDomain
import UIKit

/// One visit of the start page S01 (`/start`, StartCtrl and start.html, #2959): the access notice O01 when it opens,
/// the search (Google's predictions with the Places key, else the bundled towns), the shortcuts and 현재위치 날씨보기,
/// each add run behind the loading overlay (`$ionicLoading`), and the popups the adds end in: O09's alert and O04's
/// retry confirmation, shown through the shell's popups. A saved place closes S01 (`close()`): the banner may show
/// again and the shell opens Hourly with the new place, whatever the startup page. Port of the Android `StartPage`
/// and `StartContent` (AN-10).
@MainActor
@Observable
final class StartPage {
    /// What the search shows: Google's predictions, or the bundled towns of a build without a Places key.
    enum Results: Equatable {
        case predictions(word: String, list: [Prediction])
        case towns(word: String, page: TownPage)
    }

    @ObservationIgnored let shell: ShellModel
    @ObservationIgnored let flow: StartFlow
    /// The search (`PlaceQuery`, shared with S02).
    let query: PlaceQuery
    @ObservationIgnored private let openURL: (URL) -> Void
    @ObservationIgnored private let closed: () -> Void
    @ObservationIgnored private let catalog: Catalog
    @ObservationIgnored private var addTask: Task<Void, Never>?
    @ObservationIgnored private var noticeShown = false
    /// Google's predictions arrive 300 ms after the last change (AN-10; the Cordova page asked at every change).
    var predictionDelay: Duration {
        get { query.predictionDelay }
        set { query.predictionDelay = newValue }
    }

    /// The loading overlay.
    private(set) var loading = false
    /// The typed word (`search.word`).
    var word: String { query.word }
    /// Google's predictions with the Places key, else the bundled towns.
    var results: Results? {
        if let p = query.predictions { return .predictions(word: p.word, list: p.list) }
        if let t = query.townResults { return .towns(word: t.word, page: t.page) }
        return nil
    }

    init(shell: ShellModel, flow: StartFlow, search: (any PlaceSearch)?, towns: BundledTownLoader,
         openURL: @escaping (URL) -> Void = { UIApplication.shared.open($0) }, closed: @escaping () -> Void) {
        self.shell = shell
        self.flow = flow
        // S01 searches the bundled towns only without the Places key (as on Android), keeping the last ones.
        query = PlaceQuery(search: search, towns: towns, scansTowns: search == nil, keepsLastTowns: true)
        self.openURL = openURL
        self.closed = closed
        catalog = Catalog(code: shell.locale.catalog)
    }

    /// Whether this build searches with Google's predictions.
    var placesSearch: Bool { query.search != nil }

    /// StartCtrl's `init`: O01 on every entry; it asks for nothing (`LOC_NEEDS_ACCESS_TO`, three lines, OK).
    func opened() {
        guard !noticeShown else { return }
        noticeShown = true
        shell.show(Popup(title: catalog("LOC_NEEDS_ACCESS_TO"),
                         lines: [catalog("LOC_STORAGE_SPACE"), catalog("LOC_LOCATION_ACCESS"), catalog("LOC_CALL_INFORMATION")],
                         buttons: [Popup.Button(text: catalog("LOC_OK"))]))
    }

    // MARK: Search

    /// `OnChangeSearchWord`: an empty word clears the results; otherwise the predictions (or the first towns) for it. A
    /// word without results keeps the last ones, and only the latest word's answer shows.
    func change(_ text: String) { query.change(text) }

    /// `OnScrollResults`: the next ten towns when the last shown one comes into view.
    func moreTowns() { query.moreTowns() }

    /// `OnCancel`.
    func cancel() { query.clear() }

    // MARK: Adds

    /// `OnGetWeather(index)`.
    func addShortcut(_ shortcut: CityShortcut) { run { await $0.addShortcut(shortcut) } }

    /// `OnSelectResult` of a prediction, named from the word typed for it.
    func addPrediction(_ prediction: Prediction, word typed: String) {
        clearSearch()
        run { await $0.addPrediction(fullText: prediction.fullText, firstMatch: prediction.firstMatch, word: typed) }
    }

    /// `OnSelectResult` of a bundled town.
    func addTown(_ town: BundledTown) {
        clearSearch()
        run { await $0.addTown(town) }
    }

    /// 현재위치 날씨보기 (`OnUseLocationService`): the flow shows and hides the overlay itself.
    func useCurrentLocation() {
        guard addTask == nil else { return }
        let flow = self.flow
        addTask = Task { [weak self] in
            let outcome = await flow.useCurrentLocation { self?.loading = $0 }
            guard !Task.isCancelled else { return }
            self?.addTask = nil
            self?.show(outcome)
        }
    }

    private func clearSearch() { query.clear() }

    /// The star of a place a link showed over S01 closed it (#3097): an add still loading saves nothing and shows nothing
    /// (CODEX-3195-11).
    func abandon() {
        addTask?.cancel()
        addTask = nil
        loading = false
    }

    private func run(_ add: @escaping (StartFlow) async -> StartFlow.Outcome) {
        guard addTask == nil else { return }
        let flow = self.flow
        loading = true
        addTask = Task { [weak self] in
            let outcome = await add(flow)
            guard !Task.isCancelled else { return }
            self?.loading = false
            self?.addTask = nil
            self?.show(outcome)
        }
    }

    private func show(_ outcome: StartFlow.Outcome) {
        switch outcome {
        case .added:
            clearSearch()
            closed()
        case .alert(let key):
            // `$rootScope.showAlert(strError, msg)`: `$ionicPopup.alert`, OK positive.
            shell.show(Popup(title: catalog("LOC_ERROR"), lines: [catalog(key)],
                             buttons: [Popup.Button(text: catalog("LOC_OK"), style: .positive)]))
        case .confirm(let confirm):
            shell.show(retryPopup(confirm))
        case .none:
            break
        }
    }

    /// O04 (`showRetryConfirm(strError, msg, 'useLocationService')`): the message's lines, then Close, Settings (the
    /// app's page in the Settings app) and OK, which tries again.
    func retryPopup(_ confirm: RetryConfirm) -> Popup {
        Popup(title: catalog("LOC_ERROR"), lines: confirm.lines.map(catalog.callAsFunction),
              buttons: confirm.buttons.map { button in
                  Popup.Button(text: catalog(button.key), style: button.positive ? .positive : .standard) { [weak self] in
                      self?.retryButton(button)
                  }
              })
    }

    private func retryButton(_ button: RetryButton) {
        switch button {
        case .settings:
            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        case .retry:
            useCurrentLocation()
        case .close, .search:
            break
        }
    }
}
