package net.wizardfactory.todayweather.core.domain.start

/** A city shortcut of S01: the place a tap adds, with its name, country, address and coordinates. */
data class CityShortcut(val name: String, val country: String, val address: String, val lat: Double, val long: Double)

/**
 * `_makeFavoriteList` of StartCtrl (controller.start.js L145-L199): the S01 shortcuts, copied verbatim with their data
 * quirks (New York's coordinates lie about 290 km north of the city; Kinshasa's country is CG). The list grows with the
 * screen height in CSS pixels (`window.screen.height`): 6 cities, 11 from 568, 17 from 731 and 26 from 960.
 */
object CityShortcuts {
    /** `favoriteList1`. */
    private val LIST1 = listOf(
        CityShortcut("서울", "KR", "대한민국 서울특별시", 37.567, 126.978),
        CityShortcut("New York", "US", "New York, NY, United States", 43.299, -74.218),
        CityShortcut("東京", "JP", "日本 東京", 35.709, 139.732),
        CityShortcut("Berlin", "DE", "Berlin, Deutschland", 52.520, 13.405),
        CityShortcut("北京", "CN", "中国北京市", 39.904, 116.407),
        CityShortcut("臺北市", "TW", "台灣臺北市", 25.033, 121.565),
    )

    /** `favoriteList2`. */
    private val LIST2 = listOf(
        CityShortcut("दिल्ली", "IN", "दिल्ली, भारत", 28.704, 77.102),
        CityShortcut("Hồ Chí Minh", "VN", "Hồ Chí Minh, Việt Nam", 10.823, 106.630),
        CityShortcut("Москва", "RU", "Москва, Россия", 55.756, 37.617),
        CityShortcut("Roma", "IT", "Roma, Italia", 41.903, 12.496),
        CityShortcut("İstanbul", "TR", "İstanbul, Türkiye", 41.008, 28.978),
    )

    /** `favoriteList3`. */
    private val LIST3 = listOf(
        CityShortcut("香港", "HK", "香港香港島", 22.259, 114.191),
        CityShortcut("São Paulo", "BR", "São Paulo, Brasil", -23.551, -46.633),
        CityShortcut("กรุงเทพมหานคร", "TH", "กรุงเทพมหานคร ประเทศไทย", 13.756, 100.502),
        CityShortcut("Madrid", "ES", "Madrid, España", 40.417, -3.704),
        CityShortcut("Warszawa", "PL", "Warszawa, Polska", 52.230, 21.012),
        CityShortcut("كراچى", "PK", "کراچی, سندھ, پاکستان", 24.861, 67.010),
    )

    /** `favoriteList4`. */
    private val LIST4 = listOf(
        CityShortcut("وهران", "DZ", "وهران\u200e, الجزائر", 35.698, -0.634),
        CityShortcut("Sydney", "AU", "Sydney, New South Wales, Australia", -33.869, 151.209),
        CityShortcut("London", "GB", "London, United Kingdom", 51.507, -0.128),
        CityShortcut("Paris", "FR", "Paris, France", 48.857, 2.352),
        CityShortcut("Kinshasa", "CG", "Kinshasa, République démocratique du Congo", -4.441, 15.266),
        CityShortcut("القاهرة", "EG", "القاهرة, مصر", 30.044, 31.236),
        CityShortcut("Jakarta", "ID", "Jakarta, DKI Jakarta, Indonesia", -6.209, 106.846),
        CityShortcut("Ciudad de México", "MX", "Ciudad de México, México", 19.432, -99.133),
        CityShortcut("تهران", "IR", "تهران, استان تهران, ایران", 35.689, 51.389),
    )
    /** The shortcuts for a screen [height] in CSS pixels (dp): `bodyHeight >= 568`, `>= 731`, `>= 960`. */
    fun forScreenHeight(height: Double): List<CityShortcut> = buildList {
        addAll(LIST1)
        if (height >= 568) addAll(LIST2)
        if (height >= 731) addAll(LIST3)
        if (height >= 960) addAll(LIST4)
    }
}
