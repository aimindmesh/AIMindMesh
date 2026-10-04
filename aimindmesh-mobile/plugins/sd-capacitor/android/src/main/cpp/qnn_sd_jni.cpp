#include <jni.h>
#include <string>
#include <vector>
#include "qnn_sd_engine.h"

static QnnSdEngine g_engine;

static std::string toString(JNIEnv* env, jstring s) {
    if (!s) return "";
    const char* chars = env->GetStringUTFChars(s, nullptr);
    std::string out(chars);
    env->ReleaseStringUTFChars(s, chars);
    return out;
}

static jfloatArray toFloatArray(JNIEnv* env, const std::vector<float>& v) {
    jfloatArray result = env->NewFloatArray(static_cast<jsize>(v.size()));
    if (result) env->SetFloatArrayRegion(result, 0, static_cast<jsize>(v.size()), v.data());
    return result;
}

static jbyteArray toByteArray(JNIEnv* env, const std::vector<uint8_t>& v) {
    jbyteArray result = env->NewByteArray(static_cast<jsize>(v.size()));
    if (result) env->SetByteArrayRegion(result, 0, static_cast<jsize>(v.size()), reinterpret_cast<const jbyte*>(v.data()));
    return result;
}

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeInit(JNIEnv* env, jobject, jstring modelDir, jstring nativeLibDir,
                                                       jstring htpArch) {
    if (!modelDir) return JNI_FALSE;
    return g_engine.init(toString(env, modelDir), toString(env, nativeLibDir), toString(env, htpArch)) ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jboolean JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeIsReady(JNIEnv*, jobject) {
    return g_engine.isReady() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jstring JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeModelInfo(JNIEnv* env, jobject) {
    return env->NewStringUTF(g_engine.isReady() ? g_engine.modelInfoJson().c_str() : "{}");
}

JNIEXPORT jfloatArray JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeRunTextEncoder(JNIEnv* env, jobject, jintArray tokensArray) {
    if (!g_engine.isReady() || !tokensArray) return nullptr;
    if (env->GetArrayLength(tokensArray) != static_cast<jsize>(g_engine.seqLen())) return nullptr;
    std::vector<int32_t> tokens(g_engine.seqLen());
    env->GetIntArrayRegion(tokensArray, 0, static_cast<jsize>(tokens.size()), reinterpret_cast<jint*>(tokens.data()));
    std::vector<float> emb(size_t(g_engine.seqLen()) * g_engine.embedDim());
    if (!g_engine.runTextEncoder(tokens.data(), emb.data())) return nullptr;
    return toFloatArray(env, emb);
}

JNIEXPORT jfloatArray JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeRunUnet(JNIEnv* env, jobject, jfloatArray latentArray, jfloat timestep, jfloatArray textEmbArray) {
    if (!g_engine.isReady() || !latentArray || !textEmbArray) return nullptr;
    const size_t latentSize = g_engine.latentSize();
    const size_t embSize = size_t(g_engine.seqLen()) * g_engine.embedDim();
    if (env->GetArrayLength(latentArray) != static_cast<jsize>(latentSize) ||
        env->GetArrayLength(textEmbArray) != static_cast<jsize>(embSize)) return nullptr;
    std::vector<float> latent(latentSize), emb(embSize), out(latentSize);
    env->GetFloatArrayRegion(latentArray, 0, static_cast<jsize>(latentSize), latent.data());
    env->GetFloatArrayRegion(textEmbArray, 0, static_cast<jsize>(embSize), emb.data());
    if (!g_engine.runUnet(latent.data(), timestep, emb.data(), out.data())) return nullptr;
    return toFloatArray(env, out);
}

JNIEXPORT jbyteArray JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeRunVae(JNIEnv* env, jobject, jfloatArray latentArray) {
    if (!g_engine.isReady() || !latentArray) return nullptr;
    const size_t latentSize = g_engine.latentSize();
    if (env->GetArrayLength(latentArray) != static_cast<jsize>(latentSize)) return nullptr;
    std::vector<float> latent(latentSize);
    env->GetFloatArrayRegion(latentArray, 0, static_cast<jsize>(latentSize), latent.data());
    std::vector<uint8_t> rgb(g_engine.imageBytes());
    if (!g_engine.runVae(latent.data(), rgb.data())) return nullptr;
    return toByteArray(env, rgb);
}

JNIEXPORT jfloatArray JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeRunVaeEncoder(JNIEnv* env, jobject, jbyteArray rgbArray) {
    if (!g_engine.hasVaeEncoder() || !rgbArray) return nullptr;
    if (env->GetArrayLength(rgbArray) != static_cast<jsize>(g_engine.imageBytes())) return nullptr;
    std::vector<uint8_t> rgb(g_engine.imageBytes());
    env->GetByteArrayRegion(rgbArray, 0, static_cast<jsize>(rgb.size()), reinterpret_cast<jbyte*>(rgb.data()));
    std::vector<float> latent(g_engine.latentSize());
    if (!g_engine.runVaeEncoder(rgb.data(), latent.data())) return nullptr;
    return toFloatArray(env, latent);
}

JNIEXPORT jboolean JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeHasVaeEncoder(JNIEnv*, jobject) {
    return g_engine.hasVaeEncoder() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jbyteArray JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeRunSuperResolution(JNIEnv* env, jobject, jbyteArray rgbArray) {
    if (!g_engine.hasSuperResolution() || !rgbArray) return nullptr;
    if (env->GetArrayLength(rgbArray) != static_cast<jsize>(g_engine.imageBytes())) return nullptr;
    std::vector<uint8_t> rgb(g_engine.imageBytes());
    env->GetByteArrayRegion(rgbArray, 0, static_cast<jsize>(rgb.size()), reinterpret_cast<jbyte*>(rgb.data()));
    std::vector<uint8_t> out(g_engine.srImageBytes());
    if (!g_engine.runSuperResolution(rgb.data(), out.data())) return nullptr;
    return toByteArray(env, out);
}

JNIEXPORT jboolean JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeHasSuperResolution(JNIEnv*, jobject) {
    return g_engine.hasSuperResolution() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jboolean JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeSetBurst(JNIEnv*, jobject, jboolean on) {
    return g_engine.isReady() && g_engine.setBurst(on == JNI_TRUE) ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeRelease(JNIEnv*, jobject) {
    g_engine.release();
}

}
