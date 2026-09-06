package com.tmantoinelaw.portal.core.data.identity

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import com.tmantoinelaw.portal.core.network.api.MeDto
import com.tmantoinelaw.portal.core.network.api.PortalJson
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The remembered `/me`, the desktop's `localStorage['tma.me']`
 * (public/js/current-user.js:280-298): painted before the network answers,
 * deleted by any non-2xx answer, kept across a network failure.
 */
@Singleton
class IdentityStore @Inject constructor(private val store: DataStore<Preferences>) {
    private val meKey = stringPreferencesKey("me.json")
    private val savedAtKey = longPreferencesKey("me.savedAt")

    val identity: Flow<Identity?> = store.data.map { prefs ->
        prefs[meKey]?.let { raw -> runCatching { PortalJson.decodeFromString(MeDto.serializer(), raw).toIdentity() }.getOrNull() }
    }

    suspend fun save(raw: String) {
        store.edit { it[meKey] = raw; it[savedAtKey] = System.currentTimeMillis() }
    }

    suspend fun clear() {
        store.edit { it.remove(meKey); it.remove(savedAtKey) }
    }
}
