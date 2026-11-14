import GoogleMobileAds
import os
import SwiftUI
import TWDomain
import UIKit

/// The AdMob banner (IN-15, #2964): the emi plugin's banner with `size: 'adaptive'` and `autoShow: false`, the
/// current-orientation anchored adaptive size for the window's width, the unit of `AdsSettings`. Each request applies
/// the #2945 rule to the live ATT status and TCF values: personalized only when allowed, otherwise `npa=1` with the
/// publisher first-party ID off. It reports `ad_lifecycle` request, loaded, failed and impression, and `ad_load_error`
/// with the SDK's numeric code only (the message can carry ad unit IDs). `BannerSlot` shows it.
@MainActor
@Observable
final class AdMobBanner: NSObject, BannerAdapter, BannerViewDelegate {
    /// The loaded or loading banner.
    private(set) var view: BannerView?

    @ObservationIgnored private let unitID: String
    @ObservationIgnored private let platform: any AdsPlatform
    @ObservationIgnored private let track: @MainActor (String, [String: AnalyticsValue]) -> Void
    @ObservationIgnored private let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "admob")
    @ObservationIgnored private var onLoaded: (@MainActor () -> Void)?
    @ObservationIgnored private var onFailed: (@MainActor () -> Void)?

    init(unitID: String, platform: any AdsPlatform, track: @escaping @MainActor (String, [String: AnalyticsValue]) -> Void) {
        self.unitID = unitID
        self.platform = platform
        self.track = track
    }

    func create(onLoaded: @escaping @MainActor () -> Void, onFailed: @escaping @MainActor () -> Void) {
        destroy()
        let root = GoogleAdsPlatform.topViewController()
        let width = root?.view.window?.bounds.width ?? UIScreen.main.bounds.width
        let banner = BannerView(adSize: currentOrientationAnchoredAdaptiveBanner(width: width))
        banner.adUnitID = unitID
        banner.rootViewController = root
        banner.delegate = self
        self.onLoaded = onLoaded
        self.onFailed = onFailed
        view = banner
        lifecycle("request")
        banner.load(request())
    }

    func destroy() {
        onLoaded = nil
        onFailed = nil
        view?.delegate = nil
        view?.removeFromSuperview()
        view = nil
    }

    /// The plugin's `setAdRequest` with the #2945 rule.
    func request() -> Request {
        let (status, consent) = platform.privacyState()
        let personalized = AdRequestRule.personalized(status, consent)
        MobileAds.shared.requestConfiguration.setPublisherFirstPartyIDEnabled(personalized)
        let request = Request()
        if !personalized {
            let extras = Extras()
            extras.additionalParameters = AdRequestRule.nonPersonalizedExtras
            request.register(extras)
        }
        return request
    }

    // The delegate's calls come on the main actor (`NS_SWIFT_UI_ACTOR`); a banner replaced since is ignored.

    func bannerViewDidReceiveAd(_ bannerView: BannerView) {
        guard bannerView === view else { return }
        lifecycle("loaded")
        let done = onLoaded
        onLoaded = nil
        onFailed = nil
        done?()
    }

    func bannerView(_ bannerView: BannerView, didFailToReceiveAdWithError error: any Error) {
        guard bannerView === view else { return }
        lifecycle("failed")
        let code = (error as NSError).code
        let known = (0...999).contains(code)
        let text = known ? String(code) : "\"unavailable\""
        log.notice("""
            {"component":"admob","operation":"banner_load","cause":"load_failed","error_code":\(text, privacy: .public),"result":"failed"}
            """)
        if known { track("ad_load_error", ["ad_format": .text("banner"), "error_code": .number(Double(code))]) }
        let done = onFailed
        onLoaded = nil
        onFailed = nil
        done?()
    }

    func bannerViewDidRecordImpression(_ bannerView: BannerView) {
        guard bannerView === view else { return }
        lifecycle("impression")
    }

    private func lifecycle(_ action: String) {
        log.notice("banner \(action, privacy: .public)")
        track("ad_lifecycle", ["action": .text(action), "ad_format": .text("banner")])
    }

    /// The banner's height in points (0 without a banner).
    var height: CGFloat { view?.adSize.size.height ?? 0 }
}

/// The banner in the layout: as tall as the ad, centered on black, as the plugin laid it out over the root view's
/// black background (`EmiBannerManager.updateBannerLayout`).
struct BannerSlot: View {
    let banner: AdMobBanner

    var body: some View {
        if let view = banner.view {
            BannerHost(view: view)
                .frame(width: view.adSize.size.width, height: view.adSize.size.height)
                .frame(maxWidth: .infinity)
                .background(Color.black)
                .accessibilityIdentifier("admob-banner")
        }
    }
}

private struct BannerHost: UIViewRepresentable {
    let view: BannerView

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .black
        attach(to: container)
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        attach(to: container)
    }

    private func attach(to container: UIView) {
        guard view.superview !== container else { return }
        container.subviews.forEach { $0.removeFromSuperview() }
        view.removeFromSuperview()
        view.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(view)
        NSLayoutConstraint.activate([
            view.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            view.centerYAnchor.constraint(equalTo: container.centerYAnchor),
        ])
    }
}
