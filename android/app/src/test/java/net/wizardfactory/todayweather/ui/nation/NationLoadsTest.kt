package net.wizardfactory.todayweather.ui.nation

import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.HttpStatusException
import net.wizardfactory.todayweather.core.data.NationSource
import net.wizardfactory.todayweather.core.storage.UnitSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The open pages' requests (#2892): a page loads when it opens, keeps its answer while open, drops it when it closes;
 * a failed answer leaves S10 and S11 without values and S12 without cards; the warning times are formatted in the app's
 * language and the device's time zone.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NationLoadsTest {
    private val project = File(System.getProperty("tw.projectDir")!!)
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val nationBody = File(inputs, "nation.json").readText()
    private val specialBody = File(inputs, "special.json").readText()
    private val requests = mutableListOf<String>()

    private fun TestScope.loads(nation: suspend () -> String = { nationBody }, special: suspend () -> String = { specialBody },
                                units: UnitSettings? = UnitSettings.defaults("KR"), language: String = "ko-KR") =
        NationLoads(NationSource("https://server", HttpGet { url, _ -> requests += url; nation() }, HttpGet { url, _ -> requests += url; special() }),
            this, { units }, { listOf(language) }, { "Asia/Seoul" })

    @Test
    fun aPageLoadsWhenItOpensAndDropsItsAnswerWhenItCloses() = runTest {
        val loads = loads()
        loads.open(NationRoutes.NATION)
        assertEquals(NationPageState.Loading, loads.pages.value[NationRoutes.NATION])
        advanceUntilIdle()
        val page = loads.pages.value[NationRoutes.NATION] as NationPageState.Nation
        assertEquals(15, page.response!!.weather.size)
        loads.close(NationRoutes.NATION)
        assertNull(loads.pages.value[NationRoutes.NATION])
        assertEquals(1, requests.size)
    }

    @Test
    fun failedAnswersLeaveNoValuesAndNoCards() = runTest {
        val loads = loads(nation = { throw HttpStatusException(500) }, special = { throw HttpStatusException(500) })
        loads.open(NationRoutes.NATION_AIR)
        loads.open(NationRoutes.WARNINGS)
        advanceUntilIdle()
        assertEquals(NationPageState.Nation(null), loads.pages.value[NationRoutes.NATION_AIR])
        assertEquals(NationPageState.Warnings(emptyList()), loads.pages.value[NationRoutes.WARNINGS])
    }

    @Test
    fun warningTimesAreInTheAppsLanguage() = runTest {
        for ((language, heading) in listOf("ko-KR" to "기상특보 2026. 11. 8. 오전 12:00:00", "en-KR" to "기상특보 11/8/2026 12:00:00 AM")) {
            val loads = loads(language = language)
            loads.open(NationRoutes.WARNINGS)
            advanceUntilIdle()
            assertEquals(heading, (loads.pages.value[NationRoutes.WARNINGS] as NationPageState.Warnings).cards.first().heading)
        }
    }

    @Test
    fun aCommentWithAnEntityOutsideUnicodeShowsItsCard() = runTest {
        // Review F1: such an entity threw while the cards were built, out of the page's load.
        val loads = loads(special = { """[{"name": "기상정보", "announcement": "2026-11-07T07:20:00.000Z", "type": 3, "comment": "a &#1114112; b"}]""" })
        loads.open(NationRoutes.WARNINGS)
        advanceUntilIdle()
        assertEquals(listOf("a \uFFFD b"), (loads.pages.value[NationRoutes.WARNINGS] as NationPageState.Warnings).cards.single().comment)
    }

    @Test
    fun anAnswerAfterThePageClosedIsDropped() = runTest {
        val answer = CompletableDeferred<String>()
        val loads = loads(nation = { answer.await() })
        loads.open(NationRoutes.NATION)
        advanceUntilIdle()
        loads.close(NationRoutes.NATION)
        answer.complete(nationBody)
        advanceUntilIdle()
        assertTrue(loads.pages.value.isEmpty())
    }

    @Test
    fun ensureOpensOnlyAPageWithoutState() = runTest {
        val loads = loads()
        loads.open(NationRoutes.NATION)
        advanceUntilIdle()
        loads.ensure(NationRoutes.NATION)
        advanceUntilIdle()
        assertEquals("a page with an answer keeps it", 1, requests.size)
        loads.ensure(NationRoutes.WARNINGS)
        advanceUntilIdle()
        assertEquals("a page restored without one loads", 2, requests.size)
    }

    @Test
    fun withoutStoredUnitsNothingIsRequested() = runTest {
        val loads = loads(units = null)
        loads.open(NationRoutes.NATION)
        advanceUntilIdle()
        assertEquals(NationPageState.Nation(null), loads.pages.value[NationRoutes.NATION])
        assertTrue(requests.isEmpty())
    }
}
