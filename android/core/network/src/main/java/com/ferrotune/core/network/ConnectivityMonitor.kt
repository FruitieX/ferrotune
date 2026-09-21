package com.ferrotune.core.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Connectivity state used to drive offline UI and queue materialization. */
interface ConnectivityMonitor {
    val isOnline: StateFlow<Boolean>
}

@Singleton
class AndroidConnectivityMonitor @Inject constructor(
    @ApplicationContext context: Context,
) : ConnectivityMonitor {
    private val _isOnline = MutableStateFlow(true)
    override val isOnline: StateFlow<Boolean> = _isOnline.asStateFlow()

    init {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        if (manager == null) {
            _isOnline.value = false
        } else {
            _isOnline.value = manager.hasValidatedNetwork()
            runCatching {
                manager.registerDefaultNetworkCallback(
                    object : ConnectivityManager.NetworkCallback() {
                        override fun onAvailable(network: Network) {
                            _isOnline.value = manager.hasValidatedNetwork()
                        }

                        override fun onLost(network: Network) {
                            _isOnline.value = manager.hasValidatedNetwork()
                        }

                        override fun onCapabilitiesChanged(
                            network: Network,
                            capabilities: NetworkCapabilities,
                        ) {
                            _isOnline.value = capabilities.isUsable()
                        }
                    },
                )
            }.onFailure {
                _isOnline.value = manager.hasValidatedNetwork()
            }
        }
    }
}

private fun ConnectivityManager.hasValidatedNetwork(): Boolean {
    val network = activeNetwork ?: return false
    return getNetworkCapabilities(network)?.isUsable() ?: false
}

private fun NetworkCapabilities.isUsable(): Boolean =
    hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
        hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
