/*
 * llama_inference_jni.cpp - JNI bindings for LLMInference
 * 
 * Bridges Java LlamaCppInference class to native C++ LLMInference,
 * providing efficient token streaming via llama.cpp.
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

// Global storage for inference instances
static std::map<jlong, std::unique_ptr<LLMInference>> g_inferences;
static jlong g_nextId = 1;
static std::mutex g_mutex;

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
    
    jboolean isCopy = JNI_TRUE;
    const char* modelPathCstr = env->GetStringUTFChars(modelPath, &isCopy);
    const char* chatTemplateCstr = chatTemplate ? env->GetStringUTFChars(chatTemplate, &isCopy) : nullptr;
    const char* multimodalProjCstr = (multimodalProj && env->GetStringLength(multimodalProj) > 0) 
                                     ? env->GetStringUTFChars(multimodalProj, &isCopy) 
                                     : nullptr;
    const char* cacheTypeKCstr = cacheTypeK ? env->GetStringUTFChars(cacheTypeK, &isCopy) : nullptr;
    const char* cacheTypeVCstr = cacheTypeV ? env->GetStringUTFChars(cacheTypeV, &isCopy) : nullptr;
    
    auto llmInference = std::make_unique<LLMInference>();
    
    try {
        llmInference->loadModel(
            modelPathCstr, multimodalProjCstr, minP, temperature, storeChats, contextSize, 
            chatTemplateCstr, nThreads, useMmap, useMlock, useVulkan, useOpenCL, useHexagon,
            nBatch, nUBatch, flashAttn, cacheTypeKCstr, cacheTypeVCstr, nGpuLayers
        );
    } catch (std::runtime_error& error) {
        LOGe("Failed to load model: %s", error.what());
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), error.what());
        env->ReleaseStringUTFChars(modelPath, modelPathCstr);
        if (chatTemplateCstr) env->ReleaseStringUTFChars(chatTemplate, chatTemplateCstr);
        if (multimodalProjCstr) env->ReleaseStringUTFChars(multimodalProj, multimodalProjCstr);
        if (cacheTypeKCstr) env->ReleaseStringUTFChars(cacheTypeK, cacheTypeKCstr);
        if (cacheTypeVCstr) env->ReleaseStringUTFChars(cacheTypeV, cacheTypeVCstr);
        return -1;
    }
    
    env->ReleaseStringUTFChars(modelPath, modelPathCstr);
    if (chatTemplateCstr) env->ReleaseStringUTFChars(chatTemplate, chatTemplateCstr);
    if (multimodalProjCstr) env->ReleaseStringUTFChars(multimodalProj, multimodalProjCstr);
    if (cacheTypeKCstr) env->ReleaseStringUTFChars(cacheTypeK, cacheTypeKCstr);
    if (cacheTypeVCstr) env->ReleaseStringUTFChars(cacheTypeV, cacheTypeVCstr);
    
    std::lock_guard<std::mutex> lock(g_mutex);
    jlong id = g_nextId++;
    g_inferences[id] = std::move(llmInference);
    
    LOGi("Model loaded successfully with ID: %ld", (long)id);
    return id;
}

/**
 * Add a message to the chat history.
 */
JNIEXPORT void JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_addChatMessageNative(
    JNIEnv* env, jobject thiz, jlong modelPtr, jstring message, jstring role) {
    
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_inferences.find(modelPtr);
    if (it == g_inferences.end()) {
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), "Invalid model handle");
        return;
    }
    
    jboolean isCopy = JNI_TRUE;
    const char* messageCstr = env->GetStringUTFChars(message, &isCopy);
    const char* roleCstr = env->GetStringUTFChars(role, &isCopy);
    
    it->second->addChatMessage(messageCstr, roleCstr);
    
    env->ReleaseStringUTFChars(message, messageCstr);
    env->ReleaseStringUTFChars(role, roleCstr);
}

/**
 * Get the response generation speed in tokens per second.
 */
JNIEXPORT jfloat JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_getResponseGenerationSpeedNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {
    
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_inferences.find(modelPtr);
    if (it == g_inferences.end()) {
        return 0.0f;
    }
    return it->second->getResponseGenerationTime();
}

/**
 * Get the number of tokens used in the context window.
 */
JNIEXPORT jint JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_getContextSizeUsedNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {
    
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_inferences.find(modelPtr);
    if (it == g_inferences.end()) {
        return 0;
    }
    return it->second->getContextSizeUsed();
}

/**
 * Get performance metrics as JSON string.
 */
JNIEXPORT jstring JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_getMetricsNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {
    
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_inferences.find(modelPtr);
    if (it == g_inferences.end()) {
        return env->NewStringUTF("{}");
    }
    
    std::map<std::string, double> metrics = it->second->getMetrics();
    
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
 * Close the model and free all resources.
 */
JNIEXPORT void JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_closeNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {
    
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_inferences.find(modelPtr);
    if (it != g_inferences.end()) {
        g_inferences.erase(it);
        LOGi("Model %ld closed and resources freed", (long)modelPtr);
    }
}

/**
 * Start a completion with the given user prompt.
 */
JNIEXPORT void JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_startCompletionNative(
    JNIEnv* env, jobject thiz, jlong modelPtr, jstring prompt, jobjectArray images) {
    
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_inferences.find(modelPtr);
    if (it == g_inferences.end()) {
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), "Invalid model handle");
        return;
    }
    
    if (prompt == nullptr) {
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), "Invalid input: prompt is null");
        return;
    }

    jboolean isCopy = JNI_TRUE;
    const char* promptCstr = env->GetStringUTFChars(prompt, &isCopy);
    if (promptCstr == nullptr) {
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), "Failed to get UTF chars for prompt");
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
                env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), "Invalid input: image path is null");
                return;
            }
            const char* imageCstr = env->GetStringUTFChars(imageStr, &isCopy);
            if (imageCstr != nullptr) {
                imagesVec.push_back(std::string(imageCstr));
                env->ReleaseStringUTFChars(imageStr, imageCstr);
            }
        }
    }
    
    try {
        it->second->startCompletion(promptCstr, imagesVec);
    } catch (std::runtime_error& error) {
        env->ReleaseStringUTFChars(prompt, promptCstr);
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), error.what());
        return;
    }
    
    env->ReleaseStringUTFChars(prompt, promptCstr);
}

/**
 * Generate the next token(s).
 * Returns the generated text piece, "[EOG]" when complete, or "" if buffering UTF-8.
 */
JNIEXPORT jstring JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_completionLoopNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {
    
    // Don't hold lock during generation - allow interrupt from another thread
    LLMInference* inference = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        auto it = g_inferences.find(modelPtr);
        if (it == g_inferences.end()) {
            env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), "Invalid model handle");
            return nullptr;
        }
        inference = it->second.get();
    }
    
    try {
        std::string response = inference->completionLoop();
        return env->NewStringUTF(response.c_str());
    } catch (std::runtime_error& error) {
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), error.what());
        return nullptr;
    }
}

/**
 * Interrupt the current generation.
 */
JNIEXPORT void JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_interruptNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {
    
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_inferences.find(modelPtr);
    if (it != g_inferences.end()) {
        it->second->interrupt();
    }
}

/**
 * Clean up after completion.
 */
JNIEXPORT void JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_stopCompletionNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {
    
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_inferences.find(modelPtr);
    if (it != g_inferences.end()) {
        it->second->stopCompletion();
    }
}

/**
 * Check if the model is loaded and ready.
 */
JNIEXPORT jboolean JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_isModelLoadedNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {
    
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_inferences.find(modelPtr);
    if (it == g_inferences.end()) {
        return JNI_FALSE;
    }
    return it->second->isModelLoaded() ? JNI_TRUE : JNI_FALSE;
}

/**
 * Get the number of messages in the chat history.
 */
JNIEXPORT jint JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_getMessageCountNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {
    
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_inferences.find(modelPtr);
    if (it == g_inferences.end()) {
        return 0;
    }
    return it->second->getMessageCount();
}

/**
 * Explicitly reset the context (history and KV cache).
 */
JNIEXPORT void JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_resetContextNative(
    JNIEnv* env, jobject thiz, jlong modelPtr) {
    
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_inferences.find(modelPtr);
    if (it != g_inferences.end()) {
        it->second->resetContext();
        LOGi("Context reset for model %ld", (long)modelPtr);
    }
}

/**
 * Get formatted chat string directly from the LLM model using its template engine.
 */
JNIEXPORT jstring JNICALL
Java_com_aimindmesh_llama_LlamaCppInference_getFormattedChatNative(
    JNIEnv* env, jobject thiz, jlong modelPtr, jstring messages, jstring chatTemplate) {
    
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_inferences.find(modelPtr);
    if (it == g_inferences.end()) {
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), "Invalid model handle");
        return nullptr;
    }
    
    jboolean isCopy = JNI_TRUE;
    const char* messagesCstr = env->GetStringUTFChars(messages, &isCopy);
    const char* templateCstr = chatTemplate ? env->GetStringUTFChars(chatTemplate, &isCopy) : nullptr;
    
    try {
        std::string result = it->second->getFormattedChat(
            messagesCstr, 
            templateCstr ? templateCstr : ""
        );
        
        env->ReleaseStringUTFChars(messages, messagesCstr);
        if (templateCstr) env->ReleaseStringUTFChars(chatTemplate, templateCstr);
        
        return env->NewStringUTF(result.c_str());
    } catch (std::exception& error) {
        env->ReleaseStringUTFChars(messages, messagesCstr);
        if (templateCstr) env->ReleaseStringUTFChars(chatTemplate, templateCstr);
        
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), error.what());
        return nullptr;
    }
}

} // extern "C"
