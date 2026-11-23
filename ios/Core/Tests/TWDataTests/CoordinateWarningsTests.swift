import Foundation
import Testing
@testable import TWData
import TWModel

struct CoordinateWarningsTests {
    @Test func keepsRequestedPointAndExpiresCoverage() throws {
        let payload = try JSONValue.parse(Data("""
        {
          "location":{"lat":41.3874,"lon":2.1686},
          "checkedAt":"2026-11-21T10:00:00.000Z",
          "sources":[{"issuer":"AEMET","state":"current","asOf":"2026-11-21T10:00:00.000Z","freshUntil":"2026-11-21T10:05:00.000Z"}],
          "warnings":[{"id":"wind","issuer":"AEMET","event":"Viento","effectiveAt":"2026-11-21T10:00:00.000Z","expiresAt":"2026-11-21T11:00:00.000Z"}]
        }
        """.utf8))
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let response = try #require(CoordinateWarnings.decode(payload, lat: 41.3874, lon: 2.1686, parser: parser))
        #expect(CoordinateWarnings.decode(payload, lat: 40.4168, lon: 2.1686, parser: parser) == nil)
        #expect(response.current(at: response.checkedAt).warnings.map(\.id) == ["wind"])
        let stale = response.current(at: response.checkedAt.addingTimeInterval(300))
        #expect(stale.sources.first?.state == .unavailable)
        #expect(stale.warnings.isEmpty)
    }
}
