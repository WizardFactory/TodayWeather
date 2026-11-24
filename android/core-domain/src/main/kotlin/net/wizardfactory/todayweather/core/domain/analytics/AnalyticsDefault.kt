package net.wizardfactory.todayweather.core.domain.analytics

/**
 * Whether usage analytics collects (AK 2026-11-24, specs/analytics-default-on.md): a stored choice wins, otherwise it is
 * on by default for a known device region outside the opt-in regions. Plain Kotlin so the iOS app can mirror the rule.
 */
object AnalyticsDefault {
    /**
     * Where usage analytics stays off until the user allows it: the EEA (the 27 EU member states, with the ISO codes of
     * EU territories that have their own code: French Guiana, Guadeloupe, Martinique, Réunion, Mayotte, Saint-Martin and
     * the Åland Islands; Iceland, Liechtenstein and Norway), the United Kingdom and Switzerland.
     */
    val OPT_IN_REGIONS: Set<String> = setOf(
        "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL",
        "PT", "RO", "SK", "SI", "ES", "SE",
        "GF", "GP", "MQ", "RE", "YT", "MF", "AX",
        "IS", "LI", "NO",
        "GB", "CH",
    )

    /**
     * The officially assigned ISO 3166-1 alpha-2 codes (249). Any other region (empty, a UN M.49 number such as `150`,
     * a reserved or user-assigned code such as `EU`, `UK`, `XK` or `ZZ`) is unknown and keeps the opt-in.
     */
    val ASSIGNED_REGIONS: Set<String> = (
        "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD " +
            "CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE " +
            "GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI " +
            "KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX " +
            "MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD " +
            "SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ " +
            "VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
        ).split(' ').toSet()

    /** On by default: the region (ASCII letters in any case) is an assigned code outside [OPT_IN_REGIONS]. */
    fun onByDefault(region: String?): Boolean {
        val code = region?.trim()?.takeIf { it.length == 2 && it.all { c -> c in 'A'..'Z' || c in 'a'..'z' } }?.uppercase() ?: return false
        return code in ASSIGNED_REGIONS && code !in OPT_IN_REGIONS
    }

    /**
     * Collection at the start: a stored `"true"` collects and any other stored value does not (`"false"` holds declines and
     * failure fallbacks alike); without a stored choice the region decides ([onByDefault]).
     */
    fun collects(storedChoice: String?, region: String?): Boolean = storedChoice?.let { it == "true" } ?: onByDefault(region)
}
