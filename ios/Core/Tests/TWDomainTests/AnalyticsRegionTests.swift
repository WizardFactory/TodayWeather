import Foundation
import Testing
import TWDomain

/// The region rule of usage analytics (AK, 2026-11-24; `specs/analytics-default-on.md`): on by default outside the
/// European Economic Area, the United Kingdom and Switzerland; off until the user opts in there and wherever the region
/// is unknown. The list is the Android app's, written out here so a change on either side shows.
struct AnalyticsRegionTests {
    /// The 27 EU member states, Iceland, Liechtenstein, Norway (EEA), the United Kingdom and Switzerland.
    static let androidList: Set<String> = [
        "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU",
        "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
        "IS", "LI", "NO",
        "GB", "CH",
    ]

    /// ISO 3166-1 codes that name no country (user-assigned, exceptionally reserved): an unknown region.
    static let notCountries: Set<String> = Set(["AA", "ZZ", "AC", "CP", "DG", "EA", "EU", "EZ", "FX", "IC", "SU", "TA",
                                                "UK", "UN"])
        .union((UInt8(ascii: "M")...UInt8(ascii: "Z")).map { "Q" + String(UnicodeScalar($0)) })
        .union((UInt8(ascii: "A")...UInt8(ascii: "Z")).map { "X" + String(UnicodeScalar($0)) })

    @Test func theOptInRegionsAreTheAndroidList() {
        #expect(Self.androidList.count == 32)
        #expect(AnalyticsRegion.optInRegions == Self.androidList)
    }

    @Test func everyTwoLetterRegion() {
        let letters = (UInt8(ascii: "A")...UInt8(ascii: "Z")).map { String(UnicodeScalar($0)) }
        var on = 0
        for first in letters {
            for second in letters {
                let code = first + second
                let expected = !Self.androidList.contains(code) && !Self.notCountries.contains(code)
                #expect(AnalyticsRegion.collectsByDefault(region: code) == expected, "\(code)")
                #expect(AnalyticsRegion.collectsByDefault(region: code.lowercased()) == expected, "\(code) lower case")
                if expected { on += 1 }
            }
        }
        #expect(on == 676 - 32 - Self.notCountries.count)
    }

    @Test func theRegionsFoundationKnows() {
        for region in Locale.Region.isoRegions {
            let code = region.identifier
            let country = code.count == 2 && !Self.notCountries.contains(code)
            #expect(AnalyticsRegion.collectsByDefault(region: code) == (country && !Self.androidList.contains(code)), "\(code)")
        }
    }

    @Test func examples() {
        for code in ["KR", "US", "JP", "CN", "TW", "HK", "CA", "AU", "BR", "IN", "TR", "UA", "RS", "SM", "VA", "MC", "AD"] {
            #expect(AnalyticsRegion.collectsByDefault(region: code), "\(code)")
        }
        for code in ["DE", "FR", "GB", "CH", "NO", "IS", "LI", "IE", "GR"] {
            #expect(!AnalyticsRegion.collectsByDefault(region: code), "\(code)")
        }
    }

    @Test func anUnknownRegionIsOptIn() {
        for region: String? in [nil, "", " ", "K", "KOR", " KR", "KR ", "150", "419", "001", "ZZ", "EU", "UK", "XK", "한국", "K1"] {
            #expect(!AnalyticsRegion.collectsByDefault(region: region), "\(String(describing: region))")
        }
    }
}
