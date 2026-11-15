import Foundation
import TWDomain

/// Doubles of the ads and analytics platforms (IN-15): a virtual clock, UMP with the Ads SDK, a banner, Remote Config,
/// the Analytics SDK and the consent records. They live in the tests only; the app has no test mode.

/// A clock that moves only when the test advances it; due timers run in time order.
@MainActor
final class VirtualClock: AdsClock {
    private(set) var nowMs: Int64 = 0
    private var timers: [(due: Int64, order: Int, timer: Timer, action: @MainActor () -> Void)] = []
    private var order = 0

    final class Timer: AdsTimer {
        var cancelled = false
        func cancel() { cancelled = true }
    }

    func after(_ ms: Int64, _ action: @escaping @MainActor () -> Void) -> AdsTimer {
        let timer = Timer()
        order += 1
        timers.append((nowMs + max(0, ms), order, timer, action))
        return timer
    }

    /// Moves the clock by `ms`, running every timer that falls due on the way.
    func advance(_ ms: Int64) {
        let end = nowMs + ms
        while let next = timers.filter({ !$0.timer.cancelled && $0.due <= end }).min(by: { ($0.due, $0.order) < ($1.due, $1.order) }) {
            timers.removeAll { $0.timer === next.timer }
            nowMs = next.due
            next.action()
        }
        timers.removeAll { $0.timer.cancelled }
        nowMs = end
    }

    var pending: Int { timers.filter { !$0.timer.cancelled }.count }
}

/// UMP and the Ads SDK as the device keeps them across launches: the consent status, whether ads may be requested,
/// the ATT status and the TCF values. A form answered by the user (or the test) closes the IDFA explainer and the
/// system prompt.
@MainActor
final class DeviceConsent {
    var status: AdsConsentStatus = .unknown
    var canRequestAds = false
    var tracking: TrackingStatus = .notDetermined
    var record = AdConsentRecord(gdprApplies: 0, purposeConsents: nil)
    /// The forms shown, across launches (each one is the explainer with the system ATT prompt here).
    var formsShown = 0
    /// ATT prompts shown by iOS, across launches; iOS shows it once per install.
    var systemPrompts = 0
}

@MainActor
final class FakeAdsPlatform: AdsPlatform {
    let device: DeviceConsent
    var events: [String] = []
    /// The answer of the next consent update: nil (success, the status as the device has it) or the error text.
    var updateError: String?
    /// What UMP decides on an update while ATT is not determined (the IDFA message published: `.required`); nil
    /// keeps the device's status.
    var statusAfterUpdate: AdsConsentStatus?
    var formLoadError: String?
    var privacyOptionsRequired = false
    var privacyOptionsError: String?
    private(set) var pendingUpdate: (@MainActor (String?) -> Void)?
    private(set) var openForm: FakeForm?
    private(set) var pendingStart: (@MainActor () -> Void)?
    private(set) var sdkStarts = 0
    /// Answer the consent update at once (true) or keep it until `answerUpdate` (false).
    var answersAtOnce = true
    /// Start the SDK at once (true) or keep it until `finishSdkStart` (false).
    var startsAtOnce = true

    init(device: DeviceConsent = DeviceConsent()) { self.device = device }

    var canRequestAds: Bool { device.canRequestAds }
    var consentStatus: AdsConsentStatus { device.status }

    func requestConsentUpdate(_ done: @escaping @MainActor (String?) -> Void) {
        events.append("update")
        pendingUpdate = done
        if answersAtOnce { answerUpdate() }
    }

    func answerUpdate() {
        guard let done = pendingUpdate else { return }
        pendingUpdate = nil
        if let error = updateError {
            events.append("update failed")
            return done(error)
        }
        // UMP's answer while the IDFA message waits for the ATT answer; once ATT is answered the stored status holds.
        if let status = statusAfterUpdate, device.tracking == .notDetermined { device.status = status }
        events.append("updated \(device.status)")
        done(nil)
    }

    final class FakeForm: AdsConsentForm {
        weak var platform: FakeAdsPlatform?
        var done: (@MainActor (String?) -> Void)?
        init(platform: FakeAdsPlatform) { self.platform = platform }

        func present(_ done: @escaping @MainActor (String?) -> Void) {
            self.done = done
            platform?.formPresented(self)
        }
    }

    func loadConsentForm(_ done: @escaping @MainActor ((any AdsConsentForm)?, String?) -> Void) {
        events.append("form load")
        if let error = formLoadError { return done(nil, error) }
        let form = FakeForm(platform: self)
        done(form, nil)
    }

    fileprivate func formPresented(_ form: FakeForm) {
        events.append("form shown")
        device.formsShown += 1
        // The IDFA explainer leads to the system prompt, which iOS shows only while the status is not determined.
        if device.tracking == .notDetermined { device.systemPrompts += 1 }
        openForm = form
    }

    /// The user answers the open form (the explainer and the ATT prompt): consent obtained, ads allowed.
    func answerForm(tracking: TrackingStatus, error: String? = nil) {
        guard let form = openForm else { return }
        openForm = nil
        events.append("form answered \(tracking.name)")
        device.tracking = tracking
        if error == nil {
            device.status = .obtained
            device.canRequestAds = true
        }
        let done = form.done
        form.done = nil
        done?(error)
    }

    func startSdk(_ ready: @escaping @MainActor () -> Void) {
        sdkStarts += 1
        events.append("sdk start")
        pendingStart = ready
        if startsAtOnce { finishSdkStart() }
    }

    func finishSdkStart() {
        guard let ready = pendingStart else { return }
        pendingStart = nil
        events.append("sdk started")
        ready()
    }

    func presentPrivacyOptions(_ done: @escaping @MainActor (String?) -> Void) {
        events.append("privacy options")
        done(privacyOptionsError)
    }

    func privacyState() -> (TrackingStatus, AdConsentRecord) {
        events.append("privacy state")
        return (device.tracking, device.record)
    }
}

@MainActor
final class FakeBanner: BannerAdapter {
    var events: [String] = []
    private(set) var pending: [(loaded: @MainActor () -> Void, failed: @MainActor () -> Void)] = []
    var creates = 0
    var destroys = 0

    func create(onLoaded: @escaping @MainActor () -> Void, onFailed: @escaping @MainActor () -> Void) {
        creates += 1
        events.append("create")
        pending.append((onLoaded, onFailed))
    }

    func destroy() {
        destroys += 1
        events.append("destroy")
    }

    /// The oldest waiting load answers; nothing happens when none waits (the tests' counts show that).
    func load() { if !pending.isEmpty { pending.removeFirst().loaded() } }
    func fail() { if !pending.isEmpty { pending.removeFirst().failed() } }
}

@MainActor
final class FakeRemoteConfig: BannerConfigSource {
    var activated: [String: String] = [:]
    var fetched: [String: String]?
    var failing: Set<String> = []
    /// Steps kept until the test answers them (`answer`).
    var held: Set<String> = []
    private(set) var calls: [String] = []
    private var waiting: [String: @MainActor (Bool) -> Void] = [:]
    var current: [String: String] = [:]

    private func step(_ name: String, _ done: @escaping @MainActor (Bool) -> Void) {
        calls.append(name)
        if held.contains(name) { waiting[name] = done } else { done(!failing.contains(name)) }
    }

    func answer(_ name: String, _ ok: Bool) {
        if name == "fetch", ok, let fetched { current = fetched }
        waiting.removeValue(forKey: name)?(ok)
    }

    func setDefaults(_ defaults: [String: String], done: @escaping @MainActor (Bool) -> Void) {
        current = defaults
        step("defaults", done)
    }

    func setSettings(fetchTimeoutSeconds: Double, minimumFetchIntervalSeconds: Double, done: @escaping @MainActor (Bool) -> Void) {
        calls.append("settings \(Int(fetchTimeoutSeconds)) \(Int(minimumFetchIntervalSeconds))")
        done(!failing.contains("settings"))
    }

    func loadActivated(done: @escaping @MainActor (Bool) -> Void) {
        current.merge(activated) { $1 }
        step("activated", done)
    }

    func fetchAndActivate(done: @escaping @MainActor (Bool) -> Void) {
        if !held.contains("fetch"), !failing.contains("fetch"), let fetched { current.merge(fetched) { $1 } }
        step("fetch", done)
    }

    func values() -> [String: String] { current }
}

@MainActor
final class FakeAnalyticsSdk: AnalyticsSdk {
    var calls: [String] = []
    var events: [(name: String, params: [(String, AnalyticsParameter)])] = []
    var properties: [(String, String)] = []
    private(set) var collectionEnabled: Bool?

    func setCollectionEnabled(_ enabled: Bool) {
        collectionEnabled = enabled
        calls.append("collection \(enabled)")
    }

    func setConsent(analytics: Bool) { calls.append("consent \(analytics)") }

    func logEvent(_ name: String, _ parameters: [(String, AnalyticsParameter)]) {
        events.append((name, parameters))
        calls.append("event \(name)")
    }

    func setUserProperty(_ value: String, forName name: String) {
        properties.append((name, value))
        calls.append("property \(name)=\(value)")
    }
}

@MainActor
final class MemoryRecords: AnalyticsConsentRecords {
    var choice: String?
    var collection = false
    var failChoiceWrites = false
    var failChoiceRemoval = false
    var failCollectionWrites = false

    func readChoice() -> String? { choice }

    func writeChoice(_ value: Bool) -> Bool {
        guard !failChoiceWrites else { return false }
        choice = value ? "true" : "false"
        return true
    }

    func removeChoice() -> Bool {
        guard !failChoiceRemoval else { return false }
        choice = nil
        return true
    }

    func readCollection() -> Bool { collection }

    func writeCollection(_ enabled: Bool) -> Bool {
        guard !failCollectionWrites else { return false }
        collection = enabled
        return true
    }
}
