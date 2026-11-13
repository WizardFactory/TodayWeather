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

    private func isoString(_ millis: Int64) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: Date(timeIntervalSince1970: Double(millis) / 1000))
    }
}
