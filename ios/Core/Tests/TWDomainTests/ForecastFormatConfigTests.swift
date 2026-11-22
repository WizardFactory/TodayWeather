import Testing
import TWDomain

@MainActor
struct ForecastFormatConfigTests {
    @Test func newFormatsReportImpressionsAndFailuresOnlyAfterOptIn() {
        let sdk = FakeAnalyticsSdk()
        let analytics = UsageAnalytics(sdk: sdk, records: MemoryRecords(), trafficType: "development")
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
        #expect(!config.nativeEnabled && config.interstitialEnabled && config.policy == .default)
        #expect(changes == 1 && source.formatListeners == 1)
        source.publish(["tw_native_enabled": "true", "tw_interstitial_enabled": "false"])
        #expect(config.nativeEnabled && !config.interstitialEnabled && changes == 2)
    }

    @Test func aConsentFailureIsNotAnAdImpressionOrLoadError() {
        #expect(AnalyticsSchema.validate("ad_lifecycle", ["ad_format": .text("consent"), "action": .text("consent_failed")]) != nil)
        #expect(AnalyticsSchema.validate("ad_lifecycle", ["ad_format": .text("consent"), "action": .text("impression")]) == nil)
        #expect(AnalyticsSchema.validate("ad_load_error", ["ad_format": .text("consent"), "error_code": .number(1)]) == nil)
        #expect(AnalyticsSchema.validate("weather_load", ["outcome": .text("success"), "duration_ms": .number(12),
                                                         "ad_format": .text("consent")])?.map(\.0) == ["outcome", "duration_ms"])
    }
}
