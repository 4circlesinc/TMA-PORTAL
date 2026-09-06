package com.tmantoinelaw.portal.core.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/** Whether a network exists, for anything that must not touch Android in tests. */
interface NetworkState { val online: StateFlow<Boolean> }

/**
 * Whether the device has a network at all. Not whether the portal is at the
 * end of it: a captive portal is "online" and answers nothing, so callers
 * pair this with SessionState.reachable (portal-queue.js `online()`).
 */
@Singleton
class Connectivity @Inject constructor(@ApplicationContext context: Context) : NetworkState {
    private val manager = context.getSystemService(ConnectivityManager::class.java)
    private val _online = MutableStateFlow(current())
    override val online: StateFlow<Boolean> = _online.asStateFlow()

    init {
        manager.registerNetworkCallback(
            NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(),
            object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { _online.value = true }
                override fun onLost(network: Network) { _online.value = current() }
            },
        )
    }

    private fun current(): Boolean =
        manager.activeNetwork?.let { manager.getNetworkCapabilities(it) }?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
}
