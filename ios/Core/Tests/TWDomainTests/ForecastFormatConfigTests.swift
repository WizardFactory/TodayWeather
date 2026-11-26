import Testing
import TWDomain

@MainActor
struct ForecastFormatConfigTests {
    @Test func newFormatsReportImpressionsAndFailuresOnlyAfterOptIn() {
        let sdk = FakeAnalyticsSdk()
        let analytics = UsageAnalytics(sdk: sdk, records: MemoryRecords(), trafficType: "development", region: "DE")
        analytics.start()
        for allowed in [false, true, false] {
            _ = analytics.setCollectionEnabled(allowed)
            let before = sdk.events.count
            for format in ["native", "interstitial"] {
                #expect(analytics.track("ad_lifecycle", ["ad_format": .text(format), "action": .text("impression")]) == allowed)
                #expect(analytics.track("ad_load_error", ["ad_format": .text(format), "error_code": .number(1)]) == allowed)
            }
            #expect(sdk.events.count == before + (allowed ? 4 : 0))
        }
    }

    @Test func bothFormatSwitchesAreRegisteredWithFirebase() {
        let source = FakeRemoteConfig()
        let config = RemoteBannerConfig(source: source, clock: VirtualClock())
        config.load()
        #expect(source.values()["tw_native_enabled"] == "true")
        #expect(source.values()["tw_interstitial_enabled"] == "true")
        #expect(source.values()["tw_app_banner_enabled"] == "false")
    }

    /// #3213: `tw_interstitial_chance` is an integer percentage from 0 to 100; a missing or invalid value uses 30.
    @Test func interstitialChanceParsesOnlyAnIntegerPercentFrom0To100() {
        let cases: [(String?, Int)] = [
            (nil, 30), ("", 30), ("0", 0), ("1", 1), ("30", 30), ("050", 50), ("100", 100), ("101", 30),
            ("-1", 30), ("+5", 30), ("30.0", 30), (" 40", 30), ("40 ", 30), ("abc", 30), ("true", 30),
            ("99999999999999999999", 30), ("٣٠", 30),
        ]
        for (value, expected) in cases {
            #expect(RemoteBannerConfig.interstitialChance(value) == expected, "value \(value ?? "nil")")
        }
    }

    @Test func interstitialChanceDefaultsTo30AndFollowsStoredFetchedAndPublishedValues() {
        let source = FakeRemoteConfig()
        let config = RemoteBannerConfig(source: source, clock: VirtualClock())
        #expect(config.interstitialChance == 30)
        config.load()
        #expect(source.values()["tw_interstitial_chance"] == "30")
        #expect(config.interstitialChance == 30)
        var changes = 0
        config.onChange = { changes += 1 }
        // CODEX-3: a chance-only update is read by the next draw and does not re-run ad eligibility.
        source.publish(["tw_interstitial_chance": "100"])
        #expect(config.interstitialChance == 100 && changes == 0)
        source.publish(["tw_interstitial_chance": "150"])
        #expect(config.interstitialChance == 30 && changes == 0)
        source.publish(["tw_interstitial_chance": "5", "tw_native_enabled": "false"])
        #expect(config.interstitialChance == 5 && !config.nativeEnabled && changes == 1)

        let stored = FakeRemoteConfig()
        stored.activated = ["tw_interstitial_chance": "0"]
        stored.fetched = ["tw_interstitial_chance": "75"]
        stored.held = ["fetch"]
        let other = RemoteBannerConfig(source: stored, clock: VirtualClock())
        other.load()
        #expect(other.interstitialChance == 0)
        stored.answer("fetch", true)
        #expect(other.interstitialChance == 75)
    }

    @Test func formatControlsApplyIndependentlyOfMalformedLegacyValues() {
        let source = FakeRemoteConfig()
        source.activated = ["tw_banner_enabled": "invalid", "tw_native_enabled": "false", "tw_interstitial_enabled": "true"]
        source.held = ["fetch"]
        source.fetched = ["tw_native_enabled": "true", "tw_interstitial_enabled": "invalid"]
        let config = RemoteBannerConfig(source: source, clock: VirtualClock())
        config.load()
        #expect(!config.ready && !config.nativeEnabled && config.interstitialEnabled)
        source.answer("fetch", true)
        #expect(config.ready && config.nativeEnabled && !config.interstitialEnabled)
    }

    @Test func failedFetchKeepsStoredFormatSwitches() {
        let source = FakeRemoteConfig()
        source.activated = ["tw_interstitial_enabled": "false", "tw_native_enabled": "false"]
        source.failing = ["fetch"]
        let config = RemoteBannerConfig(source: source, clock: VirtualClock())
        config.load()
        #expect(config.ready && !config.nativeEnabled && !config.interstitialEnabled)
    }

    @Test func aPublishedUpdateChangesOnlyTheAffectedFormatsInAnOpenApp() {
        let source = FakeRemoteConfig()
        let config = RemoteBannerConfig(source: source, clock: VirtualClock())
        config.load()
        config.load()
        #expect(source.formatListeners == 1)
        var changes = 0
        config.onChange = { changes += 1 }
        source.publish(["tw_native_enabled": "false"])
        #expect(config.ready && !config.nativeEnabled && config.interstitialEnabled)
        source.publish(["tw_native_enabled": "false"])
        source.publish(["tw_native_enabled": "true"], activationSucceeds: false)
        #expect(!config.nativeEnabled && changes == 1)
        source.publish(["tw_native_enabled": "true", "tw_interstitial_enabled": "false"])
        #expect(config.nativeEnabled && !config.interstitialEnabled && changes == 2)
    }

    @Test(arguments: ["activated", "fetch"])
    func lateStartupSuccessAppliesFormatSwitchesWithoutAnotherPublication(_ step: String) {
        let clock = VirtualClock()
        let source = FakeRemoteConfig()
        source.held = [step]
        let delayedValues = ["tw_native_enabled": "false", "tw_interstitial_enabled": "true",
                             "tw_banner_enabled": "false", "tw_banner_delay_seconds": "0"]
        if step == "activated" { source.activated = delayedValues } else { source.fetched = delayedValues }
        let config = RemoteBannerConfig(source: source, clock: clock)
        config.load()
        clock.advance(RemoteBannerConfig.timeoutMs)
        #expect(config.ready && config.nativeEnabled && config.interstitialEnabled && config.policy == .default)
        var changes = 0
        config.onChange = { changes += 1 }
        source.answer(step, true)
        // The all-ads gate applies late too (#3211); the delay stays fixed after the timeout.
        #expect(!config.nativeEnabled && config.interstitialEnabled && config.policy == BannerPolicy(enabled: false, delaySeconds: 0))
        #expect(changes == 1 && source.formatListeners == 1)
        source.publish(["tw_native_enabled": "true", "tw_interstitial_enabled": "false"])
        #expect(config.nativeEnabled && !config.interstitialEnabled && changes == 2)
    }

    /// CODEX-3211-1: a late or published `tw_banner_enabled` false turns every format off with its format switches.
    @Test func aLateOrPublishedAllAdsGateApplies() {
        let clock = VirtualClock()
        let source = FakeRemoteConfig()
        source.held = ["fetch"]
        source.fetched = ["tw_banner_enabled": "false", "tw_banner_delay_seconds": "30", "tw_app_banner_enabled": "true"]
        let config = RemoteBannerConfig(source: source, clock: clock)
        config.load()
        clock.advance(RemoteBannerConfig.timeoutMs)
        #expect(config.ready && config.policy == .default && !config.appBannerEnabled)
        source.answer("fetch", true)
        #expect(!config.policy.enabled && config.policy.delaySeconds == 0 && config.appBannerEnabled, "the delay stays fixed")
        source.publish(["tw_banner_enabled": "true", "tw_banner_delay_seconds": "0", "tw_app_banner_enabled": "true"])
        #expect(config.policy.enabled)
        source.publish(["tw_banner_enabled": "false", "tw_banner_delay_seconds": "0"])
        #expect(!config.policy.enabled && config.appBannerEnabled, "the gate turns off while the banner switch stays on")
        source.publish(["tw_banner_enabled": "TRUE", "tw_banner_delay_seconds": "0"])
        #expect(!config.policy.enabled, "an invalid pair keeps the gate")
    }

    @Test func aConsentFailureIsNotAnAdImpressionOrLoadError() {
        #expect(AnalyticsSchema.validate("ad_lifecycle", ["ad_format": .text("consent"), "action": .text("consent_failed")]) != nil)
        #expect(AnalyticsSchema.validate("ad_lifecycle", ["ad_format": .text("consent"), "action": .text("impression")]) == nil)
        #expect(AnalyticsSchema.validate("ad_load_error", ["ad_format": .text("consent"), "error_code": .number(1)]) == nil)
        #expect(AnalyticsSchema.validate("weather_load", ["outcome": .text("success"), "duration_ms": .number(12),
                                                         "ad_format": .text("consent")])?.map(\.0) == ["outcome", "duration_ms"])
    }
}
