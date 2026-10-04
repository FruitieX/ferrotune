# Referenced by name from the manifest's Cast OPTIONS_PROVIDER_CLASS_NAME
# meta-data, which R8 cannot see.
-keep class com.ferrotune.music.CastOptionsProvider { *; }

# Keep source file/line info so release stack traces stay readable.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
