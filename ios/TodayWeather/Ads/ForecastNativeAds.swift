import GoogleMobileAds
import SwiftUI
import TWDomain

@MainActor
protocol ForecastNativeInventory: AnyObject {
    var enabled: Bool { get }
    var generation: Int { get }
    var availability: Int { get }
    func assignCreative(to tab: ShellTab) -> ForecastCreative?
    func assignedCreative(for tab: ShellTab) -> ForecastCreative?
}

/// Retain an assigned creative only for its original placement. The one spare has never been displayed.
@MainActor @Observable
final class ForecastNativeCache {
    private struct Entry {
        let creative: ForecastCreative
        let loadedAt: ContinuousClock.Instant
    }

    private let now: () -> ContinuousClock.Instant
    private var assigned: [ShellTab: Entry] = [:]
    @ObservationIgnored private var spare: Entry?
    private(set) var availability = 0

    init(now: @escaping () -> ContinuousClock.Instant = { .now }) {
        self.now = now
    }

    func store(_ creative: ForecastCreative) {
        spare = Entry(creative: creative, loadedAt: now())
        availability += 1
    }

    func assignCreative(to tab: ShellTab) -> ForecastCreative? {
        discardExpired()
        if let existing = assigned[tab] { return existing.creative }
        guard let spare else { return nil }
        assigned[tab] = spare
        self.spare = nil
        return spare.creative
    }

    func assignedCreative(for tab: ShellTab) -> ForecastCreative? {
        guard let entry = assigned[tab], entry.loadedAt > now() - Self.lifetime else { return nil }
        return entry.creative
    }

    private static let lifetime: Duration = .seconds(55 * 60)

    var needsSpare: Bool {
        discardExpired()
        return spare == nil && assigned.count < ShellTab.allCases.count
    }

    var hasSpare: Bool {
        discardExpired()
        return spare != nil
    }

    func clear() {
        assigned.removeAll()
        spare = nil
    }

    private func discardExpired() {
        let cutoff = now() - Self.lifetime
        for (tab, entry) in assigned where entry.loadedAt <= cutoff { assigned.removeValue(forKey: tab) }
        if let entry = spare, entry.loadedAt <= cutoff { spare = nil }
    }
}

@MainActor @Observable
final class ForecastNativeAds: NSObject, ForecastNativeInventory, NativeAdLoaderDelegate, NativeAdDelegate {
    private let unitID: String
    private let request: () -> Request
    private let track: (String, [String: AnalyticsValue]) -> Bool
    @ObservationIgnored private var loader: AdLoader?
    private(set) var enabled = false
    private(set) var generation = 0
    @ObservationIgnored private let cache: ForecastNativeCache
    private let now: () -> ContinuousClock.Instant
    private let send: (AdLoader, Request) -> Void
    @ObservationIgnored private var queued = false
    @ObservationIgnored private var retryAfter: ContinuousClock.Instant?

    init(unitID: String, request: @escaping () -> Request,
         now: @escaping () -> ContinuousClock.Instant = { .now },
         send: @escaping (AdLoader, Request) -> Void = { $0.load($1) },
         track: @escaping (String, [String: AnalyticsValue]) -> Bool) {
        self.cache = ForecastNativeCache(now: now)
        self.now = now
        self.send = send
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
        cache.clear()
        queued = false
        retryAfter = nil
        if allowed { prepareSpare() }
    }

    /// Coalesce demand and keep SDK construction off the synchronous view/navigation path.
    func prepareSpare() {
        // Evict expired visible cards even when an outstanding request already covers this demand.
        guard enabled, cache.needsSpare, !queued, loader == nil else { return }
        if let retryAfter, now() < retryAfter { return }
        queued = true
        let revision = generation
        Task { @MainActor [weak self] in
            guard let self, generation == revision else { return }
            queued = false
            guard UIApplication.shared.applicationState != .background, cache.needsSpare else { return }
            loadSpare()
        }
    }

    private func loadSpare() {
        let next = AdLoader(adUnitID: unitID, rootViewController: GoogleAdsPlatform.topViewController(),
                            adTypes: [.native], options: nil)
        loader = next
        next.delegate = self
        lifecycle("request")
        send(next, request())
    }

    var hasFreshCreative: Bool { cache.hasSpare }
    var availability: Int { cache.availability }

    func assignedCreative(for tab: ShellTab) -> ForecastCreative? { cache.assignedCreative(for: tab) }

    func assignCreative(to tab: ShellTab) -> ForecastCreative? {
        guard enabled else { return nil }
        let creative = cache.assignCreative(to: tab)
        prepareSpare()
        return creative
    }

    func adLoader(_ adLoader: AdLoader, didReceive nativeAd: NativeAd) {
        guard enabled, loader === adLoader else { return }
        loader = nil
        cache.store(ForecastCreative(nativeAd))
        nativeAd.delegate = self
        lifecycle("loaded")
    }

    func adLoader(_ adLoader: AdLoader, didFailToReceiveAdWithError error: any Error) {
        guard loader === adLoader else { return }
        loader = nil
        retryAfter = now() + .seconds(60)
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
    @Entry var forecastNativeAds: (any ForecastNativeInventory)? = nil
    @Entry var nativePlacement: ForecastNativePlacement? = nil
    @Entry var forecastChartRead: @MainActor (ShellTab) -> Void = { _ in }
}

/// The shell keys this host by the actual tab/city visit. Searching, editing or moving an optional
/// forecast section can remove and recreate a slot without granting it another inventory decision.
struct ForecastNativeVisitHost: ViewModifier {
    @State private var placement = ForecastNativePlacement()
    @Environment(\.forecastNativeAds) private var ads

    func body(content: Content) -> some View {
        content.environment(\.nativePlacement, placement)
            .onAppear { placement.resume() }
            .onDisappear { placement.suspend() }
            .onChange(of: ads?.generation) { placement.discardStaleCreative(ads) }
    }
}

@MainActor @Observable
final class ForecastNativePlacement {
    private var visit = NativeAdVisit()
    private weak var owner: (any ForecastNativeInventory)?
    private var generation: Int?
    private var tab: ShellTab?
    private weak var selectedCreative: ForecastCreative?
    private var hasClaim = false

    func reached(_ ads: (any ForecastNativeInventory)?, tab: ShellTab) {
        discardStaleCreative(ads)
        guard visit.decision == nil else { return }
        guard let ads, ads.enabled, let creative = ads.assignCreative(to: tab),
              creative.claim(for: self) else { return }
        _ = visit.reached(hasCreative: true)
        owner = ads
        generation = ads.generation
        self.tab = tab
        selectedCreative = creative
        hasClaim = true
    }

    func creative(for ads: (any ForecastNativeInventory)?) -> ForecastCreative? {
        guard hasClaim, let ads, ads.enabled, ads === owner, ads.generation == generation else { return nil }
        guard let tab, let creative = ads.assignedCreative(for: tab), creative.placement === self else { return nil }
        return creative
    }

    func suspend() {
        selectedCreative?.release(from: self)
        hasClaim = false
    }

    func resume() {
        guard !hasClaim, let tab, let owner, owner.enabled, owner.generation == generation,
              let creative = owner.assignedCreative(for: tab), creative === selectedCreative else { return }
        hasClaim = creative.claim(for: self)
    }

    func discardStaleCreative(_ ads: (any ForecastNativeInventory)?) {
        guard let generation, owner !== ads || generation != ads?.generation else { return }
        suspend()
        visit = NativeAdVisit()
        owner = nil
        self.generation = nil
        selectedCreative = nil
        tab = nil
    }
}

/// A zero-height marker can measure where an omitted slot would have appeared without reserving margins.
struct ForecastNativeSlot: View {
    private struct InventorySignal: Equatable {
        let inventory: ObjectIdentifier
        let enabled: Bool
        let generation: Int
        let availability: Int
    }

    let tab: ShellTab
    let theme: Theme
    @Environment(\.forecastNativeAds) private var ads
    @Environment(\.locale) private var locale
    @Environment(\.nativePlacement) private var placement
    @State private var isReached = false

    private var signal: InventorySignal? {
        guard let ads else { return nil }
        return InventorySignal(inventory: ObjectIdentifier(ads), enabled: ads.enabled,
                               generation: ads.generation, availability: ads.availability)
    }

    var body: some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: 0)
                .onGeometryChange(for: Bool.self) { geometry in
                    guard let viewport = geometry.bounds(of: .scrollView(axis: .vertical)) else { return false }
                    return viewport.maxY >= 0
                } action: { reached in
                    isReached = reached
                    if reached { placement?.reached(ads, tab: tab) }
                }
            if let creative = placement?.creative(for: ads) {
                let stacked = tab == .search
                ForecastCreativeHost(ad: creative, stacked: stacked, theme: theme, locale: locale)
                    .padding(.horizontal, stacked ? 0 : 12)
                    .padding(.vertical, stacked ? 12 : 6)
                    .accessibilityIdentifier("native-ad-\(tab.rawValue)")
            }
        }
        .onChange(of: signal) {
            if isReached { placement?.reached(ads, tab: tab) }
        }
    }
}
