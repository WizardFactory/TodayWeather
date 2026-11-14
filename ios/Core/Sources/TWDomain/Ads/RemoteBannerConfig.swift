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
    /// The activated values and defaults of the banner pair as strings (`getAll`).
    func values() -> [String: String]
}

/// The banner policy of an app open (`Monetization.loadConfig`, port of the Android `RemoteBannerConfig`): the
/// defaults, then the activated values, then a fetch; each valid pair applies. It is ready when the fetch has applied
/// or failed, or after 12 s; answers after that are ignored. Without Firebase (`source` nil) the defaults apply at
/// once.
@MainActor
public final class RemoteBannerConfig {
    public static let timeoutMs: Int64 = 12_000
    public static let fetchTimeoutSeconds: Double = 10
    public static let minimumFetchIntervalSeconds: Double = 3600

    public private(set) var policy = BannerPolicy.default
    /// The policy is final: applied, failed or timed out (`isBannerPolicyReady`).
    public private(set) var ready = false
    /// Runs after each change of `policy` or `ready` (`notifyPolicy`).
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
        source.setDefaults(RemoteBannerPolicy.defaults) { [weak self] ok in
            guard let self, !self.closed else { return }
            guard ok else { return self.finish("bridge_or_fetch_failed") }
            source.setSettings(fetchTimeoutSeconds: Self.fetchTimeoutSeconds,
                               minimumFetchIntervalSeconds: Self.minimumFetchIntervalSeconds) { [weak self] ok in
                guard let self, !self.closed else { return }
                guard ok else { return self.finish("bridge_or_fetch_failed") }
                // The activated values first, so an offline start keeps the kill switch.
                source.loadActivated { [weak self] ok in
                    guard let self, !self.closed else { return }
                    guard ok else { return self.finish("bridge_or_fetch_failed") }
                    self.apply(source.values())
                    source.fetchAndActivate { [weak self] ok in
                        guard let self, !self.closed else { return }
                        guard ok else { return self.finish("bridge_or_fetch_failed") }
                        self.apply(source.values())
                        self.finish("applied")
                    }
                }
            }
        }
    }

    /// A valid pair applies whole; an invalid one is ignored (`invalid_values`).
    private func apply(_ values: [String: String]) {
        guard let parsed = RemoteBannerPolicy.parse(values) else {
            log("remote_config invalid_values")
            return
        }
        policy = parsed
        onChange()
    }

    private func finish(_ result: String) {
        guard !closed else { return }
        closed = true
        timeout?.cancel()
        timeout = nil
        log("remote_config \(result)")
        ready = true
        onChange()
    }
}
