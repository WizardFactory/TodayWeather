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
/// Collection runs only after an explicit opt-in on the menu's 선택적 이용 통계, with analytics storage granted and
/// advertising denied. A grant restores at the start only when both records still hold it, as the plugin's persisted
/// flag corroborated WebView storage, so a withdrawal whose choice could not be written still holds when the
/// collection state was written. Events follow `AnalyticsSchema` and carry `measurement_version` and `trafficType`.
@MainActor
public final class UsageAnalytics {
    /// `screen_class` of the Cordova build's screen views, kept so reports continue.
    public static let screenClass = "Cordova"
    /// The values the `att_status` user property takes (`trackingStatuses`).
    public static let trackingStatuses = ["authorized", "denied", "restricted", "not_determined", "unavailable"]

    /// The choice the menu row shows (동의함 or 꺼짐).
    public private(set) var choice = false
    /// Runs when `choice` changes.
    public var onChoiceChange: @MainActor (Bool) -> Void = { _ in }

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
    public init(sdk: any AnalyticsSdk, records: any AnalyticsConsentRecords, trafficType: String,
                log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.sdk = sdk
        self.records = records
        self.trafficType = trafficType
        self.log = log
    }

    /// Applies the stored choice (`init` with `storageReady`); later calls do nothing.
    public func start() {
        guard !started else { return }
        started = true
        setChoice(startChoice())
        _ = applyCollection(choice)
    }

    /// The choice of the dialog (`setCollectionEnabled`): collection stops at once, the choice is written, then
    /// applied. False when it could not be fully applied (`LOC_PRIVACY_SAVE_FAILED`); the choice is then off.
    @discardableResult
    public func setCollectionEnabled(_ value: Bool) -> Bool {
        enabled = false
        pendingScreen = nil
        let saved = writeChoice(value)
        setChoice(saved && value)
        return applyCollection(choice) && saved
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

    /// The choice at the start; a grant the collection state does not confirm is withdrawn and written so.
    private func startChoice() -> Bool {
        guard records.readChoice() == "true" else { return false }
        if records.readCollection() { return true }
        _ = writeChoice(false)
        return false
    }

    /// Writes the choice (`persistChoice`); when that fails it removes the choice, so an old grant cannot survive.
    private func writeChoice(_ value: Bool) -> Bool {
        if records.writeChoice(value) { return true }
        if !records.removeChoice() { log("collection storage_remove_failed") }
        log("collection storage_write_failed")
        return false
    }

    private func setChoice(_ value: Bool) {
        guard choice != value else { return }
        choice = value
        onChoiceChange(value)
    }

    /// Collection off, the consent mode, then collection on for a grant; a failure leaves everything off.
    private func applyCollection(_ value: Bool) -> Bool {
        enabled = false
        lastScreen = nil
        sentTrackingStatus = nil
        sdk.setCollectionEnabled(false)
        _ = records.writeCollection(false)
        sdk.setConsent(analytics: value)
        guard value else {
            log("collection disabled")
            return true
        }
        sdk.setCollectionEnabled(true)
        guard records.writeCollection(true) else {
            setChoice(false)
            pendingScreen = nil
            _ = writeChoice(false)
            log("collection write_failed")
            sdk.setCollectionEnabled(false)
            _ = records.writeCollection(false)
            sdk.setConsent(analytics: false)
            return false
        }
        enabled = true
        log("collection enabled")
        applyTrackingStatus()
        if let pending = pendingScreen { screen(pending) }
        return true
    }
}
