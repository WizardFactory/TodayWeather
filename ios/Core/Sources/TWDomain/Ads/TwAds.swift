import Foundation

/// The banner view of the app (the AdMob plugin's banner, `size: 'adaptive'`, `autoShow: false`).
@MainActor
public protocol BannerAdapter: AnyObject {
    /// Replaces the banner by a new one and loads it without showing it: `onLoaded` or `onFailed` runs once,
    /// unless `destroy` runs first.
    func create(onLoaded: @escaping @MainActor () -> Void, onFailed: @escaping @MainActor () -> Void)
    /// Removes the banner (`removeBannerAd`).
    func destroy()
}

/// The banner of an app open: TwAds (service.twads.js) with the emi adapter's `createBannerView` (service.admobemi.js),
/// port of the Android `TwAds` corrected for the Cordova iOS build. It loads once the ads are ready (`onAdapterReady`:
/// the Ads SDK has started and UMP's initialization has answered) and shows when `BannerGate` allows; a page can hide
/// it (`setShowAds`, the start page of IN-10). Loads are at least 5 s apart. A change of the window's width loads a
/// new banner for it (`refresh`, the `orientationchange` handler). `shown` tells the layout to show the banner;
/// `ad_lifecycle` show and hide and the one `ad_policy_exposure` go to `track`.
@MainActor
public final class TwAds {
    /// The plugin's minimum time between banner loads, kept in the adapter (`loadInterval` 0).
    public static let spacingMs: Int64 = 5000

    /// The banner is in the layout (the plugin's `showBannerAd`).
    public private(set) var shown = false
    /// Runs when `shown` changes.
    public var onShownChange: @MainActor (Bool) -> Void = { _ in }

    private let adapter: any BannerAdapter
    private let config: RemoteBannerConfig
    private let clock: any AdsClock
    private let track: @MainActor (String, [String: AnalyticsValue]) -> Void
    private let log: @MainActor (String) -> Void
    private let sessionStart: Int64

    private var ready = false
    private var enableAds: Bool?
    private var requestShow: Bool?
    private var showAds: Bool?
    private var bannerLoaded = false
    private var exposed = false
    private var revision = 0
    private var creating = false
    private var rotating = false
    private var rotateAgain = false
    private var delayTimer: (any AdsTimer)?
    private var lastLoadAt: Int64?
    private var pendingLoad: (any AdsTimer)?
    private var cancelPendingLoad: (@MainActor () -> Void)?

    /// `sessionStart` is the time the app opened; `config` loads now (`TwAds.init` calls `Monetization.loadConfig`).
    public init(adapter: any BannerAdapter, config: RemoteBannerConfig, clock: any AdsClock, sessionStart: Int64,
                track: @escaping @MainActor (String, [String: AnalyticsValue]) -> Void,
                log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.adapter = adapter
        self.config = config
        self.clock = clock
        self.sessionStart = sessionStart
        self.track = track
        self.log = log
        config.onChange = { [weak self] in self?.applyVisibility() }
        config.load()
    }

    /// The ads are ready (`onAdapterReady`): ads are enabled and the banner loads.
    public func onAdapterReady() {
        guard !ready else { return }
        ready = true
        enableAds = true
        createBanner()
    }

    /// A page asks to show or hide the banner (`setShowAds`).
    public func setShowAds(_ show: Bool) {
        requestShow = show
        guard ready, !(enableAds == false && show) else { return }
        applyVisibility()
    }

    /// `_admobCreateBanner`.
    private func createBanner() {
        revision += 1
        let run = revision
        bannerLoaded = false
        creating = true
        load(onLoaded: { [weak self] in
            guard let self, run == self.revision, self.enableAds == true else { return }
            self.creating = false
            self.bannerLoaded = true
            self.applyVisibility()
            if self.rotateAgain { self.rotateAgain = false; self.refresh() }
        }, onFailed: { [weak self] in
            guard let self, run == self.revision else { return }
            self.creating = false
            self.log("banner create_failed")
            if self.rotateAgain { self.rotateAgain = false; self.refresh() }
        })
    }

    /// The adapter's `createBannerView`: the five-second spacing between requests is kept here, because the native
    /// interval returns silently; a destroy cancels a waiting load as a failure.
    private func load(onLoaded: @escaping @MainActor () -> Void, onFailed: @escaping @MainActor () -> Void) {
        let remaining = lastLoadAt.map { Self.spacingMs - (clock.nowMs - $0) } ?? 0
        let start: @MainActor () -> Void = { [weak self] in
            guard let self else { return }
            self.pendingLoad = nil
            self.cancelPendingLoad = nil
            self.lastLoadAt = self.clock.nowMs
            self.adapter.create(onLoaded: onLoaded, onFailed: onFailed)
        }
        if remaining > 0 {
            cancelPendingLoad = onFailed
            pendingLoad = clock.after(remaining, start)
        } else {
            start()
        }
    }

    /// The adapter's `destroyBannerView`.
    private func destroyBanner() {
        if let pending = pendingLoad {
            pending.cancel()
            pendingLoad = nil
            let cancel = cancelPendingLoad
            cancelPendingLoad = nil
            cancel?()
        }
        adapter.destroy()
    }

    /// `refreshBanner`: the window's width changed, so the banner is destroyed and a new one loads for the new width.
    /// The old banner stays hidden until the new one has loaded; a failed load leaves no banner.
    public func refresh() {
        guard enableAds == true else { return }
        if rotating || creating {
            rotateAgain = true
            return
        }
        rotating = true
        revision += 1
        let run = revision
        bannerLoaded = false
        applyVisibility()
        destroyBanner()
        let finish: @MainActor (Bool) -> Void = { [weak self] failed in
            guard let self else { return }
            self.rotating = false
            if run == self.revision, self.enableAds == true {
                self.bannerLoaded = !failed
                self.showAds = nil
                self.applyVisibility()
            }
            if failed { self.log("twads orientation_recreate create_failed retain_screen_policy") }
            if self.rotateAgain { self.rotateAgain = false; self.refresh() }
        }
        guard run == revision, enableAds == true else { return finish(false) }
        load(onLoaded: { finish(false) }, onFailed: { finish(true) })
    }

    /// `applyVisibility`.
    private func applyVisibility() {
        delayTimer?.cancel()
        delayTimer = nil
        guard let decision = BannerGate.decide(BannerInputs(
            ready: ready, enableAds: enableAds, requestShow: requestShow, bannerLoaded: bannerLoaded,
            policy: config.policy, policyReady: config.ready, sinceStartMs: clock.nowMs - sessionStart)) else { return }
        if let wait = decision.recheckInMs {
            delayTimer = clock.after(wait) { [weak self] in self?.applyVisibility() }
        }
        if decision.eligible && !exposed {
            exposed = true
            track("ad_policy_exposure", ["delay_seconds": .number(Double(config.policy.delaySeconds))])
        }
        guard showAds != decision.show else { return }
        showAds = decision.show
        shown = decision.show
        track("ad_lifecycle", ["action": .text(decision.show ? "show" : "hide"), "ad_format": .text("banner")])
        onShownChange(decision.show)
    }
}
