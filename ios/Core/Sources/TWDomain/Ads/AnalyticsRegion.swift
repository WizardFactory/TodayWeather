import Foundation

/// Where usage analytics is on without a stored choice (AK, 2026-11-24; `specs/analytics-default-on.md`, the same rule
/// and list as the Android app): on by default outside the European Economic Area, the United Kingdom and Switzerland;
/// off until the user opts in there and wherever the region is unknown.
///
/// The region is the device's region setting (`Locale.current.region?.identifier`, iOS Settings > General > Language &
/// Region > Region), not the app's language, the SIM, the network or the location: it is known at every start without a
/// permission or a request, and the user sees and controls it.
public enum AnalyticsRegion {
    /// The 27 EU member states, Iceland, Liechtenstein and Norway (EEA), the United Kingdom and Switzerland, as ISO 3166-1
    /// alpha-2 codes (Greece is `GR`).
    public static let optInRegions: Set<String> = [
        "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU",
        "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
        "IS", "LI", "NO",
        "GB", "CH",
    ]

    /// Whether analytics collects without a stored choice in `region`. An unknown region asks first: none, an empty one,
    /// anything but two letters (the UN M.49 areas such as `150` Europe or `419` Latin America), and the ISO 3166-1 codes
    /// that name no country (user-assigned `AA`, `QM`–`QZ`, `XA`–`XZ`, `ZZ`; exceptionally reserved `AC`, `CP`, `DG`,
    /// `EA`, `EU`, `EZ`, `FX`, `IC`, `SU`, `TA`, `UK`, `UN`).
    public static func collectsByDefault(region: String?) -> Bool {
        guard let region, region.count == 2, region.unicodeScalars.allSatisfy({ $0.isASCII && $0.properties.isAlphabetic })
        else { return false }
        let code = region.uppercased()
        return !optInRegions.contains(code) && !namesNoCountry(code)
    }

    private static let reserved: Set<String> = ["AA", "ZZ", "AC", "CP", "DG", "EA", "EU", "EZ", "FX", "IC", "SU", "TA",
                                                "UK", "UN"]

    private static func namesNoCountry(_ code: String) -> Bool {
        if reserved.contains(code) { return true }
        let first = code.first, second = code.last ?? "A"
        return first == "X" || (first == "Q" && second >= "M")
    }
}
