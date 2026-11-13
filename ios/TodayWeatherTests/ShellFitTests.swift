import SwiftUI
import Testing
import TWDomain
import UIKit
@testable import TodayWeather

/// The shell keeps everything visible (IN-07, #2956): in iPad windows of every orientation and Split View or Stage
/// Manager size, on a small iPhone and in landscape, at the default text size and at `xxxLarge` (Dynamic Type), in the
/// six catalogs' longest labels. Checked on the views' accessibility elements as laid out in a window: every tab item
/// and menu row inside the window's width, the tab bar inside its height, tab items side by side, and each tab label
/// needing no more than the two lines it may take, in a button tall enough for it.
extension HostedShellTests {
@MainActor
struct ShellFitTests {
    static let sizes: [(String, CGSize)] = [
        ("iPad 13 portrait", CGSize(width: 1032, height: 1376)), ("iPad 13 landscape", CGSize(width: 1376, height: 1032)),
        ("Split View third", CGSize(width: 320, height: 1032)), ("Split View half", CGSize(width: 678, height: 1032)),
        ("Stage Manager small", CGSize(width: 500, height: 600)), ("iPhone SE", CGSize(width: 375, height: 667)),
        ("iPhone landscape", CGSize(width: 852, height: 393)),
    ]
    static let languages = [["ko-KR"], ["en-US"], ["de-DE"], ["ja-JP"], ["zh-Hans-CN"], ["zh-Hant-TW"]]

    @Test(arguments: [DynamicTypeSize.large, .xxxLarge])
    func nothingIsCutInAnyWindow(dynamicType: DynamicTypeSize) async throws {
        var checked = 0
        for (name, size) in Self.sizes {
            for languages in Self.languages {
                let shell = ShellFixture.shell(ShellFixture.state(theme: "dark"), languages: languages)
                let hosted = try HostedView(ShellView(model: shell), size: size, dynamicType: dynamicType)
                defer { hosted.close() }
                try await hosted.settle(200)
                let where_ = "\(name) \(languages[0]) \(dynamicType)"
                try checkTabs(hosted, shell, size, dynamicType, where_)
                shell.openMenu()
                // The menu slides in over 200 ms; wait until it is in place.
                for _ in 0..<20 {
                    try await hosted.settle(100)
                    if let back = hosted.element("shell-menu-back"), back.accessibilityFrame.minX >= 4.9 { break }
                }
                for row in shell.menuRows {
                    let element = try #require(hosted.element("shell-menu-\(row.rawValue)"), "\(where_) \(row)")
                    let frame = element.accessibilityFrame
                    #expect(frame.minX >= -0.5 && frame.maxX <= size.width + 0.5, "\(where_) menu row \(row) \(frame)")
                }
                let back = try #require(hosted.element("shell-menu-back"))
                #expect(back.accessibilityFrame.minX >= 0 && back.accessibilityFrame.minY >= 0, "\(where_) back button")
                checked += 1
            }
        }
        #expect(checked == Self.sizes.count * Self.languages.count)
    }

    /// One live shell whose window turns and resizes, as a rotation and a Split View or Stage Manager resize change an
    /// iPad window: portrait, landscape, a third, a half, a small window and back, with the menu open in the last size.
    /// iPadOS 26.5's windowing mode rejects a programmatic orientation change of the test host's scene
    /// (`UISceneErrorDomain` 101), so the window's frame changes instead; the shell lays out from its window's size and
    /// insets only.
    @Test func oneShellFollowsRotationAndResizing() async throws {
        let shell = ShellFixture.shell(ShellFixture.state(), languages: ["de-DE"])
        let sizes = [CGSize(width: 1032, height: 1376), CGSize(width: 1376, height: 1032), CGSize(width: 320, height: 1032),
                     CGSize(width: 678, height: 1032), CGSize(width: 500, height: 600), CGSize(width: 1032, height: 1376)]
        let hosted = try HostedView(ShellView(model: shell), size: sizes[0], dynamicType: .xxxLarge)
        defer { hosted.close() }
        for size in sizes {
            hosted.window.frame = CGRect(origin: .zero, size: size)
            try await hosted.settle(300)
            #expect(hosted.window.bounds.size == size)
            try checkTabs(hosted, shell, size, .xxxLarge, "resized to \(size)")
        }
        shell.openMenu()
        #expect(try await hosted.menuInPlace())
        hosted.window.frame = CGRect(origin: .zero, size: CGSize(width: 320, height: 1032))
        try await hosted.settle(300)
        for row in shell.menuRows {
            let frame = try #require(hosted.element("shell-menu-\(row.rawValue)")).accessibilityFrame
            #expect(frame.minX >= -0.5 && frame.maxX <= 320.5, "menu row \(row) \(frame) after the resize")
        }
    }

    private func checkTabs(_ hosted: HostedView, _ shell: ShellModel, _ size: CGSize, _ dynamicType: DynamicTypeSize,
                           _ where_: String) throws {
        let catalog = Catalog(code: shell.locale.catalog)
        let font = UIFont.systemFont(ofSize: UIFontMetrics(forTextStyle: .caption2)
            .scaledValue(for: ShellMetrics.tabLabel, compatibleWith: UITraitCollection(preferredContentSizeCategory: dynamicType.category)))
        var previous: CGRect?
        for tab in ShellTab.allCases {
            let element = try #require(hosted.element("shell-tab-\(tab.rawValue)"), "\(where_) tab \(tab)")
            let frame = element.accessibilityFrame
            #expect(frame.minX >= -0.5 && frame.maxX <= size.width + 0.5, "\(where_) tab \(tab) \(frame) in \(size)")
            #expect(frame.minY >= 0 && frame.maxY <= size.height + 0.5, "\(where_) tab \(tab) \(frame) in \(size)")
            if let previous { #expect(frame.minX >= previous.maxX - 0.5, "\(where_) tab \(tab) overlaps") }
            previous = frame
            // The label at the item's width (2 pt padding at each side): at most two lines, and room for them.
            let text = catalog(tab.textKey) as NSString
            let needed = text.boundingRect(with: CGSize(width: frame.width - 4, height: .greatestFiniteMagnitude),
                                           options: [.usesLineFragmentOrigin], attributes: [.font: font], context: nil)
            let lines = Int((needed.height / font.lineHeight).rounded())
            #expect(lines <= 2, "\(where_) tab \(tab) label '\(text)' needs \(lines) lines")
            #expect(frame.height + 0.5 >= ShellMetrics.tabGlyphLine + needed.height, "\(where_) tab \(tab) \(frame.height) < \(needed.height)")
        }
    }
}
}

extension DynamicTypeSize {
    var category: UIContentSizeCategory {
        switch self {
        case .xxxLarge: .extraExtraExtraLarge
        case .xxLarge: .extraExtraLarge
        case .xLarge: .extraLarge
        default: .large
        }
    }
}
