package com.tmantoinelaw.portal.web

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat

/**
 * The desktop keeps its process, its socket and its power blocker while a
 * call rings or runs; Android only lets a backgrounded app keep the
 * microphone and camera behind a foreground service. Started on
 * `data-tma-call` ringing/active, stopped when the attribute clears.
 *
 * The service's own notification *is* the incoming CallStyle (or the
 * in-progress tile). Posting a second shade entry beside it was the same
 * call twice.
 */
class CallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val info = CallNotifications.Info.parse(intent?.getStringExtra(EXTRA_INFO))
        val ringing = intent?.getBooleanExtra(EXTRA_RINGING, false) == true
        val headsUp = intent?.getBooleanExtra(EXTRA_HEADS_UP, ringing && !AppForeground.resumed) == true
        val notification = CallNotifications.forService(this, info, ringing, headsUp)
        startAsForeground(notification)
        return START_NOT_STICKY
    }

    private fun startAsForeground(notification: android.app.Notification) {
        val candidates = buildList {
            if (Build.VERSION.SDK_INT >= 34) {
                add(ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
            }
            if (Build.VERSION.SDK_INT >= 30) {
                add(ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
                add(ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            }
            add(0)
        }
        for (type in candidates) {
            val ok = runCatching {
                ServiceCompat.startForeground(this, CallNotifications.ONGOING_ID, notification, type)
            }.isSuccess
            if (ok) return
        }
    }

    companion object {
        private const val EXTRA_INFO = "info"
        private const val EXTRA_RINGING = "ringing"
        private const val EXTRA_HEADS_UP = "headsUp"

        fun start(context: Context, infoJson: String?, ringing: Boolean) {
            CallNotifications.cancelIncoming(context)
            val headsUp = ringing && !AppForeground.resumed
            val intent = Intent(context, CallService::class.java)
                .putExtra(EXTRA_INFO, infoJson)
                .putExtra(EXTRA_RINGING, ringing)
                .putExtra(EXTRA_HEADS_UP, headsUp)
            runCatching { androidx.core.content.ContextCompat.startForegroundService(context, intent) }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, CallService::class.java)) }
            CallNotifications.cancelIncoming(context)
        }
    }
}
