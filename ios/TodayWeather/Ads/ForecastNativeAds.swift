import GoogleMobileAds
import SwiftUI
import TWDomain

/// One spare creative for the next slot. A creative is handed to one mounted SDK view only.
@MainActor @Observable
final class ForecastNativeAds: NSObject, NativeAdLoaderDelegate, NativeAdDelegate {
    private let unitID: String
    private let request: () -> Request
    private let track: (String, [String: AnalyticsValue]) -> Bool
    @ObservationIgnored private var loader: AdLoader?
    private(set) var enabled = false
    private(set) var generation = 0
    private var ready: NativeAd?
    private var loadedAt: Date?

    init(unitID: String, request: @escaping () -> Request, track: @escaping (String, [String: AnalyticsValue]) -> Bool) {
        self.unitID = unitID
        self.request = request
        self.track = track
    }

    func setEnabled(_ allowed: Bool) {
        guard enabled != allowed else { return }
        enabled = allowed
        generation += 1
        loader?.delegate = nil
        loader = nil
        ready = nil
        loadedAt = nil
        if allowed { preload() }
    }

    func preload() {
        guard enabled, loader == nil else { return }
        if hasFreshCreative { return }
        ready = nil
        let next = AdLoader(adUnitID: unitID, rootViewController: GoogleAdsPlatform.topViewController(),
                            adTypes: [.native], options: nil)
        loader = next
        next.delegate = self
        lifecycle("request")
        next.load(request())
    }

    var hasFreshCreative: Bool {
        guard enabled, ready != nil, let loadedAt else { return false }
        return Date().timeIntervalSince(loadedAt) < 55 * 60
    }

    func take() -> NativeAd? {
        guard hasFreshCreative else { return nil }
        defer { ready = nil }
        return ready
    }

    func adLoader(_ adLoader: AdLoader, didReceive nativeAd: NativeAd) {
        guard enabled, loader === adLoader else { return }
        loader = nil
        ready = nativeAd
        loadedAt = Date()
        nativeAd.delegate = self
        lifecycle("loaded")
    }

    func adLoader(_ adLoader: AdLoader, didFailToReceiveAdWithError error: any Error) {
        guard loader === adLoader else { return }
        loader = nil
        lifecycle("failed")
        let code = (error as NSError).code
        if (0...999).contains(code) {
            _ = track("ad_load_error", ["ad_format": .text("native"), "error_code": .number(Double(code))])
        }
    }

    func nativeAdDidRecordImpression(_ nativeAd: NativeAd) {
        if enabled { lifecycle("impression") }
    }

    private func lifecycle(_ action: String) {
        _ = track("ad_lifecycle", ["action": .text(action), "ad_format": .text("native")])
    }
}

extension EnvironmentValues {
    @Entry var forecastNativeAds: ForecastNativeAds? = nil
    @Entry var forecastChartRead: @MainActor (ShellTab) -> Void = { _ in }
}

/// A zero-height marker can measure where an omitted slot would have appeared without reserving margins.
struct ForecastNativeSlot: View {
    let tab: ShellTab
    let theme: Theme
    @Environment(\.forecastNativeAds) private var ads
    @Environment(\.locale) private var locale
    @State private var visit = NativeAdVisit()
    @State private var creative: NativeAd?
    @State private var generation = -1

    var body: some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: 0)
                .onGeometryChange(for: Bool.self) { geometry in
                    guard let viewport = geometry.bounds(of: .scrollView(axis: .vertical)) else { return false }
                    return viewport.maxY >= 0
                } action: { reached in
                    guard reached, visit.decision == nil else { return }
                    if visit.reached(hasCreative: ads?.hasFreshCreative == true), let ads {
                        generation = ads.generation
                        creative = ads.take()
                    }
                }
            if let ads, ads.enabled, generation == ads.generation, let creative {
                let stacked = tab == .search
                ForecastCreativeHost(ad: creative, stacked: stacked, theme: theme, locale: locale)
                    .padding(.horizontal, stacked ? 0 : 12)
                    .padding(.vertical, stacked ? 12 : 6)
                    .accessibilityIdentifier("native-ad-\(tab.rawValue)")
            }
        }
        .onAppear { ads?.preload() }
        .onChange(of: ads?.generation) { creative = nil }
    }
}
