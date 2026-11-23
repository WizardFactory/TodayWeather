import Foundation

/// The Remote Config calls of `Monetization.loadConfig` (the Cordova plugin's bridge). Each `done` runs once, on the
/// main actor; true when the call succeeded.
@MainActor
public protocol BannerConfigSource: AnyObject {
    func setDefaults(_ defaults: [String: String], done: @escaping @MainActor (Bool) -> Void)
    func setSettings(fetchTimeoutSeconds: Double, minimumFetchIntervalSeconds: Double,
                     done: @escaping @MainActor (Bool) -> Void)
    /// The stored activated values loaded, so an offline start keeps the last fetched policy.
    func loadActivated(done: @escaping @MainActor (Bool) -> Void)
    func fetchAndActivate(done: @escaping @MainActor (Bool) -> Void)
    /// The source notifies when a new template containing format changes was fetched.
    func observeFormatUpdates(_ notify: @escaping @MainActor () -> Void)
    func activateUpdate(done: @escaping @MainActor (Bool) -> Void)
    /// The currently activated values, including the defaults for absent keys.
    func values() -> [String: String]
}

/// The banner policy of an app open (`Monetization.loadConfig`, port of the Android `RemoteBannerConfig`): the
/// defaults, then the activated values, then a fetch; each valid pair applies. It is ready when the fetch has applied
/// or failed, or after 12 s. The legacy banner policy then stays fixed. Late and live format switches still apply.
/// Without Firebase, the defaults apply immediately.
@MainActor
public final class RemoteBannerConfig {
    public static let timeoutMs: Int64 = 12_000
    public static let fetchTimeoutSeconds: Double = 10
    public static let minimumFetchIntervalSeconds: Double = 3600

    public static let nativeEnabledKey = "tw_native_enabled"
    public static let interstitialEnabledKey = "tw_interstitial_enabled"
    public private(set) var nativeEnabled = true
    public private(set) var interstitialEnabled = true

    public private(set) var policy = BannerPolicy.default
    /// The policy is final: applied, failed or timed out (`isBannerPolicyReady`).
    public private(set) var ready = false
    /// Publishes activated and fetched switches, policy and readiness (`notifyPolicy`).
    public var onChange: @MainActor () -> Void = {}

    private let source: (any BannerConfigSource)?
    private let clock: any AdsClock
    private let log: @MainActor (String) -> Void
    private var started = false
    private var closed = false
    private var timeout: (any AdsTimer)?

    public init(source: (any BannerConfigSource)?, clock: any AdsClock, log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.source = source
        self.clock = clock
        self.log = log
    }

    public func load() {
        guard !started else { return }
        started = true
        guard let source else {
            ready = true
            onChange()
            return
        }
        timeout = clock.after(Self.timeoutMs) { [weak self] in self?.finish("timeout") }
        var defaults = RemoteBannerPolicy.defaults
        defaults[Self.nativeEnabledKey] = "true"
        defaults[Self.interstitialEnabledKey] = "true"
        source.setDefaults(defaults) { [weak self] ok in
            guard let self, !self.closed else { return }
            guard ok else { return self.finish("bridge_or_fetch_failed") }
            source.setSettings(fetchTimeoutSeconds: Self.fetchTimeoutSeconds,
                               minimumFetchIntervalSeconds: Self.minimumFetchIntervalSeconds) { [weak self] ok in
                guard let self, !self.closed else { return }
                guard ok else { return self.finish("bridge_or_fetch_failed") }
                // The activated values first, so an offline start keeps the kill switch.
                source.loadActivated { [weak self] ok in
                    guard let self, self.applyStartupSnapshot(ok) else { return }
                    source.fetchAndActivate { [weak self] ok in
                        guard let self, self.applyStartupSnapshot(ok) else { return }
                        self.finish("applied")
                    }
                }
            }
        }
    }

    /// A timeout finalizes startup and its legacy banner decision. A late success can still disable either ad format.
    private func applyStartupSnapshot(_ success: Bool) -> Bool {
        guard !closed else {
            if success { refreshFormats() }
            return false
        }
        guard success, let source else {
            finish("bridge_or_fetch_failed")
            return false
        }
        let values = source.values()
        applyFormats(values)
        if let parsed = RemoteBannerPolicy.parse(values) {
            policy = parsed
        } else {
            log("remote_config invalid_values")
        }
        onChange()
        return true
    }

    @discardableResult
    private func applyFormats(_ values: [String: String]) -> Bool {
        let native = values[Self.nativeEnabledKey, default: "true"] == "true"
        let interstitial = values[Self.interstitialEnabledKey, default: "true"] == "true"
        guard native != nativeEnabled || interstitial != interstitialEnabled else { return false }
        nativeEnabled = native
        interstitialEnabled = interstitial
        return true
    }

    private func activateFormatUpdate() {
        source?.activateUpdate { [weak self] ok in
            if ok { self?.refreshFormats() }
        }
    }

    private func refreshFormats() {
        // Read the current activated values when a callback arrives, including when multiple updates completed together.
        if let source, applyFormats(source.values()) { onChange() }
    }

    private func finish(_ result: String) {
        guard !closed else { return }
        closed = true
        timeout?.cancel()
        timeout = nil
        log("remote_config \(result)")
        ready = true
        source?.observeFormatUpdates { [weak self] in self?.activateFormatUpdate() }
        onChange()
    }
}
