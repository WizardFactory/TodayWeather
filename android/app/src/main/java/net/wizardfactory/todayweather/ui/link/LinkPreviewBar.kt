package net.wizardfactory.todayweather.ui.link

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.ui.shell.ShellColors

object LinkPreviewTags {
    const val BAR = "link-preview-bar"
    const val ADD = "link-preview-add"
}

/**
 * The bar over the tab bar while a linked place shows without being saved (specs/deeplink.md §6.2): a note and Add to
 * favorites. It blocks nothing; leaving the place (the Locations tab, a swipe) removes it.
 */
@Composable
fun LinkPreviewBar(colors: ShellColors, onAdd: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(colors.tabBar).padding(horizontal = 12.dp, vertical = 6.dp).testTag(LinkPreviewTags.BAR),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.link_preview_note), Modifier.weight(1f), color = colors.tabText, fontSize = 13.sp,
            maxLines = 2, overflow = TextOverflow.Ellipsis)
        Box(
            Modifier.heightIn(min = 44.dp).border(1.dp, colors.tabSelected, RoundedCornerShape(6.dp))
                .background(colors.tabSelected, RoundedCornerShape(6.dp))
                .clickable(onClick = onAdd).semantics { role = Role.Button }
                .padding(horizontal = 14.dp).testTag(LinkPreviewTags.ADD),
            contentAlignment = Alignment.Center,
        ) {
            Text(stringResource(R.string.link_add_favorite), color = if (colors.tabSelected.luminance() > 0.5f) Color.Black else Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}
