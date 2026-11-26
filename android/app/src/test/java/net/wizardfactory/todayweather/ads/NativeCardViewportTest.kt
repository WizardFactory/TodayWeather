package net.wizardfactory.todayweather.ads

import android.view.LayoutInflater
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import com.google.android.gms.ads.nativead.NativeAdView
import kotlinx.coroutines.runBlocking
import net.wizardfactory.todayweather.R
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The SDK judges an impression by the Android view, which the Compose scroll clip does not hide: the registered view
 * stays INVISIBLE while no part of the card is inside the scroll viewport (#3212).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NativeCardViewportTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private lateinit var scroll: ScrollState
    private var px = 0f
    private var registered: NativeAdView? = null

    /** A 300 dp viewport over 500 dp of forecast, the card, then 500 dp more; a 100 dp tab bar below. */
    private fun page(initial: Int = 0) {
        val card = NativeCard(register = { host, _ ->
            (LayoutInflater.from(host.context).inflate(R.layout.native_forecast_ad_compact, host, false) as NativeAdView)
                .also { registered = it }
        }, releaseAd = {})
        compose.setContent {
            px = LocalDensity.current.density
            scroll = rememberScrollState(initial)
            Column {
                Box(Modifier.fillMaxWidth().height(300.dp)) {
                    Column(Modifier.fillMaxWidth().verticalScroll(scroll)) {
                        Spacer(Modifier.fillMaxWidth().height(500.dp))
                        NativeCardHost(card, compact = true, dark = false)
                        Spacer(Modifier.fillMaxWidth().height(500.dp))
                    }
                }
                Spacer(Modifier.fillMaxWidth().height(100.dp))
            }
        }
        compose.waitForIdle()
    }

    private fun scrollTo(dp: Int) {
        runBlocking { scroll.scrollTo((dp * px).toInt()) }
        compose.waitForIdle()
    }

    private fun visibility() = compose.runOnIdle { registered!!.visibility }

    @Test fun aCardUnderTheTabBarIsHiddenFromTheSdkUntilItEntersTheViewport() {
        page()
        assertEquals("below the viewport, over the tab bar", View.INVISIBLE, visibility())
        scrollTo(190)
        assertEquals(View.INVISIBLE, visibility())
        scrollTo(210)
        assertEquals(View.VISIBLE, visibility())
    }

    @Test fun aCardScrolledPastIsHiddenAgain() {
        page()
        scrollTo(400)
        assertEquals(View.VISIBLE, visibility())
        scrollTo(900)
        assertEquals("above the viewport", View.INVISIBLE, visibility())
    }
}
