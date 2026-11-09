package net.wizardfactory.todayweather.core.domain.start

import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Test

/**
 * The start page's rules (S01, #2889): the startup gate of app.js, `_makeFavoriteList`, StartCtrl's name of a chosen
 * prediction, and S02's town scan with the address it builds (controller.searchctrl.js), which S01 uses without a
 * Places key.
 */
class StartDomainTest {
    @Test
    fun theGateOpensWhileStartVersionIsMissingOrBelowOne() {
        // `startVersion === null || Util.startVersion > Number(startVersion)`.
        for (shows in listOf(null, JsonNull, JsonPrimitive(0.9), JsonPrimitive(0), JsonPrimitive("0"), JsonPrimitive(""), JsonPrimitive(false))) {
            assertTrue(StartGate.shows(shows), "$shows")
        }
        // Number("abc") is NaN, and 1 > NaN is false: Cordova skipped S01 too.
        for (passes in listOf(JsonPrimitive(1), JsonPrimitive(1.0), JsonPrimitive("1"), JsonPrimitive(" 1 "), JsonPrimitive(2), JsonPrimitive(true), JsonPrimitive("abc"))) {
            assertFalse(StartGate.shows(passes), "$passes")
        }
        assertEquals(JsonPrimitive(1), StartGate.CLOSED)
    }

    @Test
    fun theShortcutsGrowWithTheScreenHeight() {
        assertEquals(6, CityShortcuts.forScreenHeight(567.9).size)
        assertEquals(11, CityShortcuts.forScreenHeight(568.0).size)
        assertEquals(11, CityShortcuts.forScreenHeight(730.9).size)
        assertEquals(17, CityShortcuts.forScreenHeight(731.0).size)
        assertEquals(17, CityShortcuts.forScreenHeight(959.0).size)
        assertEquals(26, CityShortcuts.forScreenHeight(960.0).size)
        // Manual page 2 shows these 17.
        assertEquals(listOf("서울", "New York", "東京", "Berlin", "北京", "臺北市", "दिल्ली", "Hồ Chí Minh", "Москва", "Roma", "İstanbul", "香港", "São Paulo",
            "กรุงเทพมหานคร", "Madrid", "Warszawa", "كراچى"), CityShortcuts.forScreenHeight(914.0).map { it.name })
        assertEquals(CityShortcut("서울", "KR", "대한민국 서울특별시", 37.567, 126.978), CityShortcuts.forScreenHeight(0.0).first())
        val all = CityShortcuts.forScreenHeight(2000.0)
        // Data quirks copied verbatim.
        assertEquals(CityShortcut("New York", "US", "New York, NY, United States", 43.299, -74.218), all[1])
        assertEquals("CG", all.single { it.name == "Kinshasa" }.country)
        assertEquals("وهران‎, الجزائر", all.single { it.country == "DZ" }.address)
    }

    @Test
    fun aPredictionIsNamedByTheTermAtItsFirstMatch() {
        assertEquals("회현동", PredictionName.of("대한민국 서울특별시 중구 회현동", 14, "회현"))
        assertEquals("서울특별시", PredictionName.of("대한민국 서울특별시", 5, "서울"))
        assertEquals("Seoul", PredictionName.of("Seoul, South Korea", 0, "Seo"))
        assertEquals("Jung District", PredictionName.of("Hoehyeon-dong, Jung District, Seoul, South Korea", 15, "Jung"))
        // A match inside a term, or none, keeps the typed word.
        assertEquals("현동", PredictionName.of("대한민국 서울특별시 중구 회현동", 15, "현동"))
        assertEquals("현동", PredictionName.of("대한민국 서울특별시 중구 회현동", null, "현동"))
        assertEquals(listOf(0 to "Seoul", 7 to "South Korea"), PredictionName.terms("Seoul, South Korea"))
        assertEquals(listOf(0 to "대한민국", 5 to "서울특별시"), PredictionName.terms("대한민국 서울특별시"))
    }

    private val towns = listOf(
        Town("서울특별시", "중구", "회현동", 37.558, 126.978),
        Town("서울특별시", "중구", "명동", 37.563, 126.986),
        Town("세종특별자치시", "", "조치원읍", 36.6, 127.29),
        Town("경기도", "수원시장안구", "파장동", 37.3, 127.0),
        Town("경기도", "가평군", "", 37.83, 127.51),
    )

    @Test
    fun townsMatchASubstringOfAnyPartInFileOrder() {
        val search = TownSearch(towns)
        assertEquals(listOf("회현동", "명동"), search.search("중구").towns.map { it.third })
        assertEquals(listOf("파장동"), search.search("장안").towns.map { it.third })
        assertEquals(listOf("조치원읍"), search.search("세종").towns.map { it.third })
        // Case-sensitive substrings only: an inner space matches nothing.
        assertEquals(emptyList(), search.search("서울 중구").towns)
        assertEquals(-1, search.search("중구").next)
    }

    @Test
    fun townsComeTenAtATime() {
        val many = (1..25).map { Town("서울특별시", "중구", "동$it", 37.5, 127.0) } + Town("부산광역시", "중구", "남포동", 35.1, 129.0)
        val search = TownSearch(many)
        val first = search.search("동")
        assertEquals((1..10).map { "동$it" }, first.towns.map { it.third })
        assertEquals(10, first.next)
        val second = search.search("동", first.next)
        assertEquals((11..20).map { "동$it" }, second.towns.map { it.third })
        val third = search.search("동", second.next)
        assertEquals((21..25).map { "동$it" } + "남포동", third.towns.map { it.third })
        assertEquals(-1, third.next)
    }

    @Test
    fun aTownBuildsTheAddressAndNameOfSearchCtrl() {
        assertEquals(PlaceInfo("회현동", "대한민국 서울특별시 중구 회현동", "KR", 37.558, 126.978), towns[0].placeInfo())
        // No second part: the metropolitan city and its third.
        assertEquals(PlaceInfo("조치원읍", "대한민국 세종특별자치시 조치원읍", "KR", 36.6, 127.29), towns[2].placeInfo())
        // A 도's 구 under a 시 splits after the first 시.
        assertEquals(PlaceInfo("파장동", "대한민국 경기도 수원시 장안구 파장동", "KR", 37.3, 127.0), towns[3].placeInfo())
        // No third part: named by the second.
        assertEquals(PlaceInfo("가평군", "대한민국 경기도 가평군", "KR", 37.83, 127.51), towns[4].placeInfo())
        // A 도's 구 without a 시: `substr(0, 0)` adds an empty part, as Cordova did.
        assertEquals("대한민국 경기도  가상구 동", Town("경기도", "가상구", "동", 1.0, 2.0).placeInfo().address)
    }

    @Test
    fun thePermissionClassesOfClassifyLocationPermission() {
        assertEquals(PermissionClass.GRANTED, PermissionClass.of(PermissionStatus.GRANTED))
        assertEquals(PermissionClass.REQUESTABLE, PermissionClass.of(PermissionStatus.NOT_REQUESTED))
        assertEquals(PermissionClass.REQUESTABLE, PermissionClass.of(PermissionStatus.DENIED_ONCE))
        assertEquals(PermissionClass.DENIED, PermissionClass.of(PermissionStatus.DENIED_ALWAYS))
    }

    @Test
    fun theStartPageDecisionTable() {
        assertEquals(LocationStep.Locate, StartLocation.decide(enabled = true, PermissionStatus.GRANTED))
        assertEquals(LocationStep.Fail(LocationMessage.DENIED), StartLocation.decide(enabled = true, PermissionStatus.DENIED_ALWAYS))
        assertEquals(LocationStep.Ask(hideLoading = true), StartLocation.decide(enabled = true, PermissionStatus.NOT_REQUESTED))
        assertEquals(LocationStep.Ask(hideLoading = true), StartLocation.decide(enabled = true, PermissionStatus.DENIED_ONCE))
        assertEquals(LocationStep.Fail(LocationMessage.TURN_ON), StartLocation.decide(enabled = false, PermissionStatus.GRANTED))
        assertEquals(LocationStep.Fail(LocationMessage.DENIED), StartLocation.decide(enabled = false, PermissionStatus.DENIED_ALWAYS))
        // With location off the overlay stays up during the prompt.
        assertEquals(LocationStep.Ask(hideLoading = false), StartLocation.decide(enabled = false, PermissionStatus.DENIED_ONCE))
        // A grant runs again at once without a popup; anything else is the denial message.
        assertNull(StartLocation.afterPrompt(granted = true))
        assertEquals(LocationMessage.DENIED, StartLocation.afterPrompt(granted = false))
    }

    @Test
    fun theStartPageRetryVariants() {
        val denied = listOf("LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED")
        // 1. Denied always: the app-info hint and Settings to the app's page.
        assertEquals(RetryConfirm(denied + "LOC_OPENS_THE_APP_INFO_PAGE", listOf(RetryButton.CLOSE, RetryButton.APP_SETTINGS, RetryButton.RETRY)),
            StartLocation.retry(LocationMessage.DENIED, recorded = PermissionStatus.DENIED_ALWAYS, enabled = true))
        // 2. Nothing recorded (diagnostic 7.x has no DENIED, so `== DENIED` matches an unrecorded status).
        assertEquals(listOf(RetryButton.CLOSE, RetryButton.APP_SETTINGS, RetryButton.RETRY),
            StartLocation.retry(LocationMessage.NOT_FOUND, recorded = null, enabled = true).buttons)
        // 3. Location off: Settings to the device location settings, not positive.
        val off = StartLocation.retry(LocationMessage.TURN_ON, recorded = PermissionStatus.GRANTED, enabled = false)
        assertEquals(listOf("LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION"), off.lines)
        assertEquals(listOf(RetryButton.CLOSE, RetryButton.LOCATION_SETTINGS, RetryButton.RETRY), off.buttons)
        // 4. Otherwise Close and OK; a position failure adds the WiFi line on Android.
        assertEquals(RetryConfirm(listOf("LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION", "LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI"), listOf(RetryButton.CLOSE, RetryButton.RETRY)),
            StartLocation.retry(LocationMessage.NOT_FOUND, recorded = PermissionStatus.GRANTED, enabled = true))
        assertEquals(listOf("LOC_FAIL_TO_GET_LOCATION_INFORMATION"), StartLocation.retry(LocationMessage.NO_INFORMATION, PermissionStatus.GRANTED, true).lines)
        assertTrue(RetryButton.APP_SETTINGS.positive && RetryButton.RETRY.positive && !RetryButton.LOCATION_SETTINGS.positive && !RetryButton.CLOSE.positive)
    }

    @Test
    fun theTabLookupDecisions() {
        assertEquals(LocationStep.Locate, TabLocation.decide(enabled = true, PermissionStatus.GRANTED, hasSaved = true))
        assertEquals(LocationStep.Fail(LocationMessage.DENIED), TabLocation.decide(enabled = true, PermissionStatus.DENIED_ALWAYS, hasSaved = true))
        assertEquals(LocationStep.Ask(hideLoading = false), TabLocation.decide(enabled = true, PermissionStatus.NOT_REQUESTED, hasSaved = true))
        // Location off: the saved place as it is, or without one the high-accuracy dialog.
        assertEquals(LocationStep.UseSaved, TabLocation.decide(enabled = false, PermissionStatus.GRANTED, hasSaved = true))
        assertEquals(LocationStep.AskHighAccuracy, TabLocation.decide(enabled = false, PermissionStatus.DENIED_ALWAYS, hasSaved = false))
        // A prompt's denial asks to search or retry; a grant reloads with the resume.
        assertEquals(LocationMessage.PROMPT_DENIED, TabLocation.afterPrompt(granted = false))
        assertNull(TabLocation.afterPrompt(granted = true))
        assertEquals(LocationMessage.TURN_ON, TabLocation.afterHighAccuracy(turnedOn = false))
        assertNull(TabLocation.afterHighAccuracy(turnedOn = true))
    }

    @Test
    fun theTabRetryVariantsOfTheForecastType() {
        // 1. Denied always: the hint, Search and Settings; no retry.
        assertEquals(RetryConfirm(listOf("LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED", "LOC_OPENS_THE_APP_INFO_PAGE"), listOf(RetryButton.SEARCH, RetryButton.APP_SETTINGS)),
            TabLocation.retry(LocationMessage.DENIED, recorded = PermissionStatus.DENIED_ALWAYS, enabled = true))
        // 2. Nothing recorded: Search and OK, before the location-off check.
        assertEquals(listOf(RetryButton.SEARCH, RetryButton.RETRY), TabLocation.retry(LocationMessage.TURN_ON, recorded = null, enabled = false).buttons)
        // 3. Location off: Search, Settings to the location settings and OK.
        assertEquals(listOf(RetryButton.SEARCH, RetryButton.LOCATION_SETTINGS, RetryButton.RETRY),
            TabLocation.retry(LocationMessage.TURN_ON, recorded = PermissionStatus.GRANTED, enabled = false).buttons)
        // 4. Otherwise Close and OK.
        assertEquals(listOf(RetryButton.CLOSE, RetryButton.RETRY), TabLocation.retry(LocationMessage.PROMPT_DENIED, PermissionStatus.DENIED_ONCE, true).buttons)
        assertEquals(listOf("LOC_PERMISSION_REQUEST_DENIED_PLEASE_SEARCH_BY_LOCATION_NAME_OR_RETRY"),
            TabLocation.retry(LocationMessage.PROMPT_DENIED, PermissionStatus.DENIED_ONCE, true).lines)
    }
}
