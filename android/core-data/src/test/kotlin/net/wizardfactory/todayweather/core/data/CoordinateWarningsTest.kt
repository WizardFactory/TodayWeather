package net.wizardfactory.todayweather.core.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class CoordinateWarningsTest {
    @Test fun keepsRequestedPointAndExpiresCoverage() {
        val payload = Json.parseToJsonElement("""
            {
              "location":{"lat":41.3874,"lon":2.1686},
              "checkedAt":"1000",
              "sources":[{"issuer":"AEMET","state":"current","asOf":"1000","freshUntil":"3000"}],
              "warnings":[{"id":"wind","issuer":"AEMET","event":"Viento","effectiveAt":"1000","expiresAt":"9000"}]
            }
        """.trimIndent()).jsonObject
        val response = assertNotNull(CoordinateWarnings.decode(payload, 41.3874, 2.1686) { it?.toLongOrNull() })
        assertNull(CoordinateWarnings.decode(payload, 40.4168, 2.1686) { it?.toLongOrNull() })
        assertEquals(listOf("wind"), response.current(2000).warnings.map { it.id })
        assertEquals(CoordinateWarnings.State.Unavailable, response.current(3000).sources.single().state)
        assertEquals(emptyList(), response.current(3000).warnings)
    }
}
