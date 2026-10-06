package com.ferrotune.music

import androidx.fragment.app.FragmentActivity
import org.junit.Assert.assertTrue
import org.junit.Test

class MainActivityTest {
    @Test fun `cast chooser has a fragment activity host`() {
        assertTrue(FragmentActivity::class.java.isAssignableFrom(MainActivity::class.java))
    }
}
