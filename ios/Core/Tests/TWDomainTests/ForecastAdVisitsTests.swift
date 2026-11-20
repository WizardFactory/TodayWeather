import Foundation
import Testing
@testable import TWDomain

@MainActor
struct ForecastAdVisitsTests {
    @MainActor private final class Fixture {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        var day = 20261120
        var roll = 0.0999
        var draws = 0
        var arrivals = 0

        func visits() -> ForecastAdVisits {
            ForecastAdVisits(directory: directory, localDay: { self.day }, draw: {
                self.draws += 1
                return self.roll
            })
        }

        func reserve(_ visits: ForecastAdVisits, from: ShellTab = .forecast, to: ShellTab = .dailyforecast,
                     read: Bool = true) -> UUID? {
            visits.reserve(from: from, to: to, readPastChart: read) { self.arrivals += 1 }
        }

        deinit { try? FileManager.default.removeItem(at: directory) }
    }

    @Test(arguments: [ShellTab.forecast, .dailyforecast])
    func protectsEachFirstVisitAndDrawsOnlyOnAnEligibleRepeat(first: ShellTab) throws {
        let f = Fixture()
        let visits = f.visits()
        let other: ShellTab = first == .forecast ? .dailyforecast : .forecast
        visits.markVisible(first)
        #expect(f.reserve(visits, from: first, to: other) == nil)
        visits.markVisible(other)
        #expect(f.reserve(visits, from: other, to: first, read: false) == nil)
        #expect(f.reserve(visits, from: first, to: first) == nil)
        #expect(f.reserve(visits, from: .search, to: first) == nil)
        #expect(f.reserve(visits, from: first, to: .air) == nil)
        #expect(f.draws == 0)
        f.roll = 0.10
        #expect(f.reserve(visits, from: other, to: first) == nil)
        f.roll = 0.0999
        let show = try #require(f.reserve(visits, from: other, to: first))
        #expect(f.reserve(visits, from: other, to: first) == nil)
        #expect(f.draws == 2)
        visits.displayed(show)
        visits.finish(show, failedBeforeDisplay: false)
        visits.finish(show, failedBeforeDisplay: true)
        #expect(f.arrivals == 1)
        #expect(!visits.available)
        #expect(!f.visits().available)
    }

    @Test func confirmedFailureReturnsAllowanceButCrashAndLateCallbackCannotReleaseAnotherAttempt() throws {
        let f = Fixture()
        let visits = f.visits()
        visits.markVisible(.dailyforecast)
        let first = try #require(f.reserve(visits))
        #expect(!f.visits().available)
        visits.finish(first, failedBeforeDisplay: true)
        let second = try #require(f.reserve(visits))
        visits.finish(first, failedBeforeDisplay: true)
        visits.displayed(second)
        visits.finish(second, failedBeforeDisplay: true)
        #expect(f.arrivals == 2)
        #expect(!f.visits().available)
    }

    @Test func midnightRollbackAndRelaunch() throws {
        let f = Fixture()
        let visits = f.visits()
        visits.markVisible(.dailyforecast)
        let show = try #require(f.reserve(visits))
        f.day += 1
        visits.displayed(show)
        visits.finish(show, failedBeforeDisplay: false)
        let relaunched = f.visits()
        #expect(!relaunched.available)
        f.day -= 1
        #expect(!relaunched.available)
        f.day += 2
        #expect(relaunched.available)
        #expect(f.reserve(relaunched) == nil)
        relaunched.markVisible(.dailyforecast)
        #expect(f.reserve(relaunched) != nil)
    }

    @Test func storageFailureNeverShowsOrReopensTheCap() throws {
        let f = Fixture()
        let visits = f.visits()
        visits.markVisible(.dailyforecast)
        let file = try #require(FileManager.default.contentsOfDirectory(at: f.directory,
            includingPropertiesForKeys: nil).first)
        try Data("incomplete".utf8).write(to: file)
        #expect(!visits.available)
        #expect(f.reserve(visits) == nil)
        let broken = Fixture()
        try Data().write(to: broken.directory)
        let missingStorage = broken.visits()
        missingStorage.markVisible(.dailyforecast)
        #expect(broken.reserve(missingStorage) == nil)
    }
}
