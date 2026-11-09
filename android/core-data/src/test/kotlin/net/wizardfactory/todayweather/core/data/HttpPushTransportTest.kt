package net.wizardfactory.todayweather.core.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import net.wizardfactory.todayweather.core.storage.PushRequest

/** The HTTP transport against a local server: method, path, headers and JSON body as built. */
class HttpPushTransportTest {
    @Test
    fun sendsTheRequestAsBuilt() = runBlocking {
        val server = MockWebServer()
        server.start()
        server.enqueue(MockResponse.Builder().code(200).build())
        val body = JsonObject(mapOf("newToken" to JsonPrimitive("b"), "oldToken" to JsonPrimitive("a")))
        val status = HttpPushTransport(server.url("/").toString())
            .send(PushRequest("PUT", "/v000903/push", mapOf("Content-Type" to "application/json", "Device-Id" to "dev"), body))
        assertEquals(200, status)
        val recorded = server.takeRequest()
        assertEquals("PUT", recorded.method)
        assertEquals("/v000903/push", recorded.target)
        assertEquals("dev", recorded.headers["Device-Id"])
        assertEquals("application/json; charset=utf-8", recorded.headers["Content-Type"])
        assertEquals(body.toString(), recorded.body!!.utf8())
        server.close()
    }

    @Test
    fun anUnreachableServerGivesNoStatus() = runBlocking {
        assertNull(HttpPushTransport("http://127.0.0.1:9").send(PushRequest("POST", "/v000903/push-list", emptyMap(), JsonObject(emptyMap()))))
    }
}
