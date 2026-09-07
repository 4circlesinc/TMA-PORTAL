package com.tmantoinelaw.portal

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import dagger.hilt.android.HiltAndroidApp

/** The process. Everything the app does lives in the window (MainActivity) and its WebView host. */
@HiltAndroidApp
class TmaApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Push is optional: with no Firebase values the app runs on the websocket alone.
        if (BuildConfig.FIREBASE_APP_ID.isNotBlank() && FirebaseApp.getApps(this).isEmpty()) {
            runCatching {
                FirebaseApp.initializeApp(
                    this,
                    FirebaseOptions.Builder()
                        .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                        .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                        .setApiKey(BuildConfig.FIREBASE_API_KEY)
                        .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                        .build(),
                )
            }
        }
    }
}
