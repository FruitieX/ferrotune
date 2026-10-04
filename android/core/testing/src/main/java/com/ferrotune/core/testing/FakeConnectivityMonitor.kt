package com.ferrotune.core.testing

import com.ferrotune.core.network.ConnectivityMonitor
import kotlinx.coroutines.flow.MutableStateFlow

/** [ConnectivityMonitor] whose state tests set directly. */
class FakeConnectivityMonitor(online: Boolean = true) : ConnectivityMonitor {
    override val isOnline = MutableStateFlow(online)
}
