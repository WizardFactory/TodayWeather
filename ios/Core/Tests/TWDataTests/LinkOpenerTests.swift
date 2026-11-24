import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage

/// A `link.todayweather.ai` link that arrived (cold or warm start, after the migration) applied as specs/deeplink.md §6.2
/// says: a saved place within 0.01° selected and loaded, another place shown unsaved and loaded, a page or the app as it
/// is, and on S01 only places (#3097). A place chosen in the search (#3180) opens the same way, the current position
/// included in the match. Port of the Android `LinkOpenerTest`.
@MainActor
struct LinkOpenerTests {
    static let london = Place(currentPosition: false, disable: false, name: "런던", address: "영국 런던", location: Location(lat: 51.507, long: -0.128))

    final class Calls { var log: [String] = [] }

    struct Setup {
        let holder: AppStateHolder
        let unsaved: UnsavedPlaces
        let opener: LinkOpener
        let calls: Calls
    }

    static func setup(_ state: AppState) -> Setup {
        let holder = AppStateHolder(store: MemoryStore())
        holder.load(state)
        let unsaved = UnsavedPlaces(holder: holder)
        let calls = Calls()
        let opener = LinkOpener(unsaved: unsaved, openPlace: { calls.log.append("open \($0)") }, reload: { calls.log.append("reload") })
        return Setup(holder: holder, unsaved: unsaved, opener: opener, calls: calls)
    }

    static func started(_ places: [Place] = [.currentPositionPlaceholder, london], index: Int = 1) -> AppState {
        var s = AppState(places: places, placeIndex: index)
        s.cordovaExtras["startVersion"] = StartGate.closed
        return s
    }

    @Test func aSavedPlaceNearbyIsSelectedAndLoaded() {
        let t = Self.setup(Self.started())
        let route = t.opener.open(.coordinate(lat: 51.51, lon: -0.13, name: nil, view: .daily, pollutant: nil))
        #expect(route == .weather(view: .daily, pollutant: nil, index: 1, unsaved: nil))
        #expect(t.calls.log == ["open 1"])
        #expect(t.unsaved.unsaved == nil)
    }

    @Test func anotherPlaceShowsUnsavedAndLoads() throws {
        let t = Self.setup(Self.started())
        let route = t.opener.open(.place(slug: "busan", view: .air, pollutant: "pm25"))
        let shown = try #require(t.unsaved.unsaved)
        #expect(shown.place.name == "부산" && shown.place.address == "부산광역시 중구" && shown.selected)
        #expect(route == .weather(view: .air, pollutant: "pm25", index: nil, unsaved: shown.place))
        #expect(t.calls.log == ["reload"])
        #expect(t.holder.state == Self.started(), "nothing saved")
        // A coordinate link without a name is titled by its coordinates; it replaces the unsaved place.
        _ = t.opener.open(.coordinate(lat: 0, lon: -0.5, name: nil, view: .hourly, pollutant: nil))
        #expect(t.unsaved.unsaved?.place.name == "0, -0.5")
        #expect(t.unsaved.unsaved?.place.location == Location(lat: 0, long: -0.5))
    }

    @Test func pagesAndTheAppChangeNoPlace() {
        let t = Self.setup(Self.started())
        #expect(t.opener.open(.nationWeather) == .page(.nationWeather))
        #expect(t.opener.open(.nationAir) == .page(.nationAir))
        #expect(t.opener.open(.warnings) == .page(.warnings))
        #expect(t.opener.open(.open(lang: "ko")) == .app)
        #expect(t.calls.log.isEmpty && t.unsaved.unsaved == nil)
    }

    /// An unknown catalog city and a widget link change nothing here.
    @Test func anUnknownCityChangesNothing() {
        let t = Self.setup(Self.started())
        #expect(t.opener.open(.place(slug: "atlantis", view: .hourly, pollutant: nil)) == nil)
        #expect(t.opener.open(.legacyWidget(placeID: "x")) == nil)
        #expect(t.calls.log.isEmpty && t.unsaved.unsaved == nil)
    }

    /// On S01 a place link shows the place unsaved over it, even when a saved place is near (none is selectable yet);
    /// pages and `/open` are ignored (§6.2.3).
    @Test func onTheStartPageOnlyPlacesOpen() {
        var start = AppState(places: [.currentPositionPlaceholder, Self.london], placeIndex: 1)
        start.cordovaExtras = JSONObject()
        let t = Self.setup(start)
        #expect(t.opener.open(.nationWeather) == nil)
        #expect(t.opener.open(.open(lang: nil)) == nil)
        let route = t.opener.open(.coordinate(lat: 51.507, lon: -0.128, name: "London", view: .hourly, pollutant: nil))
        #expect(route == .weather(view: .hourly, pollutant: nil, index: nil, unsaved: t.unsaved.unsaved?.place))
        #expect(t.unsaved.bypassesStart)
        #expect(t.calls.log == ["reload"])
    }

    /// #3180: a search result opens unsaved, or selects the saved place within 0.01° (the enabled current position
    /// included); the unsaved place stays then, and another result replaces it. The search loads it and chooses the tab.
    @Test func aSearchResultShowsUnsavedOrSelectsTheSavedPlaceNearby() {
        let here = Place(currentPosition: true, disable: false, name: "현재 위치", location: Location(lat: 37.38, long: 127.12))
        let t = Self.setup(Self.started([here, Self.london], index: 1))
        let busan = Place(currentPosition: false, disable: false, name: "부산광역시", address: "부산광역시", location: Location(lat: 35.18, long: 129.08))
        t.opener.show(busan)
        #expect(t.unsaved.unsaved?.place == busan)
        t.opener.show(Place(currentPosition: false, disable: false, name: "London", address: "London, UK", location: Location(lat: 51.51, long: -0.13)))
        #expect(t.holder.state?.placeIndex == 1)
        #expect(t.unsaved.unsaved?.place == busan && t.unsaved.unsaved?.selected == false, "the unsaved place stays")
        t.opener.show(Place(currentPosition: false, disable: false, name: "분당구", address: "경기도 성남시 분당구", location: Location(lat: 37.385, long: 127.12)))
        #expect(t.holder.state?.placeIndex == 0, "the current position within 0.01° opens")
        t.opener.show(Place(currentPosition: false, disable: false, name: "대구광역시", address: "대구광역시", location: Location(lat: 35.87, long: 128.6)))
        #expect(t.unsaved.unsaved?.place.name == "대구광역시" && t.unsaved.unsaved?.selected == true)
        #expect(t.holder.state?.places == [here, Self.london])
        #expect(t.calls.log.isEmpty)
    }
}
