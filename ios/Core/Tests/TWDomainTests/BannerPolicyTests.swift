import Foundation
import Testing
import TWDomain

/// The banner policy (#2964 AC1, V21): TwAds's `applyVisibility` as a decision, the banner's loads and visibility, and
/// the Remote Config pair `tw_banner_enabled` / `tw_banner_delay_seconds` with its defaults, validation and timeout.
/// Ported from the Android `BannerGateTest` and `TwAdsTest` (AN-15).
@MainActor
struct BannerPolicyTests {
    static let ready = BannerInputs(ready: true, enableAds: true, requestShow: nil, bannerLoaded: true,
                                    policy: .default, policyReady: true, sinceStartMs: 0)

    static func with(_ change: (inout BannerInputs) -> Void) -> BannerInputs {
        var inputs = ready
        change(&inputs)
        return inputs
    }

    // MARK: Gate

    @Test func nothingHappensBeforeTheAdsAreReady() {
        #expect(BannerGate.decide(Self.with { $0.ready = false }) == nil)
    }

    @Test func aLoadedBannerShowsAtOnceWithTheDefaultPolicy() {
        #expect(BannerGate.decide(Self.ready) == BannerDecision(show: true, recheckInMs: nil, eligible: true))
        #expect(BannerPolicy.default == BannerPolicy(enabled: true, delaySeconds: 0))
        #expect(RemoteBannerPolicy.defaults == ["tw_banner_enabled": "true", "tw_banner_delay_seconds": "0"])
    }

    @Test func theFirstBannerAndTheExposureWaitForTheFinishedPolicy() {
        #expect(BannerGate.decide(Self.with { $0.policyReady = false }) == BannerDecision(show: false, recheckInMs: nil, eligible: false))
    }

    @Test func theDelayCountsFromTheAppOpening() {
        let delayed = Self.with { $0.policy = BannerPolicy(enabled: true, delaySeconds: 30); $0.sinceStartMs = 10_000 }
        #expect(BannerGate.decide(delayed) == BannerDecision(show: false, recheckInMs: 20_000, eligible: true))
        #expect(BannerGate.decide(Self.with { $0.policy = BannerPolicy(enabled: true, delaySeconds: 30); $0.sinceStartMs = 30_000 })
                == BannerDecision(show: true, recheckInMs: nil, eligible: true))
        let unloaded = Self.with { $0.policy = BannerPolicy(enabled: true, delaySeconds: 5); $0.bannerLoaded = false; $0.sinceStartMs = 1000 }
        #expect(BannerGate.decide(unloaded) == BannerDecision(show: false, recheckInMs: 4000, eligible: false))
    }

    @Test func theKillSwitchAndAHidingPage() {
        #expect(BannerGate.decide(Self.with { $0.policy = BannerPolicy(enabled: false, delaySeconds: 30) })
                == BannerDecision(show: false, recheckInMs: nil, eligible: false))
        #expect(BannerGate.decide(Self.with { $0.requestShow = false; $0.policy = BannerPolicy(enabled: true, delaySeconds: 30) })
                == BannerDecision(show: false, recheckInMs: nil, eligible: false))
        #expect(BannerGate.decide(Self.with { $0.requestShow = true }) == BannerDecision(show: true, recheckInMs: nil, eligible: true))
        #expect(BannerGate.decide(Self.with { $0.enableAds = false; $0.requestShow = true })
                == BannerDecision(show: false, recheckInMs: nil, eligible: false))
        #expect(BannerGate.decide(Self.with { $0.enableAds = nil }) == BannerDecision(show: false, recheckInMs: nil, eligible: false))
    }

    @Test func theRemoteConfigPairIsReadWholeOrNotAtAll() {
        func read(_ flag: String?, _ delay: String?) -> BannerPolicy? {
            var values: [String: String] = [:]
            values["tw_banner_enabled"] = flag
            values["tw_banner_delay_seconds"] = delay
            return RemoteBannerPolicy.parse(values)
        }
        #expect(read("true", "0") == BannerPolicy(enabled: true, delaySeconds: 0))
        #expect(read("false", "120") == BannerPolicy(enabled: false, delaySeconds: 120))
        #expect(read("true", "007") == BannerPolicy(enabled: true, delaySeconds: 7))
        for (flag, delay) in [("TRUE", "0"), ("1", "0"), ("", "0"), (nil, "0"), ("true", "-1"), ("true", "1.5"), ("true", " 5"),
                              ("true", "5 "), ("true", "121"), ("true", "99999999999999999999"), ("true", ""), ("true", nil),
                              ("true", "٣"), ("false", "1e2")] as [(String?, String?)] {
            #expect(read(flag, delay) == nil, "\(String(describing: flag))/\(String(describing: delay))")
        }
    }

    // MARK: Remote Config

    final class Logs {
        var lines: [String] = []
    }

    @Test func activatedValuesFirstThenTheFetch() {
        let clock = VirtualClock()
        let source = FakeRemoteConfig()
        source.activated = ["tw_banner_enabled": "false", "tw_banner_delay_seconds": "0"]
        source.fetched = ["tw_banner_enabled": "true", "tw_banner_delay_seconds": "30"]
        source.held = ["fetch"]
        let logs = Logs()
        let config = RemoteBannerConfig(source: source, clock: clock, log: { logs.lines.append($0) })
        var changes: [(BannerPolicy, Bool)] = []
        config.onChange = { changes.append((config.policy, config.ready)) }
        config.load()
        #expect(source.calls == ["defaults", "settings 10 3600", "activated", "fetch"])
        #expect(config.policy == BannerPolicy(enabled: false, delaySeconds: 0) && !config.ready, "an offline start keeps the kill switch")
        source.answer("fetch", true)
        #expect(config.policy == BannerPolicy(enabled: true, delaySeconds: 30) && config.ready)
        #expect(logs.lines == ["remote_config applied"])
        #expect(changes.map(\.1) == [false, false, true])
    }

    @Test func aFailedFetchKeepsTheActivatedPolicy() {
        let source = FakeRemoteConfig()
        source.activated = ["tw_banner_enabled": "true", "tw_banner_delay_seconds": "15"]
        source.failing = ["fetch"]
        let logs = Logs()
        let config = RemoteBannerConfig(source: source, clock: VirtualClock(), log: { logs.lines.append($0) })
        config.load()
        #expect(config.policy == BannerPolicy(enabled: true, delaySeconds: 15) && config.ready)
        #expect(logs.lines == ["remote_config bridge_or_fetch_failed"])
    }

    @Test func anInvalidPairKeepsTheDefaults() {
        let source = FakeRemoteConfig()
        source.fetched = ["tw_banner_enabled": "false", "tw_banner_delay_seconds": "121"]
        let logs = Logs()
        let config = RemoteBannerConfig(source: source, clock: VirtualClock(), log: { logs.lines.append($0) })
        config.load()
        #expect(config.policy == .default && config.ready)
        #expect(logs.lines == ["remote_config invalid_values", "remote_config applied"],
                "the defaults are valid; the fetched pair is rejected whole")
        let rejected = RemoteBannerConfig(source: { let s = FakeRemoteConfig(); s.activated = ["tw_banner_enabled": "1"]; s.fetched = [:]; return s }(),
                                          clock: VirtualClock(), log: { logs.lines.append($0) })
        rejected.load()
        #expect(rejected.policy == .default)
        #expect(logs.lines.contains("remote_config invalid_values"))
    }

    @Test func twelveSecondsBoundThePolicyAndLaterAnswersAreIgnored() {
        let clock = VirtualClock()
        let source = FakeRemoteConfig()
        source.fetched = ["tw_banner_enabled": "false", "tw_banner_delay_seconds": "0"]
        source.held = ["fetch"]
        let logs = Logs()
        let config = RemoteBannerConfig(source: source, clock: clock, log: { logs.lines.append($0) })
        config.load()
        clock.advance(11_999)
        #expect(!config.ready)
        clock.advance(1)
        #expect(config.ready && config.policy == .default)
        source.answer("fetch", true)
        #expect(config.policy == .default, "an answer after the timeout is ignored")
        #expect(logs.lines == ["remote_config timeout"])
    }

    @Test func withoutFirebaseTheDefaultsApplyAtOnce() {
        let config = RemoteBannerConfig(source: nil, clock: VirtualClock())
        config.load()
        #expect(config.ready && config.policy == .default)
    }

    // MARK: TwAds

    @MainActor
    final class Ads {
        let clock = VirtualClock()
        let banner = FakeBanner()
        let source = FakeRemoteConfig()
        var tracked: [String] = []
        var shown: [Bool] = []
        private(set) var ads: TwAds!

        init(policy: [String: String]? = nil, holdFetch: Bool = false, sessionStart: Int64 = 0) {
            source.fetched = policy
            if holdFetch { source.held = ["fetch"] }
            let config = RemoteBannerConfig(source: source, clock: clock)
            ads = TwAds(adapter: banner, config: config, clock: clock, sessionStart: sessionStart,
                        track: { [unowned self] name, params in
                            let value = params["action"] ?? params["delay_seconds"]
                            switch value {
                            case .text(let text)?: self.tracked.append("\(name) \(text)")
                            case .number(let n)?: self.tracked.append("\(name) \(Int(n))")
                            case nil: self.tracked.append(name)
                            }
                        })
            ads.onShownChange = { [unowned self] in self.shown.append($0) }
        }
    }

    @Test func theBannerLoadsOnlyWhenTheAdsAreReadyAndShowsWhenLoaded() {
        let run = Ads()
        #expect(run.banner.creates == 0, "no request before UMP and the ATT answer")
        run.ads.onAdapterReady()
        #expect(run.banner.creates == 1 && !run.ads.shown)
        run.banner.load()
        #expect(run.ads.shown && run.shown == [true])
        #expect(run.tracked == ["ad_policy_exposure 0", "ad_lifecycle show"])
        run.ads.onAdapterReady()
        #expect(run.banner.creates == 1)
    }

    @Test func theDelayAndTheOneExposure() {
        let run = Ads(policy: ["tw_banner_enabled": "true", "tw_banner_delay_seconds": "30"])
        run.clock.advance(10_000)
        run.ads.onAdapterReady()
        run.banner.load()
        #expect(!run.ads.shown)
        #expect(run.tracked == ["ad_policy_exposure 30", "ad_lifecycle hide"])
        run.clock.advance(19_999)
        #expect(!run.ads.shown)
        run.clock.advance(1)
        #expect(run.ads.shown)
        run.ads.setShowAds(false)
        run.ads.setShowAds(true)
        #expect(run.tracked.filter { $0.hasPrefix("ad_policy_exposure") }.count == 1, "one exposure per app open")
        #expect(run.shown == [false, true, false, true])
    }

    @Test func theKillSwitchKeepsTheLoadedBannerHidden() {
        let run = Ads(policy: ["tw_banner_enabled": "false", "tw_banner_delay_seconds": "0"])
        run.ads.onAdapterReady()
        run.banner.load()
        #expect(!run.ads.shown && run.shown == [false])
        #expect(run.tracked == ["ad_lifecycle hide"], "no exposure while the kill switch is on")
    }

    @Test func theFirstShowWaitsForTheFinishedPolicy() {
        let run = Ads(policy: ["tw_banner_enabled": "true", "tw_banner_delay_seconds": "0"], holdFetch: true)
        run.ads.onAdapterReady()
        run.banner.load()
        #expect(!run.ads.shown)
        run.clock.advance(12_000)
        #expect(run.ads.shown, "after the 12 s bound the activated or default policy applies")
    }

    @Test func aPageHidesTheBanner() {
        let run = Ads()
        run.ads.setShowAds(false)
        run.ads.onAdapterReady()
        run.banner.load()
        #expect(!run.ads.shown)
        run.ads.setShowAds(true)
        #expect(run.ads.shown)
    }

    @Test func loadsAreFiveSecondsApartAndAWidthChangeLoadsANewBanner() {
        let run = Ads()
        run.ads.onAdapterReady()
        run.banner.load()
        #expect(run.ads.shown)
        run.clock.advance(2000)
        run.ads.refresh()
        #expect(!run.ads.shown && run.banner.destroys == 1, "the old banner is hidden and removed")
        #expect(run.banner.creates == 1, "the next load waits for the 5 s spacing")
        run.clock.advance(2999)
        #expect(run.banner.creates == 1)
        run.clock.advance(1)
        #expect(run.banner.creates == 2)
        run.banner.load()
        #expect(run.ads.shown)
    }

    @Test func refreshesDuringALoadRunAfterIt() {
        let run = Ads()
        run.ads.onAdapterReady()
        run.ads.refresh()
        #expect(run.banner.creates == 1, "the first load is still running")
        run.banner.load()
        #expect(run.banner.destroys == 1, "the waiting refresh runs once the load answered")
        run.clock.advance(5000)
        #expect(run.banner.creates == 2)
        run.banner.fail()
        #expect(!run.ads.shown, "a failed load leaves no banner")
    }

    @Test func aFailedLoadShowsNothing() {
        let run = Ads()
        run.ads.onAdapterReady()
        run.banner.fail()
        #expect(!run.ads.shown && run.shown.isEmpty)
        #expect(run.tracked.isEmpty)
    }
}
