import Foundation
import Testing
@testable import TodayWeather

struct WidgetVisitTests {
    @Test func fiveElapsedDaysRequireAnotherVisit() {
        let start = Date(timeIntervalSince1970: 1_785_000_000)
        let deadline = start.addingTimeInterval(120 * 3600)
        #expect(WidgetVisit.expiry(lastActive: nil, now: start) == nil)
        #expect(WidgetVisit.expiry(lastActive: start, now: start) == deadline)
        #expect(WidgetVisit.expiry(lastActive: start, now: deadline.addingTimeInterval(-1)) == deadline)
        #expect(WidgetVisit.expiry(lastActive: start, now: deadline) == nil)
        #expect(WidgetVisit.expiry(lastActive: start, now: deadline.addingTimeInterval(1)) == nil)
        #expect(WidgetVisit.expiry(lastActive: deadline, now: deadline) == deadline.addingTimeInterval(120 * 3600))
        #expect(WidgetVisit.expiry(lastActive: deadline, now: start) == nil)
    }
}
