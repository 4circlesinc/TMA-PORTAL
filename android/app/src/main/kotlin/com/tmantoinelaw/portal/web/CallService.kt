package com.tmantoinelaw.portal.web

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.ServiceCompat

/**
 * The desktop keeps its process, its socket and its power blocker while a
 * call rings or runs; Android only lets a backgrounded app keep the
 * microphone and camera behind a foreground service. Started on
 * `data-tma-call` ringing/active, or by a ring push with the app closed;
 * stopped when the call ends or stops ringing.
 *
 * The service's own notification *is* the incoming CallStyle (or the
 * in-progress tile). Posting a second shade entry beside it was the same
 * call twice.
 *
 * Rung while the app is not in front, the phone rings the way a phone call
 * does: its own ringtone and vibration, as the ringer switch allows, until
 * the call is answered, declined or stops ringing. The page in the app stays
 * quiet for that call (TMAMessagingCalls.silenceRing), so it never rings
 * twice. In front, the page's own ringtone is the one.
 */
class CallService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private var ringing = false
    private var ringer: Ringer? = null
    private val ringTimeout = Runnable {
        if (!ringing) return@Runnable
        stopRinging()
        CallSession.update("", null)
        stopSelf()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val info = CallNotifications.Info.parse(intent?.getStringExtra(EXTRA_INFO))
        val wasRinging = ringing
        ringing = intent?.getBooleanExtra(EXTRA_RINGING, false) == true
        val headsUp = intent?.getBooleanExtra(EXTRA_HEADS_UP, ringing && !AppForeground.resumed) == true
        // Lock-screen / background FSI has no JS clock; match the page's 40s
        // ring. The same ring started again (its push, then its page) keeps
        // the clock it already had.
        if (!ringing || !wasRinging) main.removeCallbacks(ringTimeout)
        if (ringing && headsUp && !wasRinging) main.postDelayed(ringTimeout, RING_TIMEOUT_MS)
        val notification = CallNotifications.forService(this, info, ringing, headsUp || (ringing && ringer != null))
        startAsForeground(notification, ringing)
        when {
            !ringing -> stopRinging()
            // Once the phone rings for a call it goes on ringing for it,
            // whether or not the app comes to the front meanwhile.
            headsUp && ringer == null -> ringer = Ringer(this).also { it.start() }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        main.removeCallbacks(ringTimeout)
        ringing = false
        stopRinging()
        if (instance === this) instance = null
        super.onDestroy()
    }

    private fun stopRinging() {
        ringer?.stop()
        ringer = null
    }

    /**
     * Ringing from the background (a push woke the app) only allows the
     * phone-call type: camera and microphone wait until the app is in use.
     * The call is answered in the app, which is in front by then, and the
     * service is started again with the full set.
     */
    private fun startAsForeground(notification: android.app.Notification, ringing: Boolean) {
        val candidates = buildList {
            if (Build.VERSION.SDK_INT >= 34) {
                val call = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
                val media = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
                if (ringing) { add(call); add(call or media) } else { add(call or media); add(call) }
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
        private const val RING_TIMEOUT_MS = 40_000L

        @Volatile private var instance: CallService? = null

        fun start(context: Context, infoJson: String?, ringing: Boolean) {
            CallNotifications.cancelIncoming(context)
            val headsUp = ringing && !AppForeground.resumed
            val intent = Intent(context, CallService::class.java)
                .putExtra(EXTRA_INFO, infoJson)
                .putExtra(EXTRA_RINGING, ringing)
                .putExtra(EXTRA_HEADS_UP, headsUp)
            runCatching { androidx.core.content.ContextCompat.startForegroundService(context, intent) }
        }

        /** Answered on this phone: the ring stops at once, before the page has caught up. */
        fun silence() {
            Handler(Looper.getMainLooper()).post { instance?.stopRinging() }
        }

        /** Whether the phone itself is ringing (so the page must not). */
        val ringsNatively: Boolean get() = instance?.ringer != null

        fun stop(context: Context) {
            silence()
            runCatching { context.stopService(Intent(context, CallService::class.java)) }
            CallNotifications.cancelIncoming(context)
        }
    }
}

/**
 * The phone's own ringtone and vibration, the way a phone call rings: the
 * ringer switch decides (silent: nothing, vibrate: vibration only, ring: both).
 */
private class Ringer(private val context: Context) {
    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
    private val audio = context.getSystemService(AudioManager::class.java)
    private var player: MediaPlayer? = null
    private var ringtone: Ringtone? = null
    private var vibrator: Vibrator? = null
    private var focus: AudioFocusRequest? = null

    fun start() {
        val mode = audio?.ringerMode ?: AudioManager.RINGER_MODE_NORMAL
        if (mode == AudioManager.RINGER_MODE_SILENT) return
        vibrate()
        if (mode != AudioManager.RINGER_MODE_NORMAL) return
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE) ?: return
        focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(attributes)
            .build()
            .also { audio?.requestAudioFocus(it) }
        player = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(attributes)
                setDataSource(context, uri)
                isLooping = true
                prepare()
                start()
            }
        }.getOrNull()
        if (player == null) {
            // Some phones' ringtone providers refuse MediaPlayer; Ringtone always plays it.
            ringtone = runCatching {
                RingtoneManager.getRingtone(context, uri)?.apply {
                    audioAttributes = attributes
                    if (Build.VERSION.SDK_INT >= 28) isLooping = true
                    play()
                }
            }.getOrNull()
        }
    }

    private fun vibrate() {
        val device = if (Build.VERSION.SDK_INT >= 31) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Vibrator::class.java)
        }
        if (device == null || !device.hasVibrator()) return
        vibrator = device
        val pattern = VibrationEffect.createWaveform(longArrayOf(0, 900, 1100), 0)
        runCatching {
            if (Build.VERSION.SDK_INT >= 33) {
                device.vibrate(pattern, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_RINGTONE))
            } else {
                @Suppress("DEPRECATION")
                device.vibrate(pattern, attributes)
            }
        }
    }

    fun stop() {
        runCatching { player?.stop() }
        runCatching { player?.release() }
        player = null
        runCatching { ringtone?.stop() }
        ringtone = null
        runCatching { vibrator?.cancel() }
        vibrator = null
        focus?.let { request -> runCatching { audio?.abandonAudioFocusRequest(request) } }
        focus = null
    }
}
