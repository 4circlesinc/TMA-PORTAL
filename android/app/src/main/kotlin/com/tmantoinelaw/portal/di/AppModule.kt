package com.tmantoinelaw.portal.di

import android.os.Build
import com.tmantoinelaw.portal.BuildConfig
import com.tmantoinelaw.portal.core.network.PortalConfig
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun portalConfig(): PortalConfig = PortalConfig(
        origin = BuildConfig.PORTAL_ORIGIN.trimEnd('/'),
        rewriteLocalhost = BuildConfig.REWRITE_LOCALHOST,
        userAgent = "TMAPortal/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE}; ${Build.MODEL})",
    )
}
