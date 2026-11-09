package net.wizardfactory.todayweather

import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import java.util.Locale
import net.wizardfactory.todayweather.core.domain.shell.AppLanguage

/**
 * The language of the app as the Cordova app chooses it: the first system language picks one of the six
 * catalogs (AppLanguage), applied to the activity's resources; the region shows the Korea-only menu rows.
 */
object AppLocale {
    fun systemTags(): List<String> = LocaleList.getDefault().let { list -> (0 until list.size()).map { AppLanguage.webTag(list[it].language, list[it].country) } }

    fun catalogLocale(tags: List<String> = systemTags()): Locale = when (AppLanguage.catalog(tags.firstOrNull())) {
        "de" -> Locale.GERMAN
        "ko" -> Locale.KOREAN
        "ja" -> Locale.JAPANESE
        "zh-CN" -> Locale.SIMPLIFIED_CHINESE
        "zh-TW" -> Locale.TRADITIONAL_CHINESE
        else -> Locale.ENGLISH
    }

    fun region(tags: List<String> = systemTags()): String = AppLanguage.region(tags)

    fun wrap(base: Context): Context {
        val config = Configuration(base.resources.configuration).apply { setLocale(catalogLocale()) }
        return base.createConfigurationContext(config)
    }
}
