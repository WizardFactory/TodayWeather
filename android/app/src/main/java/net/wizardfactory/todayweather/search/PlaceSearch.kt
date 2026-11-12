package net.wizardfactory.todayweather.search

import android.content.Context
import android.text.Spanned
import android.text.style.StyleSpan
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.tasks.await
import com.google.android.libraries.places.api.Places
import com.google.android.libraries.places.api.model.PlaceTypes
import com.google.android.libraries.places.api.net.FindAutocompletePredictionsRequest
import com.google.android.libraries.places.api.net.PlacesClient

/** A place prediction: its full text (`description`) and where the typed word first matched in it (`matched_substrings[0].offset`). */
data class Prediction(val fullText: String, val firstMatch: Int?)

/** The place predictions of S01's search box (`AutocompleteService.getPlacePredictions`, #2889). */
fun interface PlaceSearch {
    /** The predictions for [word]; null when the request failed, empty when nothing matched. */
    suspend fun predictions(word: String): List<Prediction>?
}

/**
 * Google's Places SDK (Places API (New)) with the build's Android-restricted key: Autocomplete predictions of the
 * `(regions)` collection, as the Cordova app asked the Maps JavaScript API, without a session token or a place details
 * request; the chosen prediction's full text is geocoded by the legacy server.
 */
class GooglePlaceSearch(context: Context, key: String) : PlaceSearch {
    private val client: PlacesClient

    init {
        val app = context.applicationContext
        if (!Places.isInitialized()) Places.initializeWithNewPlacesApiEnabled(app, key)
        client = Places.createClient(app)
    }

    override suspend fun predictions(word: String): List<Prediction>? = try {
        val request = FindAutocompletePredictionsRequest.builder().setQuery(word).setTypesFilter(listOf(PlaceTypes.REGIONS)).build()
        client.findAutocompletePredictions(request).await().autocompletePredictions.map { prediction ->
            // The SDK marks each match of the typed word in the full text with the given style.
            val text = prediction.getFullText(StyleSpan(android.graphics.Typeface.BOLD))
            val first = (text as Spanned).getSpans(0, text.length, StyleSpan::class.java).minOfOrNull { text.getSpanStart(it) }
            Prediction(text.toString(), first)
        }
    } catch (e: Exception) {
        if (e is CancellationException) throw e
        null
    }
}
