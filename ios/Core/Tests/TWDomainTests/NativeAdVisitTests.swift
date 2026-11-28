import Testing
import TWDomain

struct NativeAdVisitTests {
    @Test func aLateCreativeFillsTheCurrentVisit() {
        var visit = NativeAdVisit()
        let first = visit.reached(hasCreative: false)
        let late = visit.reached(hasCreative: true)
        #expect(!first && late)
    }

    @Test func visibleCreativeSurvivesGeometryUpdates() {
        var visit = NativeAdVisit()
        let first = visit.reached(hasCreative: true)
        let later = visit.reached(hasCreative: false)
        #expect(first && later)
    }
}
