package net.wizardfactory.todayweather.core.domain.shell

/**
 * The language and region the Cordova app derives from the system languages (client/www/js/app.js L421-L438,
 * L130-L157, with angular-translate 2.19.1 `determinePreferredLanguage`): only the first language counts.
 * Tags are as a WebView reports them (`ko-KR`, `zh-TW`).
 */
object AppLanguage {
    /** Catalogs in client/www/locales, in registration order. */
    val CATALOGS = listOf("en", "de", "ko", "ja", "zh-CN", "zh-TW")

    /** `registerAvailableLanguageKeys` aliases, in the order angular-translate iterates them. */
    private val ALIASES = listOf("en_*" to "en", "de_*" to "de", "ko_*" to "ko", "ja_*" to "ja", "zh_HK" to "zh-TW", "zh_TW" to "zh-TW", "zh_*" to "zh-CN")

    /**
     * The catalog for the first system language [tag]: the default tag resolver (`-` to `_`), an exact key, an alias
     * (exact or `prefix_*`), or the language part; anything else falls back to English (`fallbackLanguage('en')`).
     */
    fun catalog(tag: String?): String {
        val preferred = (tag ?: "").split("-").joinToString("_")
        if (preferred.isEmpty()) return "en"
        val lower = preferred.lowercase()
        CATALOGS.firstOrNull { it.lowercase() == lower }?.let { return it }
        for ((alias, key) in ALIASES) {
            val exact = alias.lowercase() == lower
            val wildcard = alias.endsWith("*") && alias.dropLast(1).lowercase() == preferred.take(alias.length - 1).lowercase()
            if (exact || wildcard) return key
        }
        val parts = preferred.split("_")
        if (parts.size > 1) CATALOGS.firstOrNull { it.lowercase() == parts[0].lowercase() }?.let { return it }
        return "en"
    }

    /** `Util.region`: the last part of the first tag with a `-`, else KR. */
    fun region(tags: List<String>): String = tags.firstOrNull { it.split("-").size > 1 }?.split("-")?.last() ?: "KR"

    /** The tag a WebView reports for a system locale: language and country, no script. */
    fun webTag(language: String, country: String): String = if (country.isEmpty()) language else "$language-$country"
}
