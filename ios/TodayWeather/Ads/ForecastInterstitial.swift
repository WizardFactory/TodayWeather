import Foundation
import GoogleMobileAds
import TWDomain
import UIKit

enum ForecastAdEvent {
    case showing, impression, dismissed
    case failed(any Error)
}

@MainActor
protocol ForecastInterstitialCreative: AnyObject {
    func canPresent(from root: UIViewController) throws
    func present(from root: UIViewController, event: @escaping (ForecastAdEvent) -> Void)
}

@MainActor
final class ForecastInterstitial {
    typealias Load = (@escaping @MainActor () -> Bool,
                      @escaping @MainActor (Result<any ForecastInterstitialCreative, any Error>) -> Void) -> Void
    typealias Track = (String, [String: AnalyticsValue]) -> Void

    private let visits: ForecastAdVisits
    private let load: Load
    private let root: () -> UIViewController?
    private let uptime: () -> TimeInterval
    private let track: Track
    private var enabled = false
    private var loading: UUID?
    private var lastAttempt: TimeInterval?
    private var ready: (ad: any ForecastInterstitialCreative, at: TimeInterval)?
    private var active: (id: UUID, ad: any ForecastInterstitialCreative)?

    convenience init(unitID: String, request: @escaping () -> Request, track: @escaping Track,
                     chance: @escaping () -> Int) {
        let folder = URL.applicationSupportDirectory.appendingPathComponent("ForecastInterstitial", isDirectory: true)
        self.init(visits: ForecastAdVisits(directory: folder, chance: chance), load: { stillAllowed, done in
            Task { @MainActor in
                guard stillAllowed() else { return }
                do {
                    let ad = try await InterstitialAd.load(with: unitID, request: request())
                    done(.success(SDKForecastInterstitial(ad: ad)))
                } catch { done(.failure(error)) }
            }
        }, root: {
            // A tap caught while an alert, consent form or another scene is on top does not interrupt it.
            guard UIApplication.shared.applicationState == .active,
                  let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                    .first(where: { $0.activationState == .foregroundActive && $0.keyWindow != nil }),
                  let controller = scene.keyWindow?.rootViewController, controller.presentedViewController == nil,
                  controller.viewIfLoaded?.window?.isKeyWindow == true else { return nil }
            return controller
        }, uptime: { ProcessInfo.processInfo.systemUptime }, track: track)
    }

    init(visits: ForecastAdVisits, load: @escaping Load, root: @escaping () -> UIViewController?,
         uptime: @escaping () -> TimeInterval, track: @escaping Track) {
        self.visits = visits
        self.load = load
        self.root = root
        self.uptime = uptime
        self.track = track
    }

    func setEnabled(_ allowed: Bool) {
        enabled = allowed
        if allowed { preload() }
        else {
            loading = nil
            ready = nil
            lastAttempt = nil
        }
    }

    func markVisible(_ tab: ShellTab) {
        visits.markVisible(tab)
        if tab == .forecast || tab == .dailyforecast { preload() }
    }

    /// True when this presenter owns the navigation (including repeated taps during the same presentation).
    func handleIntent(from source: ShellTab, to destination: ShellTab, readPastChart: Bool,
                      navigate: @escaping () -> Void) -> Bool {
        if active != nil { return true }
        guard enabled, readPastChart, let root = root() else { return false }
        guard let ad = freshAd() else { preload(); return false }
        do { try ad.canPresent(from: root) }
        catch {
            ready = nil
            lifecycle("failed")
            return false
        }
        guard let id = visits.reserve(from: source, to: destination, readPastChart: readPastChart,
                                      navigate: navigate) else { return false }
        ready = nil
        active = (id, ad)
        ad.present(from: root) { [weak self] event in
            guard let self, active?.id == id else { return }
            switch event {
            case .showing:
                visits.displayed(id)
                lifecycle("show")
            case .impression:
                visits.displayed(id)
                lifecycle("impression")
            case .dismissed:
                active = nil
                lifecycle("hide")
                visits.finish(id, failedBeforeDisplay: false)
            case .failed:
                active = nil
                lifecycle("failed")
                visits.finish(id, failedBeforeDisplay: true)
            }
        }
        return true
    }

    private func freshAd() -> (any ForecastInterstitialCreative)? {
        guard let cached = ready else { return nil }
        guard uptime() - cached.at < 55 * 60 else { ready = nil; return nil }
        return cached.ad
    }

    private func preload() {
        guard enabled, loading == nil, active == nil, visits.available, freshAd() == nil else { return }
        let now = uptime()
        if let lastAttempt, now - lastAttempt < 60 { return }
        lastAttempt = now
        let id = UUID()
        loading = id
        lifecycle("request")
        load({ [weak self] in self?.loading == id }) { [weak self] result in
            guard let self, loading == id else { return }
            loading = nil
            switch result {
            case .success(let ad):
                ready = (ad, uptime())
                lifecycle("loaded")
            case .failure(let error):
                loadFailed(error)
            }
        }
    }

    private func loadFailed(_ error: any Error) {
        lifecycle("failed")
        let code = (error as NSError).code
        if (0...999).contains(code) {
            track("ad_load_error", ["ad_format": .text("interstitial"), "error_code": .number(Double(code))])
        }
    }

    private func lifecycle(_ action: String) {
        track("ad_lifecycle", ["action": .text(action), "ad_format": .text("interstitial")])
    }
}

@MainActor
private final class SDKForecastInterstitial: NSObject, ForecastInterstitialCreative, FullScreenContentDelegate {
    private let ad: InterstitialAd
    private var event: ((ForecastAdEvent) -> Void)?

    init(ad: InterstitialAd) { self.ad = ad }

    func canPresent(from root: UIViewController) throws { try ad.canPresent(from: root) }

    func present(from root: UIViewController, event: @escaping (ForecastAdEvent) -> Void) {
        self.event = event
        ad.fullScreenContentDelegate = self
        ad.present(from: root)
    }

    func adWillPresentFullScreenContent(_ ad: any FullScreenPresentingAd) { event?(.showing) }
    func adDidRecordImpression(_ ad: any FullScreenPresentingAd) { event?(.impression) }
    func adDidDismissFullScreenContent(_ ad: any FullScreenPresentingAd) { event?(.dismissed) }
    func ad(_ ad: any FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: any Error) {
        event?(.failed(error))
    }
}
