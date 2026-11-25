package net.wizardfactory.todayweather.core.data

import net.wizardfactory.todayweather.core.domain.share.DeepLink
import net.wizardfactory.todayweather.core.domain.share.DeepLinkCatalog
import net.wizardfactory.todayweather.core.domain.share.DeepLinkTarget
import net.wizardfactory.todayweather.core.domain.share.WeatherView
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place

/** The pages over the tabs a link opens: S10, S11 and S12. */
enum class LinkPage { NATION_WEATHER, NATION_AIR, WARNINGS }

/** Where a `link.todayweather.ai` link goes. */
sealed interface LinkRoute {
    /**
     * A weather tab ([view], with [pollutant] for Air) for the saved place at [index], or for [preview], a place shown
     * without being saved ([LinkPreview]). Exactly one of [index] and [preview] is set.
     */
    data class Weather(val view: WeatherView, val pollutant: String?, val index: Int?, val preview: Place?) : LinkRoute

    data class Page(val page: LinkPage) : LinkRoute

    /** `/open`: the app as it is. */
    data object App : LinkRoute
}

/** specs/deeplink.md §6.2: the route of a link over the saved [AppState]. */
object LinkRoutes {
    /**
     * A catalog city or coordinates go to the first enabled saved place within 0.01° (not the current position, which
     * moves), else to a preview of the place; without [matchSaved] always to a preview. An unknown catalog city goes
     * nowhere (null), as does a widget index, which [EntryLink][net.wizardfactory.todayweather.core.domain.share.EntryLink] handles.
     */
    fun of(target: DeepLinkTarget, state: AppState, matchSaved: Boolean = true): LinkRoute? = when (target) {
        is DeepLinkTarget.Open -> LinkRoute.App
        DeepLinkTarget.NationWeather -> LinkRoute.Page(LinkPage.NATION_WEATHER)
        DeepLinkTarget.NationAir -> LinkRoute.Page(LinkPage.NATION_AIR)
        DeepLinkTarget.Warnings -> LinkRoute.Page(LinkPage.WARNINGS)
        is DeepLinkTarget.LegacyWidgetIndex -> null
        is DeepLinkTarget.Place -> DeepLinkCatalog.find(target.slug)?.let { city ->
            weather(state, matchSaved, target.view, target.pollutant,
                Place(false, false, city.name, city.address, city.country, Location(city.lat, city.lon)))
        }
        is DeepLinkTarget.Coordinate -> weather(state, matchSaved, target.view, target.pollutant,
            Place(false, false, target.name ?: DeepLink.coordinateText(target.lat, target.lon), location = Location(target.lat, target.lon)))
    }

    /**
     * The first enabled saved place within 0.01° of [place]; -1 when none is. A link never matches the current position,
     * which moves; a search result does ([withCurrentPosition]), as #3180 counts it among the saved places (CODEX-3190-4).
     */
    fun nearbySaved(state: AppState, place: Place, withCurrentPosition: Boolean = false): Int {
        val at = place.location ?: return -1
        return state.places.indexOfFirst { saved ->
            val location = saved.location
            (withCurrentPosition || !saved.currentPosition) && !saved.disable && location != null &&
                DeepLink.nearSaved(location.lat, location.long, at.lat, at.long)
        }
    }

    private fun weather(state: AppState, matchSaved: Boolean, view: WeatherView, pollutant: String?, place: Place): LinkRoute.Weather {
        val index = if (matchSaved) nearbySaved(state, place) else -1
        return if (index >= 0) LinkRoute.Weather(view, pollutant, index, null) else LinkRoute.Weather(view, pollutant, null, place)
    }
}
