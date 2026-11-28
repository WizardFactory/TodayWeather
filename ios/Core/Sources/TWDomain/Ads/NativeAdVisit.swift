/// A scroll anchor waits for a ready creative until one is shown in this visit, then keeps that decision.
public struct NativeAdVisit {
    public init() {}
    public private(set) var decision: Bool?

    public mutating func reached(hasCreative: Bool) -> Bool {
        if let decision { return decision }
        if hasCreative {
            decision = true
            return true
        }
        return false
    }
}
