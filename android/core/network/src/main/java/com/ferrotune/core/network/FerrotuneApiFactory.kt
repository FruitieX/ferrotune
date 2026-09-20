package com.ferrotune.core.network

import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FerrotuneApiFactory @Inject constructor() {

    fun create(serverUrl: String, tokenProvider: (() -> String?)? = null): FerrotuneAuthApi {
        val builder = OkHttpClient.Builder()
        if (tokenProvider != null) {
            builder.addInterceptor(Interceptor { chain ->
                val token = tokenProvider()
                val request = if (token.isNullOrBlank()) {
                    chain.request()
                } else {
                    chain.request().newBuilder()
                        .header("Authorization", "Bearer $token")
                        .build()
                }
                chain.proceed(request)
            })
        }

        return Retrofit.Builder()
            .baseUrl(serverUrl.trimEnd('/') + "/")
            .client(builder.build())
            .addConverterFactory(FerrotuneJson.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(FerrotuneAuthApi::class.java)
    }
}
