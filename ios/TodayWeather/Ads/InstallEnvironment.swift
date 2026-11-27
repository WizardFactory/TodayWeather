import Foundation
import StoreKit

/// Where this install came from (#3228), from StoreKit 2's `AppTransaction`: the App Store, TestFlight (`sandbox`) or
/// Xcode. Not the deprecated `appStoreReceiptURL`.
enum InstallEnvironment: Equatable, Sendable {
    case production, sandbox, xcode

    /// nil for a value StoreKit adds later.
    init?(_ environment: AppStore.Environment) {
        switch environment {
        case .production: self = .production
        case .sandbox: self = .sandbox
        case .xcode: self = .xcode
        default: return nil
        }
    }

    /// Whether `bundle` carries a provisioning profile: development, ad hoc and enterprise builds do (a locally signed
    /// Release build); App Store and TestFlight builds never do, and simulator builds have none.
    static func provisioned(_ bundle: Bundle = .main) -> Bool {
        bundle.url(forResource: "embedded", withExtension: "mobileprovision") != nil
    }

    /// The install's environment, or nil when StoreKit cannot tell (no app transaction, an error). An unverified
    /// transaction still names its environment, which is all a `traffic_type` tag needs; Xcode installs are not
    /// signed by the App Store, so they are always unverified.
    static func current() async -> InstallEnvironment? {
        do {
            switch try await AppTransaction.shared {
            case .verified(let transaction), .unverified(let transaction, _):
                return InstallEnvironment(transaction.environment)
            }
        } catch {
            return nil
        }
    }
}
