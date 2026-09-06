package com.tmantoinelaw.portal.core.network.cookies

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** The session cookie is a bearer credential; it never sits on disk in the clear. */
class EncryptedCookieStore(context: Context) : CookieStore {
    private val prefs = run {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context,
            "tma.cookies",
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    override fun read(): String? = prefs.getString(KEY, null)
    override fun write(json: String) { prefs.edit().putString(KEY, json).apply() }
    override fun clear() { prefs.edit().remove(KEY).apply() }

    private companion object { const val KEY = "jar" }
}
