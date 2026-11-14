import Foundation

/// The banner policy of Remote Config (`Monetization.bannerPolicy`): shown or not, and seconds after the app opened.
/// Port of the Android `BannerPolicy` (AN-15).
public struct BannerPolicy: Equatable, Sendable {
    public var enabled: Bool
    public var delaySeconds: Int

    public init(enabled: Bool, delaySeconds: Int) {
        self.enabled = enabled
        self.delaySeconds = delaySeconds
    }

    /// The policy before and without Remote Config.
    public static let `default` = BannerPolicy(enabled: true, delaySeconds: 0)
}

/// `Monetization.loadConfig`'s reading of the Remote Config pair.
public enum RemoteBannerPolicy {
    public static let enabledKey = "tw_banner_enabled"
    public static let delayKey = "tw_banner_delay_seconds"
    static let maxDelay = 120

    /// The in-app defaults (`setDefaults({tw_banner_enabled: true, tw_banner_delay_seconds: 0})`), as the texts the
    /// pair is read back as.
    public static let defaults: [String: String] = [enabledKey: "true", delayKey: "0"]

    /// The policy of the activated `values` (as strings), or nil when either is invalid: the flag must be exactly
    /// `"true"` or `"false"` and the delay ASCII digits (`/^\d+$/`) whose number is at most 120. The whole pair is
    /// rejected rather than applied in part.
    public static func parse(_ values: [String: String]) -> BannerPolicy? {
        guard let flag = values[enabledKey], let delay = values[delayKey] else { return nil }
        let enabled: Bool
        switch Array(flag.utf16) {
        case Array("true".utf16): enabled = true
        case Array("false".utf16): enabled = false
        default: return nil
        }
        let digits = Array(delay.utf8)
        guard !digits.isEmpty, digits.allSatisfy({ (0x30...0x39).contains($0) }) else { return nil }
        // `Number(delay) > 120` for any length: leading zeros do not count.
        let significant = digits.drop { $0 == 0x30 }
        guard significant.count <= 3 else { return nil }
        let seconds = significant.reduce(0) { $0 * 10 + Int($1 - 0x30) }
        guard seconds <= maxDelay else { return nil }
        return BannerPolicy(enabled: enabled, delaySeconds: seconds)
    }
}

/// What `applyVisibility` reads. `requestShow` is a page's request (the start page hides the banner); nil: none.
public struct BannerInputs: Equatable, Sendable {
    /// The Ads SDK has started and consent has settled (`onAdapterReady`).
    public var ready: Bool
    public var enableAds: Bool?
    public var requestShow: Bool?
    public var bannerLoaded: Bool
    public var policy: BannerPolicy
    /// Remote Config has finished: applied, failed or timed out.
    public var policyReady: Bool
    /// Milliseconds since the app opened (`sessionStart`).
    public var sinceStartMs: Int64

    public init(ready: Bool, enableAds: Bool?, requestShow: Bool?, bannerLoaded: Bool, policy: BannerPolicy,
                policyReady: Bool, sinceStartMs: Int64) {
        self.ready = ready
        self.enableAds = enableAds
        self.requestShow = requestShow
        self.bannerLoaded = bannerLoaded
        self.policy = policy
        self.policyReady = policyReady
        self.sinceStartMs = sinceStartMs
    }
}

/// The banner shows (`show`); it is checked again after `recheckInMs` while its delay runs; `eligible` counts as the
/// policy's exposure, once per app open.
public struct BannerDecision: Equatable, Sendable {
    public var show: Bool
    public var recheckInMs: Int64?
    public var eligible: Bool

    public init(show: Bool, recheckInMs: Int64?, eligible: Bool) {
        self.show = show
        self.recheckInMs = recheckInMs
        self.eligible = eligible
    }
}

/// TwAds's `applyVisibility` (service.twads.js) as a decision. Port of the Android `BannerGate`.
public enum BannerGate {
    /// The decision, or nil before the ads are ready, when nothing happens.
    public static func decide(_ inputs: BannerInputs) -> BannerDecision? {
        guard inputs.ready else { return nil }
        let requested = inputs.requestShow ?? inputs.enableAds
        let remaining = Int64(inputs.policy.delaySeconds) * 1000 - inputs.sinceStartMs
        let wanted = requested == true && inputs.enableAds == true && inputs.policy.enabled
        let eligible = wanted && inputs.bannerLoaded && inputs.policyReady
        return BannerDecision(show: eligible && remaining <= 0,
                              recheckInMs: inputs.policyReady && wanted && remaining > 0 ? remaining : nil,
                              eligible: eligible)
    }
}
