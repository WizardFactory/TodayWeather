import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage

/// A place opened without saving it, by a search result or a `link.todayweather.ai` link (#3180, #3097, specs/deeplink.md
/// §6.2): shown and loaded as the last place of the list, never written to the saved places until its star adds it. One
/// such place is kept: it stays while the user moves to saved places and back, and goes when another replaces it or the
/// app starts again. Port of the Android `LinkPreviewTest`, with the cases of CODEX-3190-2 and -3.
@MainActor
struct UnsavedPlacesTests {
    static let current = Place(currentPosition: true, disable: false, name: "현재 위치", location: Location(lat: 37.38, long: 127.12))
    static let london = Place(currentPosition: false, disable: false, name: "런던", address: "영국 런던", location: Location(lat: 51.51, long: -0.13))
    static let seoul = Place(currentPosition: false, disable: false, name: "서울", address: "서울특별시 중구", country: "KR",
                             location: Location(lat: 37.567, long: 126.978))
    static let busan = Place(currentPosition: false, disable: false, name: "부산", address: "부산광역시 중구", country: "KR",
                             location: Location(lat: 35.179, long: 129.076))

    static func started(_ places: [Place] = [current, london], index: Int = 1) -> AppState {
        var s = AppState()
        s.places = places
        s.placeIndex = index
        s.cordovaExtras["startVersion"] = StartGate.closed
        return s
    }

    static func holder(_ state: AppState) -> AppStateHolder {
        let holder = AppStateHolder(store: MemoryStore())
        holder.load(state)
        return holder
    }

    @Test func anUnsavedPlaceIsShownSelectedButNeverSaved() throws {
        let holder = Self.holder(Self.started())
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        let shown = try #require(unsaved.state)
        #expect(shown.places == [Self.current, Self.london, Self.seoul])
        #expect(shown.placeIndex == 2)
        #expect(holder.state == Self.started(), "nothing saved")
        #expect(unsaved.isSelected(shown))
        #expect(unsaved.isUnsaved(2))
        #expect(!unsaved.isUnsaved(1))
    }

    /// Its own changes (a response's source, a photo) stay in memory; other changes are saved.
    @Test func itsOwnChangesStayInMemory() throws {
        let holder = Self.holder(Self.started())
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        unsaved.change { $0.places[2].source = "KMA" }
        #expect(unsaved.unsaved?.place.source == "KMA")
        #expect(holder.state == Self.started())
        unsaved.change { $0.places[0].photo = "a.jpg" }
        #expect(holder.state?.places[0].photo == "a.jpg")
        #expect(unsaved.state?.places.count == 3)
    }

    /// Moving to a saved place keeps it (a swipe back shows it again); the saved selection stays the one before it.
    @Test func movingToASavedPlaceKeepsIt() throws {
        let holder = Self.holder(Self.started())
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        unsaved.change { $0.placeIndex = 0 }
        #expect(holder.state?.placeIndex == 0)
        #expect(unsaved.unsaved == UnsavedPlaces.Unsaved(place: Self.seoul, selected: false))
        #expect(unsaved.state?.places == [Self.current, Self.london, Self.seoul])
        #expect(unsaved.state?.placeIndex == 0)
        #expect(!unsaved.isSelected(try #require(unsaved.state)))
        // What a screen draws from the observed values equals what the session reads.
        #expect(unsaved.state == UnsavedPlaces.overlay(try #require(holder.state), unsaved.unsaved))
        unsaved.change { $0.placeIndex = 2 }
        #expect(unsaved.unsaved?.selected == true)
        #expect(holder.state?.placeIndex == 0, "the saved selection stays the one before it")
    }

    @Test func anotherPlaceReplacesIt() {
        let holder = Self.holder(Self.started())
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        unsaved.change { $0.placeIndex = 1 }
        unsaved.show(Self.busan)
        #expect(unsaved.unsaved == UnsavedPlaces.Unsaved(place: Self.busan, selected: true))
        #expect(unsaved.state?.places == [Self.current, Self.london, Self.busan])
    }

    /// The star saves it where it stands, as the last saved place, and keeps it selected; a second tap saves nothing.
    @Test func theStarSavesItOnce() {
        let holder = Self.holder(Self.started())
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        #expect(unsaved.add() == 2)
        #expect(unsaved.add() == nil)
        #expect(holder.state?.places == [Self.current, Self.london, Self.seoul])
        #expect(holder.state?.placeIndex == 2)
        #expect(unsaved.unsaved == nil)
        #expect(unsaved.state == holder.state)
    }

    /// A star on a place another saved place lies within 0.01° of selects that place instead.
    @Test func theStarSelectsASavedPlaceNearby() {
        let near = Place(currentPosition: false, disable: false, name: "서울시청", address: "서울특별시 중구 태평로", location: Location(lat: 37.566, long: 126.977))
        let holder = Self.holder(Self.started([Self.current, Self.london, near], index: 0))
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        #expect(unsaved.add() == 2)
        #expect(holder.state?.places.count == 3)
    }

    /// The star is not shown on a saved place: a star tap then saves nothing.
    @Test func theStarOfASavedPlaceSavesNothing() {
        let holder = Self.holder(Self.started())
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        unsaved.change { $0.placeIndex = 1 }
        #expect(unsaved.add() == nil)
        #expect(holder.state == Self.started())
    }

    /// A change that adds or removes saved places is the saved list's own: the unsaved place stays after the list.
    @Test func savedListChangesKeepIt() {
        let holder = Self.holder(Self.started())
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        holder.change { $0 = PlaceList.add($0, Self.busan) ?? $0 }
        #expect(unsaved.state?.places == [Self.current, Self.london, Self.busan, Self.seoul])
        #expect(unsaved.state?.placeIndex == 3)
    }

    /// CODEX-3190-2: deleting the last enabled saved place leaves the saved selection past the end (Cordova's
    /// `removeCity`). With an unsaved place that index would name it, so it is the selected place: the star shows and saves.
    @Test func aSavedSelectionPastTheListSelectsTheUnsavedPlace() throws {
        var off = Self.current
        off.disable = true
        let holder = Self.holder(Self.started([off, Self.london], index: 1))
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        unsaved.change { $0.placeIndex = 1 }
        #expect(unsaved.unsaved?.selected == false)
        holder.change { $0 = PlaceList.remove($0, 1) }
        #expect(holder.state?.placeIndex == 1, "Cordova keeps the index")
        let shown = try #require(unsaved.state)
        #expect(shown.places == [off, Self.seoul])
        #expect(shown.placeIndex == 1)
        #expect(unsaved.isSelected(shown), "the header shows the star")
        #expect(unsaved.add() == 1, "the star saves it")
        #expect(holder.state?.places == [off, Self.seoul])
    }

    /// CODEX-3190-3: an index from outside (a widget link, a notification's `cityIndex`) counts saved places only.
    @Test func outsideIndexesCountSavedPlacesOnly() {
        let holder = Self.holder(Self.started())
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        #expect(unsaved.isSaved(1))
        #expect(!unsaved.isSaved(2), "the unsaved slot")
        #expect(!unsaved.isSaved(-1))
    }

    /// On S01 (no place saved yet) the unsaved place shows over the start page; the star saves it as the first place and
    /// closes S01; leaving it returns to S01.
    @Test func overTheStartPageTheStarClosesIt() throws {
        let holder = Self.holder(AppState())
        let unsaved = UnsavedPlaces(holder: holder)
        #expect(!unsaved.bypassesStart)
        unsaved.show(Self.seoul)
        #expect(unsaved.bypassesStart)
        #expect(unsaved.state?.places == [.currentPositionPlaceholder, Self.seoul])
        #expect(unsaved.add() == 1)
        let saved = try #require(holder.state)
        #expect(saved.places == [.currentPositionPlaceholder, Self.seoul])
        #expect(saved.placeIndex == 1)
        #expect(!StartGate.shows(saved.cordovaExtras["startVersion"]))
        #expect(!unsaved.bypassesStart)
        let other = Self.holder(AppState())
        let leaving = UnsavedPlaces(holder: other)
        leaving.show(Self.busan)
        leaving.clear()
        #expect(!leaving.bypassesStart)
        #expect(other.state == AppState())
    }

    /// CODEX-3190-2: while the unsaved place is selected, S02's deletes keep the saved place selected before it, so the
    /// next start opens that one (#3180). Deleting it falls back to the first enabled saved place, or to none.
    @Test func deletingInS02KeepsTheSavedPlaceToReturnTo() {
        let daegu = Place(currentPosition: false, disable: false, name: "대구", address: "대구광역시 중구", location: Location(lat: 35.871, long: 128.601))
        let holder = Self.holder(Self.started([Self.current, Self.london, Self.busan, daegu], index: 2))
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        let s02 = unsaved.savedAccess
        // London, before Busan, goes: Cordova's `removeCity` would leave index 2 on Daegu.
        s02.change { $0 = PlaceList.remove($0, 1) }
        #expect(holder.state?.places == [Self.current, Self.busan, daegu])
        #expect(holder.state?.placeIndex == 1, "the next start opens Busan")
        #expect(unsaved.isSelected(unsaved.state!))
        // Busan itself goes: the first enabled place.
        s02.change { $0 = PlaceList.remove($0, 1) }
        #expect(holder.state?.placeIndex == 0)
        // Without the unsaved place selected, S02 keeps Cordova's rules.
        unsaved.change { $0.placeIndex = 1 }
        #expect(holder.state?.placeIndex == 1)
        #expect(unsaved.unsaved?.selected == false)
    }

    /// CODEX-3190-2: turning off the current position, the only enabled saved place, while the unsaved place is shown
    /// selects the unsaved place and stores no selection, so the star saves it and a start has no disabled row selected.
    @Test func turningOffTheOnlyEnabledPlaceSelectsTheUnsavedOne() throws {
        let holder = Self.holder(Self.started([Self.current], index: 0))
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        unsaved.change { $0.placeIndex = 0 }
        #expect(unsaved.unsaved?.selected == false)
        unsaved.savedAccess.change { $0 = PlaceList.disableCurrent($0, true) }
        #expect(holder.state?.placeIndex == -1)
        let shown = try #require(unsaved.state)
        #expect(shown.placeIndex == 1, "the unsaved place is the one shown")
        #expect(unsaved.isSelected(shown))
        #expect(unsaved.add() == 1)
    }

    /// Moving onto the unsaved place keeps the saved selection on the saved place it came from, which a new start opens.
    @Test func swipingOntoItKeepsTheSavedPlaceItCameFrom() {
        let holder = Self.holder(Self.started([Self.current, Self.london, Self.busan], index: 2))
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        #expect(holder.state?.placeIndex == 2)
        unsaved.change { $0.placeIndex = 1 }
        unsaved.change { $0.placeIndex = 3 }
        #expect(unsaved.unsaved?.selected == true)
        #expect(holder.state?.placeIndex == 1)
    }

    /// CODEX-3190-2: without the place to return to, the saved selection is the first enabled row, never a disabled one
    /// that Cordova's `setFirstCityIndex` (row 0 or 1) would name.
    @Test func theFallbackIsTheFirstEnabledRow() {
        var off = Self.current
        off.disable = true
        var hidden = Self.london
        hidden.disable = true
        let daegu = Place(currentPosition: false, disable: false, name: "대구", address: "대구광역시 중구", location: Location(lat: 35.871, long: 128.601))
        let holder = Self.holder(Self.started([off, hidden, Self.busan, daegu], index: 2))
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        unsaved.savedAccess.change { $0 = PlaceList.remove($0, 2) }
        #expect(holder.state?.places == [off, hidden, daegu])
        #expect(holder.state?.placeIndex == 2, "Daegu, the first enabled row")
    }

    /// CODEX-3190-10: the place to return to is found by its coordinates too, not only its name and address.
    @Test func thePlaceToReturnToIsFoundByItsCoordinates() {
        let homeA = Place(currentPosition: false, disable: false, name: "Home", location: Location(lat: 10, long: 20))
        let homeB = Place(currentPosition: false, disable: false, name: "Home", location: Location(lat: 40, long: 20))
        let holder = Self.holder(Self.started([Self.current, Self.london, homeA, homeB], index: 3))
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        unsaved.savedAccess.change { $0 = PlaceList.remove($0, 1) }
        #expect(holder.state?.places == [Self.current, homeA, homeB])
        #expect(holder.state?.placeIndex == 2, "the Home at 40°")
    }

    /// CODEX-3190-13: an old saved place without coordinates gets them from a response later; it is still the place to
    /// return to (coordinates are compared only when both places have them).
    @Test func aPlaceWhoseCoordinatesArriveLaterIsStillTheOneToReturnTo() {
        let hoehyeon = Place(currentPosition: false, disable: false, name: "회현동", address: "대한민국 서울특별시 중구 회현동", country: "KR")
        let holder = Self.holder(Self.started([Self.current, Self.london, hoehyeon], index: 2))
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        holder.change { $0.places[2].location = Location(lat: 37.56, long: 126.98) }
        unsaved.savedAccess.change { $0 = PlaceList.remove($0, 1) }
        #expect(holder.state?.placeIndex == 1, "회현동")
    }

    /// CODEX-3190-14: an earlier saved place of the same name and address without coordinates does not stand in for the
    /// place to return to: S02's change keeps the very row selected before, wherever it moves.
    @Test func anEarlierPlaceOfTheSameNameDoesNotStandIn() {
        let oldHome = Place(currentPosition: false, disable: false, name: "회현동", address: "대한민국 서울특별시 중구 회현동", country: "KR")
        var newHome = oldHome
        newHome.location = Location(lat: 37.56, long: 126.98)
        let holder = Self.holder(Self.started([Self.current, oldHome, Self.london, newHome], index: 3))
        let unsaved = UnsavedPlaces(holder: holder)
        unsaved.show(Self.seoul)
        unsaved.savedAccess.change { $0 = PlaceList.remove($0, 2) }
        #expect(holder.state?.places == [Self.current, oldHome, newHome])
        #expect(holder.state?.placeIndex == 2, "the row selected before, not the earlier one of its name")
    }
}
