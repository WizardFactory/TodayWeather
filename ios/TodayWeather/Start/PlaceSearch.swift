import Foundation
import GooglePlaces
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
