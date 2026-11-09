package net.wizardfactory.todayweather.ui.start

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.sp
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.domain.start.RetryButton
import net.wizardfactory.todayweather.core.domain.start.RetryConfirm
import net.wizardfactory.todayweather.ui.shell.FixedLine
import net.wizardfactory.todayweather.ui.shell.Glyphs
import net.wizardfactory.todayweather.ui.shell.Icon
import net.wizardfactory.todayweather.ui.shell.IonicPopup
import net.wizardfactory.todayweather.ui.shell.LineText
import net.wizardfactory.todayweather.ui.shell.PopupButton
import net.wizardfactory.todayweather.ui.shell.line

object LocationPopupTags {
    const val START_CHOICE = "start-choice"
    const val START_CHOICE_OK = "start-choice-ok"
    fun startChoice(currentPosition: Boolean) = "start-choice-$currentPosition"
}

/** The strings of the location messages and buttons ([RetryConfirm], the add alerts), by their catalog key. */
private val LOCATION_STRINGS = mapOf(
    "LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED" to R.string.LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED,
    "LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION" to R.string.LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION,
    "LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION" to R.string.LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION,
    "LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI" to R.string.LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI,
    "LOC_FAIL_TO_GET_LOCATION_INFORMATION" to R.string.LOC_FAIL_TO_GET_LOCATION_INFORMATION,
    "LOC_PERMISSION_REQUEST_DENIED_PLEASE_SEARCH_BY_LOCATION_NAME_OR_RETRY" to R.string.LOC_PERMISSION_REQUEST_DENIED_PLEASE_SEARCH_BY_LOCATION_NAME_OR_RETRY,
    "LOC_OPENS_THE_APP_INFO_PAGE" to R.string.LOC_OPENS_THE_APP_INFO_PAGE,
    "LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED" to R.string.LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED,
    "LOC_FAIL_TO_GET_WEATHER_INFO" to R.string.LOC_FAIL_TO_GET_WEATHER_INFO,
    "LOC_CLOSE" to R.string.LOC_CLOSE,
    "LOC_SEARCH" to R.string.LOC_SEARCH,
    "LOC_SETTING" to R.string.LOC_SETTING,
    "LOC_OK" to R.string.LOC_OK,
)

/** [key] translated, as the translate filter does: a key without a string shows itself. */
@Composable
internal fun locationText(key: String): String = LOCATION_STRINGS[key]?.let { stringResource(it) } ?: key

/**
 * A location retry confirmation (`showRetryConfirm`): O04 on the start page, O03 of type `forecast` over the weather
 * pages. Titled 오류, its lines one under another and its buttons left to right; a button closes it and runs [onButton];
 * Android back closes it ([onBack]).
 */
@Composable
fun LocationRetryPopup(confirm: RetryConfirm, onBack: () -> Unit, onButton: (RetryButton) -> Unit) {
    IonicPopup(stringResource(R.string.LOC_ERROR), confirm.lines.map { locationText(it) },
        confirm.buttons.map { button -> PopupButton(locationText(button.key), positive = button.positive) { onButton(button) } }, onBack = onBack)
}

/**
 * O02, TabCtrl's `startPopup` with no enabled place (`.ionic_popup`: no head, 280 dp, white): two `ion-radio` rows on
 * `autoSearch` and OK. The rows keep Cordova's inverted values (A07): 현재위치 날씨보기 stands for false and 지역 검색으로
 * 시작 for true, and OK passes the value on as "the current position" ([onOk]). A row is 16 sp `#444` with 16 dp around
 * and 64 dp at the right for the check mark (ion-checkmark 24 sp, 14 dp in); the chosen row is `#f7f7f7`. Android back
 * answers "search" ([onBack]).
 */
@Composable
fun StartChoicePopup(autoSearch: Boolean, onChoose: (Boolean) -> Unit, onOk: () -> Unit, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    BoxWithConstraints(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars).background(Color(0x66000000)).pointerInput(Unit) {},
        contentAlignment = Alignment.Center) {
        Column(Modifier.width(min(maxWidth, 280.dp)).background(Color.White).testTag(LocationPopupTags.START_CHOICE)) {
            ChoiceRow(stringResource(R.string.LOC_USE_YOUR_CURRENT_LOCATION), checked = !autoSearch, Modifier.testTag(LocationPopupTags.startChoice(false))) {
                onChoose(false)
            }
            ChoiceRow(stringResource(R.string.LOC_FIND_LOCATION_BY_NAME), checked = autoSearch, Modifier.testTag(LocationPopupTags.startChoice(true))) {
                onChoose(true)
            }
            // .popup-buttons without padding, 44 dp: one button-positive OK.
            Box(Modifier.fillMaxWidth().height(44.dp).alpha(0.87f).background(Color(0xFF387EF5)).clickable(onClick = onOk)
                .testTag(LocationPopupTags.START_CHOICE_OK), contentAlignment = Alignment.Center) {
                FixedLine(20.dp) { LineText(stringResource(R.string.LOC_OK), line(15.sp, TextUnit.Unspecified, Color.White, FontWeight.Bold)) }
            }
        }
    }
}

@Composable
private fun ChoiceRow(label: String, checked: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(modifier.fillMaxWidth().heightIn(min = 52.dp).background(if (checked) Color(0xFFF7F7F7) else Color.White)
        .semantics { selected = checked }.clickable(role = Role.RadioButton, onClick = onClick)) {
        Box(Modifier.fillMaxWidth().padding(start = 16.dp, end = 64.dp, top = 16.dp, bottom = 16.dp)) {
            LineText(label, line(16.sp, TextUnit.Unspecified, Color(0xFF444444)), maxLines = Int.MAX_VALUE)
        }
        if (checked) {
            Icon {
                FixedLine(24.dp, Modifier.align(Alignment.CenterEnd).padding(end = 14.dp)) {
                    LineText(Glyphs.CHECKMARK, line(24.sp, TextUnit.Unspecified, Color(0xFF444444), family = Glyphs.ionicons))
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFFDDDDDD)).align(Alignment.BottomCenter))
    }
}
