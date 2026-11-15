import Foundation

/// The App Tracking Transparency status as the Cordova iOS build reads it (#2945,
/// client/scripts/ios-ad-request-rule.h): the raw `ATTrackingManager.AuthorizationStatus` values 0 not determined,
/// 1 restricted, 2 denied, 3 authorized; any other value, or no reading, is `unavailable`, which counts as not
/// authorized.
public enum TrackingStatus: Equatable, Sendable {
    case notDetermined, restricted, denied, authorized, unavailable

    /// `tw_att_status_name`'s input: the raw status, nil when it could not be read (`TW_ATT_UNAVAILABLE`).
    public init(raw: Int?) {
        switch raw {
        case 0: self = .notDetermined
        case 1: self = .restricted
        case 2: self = .denied
        case 3: self = .authorized
        default: self = .unavailable
        }
    }

    /// `tw_att_status_name`: the name in the `request_policy` line and the `att_status` user property.
    public var name: String {
        switch self {
        case .notDetermined: "not_determined"
        case .restricted: "restricted"
        case .denied: "denied"
        case .authorized: "authorized"
        case .unavailable: "unavailable"
        }
    }
}

/// The TCF values UMP stores in the standard `UserDefaults`, read as the Cordova build's Objective-C reads them:
/// `(int)[prefs integerForKey:@"IABTCF_gdprApplies"]` and `[prefs stringForKey:@"IABTCF_PurposeConsents"]`.
public struct AdConsentRecord: Equatable, Sendable {
    /// `IABTCF_gdprApplies` as a C `int` (0 when absent).
    public var gdprApplies: Int32
    /// `IABTCF_PurposeConsents` (nil when absent).
    public var purposeConsents: String?

    public init(gdprApplies: Int32, purposeConsents: String?) {
        self.gdprApplies = gdprApplies
        self.purposeConsents = purposeConsents
    }

    public static let gdprAppliesKey = "IABTCF_gdprApplies"
    public static let purposeConsentsKey = "IABTCF_PurposeConsents"

    /// Reads the record from `defaults` (the standard `UserDefaults`, where UMP writes it). `integer(forKey:)` and
    /// `string(forKey:)` convert as `integerForKey:` and `stringForKey:` do (a string "1" is 1, a number becomes its
    /// text); the C `int` cast keeps the low 32 bits.
    public static func read(_ defaults: UserDefaults) -> AdConsentRecord {
        AdConsentRecord(gdprApplies: Int32(truncatingIfNeeded: defaults.integer(forKey: gdprAppliesKey)),
                        purposeConsents: defaults.string(forKey: purposeConsentsKey))
    }
}

/// The #2945 request rule of the Cordova iOS build (`tw_ad_request_personalized`): a banner request is personalized
/// only when ATT is authorized and GDPR does not apply or TCF purposes 1, 3 and 4 are consented. Every other request
/// carries `npa=1` with the publisher first-party ID off.
public enum AdRequestRule {
    /// `tw_consent_allows_personalization`. Ads are requested only after UMP has finished, so a `gdprApplies` other
    /// than 1 means UMP found no GDPR requirement. Where GDPR applies, the first four bytes of the UTF-8 text are
    /// checked as the C code reads them (a NUL ends the text): purposes 1, 3 and 4 must be `'1'`; purpose 2 is not
    /// checked but must be present.
    public static func consentAllowsPersonalization(_ consent: AdConsentRecord) -> Bool {
        if consent.gdprApplies != 1 { return true }
        guard let text = consent.purposeConsents else { return false }
        let bytes = Array(text.utf8.prefix { $0 != 0 })
        for index in 0..<4 {
            guard index < bytes.count else { return false }
            if index != 1 && bytes[index] != UInt8(ascii: "1") { return false }
        }
        return true
    }

    /// `tw_ad_request_personalized`: only with the user's ATT permission and the stored consent.
    public static func personalized(_ status: TrackingStatus, _ consent: AdConsentRecord) -> Bool {
        status == .authorized && consentAllowsPersonalization(consent)
    }

    /// The `npa` extra of a non-personalized request (`@{ @"npa" : @"1" }`).
    public static let nonPersonalizedExtras = ["npa": "1"]
}

/// The `request_policy` console line of the Cordova adapter (service.admobemi.js `reportRequestPolicy`), written
/// once when ads become ready: the status and the request mode the rule applies. A status outside the adapter's
/// list (`unavailable`) is reported as `not_reported` without the mode, as the adapter does.
public enum RequestPolicyLine {
    static let reported: Set<String> = ["authorized", "denied", "restricted", "not_determined"]

    /// The JSON text `JSON.stringify` writes, member order included.
    public static func line(status: TrackingStatus, personalized: Bool) -> String {
        if reported.contains(status.name) {
            return "{\"component\":\"admob\",\"operation\":\"request_policy\",\"att_status\":\"\(status.name)\","
                + "\"personalized\":\(personalized),\"result\":\"applied\"}"
        }
        return "{\"component\":\"admob\",\"operation\":\"request_policy\",\"att_status\":\"unavailable\","
            + "\"result\":\"not_reported\"}"
    }
}
