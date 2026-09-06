package com.tmantoinelaw.portal.core.network.di

import android.content.Context
import com.tmantoinelaw.portal.core.network.PortalConfig
import com.tmantoinelaw.portal.core.network.api.PortalHttp
import com.tmantoinelaw.portal.core.network.cookies.EncryptedCookieStore
import com.tmantoinelaw.portal.core.network.cookies.PersistentCookieJar
import com.tmantoinelaw.portal.core.network.interceptors.CsrfRetryInterceptor
import com.tmantoinelaw.portal.core.network.interceptors.PortalHeadersInterceptor
import com.tmantoinelaw.portal.core.network.session.SessionState
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun cookieJar(@ApplicationContext context: Context): PersistentCookieJar =
        PersistentCookieJar(EncryptedCookieStore(context))

    @Provides
    @Singleton
    fun okHttp(config: PortalConfig, jar: PersistentCookieJar, session: SessionState): OkHttpClient =
        OkHttpClient.Builder()
            .cookieJar(jar)
            // A 302 is a wall to hand to the browser, never a page to fetch.
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .addInterceptor(PortalHeadersInterceptor(config, jar, session))
            .addInterceptor(CsrfRetryInterceptor(config, jar, session))
            .build()

    @Provides
    @Singleton
    fun portalHttp(client: OkHttpClient, config: PortalConfig, session: SessionState): PortalHttp =
        PortalHttp(client, config, session)
}
