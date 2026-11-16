import Foundation
import TWData
import TWDomain
import TWStorage

/// The device's location for the start page and the weather pages (IN-10): the system's authorization and the location
/// services switch, the prompt's answer and the fixes, kept in a `LocationRecord` as the app's CoreLocation access keeps
/// it (`checkLocationMode` at the start, the plugin's state change handler on every report).
@MainActor
final class LocationDouble: LocationAccess {
    var system: SystemAuthorization
    var servicesEnabled: Bool
    /// What the prompt leaves (While Using and Once are both `authorizedWhenInUse`).
    var answer: SystemAuthorization
    /// The positions handed out in turn; nil is a location error (or none within 60 s).
    var fixes: [Location?]
    private(set) var record = LocationRecord()
    private(set) var prompts = 0
    private(set) var positions = 0
    private(set) var serviceRequests = 0
    /// `locationOn` events (a change from not enabled to enabled).
    private(set) var locationOn = 0

    init(services: Bool = true, system: SystemAuthorization, answer: SystemAuthorization = .denied, fixes: [Location?] = []) {
        self.system = system
        servicesEnabled = services
        self.answer = answer
        self.fixes = fixes
        // The plugin's first report at its start, then `checkLocationMode`.
        record.authorizationReported(LocationPermission(system))
        record.check(servicesEnabled: services, status: LocationPermission(system))
    }

    var recorded: LocationPermission? { record.status }

    func status() -> LocationPermission { LocationPermission(system) }

    func request() async -> LocationPermission {
        prompts += 1
        await Task.yield()
        // iOS shows the prompt only while it has no answer; with location services off nothing changes.
        if system == .notDetermined && servicesEnabled { change(answer) }
        return LocationPermission(system)
    }

    func position() async -> Location? {
        positions += 1
        if holdPositions { await withCheckedContinuation { waiting.append($0) } }
        await Task.yield()
        return fixes.isEmpty ? nil : fixes.removeFirst()
    }

    /// Positions wait until `releasePositions` (a fix that comes after the saved place's weather).
    var holdPositions = false
    private var waiting: [CheckedContinuation<Void, Never>] = []

    func releasePositions() {
        holdPositions = false
        let released = waiting
        waiting = []
        for continuation in released { continuation.resume() }
    }

    func requestServices() { serviceRequests += 1 }

    /// The system changed the authorization (the user, Settings, an expired Allow Once, location services switched).
    func change(_ next: SystemAuthorization) {
        system = next
        if record.authorizationReported(LocationPermission(next)) { locationOn += 1 }
    }

    /// The app returned to the foreground (`checkLocationMode`).
    func resume() { record.check(servicesEnabled: servicesEnabled, status: LocationPermission(system)) }
}

/// The analytics events a flow reported.
@MainActor
final class EventLog {
    private(set) var events: [(String, [String: AnalyticsValue])] = []
    lazy var telemetry: WeatherTelemetry = { [weak self] name, params in self?.events.append((name, params)) }

    func outcomes(_ name: String, _ key: String) -> [String] {
        events.filter { $0.0 == name }.compactMap {
            if case .text(let text)? = $0.1[key] { return text }
            return nil
        }
    }
}
