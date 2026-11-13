import Foundation

/// The SVG a Cordova chart directive builds, element by element in document (drawing) order, with the directive's
/// classes and attributes (port of Kotlin `chart/Svg.kt`). Numbers are CSS pixels (points); NaN stands for a
/// JavaScript NaN or undefined value, which the browser ignores.
public struct Svg: Sendable {
    public let width: Double
    public let height: Double
    public let children: [SvgNode]

    public init(width: Double, height: Double, children: [SvgNode]) {
        self.width = width
        self.height = height
        self.children = children
    }
}

public enum SvgNode: Sendable {
    case group(SvgGroup)
    case rect(SvgRect)
    case line(SvgLine)
    case image(SvgImage)
    case text(SvgText)
    case path(SvgPath)
    case circle(SvgCircle)
}

public struct SvgGroup: Sendable {
    public let cls: String
    public let children: [SvgNode]
}

public struct SvgRect: Sendable {
    public let cls: String
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
}

public struct SvgLine: Sendable {
    public let cls: String
    public let x1: Double
    public let y1: Double
    public let x2: Double
    public let y2: Double
}

/// `transform="rotate(angle, cx, cy)"`.
public struct Rotation: Sendable {
    public let angle: Double
    public let cx: Double
    public let cy: Double
}

public struct SvgImage: Sendable {
    public let cls: String?
    public let href: String
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
    public var rotation: Rotation? = nil
}

/// A `tspan` after the text: a class, or the daily chart's `font-size` attribute holding a class name.
public struct Tspan: Sendable {
    public let text: String
    public var cls: String? = nil
    public var fontSizeAttr: String? = nil
}

/// `text` with its baseline at `y + dy` (no `y` attribute: 0).
public struct SvgText: Sendable {
    public let cls: String
    public let x: Double
    public let y: Double?
    public let dy: Double?
    public let text: String
    public var tspan: Tspan? = nil
}

/// A linear `path`: `M x,y L x,y …`.
public struct SvgPath: Sendable {
    public let cls: String
    public let points: [(x: Double, y: Double)]
}

public struct SvgCircle: Sendable {
    public let cls: String
    public let cx: Double
    public let cy: Double
    public let r: Double
}
