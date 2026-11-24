import Foundation

/// Where usage analytics is on without a stored choice (AK, 2026-11-24; `specs/analytics-default-on.md`, the rule and
/// lists of the Android app's `AnalyticsDefault`): on by default for a known device region outside the EEA, the United
/// Kingdom and Switzerland; off until the user opts in there and wherever the region is unknown.
///
/// The region is the device's region setting (`Locale.current.region?.identifier`, iOS Settings > General > Language &
/// Region > Region), not the app's language, the SIM, the network or the location: it is known at every start without a
/// permission or a request, and the user sees and controls it.
public enum AnalyticsRegion {
    /// Where usage analytics stays off until the user allows it: the 27 EU member states, the EU territories with their own
    /// ISO code (French Guiana, Guadeloupe, Martinique, Réunion, Mayotte, Saint-Martin, the Åland Islands), Iceland,
    /// Liechtenstein and Norway (EEA), the United Kingdom and Switzerland (39 codes; Greece is `GR`).
    public static let optInRegions: Set<String> = [
        "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT",
        "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
        "GF", "GP", "MQ", "RE", "YT", "MF", "AX",
        "IS", "LI", "NO",
        "GB", "CH",
    ]

    /// The officially assigned ISO 3166-1 alpha-2 codes (249). Any other region (empty, a UN M.49 number such as `150`, a
    /// reserved or user-assigned code such as `EU`, `UK`, `EL`, `XK` or `ZZ`) is unknown and keeps the opt-in.
    public static let assignedRegions: Set<String> = Set((
        "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA "
            + "CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR "
            + "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM "
            + "JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP "
            + "MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY "
            + "QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN "
            + "TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
    ).split(separator: " ").map(String.init))

    /// On by default: the region, trimmed, is two ASCII letters (any case) forming an assigned code outside
    /// `optInRegions`.
    public static func collectsByDefault(region: String?) -> Bool {
        guard let trimmed = region?.trimmingCharacters(in: .whitespacesAndNewlines), trimmed.unicodeScalars.count == 2,
              trimmed.unicodeScalars.allSatisfy({ ("A"..."Z").contains($0) || ("a"..."z").contains($0) })
        else { return false }
        let code = trimmed.uppercased()
        return assignedRegions.contains(code) && !optInRegions.contains(code)
    }
}
