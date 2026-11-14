import Foundation
import Testing
import TWDomain

/// The #2945 request rule and the consent order of the Cordova iOS build (IN-15, #2964): UMP shows the IDFA explainer
/// and the system prompt, the app never asks for tracking itself, and no banner is requested before UMP and the ATT
/// prompt have answered.
@MainActor
struct AdsConsentTests {
    // MARK: Request rule

    static let gdprNotApplying = AdConsentRecord(gdprApplies: 0, purposeConsents: nil)
    static let gdprWithPurposes = AdConsentRecord(gdprApplies: 1, purposeConsents: "1111111111")
    static let gdprWithoutPurposes = [
        AdConsentRecord(gdprApplies: 1, purposeConsents: "0111111111"), // purpose 1 missing
        AdConsentRecord(gdprApplies: 1, purposeConsents: "1101111111"), // purpose 3 missing
        AdConsentRecord(gdprApplies: 1, purposeConsents: "1110111111"), // purpose 4 missing
        AdConsentRecord(gdprApplies: 1, purposeConsents: nil),
        AdConsentRecord(gdprApplies: 1, purposeConsents: "111"),
    ]

    @Test func everyAttStatusAndGdprState() {
        let statuses: [(TrackingStatus, String)] = [
            (TrackingStatus(raw: 3), "authorized"), (TrackingStatus(raw: 2), "denied"),
            (TrackingStatus(raw: 1), "restricted"), (TrackingStatus(raw: 0), "not_determined"),
            (TrackingStatus(raw: 4), "unavailable"), (TrackingStatus(raw: -7), "unavailable"),
            (TrackingStatus(raw: nil), "unavailable"),
        ]
        for (status, name) in statuses {
            #expect(status.name == name)
            let authorized = status == .authorized
            #expect(AdRequestRule.personalized(status, Self.gdprNotApplying) == authorized, "\(name), GDPR does not apply")
            #expect(AdRequestRule.personalized(status, Self.gdprWithPurposes) == authorized, "\(name), purposes 1, 3, 4")
            for record in Self.gdprWithoutPurposes {
                #expect(!AdRequestRule.personalized(status, record), "\(name), \(String(describing: record.purposeConsents))")
            }
        }
        // Purpose 2 is not needed; GDPR values other than 1 mean UMP found no requirement.
        #expect(AdRequestRule.personalized(.authorized, AdConsentRecord(gdprApplies: 1, purposeConsents: "1011")))
        #expect(AdRequestRule.personalized(.authorized, AdConsentRecord(gdprApplies: 2, purposeConsents: "0000")))
        #expect(AdRequestRule.nonPersonalizedExtras == ["npa": "1"])
    }

    /// The TCF values are read as the Objective-C rule reads them (`integerForKey:`, `stringForKey:`, an `int` cast).
    @Test func consentRecordReadsAsTheObjectiveCRule() throws {
        let name = "tw-in15-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        #expect(AdConsentRecord.read(defaults) == AdConsentRecord(gdprApplies: 0, purposeConsents: nil))
        defaults.set("1", forKey: "IABTCF_gdprApplies")
        defaults.set("1111", forKey: "IABTCF_PurposeConsents")
        #expect(AdConsentRecord.read(defaults) == AdConsentRecord(gdprApplies: 1, purposeConsents: "1111"))
        defaults.set(1, forKey: "IABTCF_gdprApplies")
        defaults.set(1111, forKey: "IABTCF_PurposeConsents")
        #expect(AdConsentRecord.read(defaults) == AdConsentRecord(gdprApplies: 1, purposeConsents: "1111"))
        defaults.set(4_294_967_297, forKey: "IABTCF_gdprApplies")
        #expect(AdConsentRecord.read(defaults).gdprApplies == 1, "the C int keeps the low 32 bits")
    }

    @Test func requestPolicyLineForEachStatus() {
        #expect(RequestPolicyLine.line(status: .authorized, personalized: true) ==
                #"{"component":"admob","operation":"request_policy","att_status":"authorized","personalized":true,"result":"applied"}"#)
        #expect(RequestPolicyLine.line(status: .notDetermined, personalized: false) ==
                #"{"component":"admob","operation":"request_policy","att_status":"not_determined","personalized":false,"result":"applied"}"#)
        #expect(RequestPolicyLine.line(status: .unavailable, personalized: false) ==
                #"{"component":"admob","operation":"request_policy","att_status":"unavailable","result":"not_reported"}"#)
    }

    // MARK: Consent order

    /// One process: the consent flow over a device's UMP state, with what it reported.
    @MainActor
    final class Run {
        let clock = VirtualClock()
        let platform: FakeAdsPlatform
        let box = Box()
        let consent: AdsConsent

        @MainActor
        final class Box {
            var readies: [TrackingStatus] = []
            var tracked: [String] = []
            var logs: [String] = []
        }

        init(device: DeviceConsent = DeviceConsent(), release: Bool = true, configure: (FakeAdsPlatform) -> Void = { _ in }) {
            platform = FakeAdsPlatform(device: device)
            configure(platform)
            let box = box
            consent = AdsConsent(platform: platform, releaseAds: release, clock: clock,
                                 track: { name, params in
                                     guard case .text(let action)? = params["action"] else { return box.tracked.append(name) }
                                     box.tracked.append("\(name) \(action)")
                                 },
                                 log: { box.logs.append($0) },
                                 onReady: { box.readies.append($0) })
        }
    }

    /// Fresh install with the IDFA message published: UMP's form (the explainer, then the system prompt) shows first;
    /// the SDK starts only after it was answered, in the same session (#2871); then ads are ready, once.
    @Test func freshInstallReadyOnlyAfterTheExplainerAndThePrompt() {
        let run = Run { $0.statusAfterUpdate = .required }
        run.consent.start()
        #expect(run.platform.events == ["update", "updated required", "form load", "form shown"])
        #expect(run.platform.sdkStarts == 0 && run.box.readies.isEmpty, "nothing while the form is open")
        run.clock.advance(60_000)
        #expect(run.box.readies.isEmpty && run.platform.sdkStarts == 0)
        run.platform.answerForm(tracking: .authorized)
        #expect(run.box.readies.isEmpty, "the SDK has not started yet")
        run.clock.advance(999)
        #expect(run.platform.sdkStarts == 0)
        run.clock.advance(1)
        #expect(run.platform.sdkStarts == 1, "one more initialize a second later starts the SDK (#2871)")
        #expect(run.box.readies == [.authorized])
        #expect(run.box.logs.contains(#"{"component":"admob","operation":"request_policy","att_status":"authorized","personalized":true,"result":"applied"}"#))
        #expect(run.platform.device.systemPrompts == 1 && run.platform.device.formsShown == 1)
        run.clock.advance(10_000)
        #expect(run.box.readies.count == 1)
    }

    /// An upgraded install whose cached consent starts the SDK at once: still not ready while the new explainer shows.
    @Test func cachedConsentStartsTheSdkButWaitsForTheAnswer() {
        let device = DeviceConsent()
        device.status = .obtained
        device.canRequestAds = true
        let run = Run(device: device) { $0.statusAfterUpdate = .required }
        run.consent.start()
        #expect(run.platform.events.prefix(3) == ["sdk start", "sdk started", "update"])
        #expect(run.platform.openForm != nil)
        #expect(run.box.readies.isEmpty, "no banner request while the explainer or the prompt may be open")
        run.platform.answerForm(tracking: .denied)
        #expect(run.box.readies == [.denied])
        #expect(run.box.logs.contains(#"{"component":"admob","operation":"request_policy","att_status":"denied","personalized":false,"result":"applied"}"#))
        run.clock.advance(5000)
        #expect(run.platform.sdkStarts == 1)
    }

    /// The SDK may answer before UMP or after it; ready waits for both.
    @Test func readyNeedsBothTheSdkAndTheConsentAnswer() {
        let device = DeviceConsent()
        device.status = .obtained
        device.canRequestAds = true
        let run = Run(device: device) { $0.startsAtOnce = false; $0.answersAtOnce = false }
        run.consent.start()
        #expect(run.box.readies.isEmpty)
        run.platform.finishSdkStart()
        #expect(run.box.readies.isEmpty, "the SDK started, UMP has not answered")
        run.platform.answerUpdate()
        #expect(run.box.readies == [.notDetermined])

        let other = Run(device: { let d = DeviceConsent(); d.status = .notRequired; d.canRequestAds = true; return d }()) {
            $0.startsAtOnce = false
        }
        other.consent.start()
        #expect(other.box.readies.isEmpty, "UMP answered, the SDK has not started")
        other.platform.finishSdkStart()
        #expect(other.box.readies == [.notDetermined])
    }

    /// No second prompt after a relaunch: UMP offers its form only while consent is required, and the app never asks.
    @Test func noSecondPromptAfterARelaunch() {
        let device = DeviceConsent()
        let first = Run(device: device) { $0.statusAfterUpdate = .required }
        first.consent.start()
        first.platform.answerForm(tracking: .denied)
        first.clock.advance(1000)
        #expect(first.box.readies == [.denied])
        #expect(device.formsShown == 1 && device.systemPrompts == 1)

        let relaunch = Run(device: device)
        relaunch.consent.start()
        #expect(!relaunch.platform.events.contains("form shown"))
        #expect(device.formsShown == 1 && device.systemPrompts == 1)
        #expect(relaunch.box.readies == [.denied])
    }

    /// Without a published message UMP answers "not required": the SDK starts and ads are ready, not personalized.
    @Test func noMessageNoPrompt() {
        let run = Run { $0.statusAfterUpdate = .notRequired; $0.device.canRequestAds = true }
        run.consent.start()
        #expect(run.box.readies == [.notDetermined])
        #expect(run.platform.device.formsShown == 0)
        #expect(run.box.logs.contains { $0.contains(#""att_status":"not_determined","personalized":false"#) })
    }

    /// UMP fails in a release build: no ads, a `consent_failed` lifecycle event; ads from a cached consent continue.
    @Test func umpFailureInARelease() {
        let run = Run { $0.updateError = "no form(s) configured" }
        run.consent.start()
        run.clock.advance(10_000)
        #expect(run.platform.sdkStarts == 0 && run.box.readies.isEmpty)
        #expect(run.box.tracked == ["ad_lifecycle consent_failed"])

        let device = DeviceConsent()
        device.canRequestAds = true
        let cached = Run(device: device) { $0.updateError = "offline" }
        cached.consent.start()
        #expect(cached.box.readies == [.notDetermined], "an error is an answer too")
    }

    /// Builds with Google's test units start the SDK without UMP once, unless UMP's answer is a consent decision.
    @Test func umpFailureWithTestUnits() {
        let run = Run(release: false) { $0.updateError = "no form(s) configured" }
        run.consent.start()
        #expect(run.platform.sdkStarts == 1 && run.box.readies.count == 1)

        let decision = Run(release: false) { $0.statusAfterUpdate = .notRequired } // canRequestAds stays false
        decision.consent.start()
        #expect(decision.platform.sdkStarts == 0 && decision.box.readies.isEmpty, "consent is required: never bypassed")

        let unknown = Run(release: false) { $0.statusAfterUpdate = .unknown }
        unknown.consent.start()
        #expect(unknown.platform.sdkStarts == 0)
    }

    @Test func formFailures() {
        let load = Run { $0.statusAfterUpdate = .required; $0.formLoadError = "load failed" }
        load.consent.start()
        #expect(load.platform.sdkStarts == 0 && load.box.readies.isEmpty)
        #expect(load.box.tracked.count == 1)

        let shown = Run { $0.statusAfterUpdate = .required }
        shown.consent.start()
        shown.platform.answerForm(tracking: .notDetermined, error: "dismissed with error")
        shown.clock.advance(2000)
        #expect(shown.platform.sdkStarts == 0 && shown.box.readies.isEmpty)
    }

    @Test func startRunsOnce() {
        let run = Run { $0.statusAfterUpdate = .notRequired; $0.device.canRequestAds = true }
        run.consent.start()
        run.consent.start()
        #expect(run.platform.events.filter { $0 == "update" }.count == 1)
    }

    // MARK: Ad privacy choices

    @Test func privacyOptionsFormOrTheCannotOpenMessage() {
        let run = Run()
        var unavailable = 0
        run.consent.openPrivacyOptions { unavailable += 1 }
        #expect(unavailable == 1 && !run.platform.events.contains("privacy options"), "no form required")

        run.platform.privacyOptionsRequired = true
        run.consent.openPrivacyOptions { unavailable += 1 }
        #expect(unavailable == 1 && run.platform.events.contains("privacy options"))

        run.platform.privacyOptionsError = "cannot present"
        run.consent.openPrivacyOptions { unavailable += 1 }
        #expect(unavailable == 2)
    }

    /// The app's own code never asks for App Tracking Transparency: UMP does (#2945).
    @Test func appCodeNeverRequestsTracking() throws {
        let ios = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        var scanned = 0
        for folder in ["TodayWeather", "Core/Sources"] {
            let walker = try #require(FileManager.default.enumerator(at: ios.appendingPathComponent(folder),
                                                                    includingPropertiesForKeys: nil))
            for case let url as URL in walker where url.pathExtension == "swift" {
                let text = try String(contentsOf: url, encoding: .utf8)
                scanned += 1
                #expect(!text.contains("requestTrackingAuthorization"), "\(url.lastPathComponent)")
            }
        }
        #expect(scanned > 20)
    }
}
