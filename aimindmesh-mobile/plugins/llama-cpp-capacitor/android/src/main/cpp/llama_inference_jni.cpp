/*
 * llama_inference_jni.cpp - JNI bindings for LLMInference
 *
 * Bridges Java LlamaCppInference class to native C++ LLMInference,
 * providing efficient token streaming via llama.cpp.
 *
 * Lifetime: each handle maps to a shared InferenceEntry. A call takes a copy of the shared_ptr
 * under g_mutex and then works without it, so closeNative() only drops the map's reference:
 * the model is freed when the last running call returns, never under it.
 */

#include "LLMInference.h"
#include <jni.h>
#include <android/log.h>
#include <map>
#include <memory>
#include <mutex>

#define TAG "[LlamaCppInference-JNI]"
#define LOGi(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGe(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

struct InferenceEntry {
    std::unique_ptr<LLMInference> inference;
    // Serializes calls that touch llama state (decode, KV cache, history); interrupt() never takes it
    std::mutex op_mutex;
};

// Global storage for inference instances
static std::map<jlong, std::shared_ptr<InferenceEntry>> g_inferences;
static jlong g_nextId = 1;
static std::mutex g_mutex;

static std::shared_ptr<InferenceEntry> findEntry(jlong id) {
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_inferences.find(id);
    return it == g_inferences.end() ? nullptr : it->second;
}

static void throwIllegalState(JNIEnv* env, const char* message) {
    jclass cls = env->FindClass("java/lang/IllegalStateException");
    if (cls != nullptr) {
        env->ThrowNew(cls, message);
        env->DeleteLocalRef(cls);
    }
}

// Releases a UTF chars buffer only if it was obtained
static void releaseChars(JNIEnv* env, jstring str, const char* chars) {
    if (str != nullptr && chars != nullptr) env->ReleaseStringUTFChars(str, chars);
}

extern "C" {

/**
 * Load a GGUF model and return a handle for subsequent operations.
 */
JNIEXPORT jlong JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_loadModelNative(
    JNIEnv* env, jobject thiz,
    jstring modelPath, jstring multimodalProj, jfloat minP, jfloat temperature,
    jboolean storeChats, jint contextSize, jstring chatTemplate,
    jint nThreads, jboolean useMmap, jboolean useMlock, jboolean useVulkan, jboolean useOpenCL, jboolean useHexagon,
    jint nBatch, jint nUBatch, jboolean flashAttn,
    jstring cacheTypeK, jstring cacheTypeV, jint nGpuLayers) {

    if (modelPath == nullptr) {
        throwIllegalState(env, "Model path is null");
        return -1;
    }
    const char* modelPathCstr = env->GetStringUTFChars(modelPath, nullptr);
    const char* chatTemplateCstr = chatTemplate ? env->GetStringUTFChars(chatTemplate, nullptr) : nullptr;
    const char* multimodalProjCstr = (multimodalProj && env->GetStringLength(multimodalProj) > 0)
                                     ? env->GetStringUTFChars(multimodalProj, nullptr)
                                     : nullptr;
    const char* cacheTypeKCstr = cacheTypeK ? env->GetStringUTFChars(cacheTypeK, nullptr) : nullptr;
    const char* cacheTypeVCstr = cacheTypeV ? env->GetStringUTFChars(cacheTypeV, nullptr) : nullptr;

    auto entry = std::make_shared<InferenceEntry>();
    entry->inference = std::make_unique<LLMInference>();
    std::string error;
    try {
        entry->inference->loadModel(
            modelPathCstr, multimodalProjCstr, minP, temperature, storeChats, contextSize,
            chatTemplateCstr, nThreads, useMmap, useMlock, useVulkan, useOpenCL, useHexagon,
            nBatch, nUBatch, flashAttn, cacheTypeKCstr, cacheTypeVCstr, nGpuLayers
        );
    } catch (std::exception& e) {
        error = e.what();
    }

    releaseChars(env, modelPath, modelPathCstr);
    releaseChars(env, chatTemplate, chatTemplateCstr);
    releaseChars(env, multimodalProj, multimodalProjCstr);
    releaseChars(env, cacheTypeK, cacheTypeKCstr);
    releaseChars(env, cacheTypeV, cacheTypeVCstr);

    if (!error.empty()) {
        LOGe("Failed to load model: %s", error.c_str());
        throwIllegalState(env, error.c_str());
        return -1;
    }

    std::lock_guard<std::mutex> lock(g_mutex);
    jlong id = g_nextId++;
    g_inferences[id] = entry;

    LOGi("Model loaded successfully with ID: %ld", (long)id);
    return id;
}

/**
 * Add a message to the chat history.
 */
JNIEXPORT void JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_addChatMessageNative(
    JNIEnv* env, jobject thiz, jlong modelPtr, jstring message, jstring role) {

    auto entry = findEntry(modelPtr);
    if (!entry) {
        throwIllegalState(env, "Invalid model handle");
        return;
    }
    if (message == nullptr || role == nullptr) {
        throwIllegalState(env, "Invalid input: message or role is null");
        return;
    }

    const char* messageCstr = env->GetStringUTFChars(message, nullptr);
    const char* roleCstr = env->GetStringUTFChars(role, nullptr);
    {
        std::lock_guard<std::mutex> op(entry->op_mutex);
        entry->inference->addChatMessage(messageCstr, roleCstr);
    }
    env->ReleaseStringUTFChars(message, messageCstr);
    env->ReleaseStringUTFChars(role, roleCstr);
}

/**
 * Get the response generation speed in tokens per second.
 */
JNIEXPORT jfloat JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_getResponseGenerationSpeedNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {

    auto entry = findEntry(modelPtr);
    return entry ? entry->inference->getResponseGenerationTime() : 0.0f;
}

/**
 * Get the number of tokens used in the context window.
 */
JNIEXPORT jint JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_getContextSizeUsedNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {

    auto entry = findEntry(modelPtr);
    return entry ? entry->inference->getContextSizeUsed() : 0;
}

/**
 * Get performance metrics as JSON string.
 */
JNIEXPORT jstring JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_getMetricsNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {

    auto entry = findEntry(modelPtr);
    if (!entry) {
        return env->NewStringUTF("{}");
    }

    std::map<std::string, double> metrics = entry->inference->getMetrics();

    // Simple JSON construction
    std::string json = "{";
    bool first = true;
    for (const auto& pair : metrics) {
        if (!first) json += ",";
        json += "\"" + pair.first + "\":" + std::to_string(pair.second);
        first = false;
    }
    json += "}";

    return env->NewStringUTF(json.c_str());
}

/**
 * Close the model. A completion still running keeps the model alive until it returns.
 */
JNIEXPORT void JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_closeNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {

    std::shared_ptr<InferenceEntry> entry;
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        auto it = g_inferences.find(modelPtr);
        if (it == g_inferences.end()) return;
        entry = it->second;
        g_inferences.erase(it);
    }
    // Makes a running decode abort; the entry is destroyed by whoever drops the last reference
    entry->inference->interrupt();
    LOGi("Model %ld closed (freed when no call is using it)", (long)modelPtr);
}

/**
 * Apply per-request sampling options before startCompletion.
 * temperature < 0 or topP <= 0 keep the load-time values; nPredict <= 0 means no limit.
 */
JNIEXPORT void JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_setSamplingNative(
    JNIEnv* env, jobject thiz, jlong modelPtr, jfloat temperature, jfloat topP, jint nPredict) {

    auto entry = findEntry(modelPtr);
    if (!entry) {
        throwIllegalState(env, "Invalid model handle");
        return;
    }
    std::lock_guard<std::mutex> op(entry->op_mutex);
    entry->inference->setSamplingOverrides(temperature, topP, nPredict);
}

/**
 * Start a completion with the given user prompt.
 */
JNIEXPORT void JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_startCompletionNative(
    JNIEnv* env, jobject thiz, jlong modelPtr, jstring prompt, jobjectArray images) {

    auto entry = findEntry(modelPtr);
    if (!entry) {
        throwIllegalState(env, "Invalid model handle");
        return;
    }

    if (prompt == nullptr) {
        throwIllegalState(env, "Invalid input: prompt is null");
        return;
    }

    const char* promptCstr = env->GetStringUTFChars(prompt, nullptr);
    if (promptCstr == nullptr) {
        throwIllegalState(env, "Failed to get UTF chars for prompt");
        return;
    }

    // Convert images array to vector of strings
    std::vector<std::string> imagesVec;
    if (images != nullptr) {
        int imageCount = env->GetArrayLength(images);
        for (int i = 0; i < imageCount; i++) {
            jstring imageStr = (jstring) env->GetObjectArrayElement(images, i);
            if (imageStr == nullptr) {
                env->ReleaseStringUTFChars(prompt, promptCstr);
                throwIllegalState(env, "Invalid input: image path is null");
                return;
            }
            const char* imageCstr = env->GetStringUTFChars(imageStr, nullptr);
            if (imageCstr != nullptr) {
                imagesVec.push_back(std::string(imageCstr));
                env->ReleaseStringUTFChars(imageStr, imageCstr);
            }
            env->DeleteLocalRef(imageStr);
        }
    }

    std::string promptStr(promptCstr);
    env->ReleaseStringUTFChars(prompt, promptCstr);

    // g_mutex is not held here: interrupt/metrics stay responsive during long image encoding
    std::string error;
    try {
        std::lock_guard<std::mutex> op(entry->op_mutex);
        entry->inference->startCompletion(promptStr.c_str(), imagesVec);
    } catch (std::exception& e) {
        error = e.what();
    }
    if (!error.empty()) {
        throwIllegalState(env, error.c_str());
    }
}

/**
 * Generate the next token(s).
 * Returns the generated text piece, "[EOG]" when complete, or "" if buffering UTF-8.
 */
JNIEXPORT jstring JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_completionLoopNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {

    // The shared_ptr copy keeps the model alive even if closeNative() runs meanwhile
    auto entry = findEntry(modelPtr);
    if (!entry) {
        throwIllegalState(env, "Invalid model handle");
        return nullptr;
    }

    std::string response;
    std::string error;
    try {
        std::lock_guard<std::mutex> op(entry->op_mutex);
        response = entry->inference->completionLoop();
    } catch (std::exception& e) {
        error = e.what();
    }
    if (!error.empty()) {
        throwIllegalState(env, error.c_str());
        return nullptr;
    }
    return env->NewStringUTF(response.c_str());
}

/**
 * Interrupt the current generation (also aborts a decode in progress).
 */
JNIEXPORT void JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_interruptNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {

    auto entry = findEntry(modelPtr);
    if (entry) {
        entry->inference->interrupt();
    }
}

/**
 * Clean up after completion.
 */
JNIEXPORT void JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_stopCompletionNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {

    auto entry = findEntry(modelPtr);
    if (entry) {
        std::lock_guard<std::mutex> op(entry->op_mutex);
        entry->inference->stopCompletion();
    }
}

/**
 * Check if the model is loaded and ready.
 */
JNIEXPORT jboolean JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_isModelLoadedNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {

    auto entry = findEntry(modelPtr);
    return (entry && entry->inference->isModelLoaded()) ? JNI_TRUE : JNI_FALSE;
}

/**
 * Get the number of messages in the chat history.
 */
JNIEXPORT jint JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_getMessageCountNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {

    auto entry = findEntry(modelPtr);
    return entry ? entry->inference->getMessageCount() : 0;
}

/**
 * Explicitly reset the context (history and KV cache).
 */
JNIEXPORT void JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_resetContextNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {

    auto entry = findEntry(modelPtr);
    if (entry) {
        std::lock_guard<std::mutex> op(entry->op_mutex);
        entry->inference->resetContext();
        LOGi("Context reset for model %ld", (long)modelPtr);
    }
}

/**
 * Save KV cache state for a specific sequence to a file.
 */
JNIEXPORT jboolean JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_saveStateNative(
    JNIEnv* env, jobject thiz, jlong modelPtr, jstring filepath, jint seqId) {

    auto entry = findEntry(modelPtr);
    if (!entry || filepath == nullptr) {
        LOGe("Invalid model handle %ld for saveState", (long)modelPtr);
        return JNI_FALSE;
    }

    const char* filepathCstr = env->GetStringUTFChars(filepath, nullptr);
    bool result;
    {
        std::lock_guard<std::mutex> op(entry->op_mutex);
        result = entry->inference->saveState(filepathCstr, seqId);
    }
    env->ReleaseStringUTFChars(filepath, filepathCstr);
    return result ? JNI_TRUE : JNI_FALSE;
}

/**
 * Load KV cache state for a specific sequence from a file.
 */
JNIEXPORT jboolean JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_loadStateNative(
    JNIEnv* env, jobject thiz, jlong modelPtr, jstring filepath, jint seqId) {

    auto entry = findEntry(modelPtr);
    if (!entry || filepath == nullptr) {
        LOGe("Invalid model handle %ld for loadState", (long)modelPtr);
        return JNI_FALSE;
    }

    const char* filepathCstr = env->GetStringUTFChars(filepath, nullptr);
    bool result;
    {
        std::lock_guard<std::mutex> op(entry->op_mutex);
        result = entry->inference->loadState(filepathCstr, seqId);
    }
    env->ReleaseStringUTFChars(filepath, filepathCstr);
    return result ? JNI_TRUE : JNI_FALSE;
}

/**
 * Get formatted chat string directly from the LLM model using its template engine.
 */
JNIEXPORT jstring JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_getFormattedChatNative(
    JNIEnv* env, jobject thiz, jlong modelPtr, jstring messages, jstring chatTemplate) {

    auto entry = findEntry(modelPtr);
    if (!entry) {
        throwIllegalState(env, "Invalid model handle");
        return nullptr;
    }
    if (messages == nullptr) {
        throwIllegalState(env, "Invalid input: messages is null");
        return nullptr;
    }

    const char* messagesCstr = env->GetStringUTFChars(messages, nullptr);
    const char* templateCstr = chatTemplate ? env->GetStringUTFChars(chatTemplate, nullptr) : nullptr;
    std::string messagesStr(messagesCstr);
    std::string templateStr(templateCstr ? templateCstr : "");
    env->ReleaseStringUTFChars(messages, messagesCstr);
    releaseChars(env, chatTemplate, templateCstr);

    std::string result;
    std::string error;
    try {
        result = entry->inference->getFormattedChat(messagesStr, templateStr);
    } catch (std::exception& e) {
        error = e.what();
    }
    if (!error.empty()) {
        throwIllegalState(env, error.c_str());
        return nullptr;
    }
    return env->NewStringUTF(result.c_str());
}

} // extern "C"
