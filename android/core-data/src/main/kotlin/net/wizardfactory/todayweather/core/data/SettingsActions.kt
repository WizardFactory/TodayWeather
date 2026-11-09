package net.wizardfactory.todayweather.core.data

import net.wizardfactory.todayweather.core.domain.settings.SettingLists

/**
 * What the settings pages change (S07, S08, #2891), as the Cordova `radioList` and `RadioCtrl` do it
 * (controller.setting.radio.js): a unit chosen on S08 is saved and, when it changed, the push list is posted again
 * with it ([updateUnits], `Push.updateUnits`); a startup page, refresh interval or theme is saved, and the refresh
 * interval restarts the timer. Then every place may load again and the selected one loads
 * ([WeatherSession.settingChanged]). The menu's refresh-interval list restarts the timer as it opens, since opening
 * sets the list's current value.
 */
class SettingsActions(private val state: StateAccess, private val session: WeatherSession, private val updateUnits: () -> Unit) {
    /** The menu opened the S08 list [name] (`settingRadio`). */
    fun opened(name: String) {
        if (name == "refreshInterval") session.reload(WeatherSession.Sender.REFRESH_INTERVAL)
    }

    /** [value] was chosen on the S08 list [name] (`valueChanged`). */
    fun choose(name: String, value: String) {
        val s = state.current() ?: return
        if (name in SettingLists.UNITS) {
            // `Units.setUnit` saves and posts only a changed unit.
            if (s.units.value(name) != value) {
                state.change { it.copy(units = it.units.with(name, value)) }
                updateUnits()
            }
        } else {
            state.change { it.copy(settings = it.settings.with(name, value)) }
            if (name == "refreshInterval") session.reload(WeatherSession.Sender.REFRESH_INTERVAL)
        }
        session.settingChanged()
    }
}
