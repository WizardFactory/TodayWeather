import Foundation
import Testing
import TWDomain

/// The ads and analytics decisions against the outputs of the Cordova iOS code (IN-15): the #2945 C request rule
/// compiled and run, and service.monetization.js and service.admobemi.js run in JavaScriptCore, by
/// ios/tools/ads/generate.py (AdsReference/ads-golden.json).
@MainActor
struct AdsGoldenTests {
    struct Golden: Decodable {
        struct Source: Decodable { let path: String; let commit: String; let sha256: String }
        struct Rule: Decodable {
            let att: Int; let gdprApplies: Int32; let purposeConsents: String?; let attName: String; let personalized: Bool
        }
        struct Policy: Decodable { let enabled: Bool; let delaySeconds: Int }
        struct RemoteCase: Decodable { let values: [String: String]; let policy: Policy; let ready: Bool; let rejected: Bool }
        struct TrackCase: Decodable {
            let name: String; let params: [String: Value]; let release: Bool; let result: Bool; let sent: [String: Value]?
        }
        struct ScreenCase: Decodable { let calls: [String]; let sent: [[String: Value]] }
        struct Property: Decodable { let name: String; let value: String }
        struct StatusCase: Decodable { let before: [String]; let after: [String]; let set: [Property] }
        struct PolicyState: Decodable { let att_status: String; let personalized: Bool }
        struct PolicyCase: Decodable { let state: PolicyState?; let lines: [String]; let status: [String]; let ready: Int }

        let generator: String
        let sources: [Source]
        let requestRule: [Rule]
        let remoteConfig: [RemoteCase]
        let track: [TrackCase]
        let screens: [ScreenCase]
        let trackingStatus: [StatusCase]
        let requestPolicy: [PolicyCase]
    }

    /// A JSON value of a case: a string, a number, or `{"$number": "NaN"}` for numbers JSON cannot hold.
    enum Value: Decodable, Equatable {
        case text(String)
        case number(Double)

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let text = try? container.decode(String.self) { self = .text(text); return }
            if let number = try? container.decode(Double.self) { self = .number(number); return }
            let special = try container.decode([String: String].self)
            self = .number(Double(special["$number"] ?? "") ?? .nan)
        }

        init(_ parameter: AnalyticsParameter) {
            switch parameter {
            case .text(let text): self = .text(text)
            case .integer(let n): self = .number(Double(n))
            }
        }

        var analytics: AnalyticsValue {
            switch self {
            case .text(let text): .text(text)
            case .number(let number): .number(number)
            }
        }
    }

    static func golden() throws -> Golden {
        let url = try #require(Bundle.module.url(forResource: "ads-golden", withExtension: "json", subdirectory: "AdsReference"))
        return try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
    }

    @Test func goldenNamesItsSources() throws {
        let golden = try Self.golden()
        #expect(golden.sources.map(\.path) == ["client/scripts/ios-ad-request-rule.h", "client/www/js/service.monetization.js",
                                               "client/www/js/service.admobemi.js"])
        for source in golden.sources {
            #expect(source.commit.count == 40 && source.sha256.count == 64, "\(source.path)")
        }
    }

    /// Every ATT status (authorized, denied, restricted, not determined, unknown values) × every GDPR state and TCF
    /// purpose string of the cases: the Swift rule decides as the compiled C rule.
    @Test func requestRuleMatchesTheCompiledCRule() throws {
        let cases = try Self.golden().requestRule
        #expect(cases.count == 7 * 4 * 19)
        #expect(cases.contains { $0.personalized } && cases.contains { !$0.personalized })
        for c in cases {
            let status = TrackingStatus(raw: c.att == -1 ? nil : c.att)
            #expect(status.name == c.attName, "att \(c.att)")
            let record = AdConsentRecord(gdprApplies: c.gdprApplies, purposeConsents: c.purposeConsents)
            #expect(AdRequestRule.personalized(status, record) == c.personalized,
                    "att \(c.att) gdpr \(c.gdprApplies) purposes \(String(reflecting: c.purposeConsents))")
        }
    }

    /// The `request_policy` line the adapter writes for each answer of the native state action.
    @Test func requestPolicyLineMatchesTheAdapter() throws {
        let cases = try Self.golden().requestPolicy
        for c in cases {
            #expect(c.lines.count == 1 && c.ready == 1)
            guard let state = c.state else { continue }
            let status: TrackingStatus = switch state.att_status {
            case "authorized": .authorized
            case "denied": .denied
            case "restricted": .restricted
            case "not_determined": .notDetermined
            default: .unavailable
            }
            #expect(RequestPolicyLine.line(status: status, personalized: state.personalized) == c.lines.first,
                    "\(state.att_status) \(state.personalized)")
            #expect(c.status == [status.name])
        }
        // The native rule never fails to answer; an unanswered action reports as an unknown status does.
        let unanswered = try #require(cases.first { $0.state == nil })
        #expect(unanswered.lines.first == RequestPolicyLine.line(status: .unavailable, personalized: false))
    }

    /// `Monetization.loadConfig`'s validation: the pair applies whole or not at all.
    @Test func remoteConfigPairMatchesMonetization() throws {
        let cases = try Self.golden().remoteConfig
        #expect(cases.count == 23)
        for c in cases {
            let parsed = RemoteBannerPolicy.parse(c.values)
            #expect((parsed == nil) == c.rejected, "\(c.values)")
            let policy = parsed ?? .default
            #expect(policy == BannerPolicy(enabled: c.policy.enabled, delaySeconds: c.policy.delaySeconds), "\(c.values)")
        }
    }

    /// `Monetization.track` after an opt-in: the result and exactly the parameters sent, with the release or the
    /// test-unit traffic type.
    @Test func eventSchemaMatchesMonetization() throws {
        for c in try Self.golden().track {
            let sdk = FakeAnalyticsSdk()
            let analytics = UsageAnalytics(sdk: sdk, records: MemoryRecords(), trafficType: c.release ? "production" : "development")
            analytics.start()
            #expect(analytics.setCollectionEnabled(true))
            let result = analytics.track(c.name, c.params.mapValues(\.analytics))
            #expect(result == c.result, "\(c.name) \(c.params)")
            if let sent = c.sent {
                let event = try #require(sdk.events.last)
                #expect(event.name == c.name)
                #expect(event.params.map(\.0).sorted() == sent.keys.sorted(), "\(c.name)")
                for (key, value) in event.params {
                    #expect(sent[key] == Value(value), "\(c.name).\(key)")
                }
            } else {
                #expect(sdk.events.isEmpty, "\(c.name) \(c.params)")
            }
        }
    }

    @Test func screenViewsMatchMonetization() throws {
        for c in try Self.golden().screens {
            let sdk = FakeAnalyticsSdk()
            let analytics = UsageAnalytics(sdk: sdk, records: MemoryRecords(), trafficType: "production")
            analytics.start()
            analytics.setCollectionEnabled(true)
            c.calls.forEach(analytics.screen)
            #expect(sdk.events.count == c.sent.count)
            for (event, sent) in zip(sdk.events, c.sent) {
                #expect(event.name == "screen_view")
                #expect(Dictionary(uniqueKeysWithValues: event.params.map { ($0.0, Value($0.1)) }) == sent)
            }
        }
    }

    @Test func trackingStatusPropertyMatchesMonetization() throws {
        for c in try Self.golden().trackingStatus {
            let sdk = FakeAnalyticsSdk()
            let analytics = UsageAnalytics(sdk: sdk, records: MemoryRecords(), trafficType: "production")
            analytics.start()
            c.before.forEach(analytics.setAdTrackingStatus)
            analytics.setCollectionEnabled(true)
            c.after.forEach(analytics.setAdTrackingStatus)
            #expect(sdk.properties.map(\.0) == c.set.map(\.name))
            #expect(sdk.properties.map(\.1) == c.set.map(\.value))
        }
    }
}
