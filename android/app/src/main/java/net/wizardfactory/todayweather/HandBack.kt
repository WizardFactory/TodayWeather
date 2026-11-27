package net.wizardfactory.todayweather

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.annotation.Keep
import net.wizardfactory.todayweather.analytics.ConsentStore
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.CordovaHandBack
import net.wizardfactory.todayweather.core.storage.CordovaMigration

/**
 * Writes the rollback hand-back ([CordovaHandBack], AN-17) into the Cordova suite: every key and the marker in one
 * `commit()`, so a fallback Cordova build never reads half of a hand-back. The generation is the stored marker's plus
 * one; a state whose texts the suite already holds under a native marker is not written again. A key the plugin stored
 * with its JSON-type flag loses the flag, as the plugin does when it stores a string.
 */
class HandBackWriter(private val suite: SharedPreferences, private val consent: () -> String?) {
    private var last: AppState? = null

    /**
     * Held here: SharedPreferences keeps its listeners only weakly. Nothing reads the field, so R8 would remove it and the
     * listener would be collected (the first 2.0.1 release build: a grant then never reached the suite and
     * [HandBackConsent] withdrew it at the next start). `check_r8.py` (`KEPT_FIELDS`) fails a release without it.
     */
    @field:Keep
    private var consentListener: SharedPreferences.OnSharedPreferenceChangeListener? = null

    /** Hands [state] back (each state the app saved); false when the suite could not be written. */
    @Synchronized
    fun write(state: AppState): Boolean {
        last = state
        val texts = CordovaHandBack.texts(state, consent())
        val stored = runCatching { suite.getString(CordovaHandBack.MARKER, null) }.getOrNull()
        val current = CordovaHandBack.parse(stored)
        val unchanged = current != null && current.writer == CordovaHandBack.NATIVE && current.complete &&
            texts.all { (key, text) -> runCatching { suite.getString(key, null) }.getOrNull() == text && !suite.contains("_${key}_type") }
        if (unchanged) return true
        val editor = suite.edit()
        texts.forEach { (key, text) ->
            if (text != null) editor.putString(key, text) else editor.remove(key)
            editor.remove("_${key}_type")
        }
        editor.putString(CordovaHandBack.MARKER, CordovaHandBack.marker(CordovaHandBack.nextGeneration(stored), CordovaHandBack.NATIVE))
        return editor.commit().also { if (!it) Log.w(TAG, "hand-back write failed") }
    }

    /** Hands the last saved state back again after a consent change; nothing before the first saved state. */
    @Synchronized
    fun rewrite(): Boolean = last?.let(::write) ?: true

    /**
     * Calls [rewrite] through [schedule] after every write of the analytics choice in [choices] (ConsentStore's file),
     * also one that leaves collection as it was, such as a withdrawal before any choice.
     */
    fun watchConsent(choices: SharedPreferences, schedule: (() -> Unit) -> Unit) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == ConsentStore.KEY) schedule { rewrite() }
        }
        consentListener = listener
        choices.registerOnSharedPreferenceChangeListener(listener)
    }

    companion object {
        private const val TAG = "TwHandBack"

        fun of(context: Context) = HandBackWriter(context.getSharedPreferences(CordovaMigration.SUITE, Context.MODE_PRIVATE)) {
            ConsentStore(context).storedChoice()
        }
    }
}

/**
 * The consent after a rollback and a return (AN-17): this app's grant stands at the start only while the suite's choice,
 * which every hand-back writes and a fallback Cordova build mirrors from its own choices, says `"true"`. So a withdrawal
 * made there holds, also when that build could not read the hand-back and so did not claim the state, and a failed
 * mirror there (which removes the choice) withdraws. Before anything was handed over, the grant stands; a grant made
 * there is not carried over, as the first migration carries none. Runs before the choice applies ([EarlyStartProvider]);
 * user choice saves commit the suite hand-back on the serialized background analytics writer before returning success,
 * while [HandBackWriter.watchConsent] schedules a single background executor off the main thread for any other writes.
 *
 * Without a choice here the region default applies (analytics default-on, 2026-11-24) and nothing is adopted: the suite
 * is backed up while this app's choice is not, so a suite choice cannot tell a fallback build's withdrawal on this
 * device from an old device's choice after a restore, and a restore must leave the region default.
 */
object HandBackConsent {
    fun beforeStart(context: Context) {
        val store = ConsentStore(context)
        if (store.storedChoice() != "true") return
        val suite = context.getSharedPreferences(CordovaMigration.SUITE, Context.MODE_PRIVATE)
        if (CordovaHandBack.parse(runCatching { suite.getString(CordovaHandBack.MARKER, null) }.getOrNull()) == null) return
        if (runCatching { suite.getString(CordovaHandBack.CONSENT, null) }.getOrNull() == "true") return
        store.write(false)
    }
}
