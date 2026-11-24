import Foundation
import TWModel

/// The Firebase Analytics calls the app makes (the Cordova plugin's bridge).
@MainActor
public protocol AnalyticsSdk: AnyObject {
    func setCollectionEnabled(_ enabled: Bool)
    /// Consent mode: analytics storage as `analytics`; ad storage, ad user data and ad personalization always denied.
    func setConsent(analytics: Bool)
    func logEvent(_ name: String, _ parameters: [(String, AnalyticsParameter)])
    func setUserProperty(_ value: String, forName name: String)
}

/// Where the usage analytics choice and the SDK's collection state are kept. The Cordova app kept the choice in
/// WebView storage (`twAnalyticsConsentV1`) and the plugin persisted the collection flag on its own; a write can
/// fail.
@MainActor
public protocol AnalyticsConsentRecords: AnyObject {
    /// The stored choice as written (`"true"`, `"false"`), nil when there is none or it cannot be read.
    func readChoice() -> String?
    /// Writes the choice; false when it was not written.
    func writeChoice(_ value: Bool) -> Bool
    /// Removes the choice; false when it could not be removed.
    func removeChoice() -> Bool
    /// The collection state recorded after the SDK calls; false when there is none or it cannot be read.
    func readCollection() -> Bool
    /// Records the collection state; false when it was not written.
    func writeCollection(_ enabled: Bool) -> Bool
}

/// `Monetization`'s usage analytics (service.monetization.js), port of the Android `Analytics` with `ConsentStore`
/// and the iOS `att_status` user property of #2945. The SDK calls are synchronous here.
///
/// Collection runs with analytics storage granted and advertising denied while the menu's 이용 통계 shows 켜짐: after
/// the user turned it on, or, without a stored choice, by default where the device region allows it (`AnalyticsRegion`,
/// AK 2026-11-24; `specs/analytics-default-on.md`). A stored choice wins over the region, and the default writes no
/// choice, so a stored value always means the user chose. A grant restores at the start only when both records still
/// hold it, as the plugin's persisted flag corroborated WebView storage, so a withdrawal whose choice could not be
/// written still holds when the collection state was written. Events follow `AnalyticsSchema` and carry
/// `measurement_version` and `trafficType`.
@MainActor
public final class UsageAnalytics {
    /// `screen_class` of the Cordova build's screen views, kept so reports continue.
    public static let screenClass = "Cordova"
    /// The values the `att_status` user property takes (`trackingStatuses`).
    public static let trackingStatuses = ["authorized", "denied", "restricted", "not_determined", "unavailable"]

    /// Whether collection is on, which the menu row shows (켜짐 or 꺼짐): the stored choice, else the region's default.
    public private(set) var choice = false
    /// Runs when `choice` changes.
    public var onChoiceChange: @MainActor (Bool) -> Void = { _ in }

    /// The device region's default without a stored choice: on outside the EEA, the United Kingdom and Switzerland.
    public let collectsByDefault: Bool
    private let sdk: any AnalyticsSdk
    private let records: any AnalyticsConsentRecords
    private let trafficType: String
    private let log: @MainActor (String) -> Void
    private var enabled = false
    private var started = false
    private var lastScreen: String?
    private var pendingScreen: String?
    private var trackingStatus: String?
    private var sentTrackingStatus: String?

    /// `trafficType` is `development` for builds with Google's test units or debug builds, `production` otherwise.
    /// `region` is the device's region (`Locale.current.region?.identifier`); nil when unknown.
    public init(sdk: any AnalyticsSdk, records: any AnalyticsConsentRecords, trafficType: String, region: String?,
                log: @escaping @MainActor (String) -> Void = { _ in }) {
        collectsByDefault = AnalyticsRegion.collectsByDefault(region: region)
        self.sdk = sdk
        self.records = records
        self.trafficType = trafficType
        self.log = log
    }

    /// Applies the stored choice, else the region's default (`init` with `storageReady`); later calls do nothing.
    public func start() {
        guard !started else { return }
        started = true
        let (value, stored) = startChoice()
        setChoice(value)
        _ = applyCollection(choice, stored: stored)
    }

    /// The choice of the dialog (`setCollectionEnabled`): collection stops at once and every consent type is denied
    /// before any file is written, then the choice is written and applied. False when it could not be fully applied
    /// (`LOC_PRIVACY_SAVE_FAILED`); collection is then off for this run. A grant that cannot be written keeps the stored
    /// choice as it was (a decline is never erased); a withdrawal that cannot be written removes the old choice, so no
    /// grant survives. Accepted residual (2026-11-24): if neither can be persisted, the next start finds no choice and the
    /// region default applies again.
    @discardableResult
    public func setCollectionEnabled(_ value: Bool) -> Bool {
        enabled = false
        pendingScreen = nil
        sdk.setCollectionEnabled(false)
        sdk.setConsent(analytics: false)
        let saved = value ? writeGrant() : writeChoice(false)
        setChoice(saved && value)
        // A failed grant leaves both records as they were (CODEX-3187-4): off for this run, nothing rewritten.
        if value && !saved {
            lastScreen = nil
            sentTrackingStatus = nil
            return false
        }
        return applyCollection(choice, stored: true) && saved
    }

    /// An event of the schema with its own fields only; false when it is dropped or not sent.
    @discardableResult
    public func track(_ name: String, _ params: [String: AnalyticsValue]) -> Bool {
        guard let safe = AnalyticsSchema.validate(name, params) else { return false }
        return emit(name, safe)
    }

    /// A route shown (`$stateChangeSuccess`): only after an opt-in, only the fixed names, not the same one twice in a
    /// row. The latest one before collection is enabled is sent once it is.
    public func screen(_ name: String) {
        guard choice else {
            pendingScreen = nil
            return
        }
        guard AnalyticsSchema.isScreen(name), !(lastScreen.map { JSString.equal($0, name) } ?? false) else { return }
        pendingScreen = name
        if emit("screen_view", [("screen_name", .text(name)), ("screen_class", .text(Self.screenClass))]) {
            lastScreen = name
            pendingScreen = nil
        }
    }

    /// The ATT status of the `request_policy` report (`setAdTrackingStatus`): kept, and set as the `att_status` user
    /// property while collection is enabled, again after a later opt-in.
    public func setAdTrackingStatus(_ status: String) {
        guard Self.trackingStatuses.contains(where: { JSString.equal($0, status) }) else { return }
        trackingStatus = status
        applyTrackingStatus()
    }

    private func applyTrackingStatus() {
        guard enabled, let status = trackingStatus, status != sentTrackingStatus else { return }
        sentTrackingStatus = status
        sdk.setUserProperty(status, forName: "att_status")
    }

    private func emit(_ name: String, _ params: [(String, AnalyticsParameter)]) -> Bool {
        guard enabled else { return false }
        sdk.logEvent(name, params + [("measurement_version", .integer(AnalyticsSchema.measurementVersion)),
                                     ("traffic_type", .text(trafficType))])
        return true
    }

    /// The choice at the start and whether it was stored: only a readable stored "true" that the collection state confirms
    /// collects (an unconfirmed grant is withdrawn and written so); any other stored record, readable or not, leaves
    /// collection off. Without a stored choice the region decides, and nothing is written.
    private func startChoice() -> (value: Bool, stored: Bool) {
        switch records.readChoice() {
        case nil:
            return (collectsByDefault, false)
        case "true":
            if records.readCollection() { return (true, true) }
            _ = writeChoice(false)
            return (false, true)
        default:
            return (false, true)
        }
    }

    /// Writes a withdrawal (`persistChoice`); when that fails it removes the choice, so an old grant cannot survive.
    private func writeChoice(_ value: Bool) -> Bool {
        if records.writeChoice(value) { return true }
        if !records.removeChoice() { log("collection storage_remove_failed") }
        log("collection storage_write_failed")
        return false
    }

    /// Writes a grant; when that fails the stored choice stays as it was, so a stored decline is never erased into "no
    /// choice" (and with it into the region default).
    private func writeGrant() -> Bool {
        if records.writeChoice(true) { return true }
        log("collection storage_write_failed")
        return false
    }

    private func setChoice(_ value: Bool) {
        guard choice != value else { return }
        choice = value
        onChoiceChange(value)
    }

    /// Collection off and every consent type denied before any file is written; for a grant the collection state is
    /// recorded first, and only then are analytics storage granted and collection enabled. A failure leaves everything
    /// off without the SDK ever collecting. A failed stored grant is withdrawn and written so; a failed default writes no
    /// choice, so the next start tries the default again.
    private func applyCollection(_ value: Bool, stored: Bool) -> Bool {
        enabled = false
        lastScreen = nil
        sentTrackingStatus = nil
        sdk.setCollectionEnabled(false)
        sdk.setConsent(analytics: false)
        guard value else {
            _ = records.writeCollection(false)
            log("collection disabled")
            return true
        }
        guard records.writeCollection(true) else {
            setChoice(false)
            pendingScreen = nil
            _ = records.writeCollection(false)
            if stored { _ = writeChoice(false) }
            log("collection write_failed")
            return false
        }
        sdk.setConsent(analytics: true)
        sdk.setCollectionEnabled(true)
        enabled = true
        log(stored ? "collection enabled" : "collection enabled region_default")
        applyTrackingStatus()
        if let pending = pendingScreen { screen(pending) }
        return true
    }
}
