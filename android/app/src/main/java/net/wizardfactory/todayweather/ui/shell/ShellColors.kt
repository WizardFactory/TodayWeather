package net.wizardfactory.todayweather.ui.shell

import androidx.compose.ui.graphics.Color
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme

/**
 * Shell colors of a Cordova theme on a tab (client/scss/ionic.app.scss: header bar L88-L168, tab bar L236-L262,
 * page and cards L269-L371, dark L673-L780, old L782-L990, side menu L1029-L1061).
 */
data class ShellColors(
    val headerBar: Color, val headerLine: Color, val headerText: Color,
    val tabBar: Color, val tabLine: Color, val tabText: Color,
    val page: Color, val text: Color,
    val menuList: Color, val menuItem: Color, val menuBorder: Color, val menuText: Color,
) {
    companion object {
        /** Status bar color of the Cordova build (config.xml). */
        val statusBar = Color(0xFF111111)

        fun of(theme: Theme, tab: Tab): ShellColors {
            val light = ShellColors(
                headerBar = Color.White, headerLine = Color(0xFFDDDDDD), headerText = Color.Black,
                tabBar = Color.White, tabLine = Color(0xFFB2B2B2), tabText = Color.Black,
                page = Color(0xFFF5F5F5), text = Color.Black,
                menuList = Color(0xFFF5F5F5), menuItem = Color.White, menuBorder = Color(0xFFDDDDDD), menuText = Color(0xFF444444),
            )
            return when (theme) {
                Theme.LIGHT -> light
                Theme.DARK -> ShellColors(
                    headerBar = Color(0xFF1B1B1B), headerLine = Color(0xFF444444), headerText = Color.White,
                    tabBar = Color(0xFF1B1B1B), tabLine = Color(0xFF444444), tabText = Color.White,
                    page = Color(0xFF171717), text = Color(0xFFDDDDDD),
                    menuList = Color(0xFF171717), menuItem = Color(0xFF1C1C1D), menuBorder = Color(0xFF111111), menuText = Color.White,
                )
                Theme.PHOTO -> light.copy(headerBar = Color(0xFF444444), headerLine = Color(0xFF111111), headerText = Color.White)
                Theme.OLD -> when (tab) {
                    Tab.HOURLY -> light.copy(headerBar = Color(0xFF03A9F4), headerLine = Color(0xFF0288D1), headerText = Color.White,
                        tabBar = Color(0xFF03A9F4), tabText = Color.White, page = Color(0xFF03A9F4), text = Color.White)
                    Tab.DAILY -> light.copy(headerBar = Color(0xFF00BCD4), headerLine = Color(0xFF0097A7), headerText = Color.White,
                        tabBar = Color(0xFF00BCD4), tabText = Color.White, page = Color(0xFF00BCD4), text = Color.White)
                    else -> light.copy(headerBar = Color(0xFF444444), headerLine = Color(0xFF111111), headerText = Color.White)
                }
            }
        }
    }
}
