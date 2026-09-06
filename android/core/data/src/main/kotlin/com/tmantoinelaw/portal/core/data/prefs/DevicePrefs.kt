package com.tmantoinelaw.portal.core.data.prefs

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Preferences that belong to this device rather than the account (the desktop's
 * settings.js). Account preferences go through `/me/preferences`; these stay here.
 */
@Singleton
class DevicePrefs @Inject constructor(private val store: DataStore<Preferences>) {
    private val themeKey = stringPreferencesKey("device.themeMode")
    private val sidebarKey = booleanPreferencesKey("device.sidebarCollapsed")
    private val appLockKey = booleanPreferencesKey("device.appLock")

    /** `light` (default), `dark`, or `system`; mirrors `/me/preferences.themeMode` until the account copy is synced. */
    val themeMode: Flow<String> = store.data.map { it[themeKey] ?: "light" }
    val sidebarCollapsed: Flow<Boolean> = store.data.map { it[sidebarKey] ?: false }
    val appLock: Flow<Boolean> = store.data.map { it[appLockKey] ?: false }

    suspend fun setThemeMode(mode: String) = store.edit { it[themeKey] = mode }
    suspend fun setSidebarCollapsed(collapsed: Boolean) = store.edit { it[sidebarKey] = collapsed }
    suspend fun setAppLock(enabled: Boolean) = store.edit { it[appLockKey] = enabled }
}
