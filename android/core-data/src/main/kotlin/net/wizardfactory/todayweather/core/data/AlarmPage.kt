package net.wizardfactory.todayweather.core.data

import java.util.TimeZone
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import net.wizardfactory.todayweather.core.domain.AddressFormat
import net.wizardfactory.todayweather.core.domain.alarms.TimePicker
import net.wizardfactory.todayweather.core.storage.AlarmSettings
import net.wizardfactory.todayweather.core.storage.PushRegistration

/** The push plugin's view of notifications, as S09 asks it (firebasex `hasPermission`/`grantPermission`). */
interface NotificationAccess {
    /** Whether the push plugin runs (`Push.inited`): Firebase is configured. */
    val available: Boolean

    /** `hasPermission`: `POST_NOTIFICATIONS` on Android 13+, else whether the app's notifications are on. */
    fun enabled(): Boolean

    /** `grantPermission`: the system's prompt on Android 13+ while it may show; its answer (true below 13). */
    suspend fun request(): Boolean
}

/** The popups of S09: their English title literals, body keys and buttons (key, `button-dark`) as PushCtrl builds them. */
sealed class AlarmPopup(val title: String?, val body: String?, val buttons: List<Pair<String, Boolean>>) {
    /** O11, `_showPermissionPopUp`: Close, or Settings to the app's page. */
    data object Permission : AlarmPopup("Permission", "LOC_NOTIFICATION_IS_OFF_TURN_ON_NOTIFICATION_FOR_THIS_APP",
        listOf("LOC_CLOSE" to false, "LOC_SETTING" to true))

    /** O12, `onClose` with an edit: Close discards, Save saves. */
    data object SaveChanges : AlarmPopup("Save", "LOC_SAVE_CHANGES", listOf("LOC_CLOSE" to false, "LOC_SAVE" to true))

    /** O13, `onOkay` with equal hours: an alert without a title. */
    data object EqualHours : AlarmPopup(null, "LOC_START_TIME_AND_END_TIME_CAN_NOT_BE_THE_SAME_TIME", listOf("LOC_CLOSE" to false))

    /** O14 for the alarm at [index] (or the add row at the end): Set, Delete, Close. */
    data class Picker(val index: Int, val time: TimePicker) : AlarmPopup(null, null, listOf("LOC_SETTING" to false, "LOC_DELETE" to false, "LOC_CLOSE" to false))
}

/**
 * S09 for one visit (PushCtrl, `controller.push.js`, AN-14 #2893). [open] selects the place of `fav` (`setCityIndex`,
 * except slot 0 while it is disabled), loads its [AlarmSettings] and, while the push plugin runs, asks for the
 * notification permission and shows O11 when it stays off. A save of a changed page replaces the place's records as a
 * change of the state, shown at once and saved in order, before the page goes back (`updatePushListByCityIndex` changed
 * the list in memory and storage first), so S02's next visit sees it; [post] then posts the place's list in its turn
 * (`_postPushList` was not awaited). [closed] turns true when the page goes back.
 *
 * Kept from Cordova (AN-06): Android back leaves without O12 (D34); O12's back closes the page like Close; the equal-hours
 * check ignores the switch; the defaults count as edits; Save without an edit only goes back, permission permitting.
 */
class AlarmPage(
    private val state: StateAccess,
    private val notifications: NotificationAccess,
    /** Posts the saved list of the place at an index, after the registrations before it ([PushSync.postPlace]). */
    private val post: (index: Int) -> Unit,
    private val openSettings: () -> Unit,
    private val scope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
    private val zone: () -> TimeZone = TimeZone::getDefault,
) {
    private val _settings = MutableStateFlow<AlarmSettings?>(null)
    private val _popup = MutableStateFlow<AlarmPopup?>(null)
    private val _closed = MutableStateFlow(false)
    private val _title = MutableStateFlow("")

    val settings: StateFlow<AlarmSettings?> = _settings.asStateFlow()
    val popup: StateFlow<AlarmPopup?> = _popup.asStateFlow()
    val closed: StateFlow<Boolean> = _closed.asStateFlow()

    /** `cityData.name || getShortenAddress(cityData.address)`. */
    val title: StateFlow<String> = _title.asStateFlow()

    fun open(fav: Int?) {
        val s = state.current() ?: return
        if (fav != null && (fav != 0 || s.places.getOrNull(0)?.disable == false)) {
            if (fav >= 0 && fav < s.places.size) state.change { it.copy(placeIndex = fav) }
        }
        val current = state.current() ?: return
        val index = current.placeIndex
        val city = current.places.getOrNull(index) ?: return
        _title.value = city.name?.takeIf { it.isNotEmpty() } ?: AddressFormat.shorten(city.address)
        // The records as the Cordova list in memory had them: repaired by `loadPushInfo` at the start.
        val records = current.push.records.map { PushRegistration.repair(it, current.places) }
        _settings.value = AlarmSettings.load(records, index, current.places, clock(), zone())
        if (!notifications.available) return
        scope.launch {
            notifications.request()
            if (!notifications.enabled()) _popup.value = AlarmPopup.Permission
        }
    }

    private fun edit(update: (AlarmSettings) -> AlarmSettings) {
        _settings.value = _settings.value?.let(update)
    }

    fun toggleDay(day: Int) = edit { it.toggleDay(day) }

    fun setAlert(on: Boolean) = edit { it.setAlert(on) }

    fun setHours(from: Double, to: Double) = edit { it.setHours(from, to) }

    /** O14 on an alarm row or the add row (`onOpenTimePicker`). */
    fun openPicker(index: Int) {
        val s = _settings.value ?: return
        _popup.value = AlarmPopup.Picker(index, TimePicker.of(s.pickerInput(index, zone())))
    }

    /** The picker's arrows. */
    fun turnPicker(change: (TimePicker) -> TimePicker) {
        val p = _popup.value as? AlarmPopup.Picker ?: return
        _popup.value = p.copy(time = change(p.time))
    }

    /** The picker's answer: the seconds of Set, 0 for Delete, null for Close. */
    fun answerPicker(seconds: Int?) {
        val p = _popup.value as? AlarmPopup.Picker ?: return
        _popup.value = null
        val current = state.current() ?: return
        edit { it.pick(p.index, seconds, current.places, clock(), zone()) }
    }

    /** Set: the shown time's seconds. */
    fun pickerSet() {
        (_popup.value as? AlarmPopup.Picker)?.let { answerPicker(it.time.seconds()) }
    }

    /** The back arrow and Cancel (`onClose`): back without an edit, else O12. */
    fun cancel() {
        if (_settings.value?.updated != true) _closed.value = true else _popup.value = AlarmPopup.SaveChanges
    }

    /** Save (`onOkay`): O13 for equal hours; without the plugin save and back; else save and back with the permission, O11 without. */
    fun save() {
        val s = _settings.value ?: return
        if (s.equalHours) {
            _popup.value = AlarmPopup.EqualHours
            return
        }
        if (!notifications.available || notifications.enabled()) {
            persist(s)
            _closed.value = true
        } else {
            _popup.value = AlarmPopup.Permission
        }
    }

    private fun persist(s: AlarmSettings) {
        val list = s.toSave(clock(), zone()) ?: return
        state.change { it.copy(push = PushRegistration.onPlaceSaved(it.push, it.places, list, s.cityIndex, null).state) }
        post(s.cityIndex)
    }

    /** O11: Settings opens the app's page; either button closes it. */
    fun answerPermission(settings: Boolean) {
        _popup.value = null
        if (settings) openSettings()
    }

    /** O12: Save runs [save]'s checks; Close goes back without saving. */
    fun answerSaveChanges(saveIt: Boolean) {
        _popup.value = null
        if (saveIt) save() else _closed.value = true
    }

    /** O13's Close. */
    fun closeEqualHours() {
        _popup.value = null
    }

    /**
     * Android back: a popup resolves with nothing (O12 then goes back like Close; O11 and O13 close; the picker closes
     * without an answer); without one the page goes back without O12 (D34).
     */
    fun back() {
        when (_popup.value) {
            null -> _closed.value = true
            AlarmPopup.SaveChanges -> {
                _popup.value = null
                _closed.value = true
            }
            else -> _popup.value = null
        }
    }
}

/**
 * The answer to O06 (`Push.enableAlertForOldAlarm`, AN-14) as a change of the state, shown at once and saved in order:
 * OK turns every alert on, and either answer ends the introduction. OK's post of the whole list ([post],
 * [PushSync.postList]) follows after the registrations before it.
 */
fun answerAlertIntro(state: StateAccess, enable: Boolean, post: () -> Unit) {
    state.change { it.copy(push = PushRegistration.onAlertIntro(it.push, it.places, enable, null).state) }
    if (enable) post()
}
