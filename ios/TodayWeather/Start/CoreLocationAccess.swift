import CoreLocation
import Foundation
import os
import TWData
import TWDomain
import TWStorage
import UIKit

/// The app's location (IN-10, #2959) with CoreLocation, as the Cordova iOS build had it through the diagnostic,
/// geolocation and location-accuracy plugins: when-in-use authorization only (`NSLocationWhenInUseUsageDescription`,
/// the purpose text of #2856), `Util.locationStatus` kept as app.js keeps it (`LocationRecord`: `checkLocationMode` at
/// the start and on each return to the foreground, the state change handler on every authorization report, `locationOn`
/// when location became enabled), positions as `watchPosition` gave them (`PositionFix`: best accuracy, the first fix
/// of at most 60 s age within 60 s; an approximate fix when the user allowed approximate location only).
///
/// Unlike the plugin, a request that cannot show the prompt (already answered, or location services off) answers at
/// once with the status, and a prompt that leaves the status unchanged answers when the app is active again, so an
/// attempt always settles (#2871).
@MainActor
final class CoreLocationAccess: NSObject, LocationAccess {
    private let manager = CLLocationManager()
    /// `locationAccuracy.request`'s own manager: started only to make iOS show its alert while location services are off.
    private let servicesManager = CLLocationManager()
    private let servicesDelegate = ServicesDelegate()
    private(set) var record = LocationRecord()
    /// `CLLocationManager.locationServicesEnabled()`, read off the main thread at each check.
    private(set) var servicesOn = true
    private var pendingRequest: CheckedContinuation<LocationPermission, Never>?
    private var positionStreams: [UUID: AsyncStream<PositionEvent>.Continuation] = [:]
    private var observers: [NSObjectProtocol] = []
    private let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "location")
    /// The system's authorization and the location services switch; tests pass doubles (the app has no test mode).
    private let systemStatus: (@MainActor () -> CLAuthorizationStatus)?
    private let servicesProbe: @Sendable () async -> Bool

    /// Location became enabled (`reloadEvent 'locationOn'`).
    var onLocationOn: () -> Void = {}

    init(systemStatus: (@MainActor () -> CLAuthorizationStatus)? = nil,
         servicesProbe: @escaping @Sendable () async -> Bool = {
             // `locationServicesEnabled()` may block: read off the main thread.
             await Task.detached { CLLocationManager.locationServicesEnabled() }.value
         }) {
        self.systemStatus = systemStatus
        self.servicesProbe = servicesProbe
        super.init()
        manager.delegate = self
        servicesManager.delegate = servicesDelegate
        let center = NotificationCenter.default
        // A prompt or the location services alert takes the app out of the active state; back in it, a request the
        // prompt left unanswered settles.
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.becameActive() }
        })
        check()
    }

    var recorded: LocationPermission? { record.status }
    var servicesEnabled: Bool { servicesOn }

    private var authorization: CLAuthorizationStatus { systemStatus?() ?? manager.authorizationStatus }

    func status() -> LocationPermission { LocationPermission(Self.system(authorization)) }

    /// `checkLocationMode`: the start and each return to the foreground.
    func check() {
        Task { [weak self] in await self?.checkNow() }
    }

    /// One `checkLocationMode`, finished when it returns. The status is read once the services answer is there, as the
    /// Cordova code reads it in that callback: the user may have answered the prompt meanwhile, and an older status
    /// would undo that report (the start page would then ask again and again; CODEX-IN10-1).
    func checkNow() async {
        let enabled = await servicesProbe()
        let status = status()
        servicesOn = enabled
        record.check(servicesEnabled: enabled, status: status)
        log.info("location check services=\(enabled, privacy: .public) status=\(status.rawValue, privacy: .public)")
    }

    func request() async -> LocationPermission {
        guard authorization == .notDetermined, servicesOn, pendingRequest == nil else {
            let now = status()
            reported(now)
            return now
        }
        return await withCheckedContinuation { continuation in
            pendingRequest = continuation
            manager.requestWhenInUseAuthorization()
        }
    }

    func position() async -> Location? {
        let id = UUID()
        let (stream, continuation) = AsyncStream<PositionEvent>.makeStream()
        positionStreams[id] = continuation
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        manager.startUpdatingLocation()
        let fix = await PositionFix.first(stream)
        positionStreams[id] = nil
        continuation.finish()
        if positionStreams.isEmpty { manager.stopUpdatingLocation() }
        log.info("location position \(fix == nil ? "none" : "found", privacy: .public)")
        return fix
    }

    func requestServices() {
        guard !servicesOn else { return }
        servicesManager.startUpdatingLocation()
    }

    /// The plugin's state change handler for a reported status; a change to enabled is `locationOn`. A pending request
    /// settles with any answer of the prompt.
    private func reported(_ status: LocationPermission) {
        if record.authorizationReported(status) {
            log.info("location on")
            onLocationOn()
        }
    }

    private func authorizationChanged() {
        let now = status()
        reported(now)
        if now != .notDetermined, let pending = pendingRequest {
            pendingRequest = nil
            pending.resume(returning: now)
        }
    }

    private func becameActive() {
        guard let pending = pendingRequest else { return }
        // The prompt has been answered by now, or was not shown: the status as it is.
        let now = status()
        reported(now)
        if now == .notDetermined {
            pendingRequest = nil
            pending.resume(returning: now)
        }
    }

    static func system(_ status: CLAuthorizationStatus) -> SystemAuthorization {
        switch status {
        case .notDetermined: .notDetermined
        case .restricted: .restricted
        case .denied: .denied
        case .authorizedAlways: .authorizedAlways
        case .authorizedWhenInUse: .authorizedWhenInUse
        @unknown default: .denied
        }
    }

    private func delivered(_ event: PositionEvent) {
        for continuation in positionStreams.values { continuation.yield(event) }
    }
}

extension CoreLocationAccess: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor [weak self] in self?.authorizationChanged() }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let events = locations.map {
            PositionEvent.fix(Location(lat: $0.coordinate.latitude, long: $0.coordinate.longitude), at: $0.timestamp)
        }
        Task { @MainActor [weak self] in
            for event in events { self?.delivered(event) }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        Task { @MainActor [weak self] in self?.delivered(.failed) }
    }
}

/// The app's location as `AppLaunch` holds it: the `LocationAccess` of the start page and the weather pages,
/// `checkLocationMode` on each return to the foreground, and the `locationOn` hook. Tests pass doubles.
@MainActor
protocol AppLocation: LocationAccess {
    var onLocationOn: () -> Void { get set }
    func check()
}

extension CoreLocationAccess: AppLocation {}

/// Stops `locationAccuracy.request`'s manager at its first answer, as the plugin did.
private final class ServicesDelegate: NSObject, CLLocationManagerDelegate {
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        manager.stopUpdatingLocation()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        manager.stopUpdatingLocation()
    }
}
