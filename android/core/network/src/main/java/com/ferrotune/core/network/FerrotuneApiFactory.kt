package com.ferrotune.core.network

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FerrotuneApiFactory @Inject constructor() : AccountApiFactory {

    override fun create(serverUrl: String, sessionToken: String): FerrotuneApi =
        create(serverUrl, tokenProvider = { sessionToken })

    fun create(serverUrl: String, tokenProvider: (() -> String?)? = null): FerrotuneApi {
        val builder = OkHttpClient.Builder()
        if (tokenProvider != null) {
            builder.addInterceptor { chain ->
                chain.proceed(chain.request().withBearerToken(tokenProvider()))
            }
        }
        return create(serverUrl, builder.build())
    }

    fun create(serverUrl: String, client: OkHttpClient): FerrotuneApi =
        Retrofit.Builder()
            .baseUrl(serverUrl.trimEnd('/') + "/")
            .client(client)
            .addConverterFactory(FerrotuneJson.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(FerrotuneApi::class.java)
}
