import Foundation

/// UMP's consent status (`UMPConsentStatus`).
public enum AdsConsentStatus: Equatable, Sendable {
    case unknown, required, notRequired, obtained
}

/// Why the plugin's `initialize` answered with an error.
public enum AdsConsentError: Equatable, Sendable {
    /// `requestConsentInfoUpdate` failed (no consent message published, no network …).
    case update(String)
    /// The consent form could not be loaded.
    case formLoad(String)
    /// The consent form failed while it showed.
    case form(String)
    /// "Cannot request ads, consent is required.": UMP answered and does not allow ads.
    case consentRequired
    /// "Consent status unknown."
    case statusUnknown

    /// A consent decision, never bypassed (the adapter's `/consent is required|status unknown/`).
    public var isConsentDecision: Bool { self == .consentRequired || self == .statusUnknown }
}

/// A consent form loaded to be shown once (`UMPConsentForm`).
@MainActor
public protocol AdsConsentForm: AnyObject {
    /// Shows the form; `done` runs once when it closes, with the error text when it failed.
    func present(_ done: @escaping @MainActor (String?) -> Void)
}

/// Google's consent platform (UMP) and the Ads SDK as the AdMob plugin calls them on iOS. Every `done` runs once on
/// the main actor.
@MainActor
public protocol AdsPlatform: AnyObject {
    /// Ads may be requested: consent obtained or not required, also as stored from an earlier session.
    var canRequestAds: Bool { get }
    var consentStatus: AdsConsentStatus { get }
    /// `requestConsentInfoUpdate`; `done` gets the error's text, nil on success.
    func requestConsentUpdate(_ done: @escaping @MainActor (String?) -> Void)
    /// `UMPConsentForm.load`: the form, or nil and the error's text.
    func loadConsentForm(_ done: @escaping @MainActor ((any AdsConsentForm)?, String?) -> Void)
    /// `GADMobileAds.start`; `ready` runs when the SDK has started.
    func startSdk(_ ready: @escaping @MainActor () -> Void)
    var privacyOptionsRequired: Bool { get }
    /// The privacy options form; `done` gets the error's text, nil when it showed and closed.
    func presentPrivacyOptions(_ done: @escaping @MainActor (String?) -> Void)
    /// The ATT status and the stored TCF values, read without prompting (the injected `twAdPrivacyState`).
    func privacyState() -> (TrackingStatus, AdConsentRecord)
}

/// The consent flow and the Ads SDK start of an app open on iOS: the emi adapter's `init` (service.admobemi.js) with
/// the plugin's iOS `initialize`, as #2871 and #2945 left them.
///
/// - The app never asks for App Tracking Transparency itself. UMP shows the GDPR message and the IDFA explainer as
///   its consent form, and the explainer raises the system prompt; iOS shows that prompt once per install, and UMP
///   offers its form only while consent is required.
/// - A consent cached from an earlier session starts the SDK at once; otherwise it starts once UMP allows ads, in the
///   same session (#2871: one more `initialize` a second after the form, when the SDK has not started).
/// - The ads are ready (`onReady`) only after both the SDK has started and UMP's initialization has answered,
///   success or error (#2945). So no banner is requested while a consent form or the ATT prompt may be open, also when
///   cached consent starts the SDK first. Then the `request_policy` line is written once.
/// - When UMP fails, release builds request no ads; builds with Google's test units start the SDK without UMP once,
///   unless the answer is a consent decision.
@MainActor
public final class AdsConsent {
    /// The delay of the second `initialize` after the consent form (`startAfterConsent`).
    public static let retryDelayMs: Int64 = 1000

    private let platform: any AdsPlatform
    private let releaseAds: Bool
    private let clock: any AdsClock
    private let track: @MainActor (String, [String: AnalyticsValue]) -> Void
    private let log: @MainActor (String) -> Void
    private let onReady: @MainActor (TrackingStatus) -> Void

    private var initialized = false
    private var sdkRequested = false
    private var sdkStarted = false
    private var consentAnswered = false
    private var reported = false
    private var retried = false
    private var fellBack = false

    /// `onReady` gets the ATT status the `request_policy` line reported.
    public init(platform: any AdsPlatform, releaseAds: Bool, clock: any AdsClock,
                track: @escaping @MainActor (String, [String: AnalyticsValue]) -> Void,
                log: @escaping @MainActor (String) -> Void = { _ in },
                onReady: @escaping @MainActor (TrackingStatus) -> Void) {
        self.platform = platform
        self.releaseAds = releaseAds
        self.clock = clock
        self.track = track
        self.log = log
        self.onReady = onReady
    }

    /// The adapter's `init`: runs once per process.
    public func start() {
        guard !initialized else { return }
        initialized = true
        initialize(answers: true)
    }

    /// The plugin's iOS `initialize`. Only the first call's success counts as UMP's answer; the second one's success
    /// callback is empty in the adapter, its errors are handled.
    private func initialize(answers: Bool) {
        if platform.canRequestAds { startSdk() }
        platform.requestConsentUpdate { [weak self] error in
            guard let self else { return }
            if let error { return self.failed(.update(error)) }
            switch self.platform.consentStatus {
            case .required:
                self.platform.loadConsentForm { [weak self] form, error in
                    guard let self else { return }
                    if let form {
                        form.present { [weak self] error in
                            guard let self else { return }
                            if let error { self.failed(.form(error)) } else if answers { self.answered() }
                        }
                    } else {
                        self.failed(.formLoad(error ?? ""))
                    }
                    if self.platform.canRequestAds { self.startSdk() }
                }
            case .notRequired, .obtained:
                if self.platform.canRequestAds {
                    self.startSdk()
                    if answers { self.answered() }
                } else {
                    self.failed(.consentRequired)
                }
            case .unknown:
                self.failed(.statusUnknown)
            }
        }
    }

    /// UMP finished (the SDK started, or the consent form was answered): ready when the SDK has started; one more
    /// `initialize` a second later starts the SDK in this session when the form allowed ads (#2871).
    private func answered() {
        consentAnswered = true
        ready()
        _ = clock.after(Self.retryDelayMs) { [weak self] in
            guard let self, !self.sdkStarted, !self.retried else { return }
            self.retried = true
            self.log("admob consent finished, initialize again")
            self.initialize(answers: false)
        }
    }

    /// `onConsentError`: an error is an answer too, so ads from cached consent continue.
    private func failed(_ error: AdsConsentError) {
        consentAnswered = true
        ready()
        log("admob consent ump_error retain_gate not_ready")
        track("ad_lifecycle", ["action": .text("consent_failed"), "ad_format": .text("banner")])
        if releaseAds || fellBack || error.isConsentDecision { return }
        fellBack = true
        // `useCustomConsentManager`: the test-unit build starts the SDK without UMP.
        startSdk()
    }

    private func startSdk() {
        guard !sdkRequested else { return }
        sdkRequested = true
        platform.startSdk { [weak self] in
            guard let self, !self.sdkStarted else { return }
            self.sdkStarted = true
            self.log("admob initialize ready")
            self.ready()
        }
    }

    /// Ready once both the SDK has started and UMP has answered; the request mode is reported once.
    private func ready() {
        guard sdkStarted, consentAnswered, !reported else { return }
        reported = true
        let (status, consent) = platform.privacyState()
        log(RequestPolicyLine.line(status: status, personalized: AdRequestRule.personalized(status, consent)))
        onReady(status)
    }

    /// 광고 개인정보 선택: UMP's privacy options form where one is required; otherwise, or when it cannot show,
    /// `onUnavailable` (`LOC_AD_PRIVACY_UNAVAILABLE`). A changed consent may allow the SDK to start.
    public func openPrivacyOptions(onUnavailable: @escaping @MainActor () -> Void) {
        guard platform.privacyOptionsRequired else {
            log("privacy ad_choices not_required form_unavailable")
            return onUnavailable()
        }
        platform.presentPrivacyOptions { [weak self] error in
            guard let self else { return }
            if error != nil {
                self.log("privacy ad_choices ump_error form_unavailable")
                onUnavailable()
            }
            if self.initialized, self.platform.canRequestAds { self.startSdk() }
        }
    }
}
