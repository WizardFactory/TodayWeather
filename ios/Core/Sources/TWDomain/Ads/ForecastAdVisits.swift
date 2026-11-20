import Foundation

/// One instance belongs to the app's tab navigator. All scenes use the same installation record.
@MainActor
public final class ForecastAdVisits {
    private struct Day: Codable {
        let date: Int
        var hourly = false
        var daily = false
        var spent = false

        func hasSeen(_ tab: ShellTab) -> Bool {
            switch tab {
            case .forecast: hourly
            case .dailyforecast: daily
            default: false
            }
        }
    }

    private struct Presentation {
        let id: UUID
        let reservedDate: Int
        let navigate: () -> Void
        var shown = false
    }

    private let directory: URL
    private let localDay: () -> Int
    private let draw: () -> Double
    private var pending: Presentation?
    /// Fail closed in memory too if the date changed during presentation and storing the display failed.
    private var lastDisplayDay = 0

    public init(directory: URL, localDay: @escaping () -> Int = ForecastAdVisits.today,
                draw: @escaping () -> Double = { Double.random(in: 0..<1) }) {
        self.directory = directory
        self.localDay = localDay
        self.draw = draw
    }

    public nonisolated static func today() -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .autoupdatingCurrent
        let date = calendar.dateComponents([.year, .month, .day], from: Date())
        return (date.year ?? 0) * 10_000 + (date.month ?? 0) * 100 + (date.day ?? 0)
    }

    public var presenting: Bool { pending != nil }

    public var available: Bool {
        guard !presenting, let day = try? current() else { return false }
        return !day.spent && day.date > lastDisplayDay
    }

    public func markVisible(_ tab: ShellTab) {
        guard tab == .forecast || tab == .dailyforecast,
              var day = try? current(), !day.hasSeen(tab) else { return }
        if tab == .forecast { day.hourly = true } else { day.daily = true }
        try? save(day)
    }

    /// Called only on a foreground tab-bar tap with an SDK ad ready to show. Save before handing it to the SDK.
    public func reserve(from source: ShellTab, to destination: ShellTab, readPastChart: Bool,
                        navigate: @escaping () -> Void) -> UUID? {
        guard !presenting, readPastChart, source != destination, source == .forecast || source == .dailyforecast,
              var day = try? current(), day.hasSeen(destination), !day.spent, day.date > lastDisplayDay,
              draw() < 0.10 else { return nil }
        day.spent = true
        do { try save(day) } catch { return nil }
        let id = UUID()
        pending = Presentation(id: id, reservedDate: day.date, navigate: navigate)
        return id
    }

    public func displayed(_ id: UUID) {
        guard let active = pending, active.id == id else { return }
        pending?.shown = true
        let date = localDay()
        lastDisplayDay = max(lastDisplayDay, date)
        if date > active.reservedDate, var day = try? current(), !day.spent {
            day.spent = true
            try? save(day)
        }
    }

    public func finish(_ id: UUID, failedBeforeDisplay: Bool) {
        guard let active = pending, active.id == id else { return }
        pending = nil
        if failedBeforeDisplay, !active.shown, var day = try? current(), day.date == active.reservedDate {
            day.spent = false
            try? save(day)
        }
        active.navigate()
    }

    private var file: URL { directory.appendingPathComponent("forecast-ad-day.json") }

    private func current() throws -> Day? {
        let date = localDay()
        let data: Data
        do { data = try Data(contentsOf: file) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile { return Day(date: date) }
        let stored = try JSONDecoder().decode(Day.self, from: data)
        if date < stored.date { return nil }
        return date == stored.date ? stored : Day(date: date)
    }

    private func save(_ day: Day) throws {
        // A cache purge or a backup restore must not grant another impression or import another installation's cap.
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var folder = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try folder.setResourceValues(values)
        try JSONEncoder().encode(day).write(to: file, options: .atomic)
    }
}
