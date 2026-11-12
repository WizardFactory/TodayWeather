package net.wizardfactory.todayweather.core.domain.start

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.domain.Js

/** The startup gate of app.js (L362-L367): S01 opens while the stored `startVersion` is missing or below `Util.startVersion`. */
object StartGate {
    /** `Util.startVersion` (service.util.js L33). */
    const val VERSION = 1.0

    /** What closing S01 stores (`TwStorage.set("startVersion", Util.startVersion)`). */
    val CLOSED = JsonPrimitive(1)

    /** `startVersion === null || Util.startVersion > Number(startVersion)`, [stored] as `TwStorage.get` returns it. */
    fun shows(stored: JsonElement?): Boolean = stored == null || stored is JsonNull || VERSION > Js.number(stored)
}

/** A place S01 or S02 adds, as its `geoInfo`: the name, the address, the country and the coordinates. */
data class PlaceInfo(val name: String?, val address: String, val country: String, val lat: Double, val long: Double)

/**
 * StartCtrl's name of a chosen Places prediction (controller.start.js L321-L331): the term whose offset is the first
 * matched substring's, else the typed word. The Places SDK's full text stands for the legacy `description`; its terms
 * are the parts between ", ", or between spaces when it has no comma (a Korean description).
 */
object PredictionName {
    fun of(fullText: String, firstMatch: Int?, word: String): String =
        firstMatch?.let { offset -> terms(fullText).firstOrNull { it.first == offset }?.second } ?: word

    /** The terms of [fullText] with their offsets. */
    fun terms(fullText: String): List<Pair<Int, String>> {
        val separator = if (", " in fullText) ", " else " "
        val terms = mutableListOf<Pair<Int, String>>()
        var start = 0
        while (start <= fullText.length) {
            val end = fullText.indexOf(separator, start).takeIf { it >= 0 } ?: fullText.length
            if (end > start) terms += start to fullText.substring(start, end)
            start = end + separator.length
        }
        return terms
    }
}

/** A bundled town (`window.towns` of town.js, the app's `assets/data/towns.json`). */
data class Town(val first: String, val second: String, val third: String, val lat: Double, val long: Double)

/** A page of town matches and where the next one starts, −1 at the end of the list (`searchIndex`). */
data class TownPage(val towns: List<Town>, val next: Int)

/**
 * S02's town scan (`OnScrollResults`, controller.searchctrl.js L288-L303): a case-sensitive substring of `first`,
 * `second` or `third`, in file order, 10 matches at a time.
 */
class TownSearch(private val towns: List<Town>) {
    fun search(word: String, from: Int = 0): TownPage {
        val found = mutableListOf<Town>()
        for (i in from until towns.size) {
            val town = towns[i]
            if (word in town.first || word in town.second || word in town.third) {
                found += town
                if (found.size % PAGE == 0) return TownPage(found, i + 1)
            }
        }
        return TownPage(found, -1)
    }

    companion object {
        const val PAGE = 10
    }
}

/**
 * The `geoInfo` of a town (controller.searchctrl.js L373-L401): "대한민국" and the town's parts, a 도's 구 split after its
 * first 시, named by the last part present. The branch for a second part with a space (no town has one) is left out.
 */
fun Town.placeInfo(): PlaceInfo {
    var address = "대한민국 $first"
    var name = first
    if (second != "") {
        name = second
        if (first.endsWith('도') && second.endsWith('구')) {
            val si = second.indexOf('시')
            address += " " + second.substring(0, si + 1)
            address += " " + second.substring(si + 1)
        } else {
            address += " $second"
        }
    }
    if (third != "") {
        name = third
        address += " $third"
    }
    return PlaceInfo(name, address, "KR", lat, long)
}
