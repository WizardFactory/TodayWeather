import FirebaseCore
import FirebaseMessaging
import Foundation
import os
import TWData
import TWStorage
import UIKit
import UserNotifications

/// The current FCM registration token, or nil when none is known.
protocol PushTokenProvider: Sendable {
    func currentToken() async -> String?
}

/// The token the Firebase Messaging SDK holds; nil when Firebase is not configured (no `GoogleService-Info.plist`)
/// or no token was fetched yet. A token that arrives later comes through `MessagingBridge`.
struct FirebaseTokenProvider: PushTokenProvider {
    func currentToken() async -> String? {
        await MainActor.run {
            FirebaseApp.app() == nil ? nil : Messaging.messaging().fcmToken
        }
    }
}

/// Push registration with the legacy server after the migration (IN-04, #2953): what the Cordova `Push` service does
/// on iOS, in the order of the Android app (AN-04, `PushSync`). `open()` runs once per opened process (the Cordova web
/// page's `Push.init`); `resume()` (every process start, also in the background) registers the tokens an earlier
/// process queued but did not finish; `receive(token:)` is the token callback. The process start and tokens reach
/// `PushSync` in the order they came: a token is queued when it arrives, and one stream and one task this service
/// owns run the registrations.
@MainActor
final class PushService: PushUnitsUpdating {
    private enum Event: Sendable {
        /// Register the queued tokens (a process start, or a token queued).
        case drain
        /// Post the list again after a unit change (IN-12).
        case units
    }

    let sync: PushSync
    private let tokenProvider: any PushTokenProvider
    private var opened = false
    private let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "push")
    private let events: AsyncStream<Event>.Continuation
    private let consumer: Task<Void, Never>

    /// `serverURL`: the legacy server; `deviceId`: the `CDVUUID` (`DeviceIdentity`); `state`: the app state's single
    /// writer (`AppStateHolder`); `queue`: the tokens waiting for registration.
    init(serverURL: String, deviceId: String, tokenProvider: any PushTokenProvider, state: any PushStateAccess,
         queue: PushTokenQueue, transport: (any PushTransport)? = nil, bundle: Bundle = .main) {
        self.tokenProvider = tokenProvider
        let appVersion = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let sync = PushSync(state: state, queue: queue,
                            transport: transport ?? HTTPPushTransport(baseURL: serverURL)) { state in
            PushRegistration.Context(deviceId: deviceId, language: CordovaLanguage.navigatorLanguage(),
                                     appVersion: appVersion, units: state.units, now: Date(), zone: .current)
        }
        self.sync = sync
        let (stream, continuation) = AsyncStream.makeStream(of: Event.self)
        events = continuation
        consumer = Task {
            for await event in stream {
                switch event {
                case .drain: await sync.drain()
                case .units: await sync.updateUnits()
                }
            }
        }
    }

    deinit {
        events.finish()
    }

    /// The service of this build: the server from `TWServerURL` (Info.plist, from the private `Private.xcconfig`),
    /// the Firebase token and the app's state holder. Nil without a server URL: the app then sends nothing.
    static func production(deviceId: String, state: any PushStateAccess, bundle: Bundle = .main) -> PushService? {
        guard let url = serverURL(bundle.object(forInfoDictionaryKey: "TWServerURL") as? String),
              let queue = try? PushTokenQueue.standard() else {
            return nil
        }
        return PushService(serverURL: url, deviceId: deviceId, tokenProvider: FirebaseTokenProvider(), state: state,
                           queue: queue, bundle: bundle)
    }

    /// The `TWServerURL` value when it is an http(s) URL with a host; nil for an empty or other value.
    static func serverURL(_ text: String?) -> String? {
        guard let text, let url = URL(string: text), url.scheme == "https" || url.scheme == "http",
              let host = url.host(), !host.isEmpty else {
            return nil
        }
        return text
    }

    /// The registration of an opened app; nil when this service already ran it (once per process).
    @discardableResult
    func open() -> Task<PushSync.Outcome?, Never>? {
        guard !opened else { return nil }
        opened = true
        let sync = sync, provider = tokenProvider, log = log
        return Task {
            let outcome = await sync.open { await provider.currentToken() }
            log.info("open registration: \(outcome?.requests.map(\.method).joined(separator: ",") ?? "no context", privacy: .public)")
            return outcome
        }
    }

    /// The process started: tokens an earlier process queued are registered.
    /// A unit changed on S08 (`Push.updateUnits()`, IN-12): the list is posted again after the registrations before it,
    /// with the state as saved by then.
    nonisolated func updateUnits(_ state: AppState) {
        events.yield(.units)
    }

    func resume() {
        events.yield(.drain)
    }

    /// A token FCM delivered (the Cordova token callback): queued at once, in order of arrival, then registered
    /// after the registrations before it (CODEX-IN04A-1). A token that cannot be queued (its file cannot be written)
    /// is not registered; the next open reads the current token from FCM.
    func receive(token: String) {
        if !sync.enqueue(token: token) { log.error("token not queued; the next open reads it from FCM") }
        events.yield(.drain)
    }
}

/// `navigator.language` of the Cordova app's WKWebView: the first preferred language of the device.
enum CordovaLanguage {
    static func navigatorLanguage(_ preferred: [String] = Locale.preferredLanguages) -> String {
        preferred.first ?? "en-US"
    }
}

/// Receives FCM tokens (`MessagingDelegate`) and hands them to `AppStartup`, which hands them to the push timeline
/// (`PushService.receive(token:)`) in order of arrival.
final class MessagingBridge: NSObject, MessagingDelegate {
    nonisolated func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken else { return }
        Task { @MainActor in AppStartup.shared.receive(token: fcmToken) }
    }

    /// With Firebase configured: receive tokens, and register for remote notifications when the user allowed
    /// notifications (as the Cordova build did after the permission; asking for it is IN-14), so FCM gets the APNs
    /// token it needs for its own.
    @MainActor
    func start(_ application: UIApplication) {
        guard FirebaseApp.app() != nil else { return }
        Messaging.messaging().delegate = self
        Task { @MainActor in
            let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
            if [.authorized, .provisional, .ephemeral].contains(status) {
                application.registerForRemoteNotifications()
            }
        }
    }
}
