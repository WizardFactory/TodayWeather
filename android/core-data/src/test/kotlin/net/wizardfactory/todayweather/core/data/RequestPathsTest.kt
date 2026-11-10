package net.wizardfactory.todayweather.core.data

import androidx.datastore.core.DataStoreFactory
import java.io.File
import java.nio.file.Files
import java.util.Collections
import java.util.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import net.wizardfactory.todayweather.core.storage.AppStateSerializer
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.PushRegistration
import net.wizardfactory.todayweather.core.storage.PushState
import net.wizardfactory.todayweather.core.storage.UnitSettings
import okhttp3.HttpUrl.Companion.toHttpUrl

/**
 * AC3 of #2897 (spec R8): every request the native client sends has a path the legacy server serves under `v000903`,
 * or is an exception the register lists with its decision (`server-routes/exceptions.json`).
 *
 * The production clients and transports send to recording servers, so the paths are the ones on the wire, encoded by
 * OkHttp. The inputs take every branch of the request builders: the Cordova corpus's weather cases (coordinates, the
 * KMA town route with one to three parts, the free-form fallback), geocoding by position and by address, the nation
 * and warning pages, and every push flow. Each path goes through the route table generated from `server/`
 * (`tools/server-routes/generate.mjs`; CI fails when it is stale) as Express dispatches it ([ServerRoutes]).
 * [RequestSitesTest] keeps these clients the only request sites.
 */
class RequestPathsTest {
    private val routes = ServerRoutes.load()
    private val register = Json.parseToJsonElement(File(javaClass.getResource("/server-routes/exceptions.json")!!.toURI()).readText())
        .jsonObject["exceptions"]!!.jsonArray.map { it.jsonObject }
    private val weatherCases = Json.parseToJsonElement(File(javaClass.getResource("/corpus/requests.json")!!.toURI()).readText())
        .jsonArray.map { it.jsonObject }
    private val languages = listOf("ko-KR", "en-US")

    /** Records each request and answers it at once with an empty JSON object. */
    private class Recorder : Dispatcher() {
        val requests: MutableList<RecordedRequest> = Collections.synchronizedList(mutableListOf())

        override fun dispatch(request: RecordedRequest): MockResponse {
            requests += request
            return MockResponse.Builder().code(200).body("{}").build()
        }
    }

    private data class Verdict(val method: String, val path: String, val match: ServerRoutes.Match?, val exception: String?) {
        val route: String get() = match?.let { "${it.route.method} ${it.pattern}" } ?: "(no route)"
    }

    @Test
    fun everyRequestIsAServedV000903RouteOrAListedException() = runBlocking {
        val legacy = Recorder()
        val photos = Recorder()
        MockWebServer().use { server ->
            MockWebServer().use { photoHost ->
                server.dispatcher = legacy
                photoHost.dispatcher = photos
                server.start()
                photoHost.start()
                sendEveryRequest(server.url("").toString().removeSuffix("/"), photoHost.url(FEED_PATH).toString())
            }
        }
        val sent = legacy.requests.map { it.target.substringBefore('?') }
        for (case in weatherCases) {
            val path = case.text("url")?.toHttpUrl()?.encodedPath ?: continue
            assertTrue(path in sent, "${case.text("name")}: $path was not sent")
        }
        val verdicts = legacy.requests.map { verdict(it.method, it.target.substringBefore('?')) }
        println(table(verdicts, photos.requests.size))

        assertEquals(EXPECTED, verdicts.map { it.route }.toSet(), "the routes the native client reaches")
        assertEquals(listOf("E1", "E2", "E3", "E4"), register.map { it.text("id") })
        assertEquals(listOf("E1", "E2"), register.filter { it.text("observedBy") == "RequestPathsTest" }.map { it.text("id") })
        assertEquals(setOf("E1"), verdicts.mapNotNull { it.exception }.toSet(), "the server's exceptions the client still sends")
        assertEquals(listOf("GET $FEED_PATH"), photos.requests.map { "${it.method} ${it.target}" }, "E2: the photo feed, at its own URL")
    }

    /** The dispatch follows Express where these paths need it (the server's behavior, read from its source). */
    @Test
    fun theDispatchFollowsExpress() {
        fun route(method: String, path: String) = routes.dispatch(method, path)?.let { "${it.route.method} ${it.pattern}" }
        // The versioned routers match any case; the gateway is case-sensitive, like CloudFront's path patterns.
        assertEquals("GET /v000903/kma/special", route("GET", "/V000903/KMA/special"))
        assertNull(route("GET", "/Weather/v000903/coord/37.5,127"))
        // The gateway answers its other paths and methods with its 404 route.
        assertEquals("ALL OWN_PATH", route("GET", "/weather/v000904/coord/37.5,127"))
        assertEquals("ALL OWN_PATH", route("POST", "/geocode/v000903/coord/37.5,127"))
        // A trailing slash is optional; a mount ends at a slash; a route takes the whole rest of the path.
        assertEquals("PUT /v000903/push", route("PUT", "/v000903/push/"))
        assertNull(route("PUT", "/v000903/pushes"))
        assertNull(route("GET", "/v000903/kma/addr/a/b/c/d"))
        // The method decides; HEAD reaches a GET route.
        assertNull(route("GET", "/v000903/push"))
        assertEquals("GET /v000903/kma/special", route("HEAD", "/v000903/kma/special"))
        // Middleware run in order: v000803's authorization check comes before its routes, a router's own after its mount.
        assertEquals(
            listOf("function checkAuthorization(req, res, next)", "function timestamp(req, res, next)"),
            routes.dispatch("GET", "/v000803/nation/KR")!!.passed.filter { "v000803" in it.file }.map { it.handler },
        )
        // The gateway comes before the session; its error handler (four parameters) does not run without an error.
        assertEquals(listOf("cors(…)"), routes.dispatch("GET", "/weather/v000903/coord/37.5,127")!!.passed.map { it.handler })
        assertEquals(
            listOf("cors(…)", "session(…)", "favicon(…)", "bodyParser.json(…)", "bodyParser.urlencoded(…)", "cookieParser(…)",
                "express.static(…)", "i18n.init", "function timestamp(req, res, next)", "function timestamp(req, res, next)"),
            routes.dispatch("GET", "/v000903/kma/special")!!.passed.map { it.handler },
        )
        // Other paths reach no route: the application's 404 handler answers them.
        assertNull(route("GET", "/nowhere"))
    }

    private fun verdict(method: String, path: String): Verdict {
        assertTrue(VERSIONED.matches(path), "$method $path is not under v000903")
        val match = routes.dispatch(method, path)
        val listed = register.firstOrNull { entry ->
            val route = entry["route"]?.jsonObject ?: return@firstOrNull false
            entry.text("kind") == "not-served" && match != null && route.text("file") == match.route.file &&
                route.text("method") == match.route.method && route.text("path") == match.route.path
        }
        if (listed == null) {
            assertNotNull(match, "$method $path: no route of the legacy server answers it")
            assertEquals(method, match.route.method, "$method $path: answered by ${match.route.method} ${match.pattern} (${match.route.source})")
            for (layer in match.passed) {
                assertTrue("${layer.file} ${layer.handler}" in PASSED, "$method $path passes ${layer.handler} (${layer.source}), which is not reviewed")
            }
        }
        return Verdict(method, path, match, listed?.text("id"))
    }

    /** What the app sends, through the production clients and transports. */
    private suspend fun sendEveryRequest(base: String, feedUrl: String) {
        // W1–W3: every case of the Cordova corpus (coordinates; latitude 0 with an address; the KMA town route with one
        // to three parts; the free-form fallback; nothing to send).
        val weather = WeatherRepository(base, null)
        for (case in weatherCases) weather.load(place(case), units(case["units"]!!.jsonObject), languages, force = true)
        // G1, G2: a position (S01, S02), a prediction's full text (S01) and its terms joined (S02, B27), a place abroad.
        val geocode = GeocodeClient(base)
        geocode.byLocation(Location(37.561, 126.979), languages)
        geocode.byAddress("대한민국 서울특별시 중구 회현동", languages)
        geocode.byAddress("회현동,중구,서울특별시", languages)
        geocode.byAddress("Westminster Abbey, London, UK", languages)
        // N1, N2: S10 and S11 (region KR), S12.
        val nation = NationSource(base)
        nation.nation("KR", UnitSettings.defaults("KR"), languages)
        nation.special(languages)
        // P1–P3: every flow of PushSync.
        pushFlows(base)
        // E2: the photo feed, at its own URL.
        coroutineScope { WeatherPhotoFeed(feedUrl, this).load() }
    }

    private suspend fun pushFlows(base: String) {
        val record = Json.parseToJsonElement(
            """{"cityIndex":1,"id":1,"category":"alarm","time":"2026-11-07T22:40:00.000Z","dayOfWeek":[true,true,true,true,true,true,true],
                "enable":true,"name":"명동","source":"KMA","location":{"lat":37.56,"long":126.98},
                "town":{"first":"서울특별시","second":"중구","third":"명동"}}""",
        ).jsonObject
        val dir = Files.createTempDirectory("request-paths").toFile().apply { deleteOnExit() }
        val store = DataStoreFactory.create(AppStateSerializer, scope = CoroutineScope(Dispatchers.IO + Job())) { File(dir, "state.json") }
        val myeongdong = Place(false, false, "명동", "대한민국 서울특별시 중구 명동", "KR", Location(37.56, 126.98), source = "KMA")
        val moved = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.558, 126.978), source = "KMA")
        store.updateData {
            it.copy(places = listOf(Place.currentPositionPlaceholder(), myeongdong), push = PushState(fcmToken = "token-a", records = listOf(record)))
        }
        val ctx = PushRegistration.Context("device", "ko-KR", "2.0.0", UnitSettings.defaults("KR"), 0, TimeZone.getTimeZone("Asia/Seoul"))
        val sync = PushSync(store, HttpPushTransport(base)) { ctx }
        val flows = listOf<Pair<String, suspend () -> PushSync.Outcome?>>(
            "the app opens with a new token (P1, then P3)" to { sync.onStart { "token-b" } },
            "FCM delivers another token (P1)" to { sync.onNewToken("token-c") },
            "a unit changes on S08 (P3)" to { sync.updateUnits() },
            "S09 saves the place's alarms (P3)" to { sync.postPlace(1) },
            "O06 is answered (P3)" to { sync.postList() },
            "the place moves (P3)" to {
                store.updateData { it.copy(places = listOf(it.places[0], moved)) }
                sync.updateCity(1)
            },
            "S02 deletes the place (P2)" to { sync.removeCity(1) },
        )
        for ((name, flow) in flows) assertTrue(flow()!!.requests.isNotEmpty(), "$name: nothing sent")
    }

    private fun table(verdicts: List<Verdict>, feed: Int): String = buildString {
        appendLine("Requests of the native client, dispatched by the route table of ${routes.app} (express ${routes.express}):")
        appendLine("| Method | A path on the wire | Sent | Route | Verdict |")
        appendLine("| --- | --- | --- | --- | --- |")
        for (group in verdicts.groupBy { it.route }.values) {
            val v = group.first()
            val route = v.match?.let { "${it.route.method} ${it.pattern} (${it.route.source})" } ?: "none"
            appendLine("| ${v.method} | ${v.path} | ${group.size} | $route | ${v.exception?.let { "$it: not served" } ?: "served, v000903"} |")
        }
        appendLine("| GET | {TW_WEATHER_PHOTOS_URL} | $feed | another host | E2 |")
    }

    private fun place(case: JsonObject): Place {
        val geo = case["geoInfo"]!!.jsonObject
        val location = geo["location"]?.jsonObject?.let { Location(it["lat"]!!.jsonPrimitive.double, it["long"]!!.jsonPrimitive.double) }
        return Place(currentPosition = false, disable = false, address = geo.text("address"), location = location)
    }

    private fun units(u: JsonObject) = UnitSettings(
        temperatureUnit = u.text("temperatureUnit")!!, windSpeedUnit = u.text("windSpeedUnit")!!, pressureUnit = u.text("pressureUnit")!!,
        distanceUnit = u.text("distanceUnit")!!, precipitationUnit = u.text("precipitationUnit")!!, airUnit = u.text("airUnit")!!,
    )

    private fun JsonObject.text(key: String) = this[key]?.jsonPrimitive?.contentOrNull

    private companion object {
        const val FEED_PATH = "/weather-photos.json"

        /** `v000903` as the first path segment, or the second after `weather` or `geocode` (AN-06). */
        val VERSIONED = Regex("^/(?:weather/|geocode/)?v000903(?:/.*)?$")

        /** The routes the native client reaches: W1, W2 (one to three parts), W3 (E1), G1, G2, N1, N2, P1–P3. */
        val EXPECTED = setOf(
            "GET /weather/:version(v000901|v000902|v000903)/coord/:loc",
            "GET /v000903/kma/addr/:region",
            "GET /v000903/kma/addr/:region/:city",
            "GET /v000903/kma/addr/:region/:city/:town",
            "ALL OWN_PATH",
            "GET /geocode/:version(v000903)/coord/:loc",
            "GET /geocode/:version(v000901|v000903)/addr/*",
            "GET /v000903/nation/:nation",
            "GET /v000903/kma/special",
            "PUT /v000903/push",
            "DELETE /v000903/push",
            "POST /v000903/push-list",
        )

        /** The middleware these requests pass before their routes, each read to go on to the route. */
        val PASSED = mapOf(
            "server/app.js cors(…)" to "adds the CORS headers",
            "server/app.js session(…)" to "reads or sets the session cookie",
            "server/app.js favicon(…)" to "answers /favicon.ico only",
            "server/app.js bodyParser.json(…)" to "parses a JSON body",
            "server/app.js bodyParser.urlencoded(…)" to "parses a form body",
            "server/app.js cookieParser(…)" to "parses the cookies",
            "server/app.js express.static(…)" to "answers the files under server/public (img, lib, stylesheets) only",
            "server/app.js i18n.init" to "sets the request's language",
            "server/routes/v000903/index.js function timestamp(req, res, next)" to "logs the request",
            "server/routes/v000903/route.kma.v000903.js function timestamp(req, res, next)" to "logs the request",
            "server/routes/v000803/route.nation.js function timestamp(req, res, next)" to "logs the request",
            "server/routes/v000705/routePushNotification.js function (req, res, next)" to
                "with PUSH_STORE=s3 hands the change to the push coordinator, which applies it; otherwise goes on",
            "server/routes/v000902/route.push.update.list.js function (req, res, next)" to "the same, for the list",
        )
    }
}
