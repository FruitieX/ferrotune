package com.ferrotune.core.datastore.di

import com.ferrotune.core.datastore.AccountStore
import com.ferrotune.core.datastore.Accounts
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class DataStoreModule {
    @Binds
    @Singleton
    abstract fun bindAccounts(impl: AccountStore): Accounts
}
