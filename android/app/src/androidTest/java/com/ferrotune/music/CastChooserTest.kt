package com.ferrotune.music

import android.Manifest
import android.os.Build
import android.view.ViewGroup
import android.view.WindowManager
import androidx.fragment.app.DialogFragment
import androidx.mediarouter.app.MediaRouteButton
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.cast.framework.CastButtonFactory
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.Before

/** Exercise the real activity, manifest Cast provider, and application theme. */
class CastChooserTest {
    @Before fun allowNotifications() {
        if (Build.VERSION.SDK_INT >= 33) {
            val instrumentation = InstrumentationRegistry.getInstrumentation()
            instrumentation.uiAutomation.grantRuntimePermission(
                instrumentation.targetContext.packageName,
                Manifest.permission.POST_NOTIFICATIONS,
            )
        }
    }

    @Test fun castButtonOpensChooserWithApplicationTheme() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                val button = MediaRouteButton(activity).apply { setAlwaysVisible(true) }
                CastButtonFactory.setUpMediaRouteButton(activity, button)
                activity.addContentView(button, ViewGroup.LayoutParams(64, 64))

                assertTrue(button.performClick())
                activity.supportFragmentManager.executePendingTransactions()
                val chooser = activity.supportFragmentManager.fragments
                    .filterIsInstance<DialogFragment>().single()
                assertTrue(chooser.requireDialog().isShowing)
                chooser.dismissNow()
            }
        }
    }
}
