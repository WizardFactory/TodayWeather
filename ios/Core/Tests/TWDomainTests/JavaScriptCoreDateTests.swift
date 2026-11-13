import Foundation
import Testing
import TWDomain
import TWModel

/// `new Date(string)` of JavaScriptCore beyond the corpus: what this JavaScriptCore printed with `toISOString()` for
/// each string (jsc of JavaScriptCore 21624.5.1.11.3, macOS 26.6.2, TZ=Asia/Seoul; ios/tools/corpus/differences.md,
/// "Date strings"). nil is an Invalid Date. V8 differs on the day, second-60 and 24:00 fraction rows.
struct JavaScriptCoreDateTests {
    @Test(arguments: [
        ("2026-11-07T23:59:60Z", "2026-11-08T00:00:00.000Z"),
        ("2026-11-07T23:59:60.500Z", "2026-11-08T00:00:00.000Z"),
        ("2026-11-07T10:00:60", "2026-11-07T01:01:00.000Z"),
        ("2026-11-07T24:00:00Z", "2026-11-08T00:00:00.000Z"),
        ("2026-11-07T24:00:60Z", nil),
        ("2026-11-07T24:00:00.001Z", "2026-11-08T00:00:00.001Z"),
        ("2026-11-07T23:60:00Z", nil),
        ("2026-11-07T23:59:61Z", nil),
        ("2026-12-31T23:59:60Z", "2027-01-01T00:00:00.000Z"),
        ("2028-02-29T00:00:00Z", "2028-02-29T00:00:00.000Z"),
        ("2100-02-29T00:00:00Z", nil),
        ("2000-02-29T00:00:00Z", "2000-02-29T00:00:00.000Z"),
        ("2026-04-30T00:00:00Z", "2026-04-30T00:00:00.000Z"),
        ("2026-04-31", nil),
        ("2026-02-29T10:00", nil),
        ("+002026-02-30T00:00:00Z", nil),
        ("2026-11-07T10:00:00+24:00", nil),
        ("2026-11-07T10:00:00+23:59", "2026-11-06T10:01:00.000Z"),
        ("2026-11-07T10:00:00.1234Z", "2026-11-07T10:00:00.123Z"),
    ] as [(String, String?)])
    func dateStrings(input: String, iso: String?) {
        let millis = Warnings.jsDate(.string(input), zone: TimeZone(identifier: "Asia/Seoul")!)
        #expect(millis.map(isoString) == iso, "\(input)")
    }

    /// A local time without an offset in a daylight-saving gap or overlap (CODEX-IN02-1), as ECMAScript's
    /// LocalTime→UTC rule gives and JavaScriptCore prints: a time in a gap uses the offset before the transition (it
    /// moves forward); a time in an overlap is the earlier instant. Recorded with
    /// `TZ=<zone> /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc dst.js -- <strings>`
    /// (`new Date(s).toISOString()`; JavaScriptCore 21624.5.1.11.3, macOS 26.6.2) on 2026-11-13.
    @Test(arguments: [
        // New York: spring gap 02:00–03:00 EST→EDT on 2026-03-08, fall overlap 01:00–02:00 on 2026-11-01.
        ("America/New_York", "2026-03-08T02:30:00", "2026-03-08T07:30:00.000Z"),
        ("America/New_York", "2026-03-08T02:00:00", "2026-03-08T07:00:00.000Z"),
        ("America/New_York", "2026-03-08T03:00:00", "2026-03-08T07:00:00.000Z"),
        ("America/New_York", "2026-03-08T02:30", "2026-03-08T07:30:00.000Z"),
        ("America/New_York", "2026-11-01T01:30:00", "2026-11-01T05:30:00.000Z"),
        ("America/New_York", "2026-11-01T01:00:00", "2026-11-01T05:00:00.000Z"),
        ("America/New_York", "2026-11-01T02:00:00", "2026-11-01T07:00:00.000Z"),
        // Paris: spring gap 02:00–03:00 CET→CEST on 2026-03-29, fall overlap 02:00–03:00 on 2026-10-25.
        ("Europe/Paris", "2026-03-29T02:30:00", "2026-03-29T01:30:00.000Z"),
        ("Europe/Paris", "2026-10-25T02:30:00", "2026-10-25T00:30:00.000Z"),
        ("Europe/Paris", "2026-10-25T02:00:00", "2026-10-25T00:00:00.000Z"),
        ("Europe/Paris", "2026-10-25T02:59:59", "2026-10-25T00:59:59.000Z"),
        ("Europe/Paris", "2026-10-25T03:00:00", "2026-10-25T02:00:00.000Z"),
        ("Europe/Paris", "2026-11-01T01:30:00", "2026-11-01T00:30:00.000Z"),
    ])
    func localTimesAroundDaylightSavingChanges(zone: String, input: String, iso: String) {
        let millis = Warnings.jsDate(.string(input), zone: TimeZone(identifier: zone)!)
        #expect(millis.map(isoString) == iso, "\(zone) \(input)")
    }

    private func isoString(_ millis: Int64) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: Date(timeIntervalSince1970: Double(millis) / 1000))
    }
}
