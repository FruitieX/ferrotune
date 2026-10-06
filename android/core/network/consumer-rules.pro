# Retrofit discovers suspend response types only through Continuation<T>.
# Responses whose values are ignored can otherwise disappear in R8 full mode,
# leaving Continuation<Object> and no kotlinx.serialization converter.
-keep,allowobfuscation @kotlinx.serialization.Serializable class com.ferrotune.core.network.** { *; }
