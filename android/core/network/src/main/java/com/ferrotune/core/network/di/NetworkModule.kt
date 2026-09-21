package com.ferrotune.core.network.di

import com.ferrotune.core.network.AccountApiFactory
import com.ferrotune.core.network.AndroidConnectivityMonitor
import com.ferrotune.core.network.AuthenticatedApiProvider
import com.ferrotune.core.network.ConnectivityMonitor
import com.ferrotune.core.network.FerrotuneApiFactory
import com.ferrotune.core.network.FerrotuneApiProvider
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class NetworkModule {
    @Binds
    @Singleton
    abstract fun bindFerrotuneApiProvider(impl: AuthenticatedApiProvider): FerrotuneApiProvider

    @Binds
    @Singleton
    abstract fun bindConnectivityMonitor(impl: AndroidConnectivityMonitor): ConnectivityMonitor

    @Binds
    @Singleton
    abstract fun bindAccountApiFactory(impl: FerrotuneApiFactory): AccountApiFactory
}
