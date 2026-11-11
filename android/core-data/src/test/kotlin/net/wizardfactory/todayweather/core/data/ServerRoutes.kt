package net.wizardfactory.todayweather.core.data

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The legacy server's routes as `tools/server-routes/generate.mjs` read them from `server/` (`server-routes/routes.json`),
 * dispatched as Express 4.13.4 does (`lib/router/index.js` `handle` and `trim_prefix`, `lib/router/layer.js` `match`):
 * - each router tries its layers in registration order, starting with `server/app.js`;
 * - a middleware or mount matches a prefix of the path that ends at `/`, `.` or the end (any path for `/`); a mount goes
 *   on in its router with the prefix removed, and back here when nothing there answered;
 * - a route matches the whole rest of the path and its method (`ALL` any method; `HEAD` a `GET` route too);
 * - middleware are taken to call `next()`, so callers check which ones a request passed; error handlers (four
 *   parameters) do not run for a request without an error.
 * Paths are matched as sent, percent-encoded, as Express matches `req.url`.
 */
class ServerRoutes private constructor(val app: String, val express: String, val routers: Map<String, List<Layer>>) {
    data class Layer(
        val file: String,
        val line: Int,
        val kind: String,
        val method: String?,
        val path: String,
        val regex: Regex,
        val matchesAll: Boolean,
        val router: String?,
        val handler: String?,
        val arity: Int?,
    ) {
        val source: String get() = "$file:$line"

        /** The part of [path] this layer matches (all of it for a route), or null. */
        fun match(path: String): String? = if (matchesAll) "" else regex.find(path)?.takeIf { it.range.first == 0 }?.value
    }

    /** The route that answers, the mounts that led to it, and the middleware that ran before it. */
    data class Match(val route: Layer, val mounts: List<Layer>, val passed: List<Layer>) {
        /** The route's pattern under its mounts, e.g. `/v000903/kma/addr/:region`. */
        val pattern: String get() = (mounts.map { it.path } + route.path).filter { it != "/" }.joinToString("").ifEmpty { "/" }
    }

    /** The route [method] [path] reaches, or null when none does (the application's 404 handler answers). */
    fun dispatch(method: String, path: String): Match? = dispatch(app, method, path, emptyList(), mutableListOf())

    private fun dispatch(file: String, method: String, path: String, mounts: List<Layer>, passed: MutableList<Layer>): Match? {
        for (layer in routers.getValue(file)) {
            val matched = layer.match(path) ?: continue
            if (layer.kind == "route") {
                if (layer.method == "ALL" || layer.method == method || (method == "HEAD" && layer.method == "GET")) {
                    return Match(layer, mounts, passed.toList())
                }
                continue
            }
            val next = path.getOrNull(matched.length)
            if (next != null && next != '/' && next != '.') continue
            when (layer.kind) {
                "middleware" -> if ((layer.arity ?: 0) <= 3) passed += layer
                "mount" -> {
                    val rest = path.substring(matched.length).let { if (it.startsWith("/")) it else "/$it" }
                    dispatch(layer.router!!, method, rest, mounts + layer, passed)?.let { return it }
                }
                else -> error("unknown layer kind ${layer.kind} at ${layer.source}")
            }
        }
        return null
    }

    companion object {
        fun load(): ServerRoutes {
            val table = Json.parseToJsonElement(File(ServerRoutes::class.java.getResource("/server-routes/routes.json")!!.toURI()).readText()).jsonObject
            val routers = table["routers"]!!.jsonArray.map { it.jsonObject }.associate { router ->
                val file = router["file"]!!.jsonPrimitive.content
                file to router["layers"]!!.jsonArray.map { layer(file, it.jsonObject) }
            }
            for (layer in routers.values.flatten()) {
                if (layer.kind == "mount") check(layer.router in routers) { "${layer.source} mounts ${layer.router}, which the table lacks" }
            }
            return ServerRoutes(table["app"]!!.jsonPrimitive.content, table["express"]!!.jsonPrimitive.content, routers)
        }

        private fun layer(file: String, l: JsonObject): Layer {
            fun text(key: String) = l[key]?.jsonPrimitive?.contentOrNull
            val options = if (l["ignoreCase"]!!.jsonPrimitive.boolean) setOf(RegexOption.IGNORE_CASE) else emptySet()
            return Layer(
                file = file,
                line = l["line"]!!.jsonPrimitive.int,
                kind = text("kind")!!,
                method = text("method"),
                path = text("path")!!,
                regex = Regex(text("regex")!!, options),
                matchesAll = l["matchesAll"]?.jsonPrimitive?.boolean == true,
                router = text("router"),
                handler = text("handler"),
                arity = l["arity"]?.jsonPrimitive?.int,
            )
        }
    }
}
