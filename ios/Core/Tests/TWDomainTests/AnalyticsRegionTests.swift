import Foundation
import Testing
import TWDomain

/// The region rule of usage analytics (AK, 2026-11-24; `specs/analytics-default-on.md`): on by default for a known region
/// outside the EEA, the United Kingdom and Switzerland; off until the user opts in there and wherever the region is
/// unknown. Both lists are the Android app's (`AnalyticsDefault`), written out here so a change on either side shows.
struct AnalyticsRegionTests {
    /// The 27 EU member states, the EU territories with their own ISO code, Iceland, Liechtenstein, Norway, the United
    /// Kingdom and Switzerland.
    static let androidOptIn: Set<String> = [
        "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU",
        "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
        "GF", "GP", "MQ", "RE", "YT", "MF", "AX",
        "IS", "LI", "NO",
        "GB", "CH",
    ]

    /// The 249 officially assigned ISO 3166-1 alpha-2 codes, as Android's `ASSIGNED_REGIONS`.
    static let androidAssigned: Set<String> = Set("""
        AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD
        CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE
        GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI
        KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX
        MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD
        SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ
        VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
        """.split(whereSeparator: { $0 == " " || $0 == "\n" }).map(String.init))

    @Test func theListsAreAndroids() {
        #expect(Self.androidOptIn.count == 39)
        #expect(AnalyticsRegion.optInRegions == Self.androidOptIn)
        #expect(Self.androidAssigned.count == 249)
        #expect(AnalyticsRegion.assignedRegions == Self.androidAssigned)
        #expect(Self.androidOptIn.isSubset(of: Self.androidAssigned))
    }

    /// Foundation knows every assigned code as a region (its list also holds areas and reserved codes, which stay unknown).
    @Test func foundationKnowsTheAssignedCodes() {
        let foundation = Set(Locale.Region.isoRegions.map(\.identifier))
        #expect(Self.androidAssigned.subtracting(foundation).isEmpty, "\(Self.androidAssigned.subtracting(foundation).sorted())")
        for code in foundation.subtracting(Self.androidAssigned) {
            #expect(!AnalyticsRegion.collectsByDefault(region: code), "\(code)")
        }
    }

    @Test func everyTwoLetterRegion() {
        let letters = (UInt8(ascii: "A")...UInt8(ascii: "Z")).map { String(UnicodeScalar($0)) }
        var on = 0
        for first in letters {
            for second in letters {
                let code = first + second
                let expected = Self.androidAssigned.contains(code) && !Self.androidOptIn.contains(code)
                #expect(AnalyticsRegion.collectsByDefault(region: code) == expected, "\(code)")
                #expect(AnalyticsRegion.collectsByDefault(region: code.lowercased()) == expected, "\(code) lower case")
                if expected { on += 1 }
            }
        }
        #expect(on == 249 - 39)
    }

    @Test func examples() {
        for code in ["KR", "US", "JP", "CN", "TW", "HK", "CA", "AU", "BR", "IN", "TR", "UA", "RS", "SM", "VA", "MC", "AD",
                     "GL", "FO", "SJ", "BL", "PM", "NC", "PF", "GG", "JE", "IM", "GI", " KR", "kr\n"] {
            #expect(AnalyticsRegion.collectsByDefault(region: code), "\(code)")
        }
        for code in ["DE", "FR", "GB", "CH", "NO", "IS", "LI", "IE", "GR", "RE", "GF", "AX", "MF"] {
            #expect(!AnalyticsRegion.collectsByDefault(region: code), "\(code)")
        }
    }

    @Test func anUnknownRegionIsOptIn() {
        for region: String? in [nil, "", " ", "K", "KOR", "150", "419", "001", "ZZ", "EU", "UK", "EL", "IC", "EA", "XK",
                                "XA", "AB", "NT", "한국", "K1", "K R"] {
            #expect(!AnalyticsRegion.collectsByDefault(region: region), "\(String(describing: region))")
        }
    }
}
