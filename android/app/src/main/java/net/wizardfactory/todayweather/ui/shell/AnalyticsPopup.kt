package net.wizardfactory.todayweather.ui.shell

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import net.wizardfactory.todayweather.R

/**
 * 이용 통계's popup over the menu (#2894; analytics default-on, AK 2026-11-24): where usage analytics is on by default the
 * native text, which says it stays on unless turned off here, with 끄기 and 켜기; in the opt-in regions ([optIn]) the
 * Cordova consent question with 거부 / 철회 and 동의 (native texts: the Cordova wording in en, ko and ja, translated in
 * de, zh-CN and zh-TW). [onChoose] gets the choice; back closes it without one (B17).
 */
@Composable
fun AnalyticsPopup(optIn: Boolean, onChoose: (Boolean) -> Unit, onBack: () -> Unit) {
    IonicPopup(
        stringResource(R.string.analytics_label),
        listOf(stringResource(if (optIn) R.string.analytics_consent_detail else R.string.analytics_detail)),
        listOf(
            PopupButton(stringResource(if (optIn) R.string.analytics_consent_deny else R.string.analytics_turn_off)) { onChoose(false) },
            PopupButton(stringResource(if (optIn) R.string.analytics_consent_allow else R.string.analytics_turn_on)) { onChoose(true) },
        ),
        onBack = onBack,
    )
}

/** A withdrawal is still being saved. The pending dialog also survives Activity recreation. */
@Composable
fun AnalyticsWithdrawalProgress() {
    IonicPopup(stringResource(R.string.analytics_label), emptyList(), emptyList(), onBack = {}, body = {
        Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
    })
}
