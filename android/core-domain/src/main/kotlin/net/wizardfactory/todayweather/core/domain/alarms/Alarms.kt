package net.wizardfactory.todayweather.core.domain.alarms

import net.wizardfactory.todayweather.core.domain.share.EntryLink

/**
 * The time picker O14 of S09 (AN-14, #2893): ionic-timepicker 0.5.1 (the `WizardFactory/ionic-timepicker#e2d5cd3` fork the
 * app bundles) with the app's configuration, 12-hour, a 5-minute step and three buttons. [hours], [minutes] and [meridian]
 * are the texts the picker shows. Its anomalies are kept (AN-06): noon opens as 12 AM, so Set turns 12:00 PM into 0, which
 * S09 treats as Delete, and 12:30 PM into 00:30; Set at 12:00 AM answers 0 as well.
 */
data class TimePicker(val hours: String, val minutes: String, val meridian: String) {
    /** `{{time.hours}} : {{time.minutes}} {{time.meridian}}`. */
    val heading: String get() = "$hours : $minutes $meridian"

    /** 1 after 12, else one more. */
    fun increaseHours(): TimePicker = copy(hours = pad(hours.toInt().let { if (it != 12) it + 1 else 1 }))

    /** 12 below 2, else one less. */
    fun decreaseHours(): TimePicker = copy(hours = pad(hours.toInt().let { if (it > 1) it - 1 else 12 }))

    fun increaseMinutes(): TimePicker = copy(minutes = pad((minutes.toInt() + STEP) % 60))

    fun decreaseMinutes(): TimePicker = copy(minutes = pad((minutes.toInt() + 60 - STEP) % 60))

    fun changeMeridian(): TimePicker = copy(meridian = if (meridian == AM) PM else AM)

    /** Set: the seconds of the day; PM adds 12 hours except at 12, 12 AM is hour 0. */
    fun seconds(): Int {
        var h = hours.toInt()
        if (meridian == PM && h != 12) h += 12 else if (meridian == AM && h == 12) h -= 12
        return h * 3600 + minutes.toInt() * 60
    }

    companion object {
        const val STEP = 5
        const val AM = "AM"
        const val PM = "PM"

        /** `setMinSecs`: the input's hours, PM only above 12, and its minutes, as `toFixed(0)` with a leading zero. */
        fun of(inputTime: Int): TimePicker {
            var h = inputTime / 3600
            val meridian = if (h > 12) PM.also { h -= 12 } else AM
            val minutes = Math.floor((inputTime % 3600) / 60.0 + 0.5).toInt()
            return TimePicker(h.toString().padStart(2, '0'), minutes.toString().padStart(2, '0'), meridian)
        }

        /** A number below 10 with a leading zero, as the arrows write it. */
        private fun pad(n: Int) = if (n < 10) "0$n" else n.toString()
    }
}

/** An alarm row of S09: `secs2dateStr`, the local hour without padding and two-digit minutes. */
object AlarmRow {
    fun text(localSeconds: Int): String = "${localSeconds / 3600}:${(localSeconds % 3600 / 60).toString().padStart(2, '0')}"
}

/**
 * A tap on a push notification (`_notificationCallback` with `tap`): the place index of its `cityIndex` data, a string, by
 * JavaScript's `parseInt`; null when it is absent or no number. The index may be outside the places; `setCityIndex` checks.
 */
object NotificationTap {
    fun placeIndex(cityIndex: String?): Double? = cityIndex?.let { EntryLink.parseInt(it).takeUnless(Double::isNaN) }
}

/** The foreground popup O07 (TabCtrl's `notificationEvent`): the title, a break when both are there, then the body. */
object ForegroundMessage {
    fun template(title: String?, body: String?): String {
        var template = title.orEmpty()
        if (!body.isNullOrEmpty()) {
            if (template.isNotEmpty()) template += "<br>"
            template += body
        }
        return template
    }
}
