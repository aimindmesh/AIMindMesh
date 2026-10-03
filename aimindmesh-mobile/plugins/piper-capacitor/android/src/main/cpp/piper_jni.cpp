#include <jni.h>
#include <string>
#include <android/log.h>
#include <vector>
#include <memory>
#include <fstream>
#include <iostream>
#include <array>
#include <mutex>
#include <sstream>
#include <cstdlib>

// ONNX Runtime headers
// ONNX Runtime headers
#include "onnxruntime_cxx_api.h"

#define TAG "PiperJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

#include <dlfcn.h>

// Proxy for OrtGetApiBase to allow dynamic loading of onnxruntime shared library
// This avoids link-time dependencies and version conflicts
extern "C" {
    // Exact signature matching standard onnxruntime_c_api.h
    const OrtApiBase* OrtGetApiBase(void) noexcept {
        typedef const OrtApiBase* (*GetApiBaseFunc)(void);
        static GetApiBaseFunc original_impl = nullptr;
        
        if (!original_impl) {
            // ALWAYS try to open the library explicitly to avoid finding OURSELF with RTLD_DEFAULT
            // This prevents infinite recursion.
            // On Android, the library is usually named "libonnxruntime.so"
            void* handle = dlopen("libonnxruntime.so", RTLD_LAZY);
            
            if (!handle) {
                // If standard name fails, try strict explicit path if known, or just log error.
                // But Java side loads "onnxruntime", so "libonnxruntime.so" should work.
                LOGE("Failed to explicitly dlopen libonnxruntime.so: %s", dlerror());
                
                // Last ditch effort: RTLD_NEXT (look for symbol in *next* library in search order)
                // Do NOT use RTLD_DEFAULT as it might find this function itself.
                original_impl = (GetApiBaseFunc)dlsym(RTLD_NEXT, "OrtGetApiBase");
            } else {
                original_impl = (GetApiBaseFunc)dlsym(handle, "OrtGetApiBase");
            }
        }
        
        if (original_impl) {
            return original_impl();
        }
        
        LOGE("FATAL: OrtGetApiBase symbol not found in Loaded Libraries!");
        return nullptr;
    }
}

// Global ONNX Runtime environment
std::unique_ptr<Ort::Env> ortEnv;
std::unique_ptr<Ort::Session> ortSession;
// Guards the globals above (Java also serializes, this keeps the native side self-contained)
static std::mutex ortMutex;

// Per-voice settings from the .onnx.json config: "low"/"x_low" voices are 16 kHz, so a
// hard-coded 22050 Hz header played them ~38% too fast.
static int voiceSampleRate = 22050;
static float voiceNoiseScale = 0.667f;
static float voiceLengthScale = 1.0f;
static float voiceNoiseW = 0.8f;

// Reads the first number after "key": in a small JSON config (no JSON dependency needed).
static double findJsonNumber(const std::string& json, const char* key, double fallback) {
    std::string quoted = std::string("\"") + key + "\"";
    size_t pos = json.find(quoted);
    if (pos == std::string::npos) return fallback;
    pos = json.find(':', pos + quoted.size());
    if (pos == std::string::npos) return fallback;
    const char* start = json.c_str() + pos + 1;
    char* end = nullptr;
    double value = std::strtod(start, &end);
    return end == start ? fallback : value;
}

static void loadVoiceConfig(const char* configPath) {
    std::ifstream file(configPath);
    std::stringstream buffer;
    buffer << file.rdbuf();
    std::string json = buffer.str();
    int rate = static_cast<int>(findJsonNumber(json, "sample_rate", 22050));
    voiceSampleRate = (rate >= 8000 && rate <= 48000) ? rate : 22050;
    voiceNoiseScale = static_cast<float>(findJsonNumber(json, "noise_scale", 0.667));
    voiceLengthScale = static_cast<float>(findJsonNumber(json, "length_scale", 1.0));
    voiceNoiseW = static_cast<float>(findJsonNumber(json, "noise_w", 0.8));
    LOGI("Voice config: sample_rate=%d noise_scale=%.3f length_scale=%.3f noise_w=%.3f",
         voiceSampleRate, voiceNoiseScale, voiceLengthScale, voiceNoiseW);
}

// WAV Header struct
struct WavHeader {
    char riff[4] = {'R', 'I', 'F', 'F'};
    uint32_t overall_size;
    char wave[4] = {'W', 'A', 'V', 'E'};
    char fmt_chunk_marker[4] = {'f', 'm', 't', ' '};
    uint32_t length_of_fmt = 16;
    uint16_t format_type = 1;
    uint16_t channels = 1;
    uint32_t sample_rate = 22050; // Default, will update from config
    uint32_t byterate;
    uint16_t block_align;
    uint16_t bits_per_sample = 16;
    char data_chunk_header[4] = {'d', 'a', 't', 'a'};
    uint32_t data_size;
};

bool writeWav(const std::string& filename, const std::vector<float>& audioData, int sampleRate) {
    std::ofstream file(filename, std::ios::binary);
    if (!file.is_open()) {
        LOGE("Failed to open file for writing: %s", filename.c_str());
        return false;
    }

    WavHeader header;
    header.sample_rate = sampleRate;
    header.bits_per_sample = 16;
    header.channels = 1;
    header.data_size = audioData.size() * sizeof(int16_t);
    header.overall_size = header.data_size + sizeof(WavHeader) - 8;
    header.block_align = header.channels * header.bits_per_sample / 8;
    header.byterate = header.sample_rate * header.block_align;

    file.write(reinterpret_cast<const char*>(&header), sizeof(WavHeader));

    // Convert float to int16
    for (float sample : audioData) {
        int16_t pcm = static_cast<int16_t>(std::max(-1.0f, std::min(1.0f, sample)) * 32767.0f);
        file.write(reinterpret_cast<const char*>(&pcm), sizeof(int16_t));
    }
    
    file.close();
    LOGI("WAV file written: %s", filename.c_str());
    return true;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_aimindmesh_piper_PiperSynthesizer_nativeLoadVoice(
        JNIEnv* env,
        jobject /* this */,
        jstring jModelPath,
        jstring jConfigPath) {
    
    const char* modelPath = env->GetStringUTFChars(jModelPath, 0);
    const char* configPath = env->GetStringUTFChars(jConfigPath, 0);

    LOGI("Loading voice model from: %s", modelPath);
    std::lock_guard<std::mutex> lock(ortMutex);

    try {
        if (!ortEnv) {
            LOGI("Creating Ort::Env...");
            ortEnv = std::make_unique<Ort::Env>(ORT_LOGGING_LEVEL_WARNING, "PiperJNI");
            LOGI("Ort::Env created");
        }

        Ort::SessionOptions sessionOptions;
        sessionOptions.SetIntraOpNumThreads(1);
        sessionOptions.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
        LOGI("SessionOptions configured");

        LOGI("Creating Ort::Session with model: %s", modelPath);
        ortSession = std::make_unique<Ort::Session>(*ortEnv, modelPath, sessionOptions);
        LOGI("Ort::Session created successfully");
        loadVoiceConfig(configPath);

        LOGI("ONNX model loaded successfully");
        
        env->ReleaseStringUTFChars(jModelPath, modelPath);
        env->ReleaseStringUTFChars(jConfigPath, configPath);
        return JNI_TRUE;

    } catch (const Ort::Exception& e) {
        LOGE("ONNX Runtime error: %s", e.what());
        env->ReleaseStringUTFChars(jModelPath, modelPath);
        env->ReleaseStringUTFChars(jConfigPath, configPath);
        return JNI_FALSE;
    } catch (const std::exception& e) {
        LOGE("Standard exception: %s", e.what());
        env->ReleaseStringUTFChars(jModelPath, modelPath);
        env->ReleaseStringUTFChars(jConfigPath, configPath);
        return JNI_FALSE;
    }
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_aimindmesh_piper_PiperSynthesizer_nativeSynthesize(
        JNIEnv* env,
        jobject /* this */,
        jlongArray jPhonemeIds,
        jstring jOutputPath) {
    
    std::lock_guard<std::mutex> lock(ortMutex);
    jsize numPhonemes = env->GetArrayLength(jPhonemeIds);
    jlong* phonemeIdsRaw = env->GetLongArrayElements(jPhonemeIds, 0);
    
    std::vector<int64_t> phonemeIds(phonemeIdsRaw, phonemeIdsRaw + numPhonemes);
    env->ReleaseLongArrayElements(jPhonemeIds, phonemeIdsRaw, 0);

    LOGI("Synthesizing with %d phonemes", numPhonemes);

    if (!ortSession) {
        LOGE("Session not initialized");
        return nullptr;
    }

    try {
        std::vector<int64_t> inputLengths = {static_cast<int64_t>(phonemeIds.size())};
        std::vector<float> scales = {voiceNoiseScale, voiceLengthScale, voiceNoiseW}; // noise_scale, length_scale, noise_w

        // Prepare inputs
        std::vector<const char*> inputNames = {"input", "input_lengths", "scales"};
        std::vector<Ort::Value> inputValues;

        Ort::MemoryInfo memoryInfo = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);

        inputValues.push_back(Ort::Value::CreateTensor<int64_t>(
            memoryInfo, phonemeIds.data(), phonemeIds.size(), 
            std::vector<int64_t>{1, static_cast<int64_t>(phonemeIds.size())}.data(), 2));

        inputValues.push_back(Ort::Value::CreateTensor<int64_t>(
            memoryInfo, inputLengths.data(), inputLengths.size(), 
            std::vector<int64_t>{1}.data(), 1));

        inputValues.push_back(Ort::Value::CreateTensor<float>(
            memoryInfo, scales.data(), scales.size(), 
            std::vector<int64_t>{3}.data(), 1));

        // Check if model expects 'sid' (Speaker ID)
        bool usesSid = false;
        size_t numInputNodes = ortSession->GetInputCount();
        for (size_t i = 0; i < numInputNodes; i++) {
            Ort::AllocatedStringPtr nameAllocated = ortSession->GetInputNameAllocated(i, Ort::AllocatorWithDefaultOptions());
            const char* name = nameAllocated.get();
            if (strcmp(name, "sid") == 0) {
                usesSid = true;
                break;
            }
        }

        if (usesSid) {
            LOGI("Model requires 'sid', adding default speaker ID 0");
            inputNames.push_back("sid");
            std::vector<int64_t> sid = {0}; // Default speaker 0
            inputValues.push_back(Ort::Value::CreateTensor<int64_t>(
                memoryInfo, sid.data(), sid.size(), 
                std::vector<int64_t>{1}.data(), 1));
        }

        // Run inference
        LOGI("Running inference...");
        std::vector<const char*> outputNames = {"output"};
        auto outputValues = ortSession->Run(
            Ort::RunOptions{nullptr}, 
            inputNames.data(), inputValues.data(), inputValues.size(), 
            outputNames.data(), outputNames.size());
        
        LOGI("Inference completed");

        // Get output audio
        float* floatAudio = outputValues[0].GetTensorMutableData<float>();
        size_t audioSize = outputValues[0].GetTensorTypeAndShapeInfo().GetElementCount();
        LOGI("Inference output size: %zu samples", audioSize);
        
        std::vector<float> audioData(floatAudio, floatAudio + audioSize);

        // Path comes from Java (cache dir): /data/user/0/... is wrong for secondary users/profiles
        const char* outputPathChars = env->GetStringUTFChars(jOutputPath, 0);
        std::string outputPath(outputPathChars);
        env->ReleaseStringUTFChars(jOutputPath, outputPathChars);
        if (!writeWav(outputPath, audioData, voiceSampleRate)) {
            return nullptr;
        }

        return env->NewStringUTF(outputPath.c_str());

    } catch (const Ort::Exception& e) {
        LOGE("ONNX Inference error: %s", e.what());
        return nullptr;
    } catch (const std::exception& e) {
        LOGE("Standard exception during synthesis: %s", e.what());
        return nullptr;
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_aimindmesh_piper_PiperSynthesizer_nativeUnload(
        JNIEnv* env,
        jobject /* this */) {
    
    LOGI("Unloading voice model");
    std::lock_guard<std::mutex> lock(ortMutex);
    ortSession.reset();
    // Keep environment alive
}
