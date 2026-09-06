package com.tmantoinelaw.portal.core.data.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import com.tmantoinelaw.portal.core.data.auth.EncryptedVerifierStore
import com.tmantoinelaw.portal.core.data.auth.VerifierStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

private val Context.identityDataStore: DataStore<Preferences> by preferencesDataStore(name = "identity")

@Module
@InstallIn(SingletonComponent::class)
object DataModule {
    @Provides
    @Singleton
    fun preferences(@ApplicationContext context: Context): DataStore<Preferences> = context.identityDataStore

    @Provides
    @Singleton
    fun verifierStore(@ApplicationContext context: Context): VerifierStore = EncryptedVerifierStore(context)
}
