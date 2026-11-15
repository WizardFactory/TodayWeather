import AppTrackingTransparency
import Foundation
import GoogleMobileAds
import TWDomain
import UIKit
import UserMessagingPlatform

/// UMP and the Google Mobile Ads SDK as the Cordova AdMob plugin (emi-indo-cordova-plugin-admob 3.0.4) calls them on
/// iOS (IN-15, #2964). Forms show over the top view controller of the app's window. The tracking status is only read
/// here: the app never asks for App Tracking Transparency itself, UMP's IDFA explainer does (#2945).
@MainActor
final class GoogleAdsPlatform: AdsPlatform {
    private let defaults: UserDefaults

    /// `defaults` is where UMP keeps the TCF values (the standard `UserDefaults`).
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var canRequestAds: Bool { ConsentInformation.shared.canRequestAds }

    var consentStatus: AdsConsentStatus {
        switch ConsentInformation.shared.consentStatus {
        case .required: .required
        case .notRequired: .notRequired
        case .obtained: .obtained
        default: .unknown
        }
    }

    func requestConsentUpdate(_ done: @escaping @MainActor (String?) -> Void) {
        let parameters = RequestParameters()
        // The plugin's default: not tagged as under the age of consent.
        parameters.isTaggedForUnderAgeOfConsent = false
        let once = Once(done)
        ConsentInformation.shared.requestConsentInfoUpdate(with: parameters) { error in
            let text = error.map { Self.describe($0) }
            Task { @MainActor in once.call(text) }
        }
    }

    func loadConsentForm(_ done: @escaping @MainActor ((any AdsConsentForm)?, String?) -> Void) {
        let once = Once<((any AdsConsentForm)?, String?)> { done($0.0, $0.1) }
        ConsentForm.load { form, error in
            let text = error.map { Self.describe($0) }
            let loaded = Loaded(form: form)
            Task { @MainActor in
                guard let form = loaded.form else { return once.call((nil, text ?? "no form")) }
                once.call((UmpForm(form: form), nil))
            }
        }
    }

    /// The loaded form handed to the main actor, where it is shown and used only (UMP answers on the main thread).
    private struct Loaded: @unchecked Sendable {
        let form: ConsentForm?
    }

    func startSdk(_ ready: @escaping @MainActor () -> Void) {
        let once = Once<Void> { ready() }
        MobileAds.shared.start { _ in
            Task { @MainActor in once.call(()) }
        }
    }

    var privacyOptionsRequired: Bool {
        ConsentInformation.shared.privacyOptionsRequirementStatus == .required
    }

    func presentPrivacyOptions(_ done: @escaping @MainActor (String?) -> Void) {
        let once = Once(done)
        ConsentForm.presentPrivacyOptionsForm(from: Self.topViewController()) { error in
            let text = error.map { Self.describe($0) }
            Task { @MainActor in once.call(text) }
        }
    }

    /// The tracking status (never a prompt) and the TCF values UMP stored, read as the Cordova build's injected rule
    /// reads them.
    func privacyState() -> (TrackingStatus, AdConsentRecord) {
        (TrackingStatus(raw: Int(ATTrackingManager.trackingAuthorizationStatus.rawValue)), AdConsentRecord.read(defaults))
    }

    /// The error's domain and code only: UMP's messages are not logged.
    nonisolated static func describe(_ error: any Error) -> String {
        let error = error as NSError
        return "\(error.domain) \(error.code)"
    }

    /// The view controller forms show over: the top presented one of the key window.
    static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? scenes.first?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    /// A UMP consent form; `present` answers once.
    private final class UmpForm: AdsConsentForm {
        let form: ConsentForm

        init(form: ConsentForm) {
            self.form = form
        }

        func present(_ done: @escaping @MainActor (String?) -> Void) {
            let once = Once(done)
            form.present(from: GoogleAdsPlatform.topViewController()) { error in
                let text = error.map { GoogleAdsPlatform.describe($0) }
                Task { @MainActor in once.call(text) }
            }
        }
    }
}

/// A callback that runs at most once, whatever the SDK does with its completion handlers.
@MainActor
final class Once<Value> {
    private var action: (@MainActor (Value) -> Void)?

    init(_ action: @escaping @MainActor (Value) -> Void) {
        self.action = action
    }

    func call(_ value: Value) {
        guard let action else { return }
        self.action = nil
        action(value)
    }
}
