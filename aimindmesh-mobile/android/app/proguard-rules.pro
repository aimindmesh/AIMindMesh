# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Keep JNA classes - required for Vosk native library
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
-keepclassmembers class * extends com.sun.jna.Structure {
    <fields>;
    <methods>;
}
-keepclassmembers class * implements com.sun.jna.Callback {
    <methods>;
}

# Keep Vosk classes
-keep class org.vosk.** { *; }
-keep class com.alphacephei.vosk.** { *; }

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Ignore java.awt warnings from JNA
-dontwarn java.awt.**

# Keep ONNX Runtime classes (required for JNI text embedding)
-keep class ai.onnxruntime.** { *; }
-keep class com.microsoft.onnxruntime.** { *; }
-dontwarn ai.onnxruntime.**

# Keep Sherpa-ONNX classes (required for JNI)
-keep class com.k2fsa.sherpa.onnx.** { *; }
-dontwarn com.k2fsa.sherpa.onnx.**
-keep class com.k2fsa.sherpa.onnx.OfflineTts { *; }
-keep class com.k2fsa.sherpa.onnx.OfflineTtsConfig { *; }
-keep class com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig { *; }

# Gson rules (required for TextEmbedding plugin tokenizer parsing)
-keepattributes Signature
-keepattributes *Annotation*
-keep class sun.misc.Unsafe { *; }
-keep class com.google.gson.** { *; }

# Keep plugin classes that might be used via reflection or JNI
-keep class com.aimindmesh.textembedding.** { *; }
-keep class com.aimindmesh.speakerembedding.** { *; }

# Suppress warnings for missing annotations (safe to ignore)
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**

# TensorFlow Lite GPU delegate (LiteRT)
-dontwarn org.tensorflow.lite.gpu.GpuDelegateFactory$Options$GpuBackend
-dontwarn org.tensorflow.lite.gpu.GpuDelegateFactory$Options


# Capacitor Critical Rules - DO NOT REMOVE
-keep public class com.getcapacitor.** { *; }
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public void *(com.getcapacitor.PluginCall);
}
-keep class * extends com.getcapacitor.Plugin
-keep class * extends com.getcapacitor.BridgeActivity
-keep class * extends android.webkit.WebViewClient
-keep class * extends android.webkit.WebChromeClient

# Plugins
-keep class ai.annadata.plugin.capacitor.** { *; }
-keep class com.aimindmesh.litert.** { *; }
-keep class com.aimindmesh.** { *; }

# LiteRT (Gemma / WakeWord) - Modern com.google.ai.edge.litert namespace
-keep class com.google.ai.edge.litert.** { *; }
-keep class com.google.ai.edge.litertlm.** { *; }

# Legacy TFLite suppression (for transitive TFLite-Support references)
-dontwarn org.tensorflow.lite.**



