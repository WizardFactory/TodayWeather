import Foundation

/// How this build was installed, read from the app bundle at launch (#3228, AK 2026-11-27), for `traffic_type`:
/// - `provisioned`: the bundle carries `embedded.mobileprovision`. Development, ad hoc and enterprise builds (a
///   locally signed Release build run from Xcode or installed by hand) do; Apple strips it from App Store and
///   TestFlight downloads, and simulator builds have none.
/// - `sandboxReceipt`: the App Store receipt is TestFlight's `sandboxReceipt`; App Store installs have `receipt`.
///
/// StoreKit 2's `AppTransaction` was tried first and gave no answer on a TestFlight install (2026-11-27), so it is
/// not used. Both reads are synchronous file-name checks and never block.
struct InstallSource: Equatable, Sendable {
    var provisioned: Bool
    var sandboxReceipt: Bool

    /// An App Store install: neither signal.
    static let store = InstallSource(provisioned: false, sandboxReceipt: false)

    /// Whether `url` is TestFlight's receipt.
    static func isSandboxReceipt(_ url: URL?) -> Bool {
        url?.lastPathComponent == "sandboxReceipt"
    }

    static func read(_ bundle: Bundle = .main) -> InstallSource {
        InstallSource(provisioned: bundle.url(forResource: "embedded", withExtension: "mobileprovision") != nil,
                      sandboxReceipt: isSandboxReceipt(receiptURL(bundle)))
    }

    /// `Bundle.appStoreReceiptURL`, deprecated from iOS 18 in favour of StoreKit 2 (`AppTransaction`), which could not
    /// tell TestFlight installs on 2026-11-27. AK lifted #3228's exclusion of it. Only the URL's last path component is
    /// read; the receipt itself is not opened. Kept in this one place so it can be replaced when Apple removes it.
    private static func receiptURL(_ bundle: Bundle) -> URL? {
        bundle.appStoreReceiptURL
    }
}
