package com.tmantoinelaw.portal.core.data.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** The desktop keeps its verifier in a 0600 file (desktop/signin-handoff.js); here it is an encrypted preference. */
class EncryptedVerifierStore(context: Context) : VerifierStore {
    private val prefs = run {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "tma.signin", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    override fun remember(verifier: String) { prefs.edit().putString(KEY, verifier).apply() }
    override fun stored(): String? = prefs.getString(KEY, null)?.takeIf { it.isNotBlank() }
    override fun forget() { prefs.edit().remove(KEY).apply() }

    private companion object { const val KEY = "verifier" }
}
