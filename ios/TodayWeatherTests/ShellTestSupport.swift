import SwiftUI
import Testing
import TWDomain
import TWModel
import TWStorage
import UIKit
@testable import TodayWeather

/// A state store for tests: keeps the saves in memory (the shell's tests never touch the app's state file).
final class MemoryStore: AppStateSaving, @unchecked Sendable {
    private let lock = NSLock()
    private var saves: [AppState] = []
    var saved: [AppState] { lock.withLock { saves } }
    func save(_ state: AppState) throws { lock.withLock { saves.append(state) } }
}

@MainActor
enum ShellFixture {
    /// A migrated state with the place 회현동 selected, S01 closed, and the given settings.
    static func state(theme: String = "light", startupPage: String = "0", startVersion: JSONValue? = .number(1)) -> AppState {
        var extras = JSONObject()
        if let startVersion { extras["startVersion"] = startVersion }
        let place = Place(currentPosition: false, disable: false, name: "회현동", address: "대한민국 서울특별시 중구 회현동",
                          country: "KR", location: Location(lat: 37.56, long: 126.98))
        return AppState(places: [.currentPositionPlaceholder, place], placeIndex: 1,
                        settings: Settings(startupPage: startupPage, refreshInterval: "0", theme: theme), cordovaExtras: extras)
    }

    /// A shell over `state` for the system languages `languages`, with the Cordova build's version.
    static func shell(_ state: AppState = state(), languages: [String] = ["ko-KR"]) -> ShellModel {
        let holder = AppStateHolder(store: MemoryStore())
        holder.load(state)
        return ShellModel(holder: holder, locale: ShellLocale(preferredLanguages: languages), version: "1.1.2")
    }
}

/// The suites that put the shell in windows of the test host's scene run one after the other: one rotates the scene,
/// and the others measure frames and wait for animations, which a busy main actor would slow.
@Suite(.serialized) struct HostedShellTests {}

/// A SwiftUI view in a window of the app's scene, with its accessibility elements (what VoiceOver and a tap reach).
@MainActor
final class HostedView {
    let window: UIWindow
    let host: UIViewController

    /// SwiftUI builds its accessibility elements only while an assistive client asks for them; the test process turns
    /// on the automation mode that UI tests use (libAccessibility, test code only).
    static let accessibility: Bool = {
        guard let handle = dlopen("/usr/lib/libAccessibility.dylib", RTLD_NOW),
              let symbol = dlsym(handle, "_AXSSetAutomationEnabled") else { return false }
        typealias Enable = @convention(c) (Int32) -> Void
        unsafeBitCast(symbol, to: Enable.self)(1)
        return true
    }()

    init<V: View>(_ view: V, size: CGSize, dynamicType: DynamicTypeSize = .large) throws {
        #expect(Self.accessibility, "accessibility automation")
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        host = UIHostingController(rootView: view.environment(\.dynamicTypeSize, dynamicType))
        window.rootViewController = host
        window.isHidden = false
        host.view.layoutIfNeeded()
    }

    func close() { window.isHidden = true }

    /// Lets SwiftUI apply the latest state and lay out.
    func settle(_ ms: Int = 300) async throws {
        try await Task.sleep(for: .milliseconds(ms))
        host.view.setNeedsLayout()
        host.view.layoutIfNeeded()
    }

    /// Every accessibility element under the window.
    func elements() -> [NSObject] {
        var out: [NSObject] = []
        var queue: [NSObject] = [window]
        var seen = Set<ObjectIdentifier>()
        while let element = queue.popLast() {
            guard seen.insert(ObjectIdentifier(element)).inserted else { continue }
            out.append(element)
            if let view = element as? UIView { queue += view.subviews }
            if let children = element.accessibilityElements as? [NSObject] {
                queue += children
            } else {
                let count = element.accessibilityElementCount()
                if count != NSNotFound, count > 0 {
                    for i in 0..<count { if let child = element.accessibilityElement(at: i) as? NSObject { queue.append(child) } }
                }
            }
        }
        return out
    }

    /// The element's `accessibilityIdentifier` (SwiftUI's elements answer it without declaring
    /// `UIAccessibilityIdentification`).
    static func identifier(_ element: NSObject) -> String? {
        let selector = NSSelectorFromString("accessibilityIdentifier")
        guard element.responds(to: selector) else { return nil }
        return element.perform(selector)?.takeUnretainedValue() as? String
    }

    /// Waits until the side menu has slid in (its back button in place), up to 5 s.
    func menuInPlace() async throws -> Bool {
        for _ in 0..<50 {
            try await settle(100)
            if let back = element("shell-menu-back"), back.accessibilityFrame.minX >= 4.9 { return true }
        }
        return false
    }

    func element(_ identifier: String) -> NSObject? {
        elements().first { Self.identifier($0) == identifier }
    }

    /// Taps the element as VoiceOver's activation does (the button's action).
    func tap(_ identifier: String) throws {
        let all = elements()
        let ids = all.compactMap { Self.identifier($0) }.filter { !$0.isEmpty }
        // Not named `element`: inside `#require` the local would shadow `element(_:)` (Swift 6.3, Xcode 26.6).
        let target = try #require(element(identifier),
                                  "element \(identifier) among \(all.count): \(ids.prefix(20)) \(all.prefix(8).map { String(describing: type(of: $0)) })")
        #expect(target.accessibilityActivate(), "activate \(identifier)")
    }
}
