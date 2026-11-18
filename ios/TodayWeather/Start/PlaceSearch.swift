import Foundation
import GooglePlaces
import TWDomain
import os

/// A place prediction: its full text (`description`) and where the typed word first matched in it
/// (`matched_substrings[0].offset`, in UTF-16 code units).
struct Prediction: Equatable, Sendable {
    let fullText: String
    let firstMatch: Int?
}

/// The place predictions of S01's search box (`AutocompleteService.getPlacePredictions`, #2959).
@MainActor
protocol PlaceSearch: AnyObject {
    /// The predictions for `word`; nil when the request failed, empty when nothing matched.
    func predictions(_ word: String) async -> [Prediction]?
}

/// Google's Places SDK for iOS with the build's key restricted to this app's bundle ID (the private input
/// `TW_PLACES_API_KEY_IOS`, Info.plist `TWPlacesAPIKey`; Places API (New)): autocomplete suggestions of the `(regions)`
/// collection, as the Cordova app asked the Maps JavaScript API, without a session token or a place details request;
/// the chosen prediction's full text is geocoded by the legacy server. Without the key there is no Places search and
/// S01 searches the bundled towns (as on Android). The key is never logged.
@MainActor
final class GooglePlaceSearch: PlaceSearch {
    private static var provided = false
    private let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "places")

    /// Nil without a key.
    init?(key: String) {
        guard !key.isEmpty else { return nil }
        if !Self.provided { Self.provided = GMSPlacesClient.provideAPIKey(key) }
        if !Self.provided { return nil }
    }

    /// The key of this build (Info.plist `TWPlacesAPIKey`), empty without the private input.
    static var bundleKey: String { (Bundle.main.infoDictionary?["TWPlacesAPIKey"] as? String) ?? "" }

    func predictions(_ word: String) async -> [Prediction]? {
        let filter = GMSAutocompleteFilter()
        filter.types = ["(regions)"]
        let request = GMSAutocompleteRequest(query: word)
        request.filter = filter
        let log = self.log
        let answer: [Prediction]? = await withCheckedContinuation { continuation in
            let once = OnceAnswer(continuation)
            GMSPlacesClient.shared().fetchAutocompleteSuggestions(from: request) { results, error in
                if let error {
                    log.notice("places suggestions failed \((error as NSError).code, privacy: .public)")
                    return once.resume(nil)
                }
                once.resume((results ?? []).compactMap { $0.placeSuggestion.map(Self.prediction) })
            }
        }
        return answer
    }

    /// The full text and the first range the SDK marks as matching the typed word.
    nonisolated static func prediction(_ suggestion: GMSAutocompletePlaceSuggestion) -> Prediction {
        let text = suggestion.attributedFullText
        var first: Int?
        text.enumerateAttribute(.gmsAutocompleteMatchAttribute, in: NSRange(location: 0, length: text.length)) { value, range, _ in
            if value != nil, first == nil || range.location < first! { first = range.location }
        }
        return Prediction(fullText: text.string, firstMatch: first)
    }
}

/// Resumes a continuation exactly once, whatever the SDK calls back.
private final class OnceAnswer: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<[Prediction]?, Never>?

    init(_ continuation: CheckedContinuation<[Prediction]?, Never>) { self.continuation = continuation }

    func resume(_ value: [Prediction]?) {
        let pending: CheckedContinuation<[Prediction]?, Never>? = lock.withLock {
            defer { continuation = nil }
            return continuation
        }
        pending?.resume(returning: value)
    }
}

/// The search of S01 and S02 (IN-10's component, shared with IN-11): the typed word, Google's predictions with the
/// Places key (300 ms after the last change, AN-10; only the latest word's answer shows; a word without predictions
/// keeps the last ones, as `callbackAutocomplete` returns on `ZERO_RESULTS`) and the bundled towns (`OnScrollResults`:
/// 10 at a time, more as the last row appears). S01 scans the towns only without the key and keeps the last ones for a
/// word without a match (AN-10); S02 always scans them, and a new word replaces them (`searchResults = []`).
@MainActor
@Observable
final class PlaceQuery {
    struct Predictions: Equatable {
        let word: String
        let list: [Prediction]
    }

    struct Towns: Equatable {
        let word: String
        let page: TownPage
    }

    @ObservationIgnored let search: (any PlaceSearch)?
    @ObservationIgnored private let towns: BundledTownLoader
    @ObservationIgnored private let scansTowns: Bool
    @ObservationIgnored private let keepsLastTowns: Bool
    @ObservationIgnored private var townTask: Task<Void, Never>?
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    /// Google's predictions arrive this long after the last change.
    @ObservationIgnored var predictionDelay = Duration.milliseconds(300)

    /// The typed word (`search.word`).
    private(set) var word = ""
    /// Google's predictions (`searchResults2`).
    private(set) var predictions: Predictions?
    /// The bundled towns found (`searchResults`).
    private(set) var townResults: Towns?

    init(search: (any PlaceSearch)?, towns: BundledTownLoader, scansTowns: Bool, keepsLastTowns: Bool) {
        self.search = search
        self.towns = towns
        self.scansTowns = scansTowns
        self.keepsLastTowns = keepsLastTowns
    }

    /// `OnChangeSearchWord`: an empty word clears the results; otherwise the towns and the predictions for it.
    func change(_ text: String) {
        word = text
        townTask?.cancel()
        searchTask?.cancel()
        let typed = text.trimmingCharacters(in: .whitespaces)
        if typed.isEmpty {
            predictions = nil
            townResults = nil
            return
        }
        if scansTowns {
            if let loaded = towns.cached {
                publishTowns(loaded, for: typed)
            } else {
                townTask = Task { [weak self, towns] in
                    guard !Task.isCancelled else { return }
                    guard let loaded = await towns.load(), !Task.isCancelled else { return }
                    self?.publishTowns(loaded, for: typed)
                }
            }
        }
        if let search {
            let delay = predictionDelay
            searchTask = Task { [weak self] in
                do { try await Task.sleep(for: delay) } catch { return }
                let found = await search.predictions(typed)
                guard let self, !Task.isCancelled, let found, !found.isEmpty else { return }
                predictions = Predictions(word: typed, list: found)
            }
        }
    }

    private func publishTowns(_ towns: TownSearch, for typed: String) {
        let page = towns.search(typed)
        if !page.towns.isEmpty || !keepsLastTowns {
            townResults = page.towns.isEmpty ? nil : Towns(word: typed, page: page)
        }
    }

    /// `OnScrollResults`: the next ten towns when the last shown one comes into view.
    func moreTowns() {
        guard let shown = townResults, shown.page.next >= 0, let towns = towns.cached else { return }
        let more = towns.search(shown.word, from: shown.page.next)
        townResults = Towns(word: shown.word, page: TownPage(towns: shown.page.towns + more.towns, next: more.next))
    }

    /// Cancel, an add, edit mode: the word and every result go.
    func clear() {
        show(word: "")
    }

    /// The word set without a search (`search.word = geoInfo.name` after find-by-location): the results go.
    func show(word text: String) {
        townTask?.cancel()
        searchTask?.cancel()
        word = text
        predictions = nil
        townResults = nil
    }
}
