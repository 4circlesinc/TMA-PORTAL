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
 */
class CallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val info = CallNotifications.Info.parse(intent?.getStringExtra(EXTRA_INFO))
        val ringing = intent?.getBooleanExtra(EXTRA_RINGING, false) == true
        val notification = CallNotifications.ongoing(this, info, ringing)
        val type = if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA else 0
        runCatching { ServiceCompat.startForeground(this, CallNotifications.ONGOING_ID, notification, type) }
            .onFailure { runCatching { ServiceCompat.startForeground(this, CallNotifications.ONGOING_ID, notification, if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0) } }
        return START_NOT_STICKY
    }

    companion object {
        private const val EXTRA_INFO = "info"
        private const val EXTRA_RINGING = "ringing"

        fun start(context: Context, infoJson: String?, ringing: Boolean) {
            val intent = Intent(context, CallService::class.java).putExtra(EXTRA_INFO, infoJson).putExtra(EXTRA_RINGING, ringing)
            runCatching { androidx.core.content.ContextCompat.startForegroundService(context, intent) }
        }

        fun stop(context: Context) { runCatching { context.stopService(Intent(context, CallService::class.java)) } }
    }
}
