/// A scroll anchor makes exactly one placement decision, even if a later load or layout pass reaches it again.
public struct NativeAdVisit {
    public init() {}
    public private(set) var decision: Bool?

    public mutating func reached(hasCreative: Bool) -> Bool {
        if let decision { return decision }
        decision = hasCreative
        return hasCreative
    }
}
