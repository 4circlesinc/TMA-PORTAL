package com.tmantoinelaw.portal.notify

import android.content.Context
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.tmantoinelaw.portal.core.data.notifications.NotificationsRepository
import com.tmantoinelaw.portal.core.data.realtime.RealtimeCoordinator
import com.tmantoinelaw.portal.core.data.session.SessionRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Foreground: socket up, no OS banners (the in-app toast shows). Background:
 * the socket lets go after its grace period, and anything that still arrives
 * is raised as an OS notification (prompt §4.4, §12).
 */
@Singleton
class ForegroundWatcher @Inject constructor(
    @ApplicationContext private val context: Context,
    private val realtime: RealtimeCoordinator,
    private val notifications: NotificationsRepository,
    private val session: SessionRepository,
    private val os: OsNotifications,
) : DefaultLifecycleObserver {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    @Volatile var inFront = false
        private set

    fun start() {
        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
        os.ensureChannels(context)
        notifications.created.onEach { item ->
            val identity = session.identity.value ?: return@onEach
            if (!inFront) os.show(context, identity, item, notifications.unread.value)
        }.launchIn(scope)
        session.signedOut.onEach { os.clearAll(context) }.launchIn(scope)
    }

    override fun onStart(owner: LifecycleOwner) {
        inFront = true
        realtime.setForeground(true)
        scope.launch(Dispatchers.IO) { notifications.catchUp() }
    }

    override fun onStop(owner: LifecycleOwner) {
        inFront = false
        realtime.setForeground(false)
    }
}
