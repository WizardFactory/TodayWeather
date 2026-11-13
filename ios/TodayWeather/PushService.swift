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
/// on iOS. `open()` runs once per opened process (the Cordova web page's `Push.init`), `resume()` registers the
/// tokens FCM delivered while the app ran, also those an earlier process left (`PushTokenQueue`). Registrations run
/// one at a time in `PushSync`.
@MainActor
final class PushService {
    let sync: PushSync
    private let tokenProvider: any PushTokenProvider
    private var opened = false
    private let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "push")

    /// `serverURL`: the legacy server; `deviceId`: the `CDVUUID` (`DeviceIdentity`); `repostDelay`: the wait before the
    /// list post of an open (the Cordova 3-second timer).
    init(serverURL: String, deviceId: String, tokenProvider: any PushTokenProvider, store: AppStateStore,
         queue: PushTokenQueue, transport: (any PushTransport)? = nil, repostDelay: Duration = .seconds(3),
         bundle: Bundle = .main) {
        self.tokenProvider = tokenProvider
        let appVersion = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        sync = PushSync(store: store, queue: queue, transport: transport ?? HTTPPushTransport(baseURL: serverURL),
                        repostDelay: repostDelay) { state in
            PushRegistration.Context(deviceId: deviceId, language: CordovaLanguage.navigatorLanguage(),
                                     appVersion: appVersion, units: state.units, now: Date(), zone: .current)
        }
    }

    /// The service of this build: the server from `TWServerURL` (Info.plist, from the private `Private.xcconfig`)
    /// and the Firebase token. Nil without a server URL: the app then sends nothing.
    static func production(deviceId: String, bundle: Bundle = .main) -> PushService? {
        guard let url = serverURL(bundle.object(forInfoDictionaryKey: "TWServerURL") as? String),
              let store = try? AppStateStore.standard(),
              let queue = try? PushTokenQueue.standard() else {
            return nil
        }
        return PushService(serverURL: url, deviceId: deviceId, tokenProvider: FirebaseTokenProvider(), store: store,
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

    /// Registers the queued tokens.
    @discardableResult
    func resume() -> Task<[PushSync.Outcome], Never> {
        let sync = sync
        return Task { await sync.drain() }
    }
}

/// `navigator.language` of the Cordova app's WKWebView: the first preferred language of the device.
enum CordovaLanguage {
    static func navigatorLanguage(_ preferred: [String] = Locale.preferredLanguages) -> String {
        preferred.first ?? "en-US"
    }
}

/// Receives FCM tokens (`MessagingDelegate`) and hands them to `AppStartup`, which stores them in the token queue
/// before anything is sent.
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
