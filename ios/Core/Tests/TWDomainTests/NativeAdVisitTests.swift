import Testing
import TWDomain

struct NativeAdVisitTests {
    @Test func aLateCreativeWaitsForTheNextVisit() {
        var visit = NativeAdVisit()
        let first = visit.reached(hasCreative: false)
        let late = visit.reached(hasCreative: true)
        var next = NativeAdVisit()
        let secondVisit = next.reached(hasCreative: true)
        #expect(!first && !late && secondVisit)
    }

    @Test func visibleCreativeSurvivesGeometryUpdates() {
        var visit = NativeAdVisit()
        let first = visit.reached(hasCreative: true)
        let later = visit.reached(hasCreative: false)
        #expect(first && later)
    }
}
