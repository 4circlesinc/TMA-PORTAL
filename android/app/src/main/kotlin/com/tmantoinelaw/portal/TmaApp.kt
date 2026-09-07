package com.tmantoinelaw.portal

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

/** The process. Everything the app does lives in the window (MainActivity) and its WebView host. */
@HiltAndroidApp
class TmaApp : Application()
