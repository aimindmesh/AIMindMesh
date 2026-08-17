#include <jni.h>
#include <string>
#include <vector>
#include "qnn_sd_engine.h"

static QnnSdEngine g_engine;

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeInit(
    JNIEnv* env,
    jobject /* this */,
    jstring modelDirStr,
    jstring nativeLibDirStr
) {
    if (!modelDirStr) return JNI_FALSE;
    const char* pathChars = env->GetStringUTFChars(modelDirStr, nullptr);
    std::string path(pathChars);
    env->ReleaseStringUTFChars(modelDirStr, pathChars);

    std::string libDir = "";
    if (nativeLibDirStr) {
        const char* libChars = env->GetStringUTFChars(nativeLibDirStr, nullptr);
        libDir = std::string(libChars);
        env->ReleaseStringUTFChars(nativeLibDirStr, libChars);
    }

    bool ok = g_engine.init(path, libDir);
    return ok ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jboolean JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeIsReady(
    JNIEnv* /* env */,
    jobject /* this */
) {
    return g_engine.isReady() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jfloatArray JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeRunTextEncoder(
    JNIEnv* env,
    jobject /* this */,
    jintArray tokensArray
) {
    if (!g_engine.isReady() || !tokensArray) return nullptr;

    jsize len = env->GetArrayLength(tokensArray);
    if (len < 77) return nullptr;

    jint* tokensPtr = env->GetIntArrayElements(tokensArray, nullptr);
    std::vector<float> outputEmb(77 * 1024);

    bool ok = g_engine.runTextEncoder(reinterpret_cast<const int32_t*>(tokensPtr), outputEmb.data());
    env->ReleaseIntArrayElements(tokensArray, tokensPtr, JNI_ABORT);

    if (!ok) return nullptr;

    jfloatArray result = env->NewFloatArray(outputEmb.size());
    env->SetFloatArrayRegion(result, 0, outputEmb.size(), outputEmb.data());
    return result;
}

JNIEXPORT jfloatArray JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeRunUnet(
    JNIEnv* env,
    jobject /* this */,
    jfloatArray latentArray,
    jfloat timestep,
    jfloatArray textEmbArray
) {
    if (!g_engine.isReady() || !latentArray || !textEmbArray) return nullptr;

    jfloat* latentPtr = env->GetFloatArrayElements(latentArray, nullptr);
    jfloat* textEmbPtr = env->GetFloatArrayElements(textEmbArray, nullptr);

    size_t latentSize = 1 * 64 * 64 * 4;
    std::vector<float> outLatent(latentSize);

    bool ok = g_engine.runUnet(latentPtr, timestep, textEmbPtr, outLatent.data());

    env->ReleaseFloatArrayElements(latentArray, latentPtr, JNI_ABORT);
    env->ReleaseFloatArrayElements(textEmbArray, textEmbPtr, JNI_ABORT);

    if (!ok) return nullptr;

    jfloatArray result = env->NewFloatArray(outLatent.size());
    env->SetFloatArrayRegion(result, 0, outLatent.size(), outLatent.data());
    return result;
}

JNIEXPORT jbyteArray JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeRunVae(
    JNIEnv* env,
    jobject /* this */,
    jfloatArray latentArray
) {
    if (!g_engine.isReady() || !latentArray) return nullptr;

    jfloat* latentPtr = env->GetFloatArrayElements(latentArray, nullptr);
    size_t imageSize = 1 * 512 * 512 * 3;
    std::vector<uint8_t> outRgb(imageSize);

    bool ok = g_engine.runVae(latentPtr, outRgb.data());
    env->ReleaseFloatArrayElements(latentArray, latentPtr, JNI_ABORT);

    if (!ok) return nullptr;

    jbyteArray result = env->NewByteArray(outRgb.size());
    env->SetByteArrayRegion(result, 0, outRgb.size(), reinterpret_cast<const jbyte*>(outRgb.data()));
    return result;
}

JNIEXPORT void JNICALL
Java_com_aimindmesh_mobile_sd_QnnNativeBridge_nativeRelease(
    JNIEnv* /* env */,
    jobject /* this */
) {
    g_engine.release();
}

}
