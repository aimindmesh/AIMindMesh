/*
 * voxtral_jni.cpp - JNI bridge for Voxtral STT inference
 *
 * Uses the mtmd (multimodal) high-level API from llama.cpp to handle
 * the complete pipeline: PCM audio → mel spectrogram → CLIP encoding →
 * llama decode → token sampling → text output.
 *
 * The mtmd API handles audio preprocessing internally via
 * whisper_preprocessor::preprocess_audio() with precalculated 128-bin filters.
 */

#include <jni.h>
#include <android/log.h>
#include <string>
#include <vector>
#include <queue>
#include <mutex>
#include <atomic>

// llama.cpp core headers
#include "llama.h"
#include "ggml.h"
#include "common.h"

// Multimodal (handles audio → mel → CLIP internally)
#include "tools/mtmd/mtmd.h"
#include "tools/mtmd/mtmd-helper.h"

#define TAG "VoxtralJNI"
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)

// Audio parameters
#define MIN_PROCESS_SAMPLES 8000  // 0.5s minimum buffer before inference

// Error codes returned to Kotlin
#define VOXTRAL_OK                  0
#define VOXTRAL_ERR_NULL_HANDLE    -1
#define VOXTRAL_ERR_INIT_FAILED    -2
#define VOXTRAL_ERR_AUDIO_FAILED   -3
#define VOXTRAL_ERR_ENCODE_FAILED  -4
#define VOXTRAL_ERR_DECODE_FAILED  -5
#define VOXTRAL_ERR_SAMPLE_FAILED  -6
#define VOXTRAL_ERR_OOM            -7
#define VOXTRAL_ERR_BUFFERING       1  // Positive = still buffering, not an error

struct voxtral_context {
    // mtmd context (handles CLIP audio encoder + mel conversion)
    mtmd_context* mtmd_ctx = nullptr;

    // llama text model
    llama_model* llama_model = nullptr;
    llama_context* llama_ctx = nullptr;

    // Sampler for greedy decoding (temperature=0 for STT)
    llama_sampler* sampler = nullptr;

    // Token queue for async retrieval from Kotlin
    std::queue<std::string> token_queue;
    std::mutex queue_mutex;

    // Audio buffer for streaming chunks
    std::vector<float> audio_buffer;

    // KV cache position tracker
    llama_pos n_past = 0;

    // Processing state
    std::atomic<bool> is_processing{false};

    // Configuration
    int n_threads = 4;
    int n_batch = 512;
};

// ============================================================================
// Helper: Push a token string into the queue (thread-safe)
// ============================================================================
static void push_token(voxtral_context* ctx, const std::string& token) {
    std::lock_guard<std::mutex> lock(ctx->queue_mutex);
    ctx->token_queue.push(token);
}

// ============================================================================
// Helper: Run the sampling loop after audio has been decoded into KV cache
// Samples tokens from the llama context until EOS/EOT.
// ============================================================================
static int run_sampling_loop(voxtral_context* ctx) {
    int n_tokens_generated = 0;
    const int max_tokens = 4096;  // Safety limit for STT output

    const llama_vocab* vocab = llama_model_get_vocab(ctx->llama_model);
    if (!vocab) {
        LOGE("Failed to get vocab from model");
        return VOXTRAL_ERR_SAMPLE_FAILED;
    }

    // UTF-8 buffering (same pattern as LLMInference)
    std::string utf8_buffer;

    for (int i = 0; i < max_tokens; i++) {
        // Sample next token
        llama_token token = llama_sampler_sample(ctx->sampler, ctx->llama_ctx, -1);

        // Accept token into sampler state
        llama_sampler_accept(ctx->sampler, token);

        // Check for end of generation
        if (llama_vocab_is_eog(vocab, token)) {
            LOGI("EOS reached after %d tokens", n_tokens_generated);
            // Flush any remaining UTF-8 buffer
            if (!utf8_buffer.empty()) {
                push_token(ctx, utf8_buffer);
                utf8_buffer.clear();
            }
            break;
        }

        // Convert token to text
        std::string piece = common_token_to_piece(ctx->llama_ctx, token, false);

        if (piece.empty()) {
            continue;
        }

        // Buffer for UTF-8 validation
        utf8_buffer += piece;

        // Simple UTF-8 completeness check: if last byte doesn't look like
        // a continuation byte start, emit the buffer
        unsigned char last_byte = (unsigned char)utf8_buffer.back();
        bool might_be_incomplete = (last_byte & 0x80) != 0 &&
                                   (last_byte & 0xC0) == 0xC0;

        if (!might_be_incomplete) {
            push_token(ctx, utf8_buffer);
            utf8_buffer.clear();
        }

        n_tokens_generated++;

        // Prepare batch for next token
        llama_batch batch = llama_batch_init(1, 0, 1);
        batch.n_tokens = 1;
        batch.token[0] = token;
        batch.pos[0] = ctx->n_past;
        batch.n_seq_id[0] = 1;
        batch.seq_id[0][0] = 0;
        batch.logits[0] = true;

        ctx->n_past++;

        if (llama_decode(ctx->llama_ctx, batch) != 0) {
            LOGE("llama_decode failed at token %d", i);
            llama_batch_free(batch);
            return VOXTRAL_ERR_DECODE_FAILED;
        }

        llama_batch_free(batch);
    }

    return n_tokens_generated;
}

// ============================================================================
// JNI Methods
// ============================================================================

extern "C" {

JNIEXPORT jlong JNICALL
Java_com_aimindmesh_mobile_voxtral_VoxtralInferenceEngine_nativeInitModel(
    JNIEnv* env,
    jobject thiz,
    jstring j_model_path,
    jstring j_mmproj_path,
    jint j_n_threads
) {
    const char* model_path = env->GetStringUTFChars(j_model_path, nullptr);
    const char* mmproj_path = env->GetStringUTFChars(j_mmproj_path, nullptr);
    int n_threads = (int)j_n_threads;

    LOGI("Initializing Voxtral model");
    LOGI("  Model: %s", model_path);
    LOGI("  MM Projector: %s", mmproj_path);
    LOGI("  Threads: %d", n_threads);

    voxtral_context* ctx = new voxtral_context();
    ctx->n_threads = n_threads;

    // 0. Global Init
    lm_ggml_backend_load_all();

    // 1. Load Llama model
    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0;  // CPU only for STT (saves GPU memory)
    model_params.use_mmap = true;

    ctx->llama_model = llama_model_load_from_file(model_path, model_params);
    if (ctx->llama_model == nullptr) {
        LOGE("Failed to load llama model from: %s", model_path);
        delete ctx;
        env->ReleaseStringUTFChars(j_model_path, model_path);
        env->ReleaseStringUTFChars(j_mmproj_path, mmproj_path);
        return 0;
    }
    LOGI("Llama model loaded successfully");

    // 2. Create Llama Context
    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = 4096;        // Enough for ~1 min audio chunk
    ctx_params.n_batch = 512;
    ctx_params.n_threads = n_threads;
    ctx_params.n_threads_batch = n_threads;
    ctx_params.no_perf = true;

    ctx->llama_ctx = llama_init_from_model(ctx->llama_model, ctx_params);
    if (ctx->llama_ctx == nullptr) {
        LOGE("Failed to create llama context");
        llama_model_free(ctx->llama_model);
        delete ctx;
        env->ReleaseStringUTFChars(j_model_path, model_path);
        env->ReleaseStringUTFChars(j_mmproj_path, mmproj_path);
        return 0;
    }
    ctx->n_batch = ctx_params.n_batch;
    LOGI("Llama context created (n_ctx=%d)", ctx_params.n_ctx);

    // 3. Initialize mtmd (multimodal context - handles CLIP + audio preprocessing)
    mtmd_context_params mtmd_params = mtmd_context_params_default();
    mtmd_params.use_gpu = false;    // CPU for stability on mobile
    mtmd_params.n_threads = n_threads;


    ctx->mtmd_ctx = mtmd_init_from_file(mmproj_path, ctx->llama_model, mtmd_params);
    if (ctx->mtmd_ctx == nullptr) {
        LOGE("Failed to initialize mtmd context from: %s", mmproj_path);
        llama_free(ctx->llama_ctx);
        llama_model_free(ctx->llama_model);
        delete ctx;
        env->ReleaseStringUTFChars(j_model_path, model_path);
        env->ReleaseStringUTFChars(j_mmproj_path, mmproj_path);
        return 0;
    }

    if (!mtmd_support_audio(ctx->mtmd_ctx)) {
        LOGE("Model does not support audio input!");
        mtmd_free(ctx->mtmd_ctx);
        llama_free(ctx->llama_ctx);
        llama_model_free(ctx->llama_model);
        delete ctx;
        env->ReleaseStringUTFChars(j_model_path, model_path);
        env->ReleaseStringUTFChars(j_mmproj_path, mmproj_path);
        return 0;
    }
    LOGI("mtmd audio context initialized (sample_rate=%d Hz)", mtmd_get_audio_sample_rate(ctx->mtmd_ctx));

    // 4. Initialize Sampler (greedy for STT - temperature = 0)
    llama_sampler_chain_params sampler_params = llama_sampler_chain_default_params();
    sampler_params.no_perf = true;
    ctx->sampler = llama_sampler_chain_init(sampler_params);

    // Greedy decoding: temperature 0 + argmax
    llama_sampler_chain_add(ctx->sampler, llama_sampler_init_temp(0.0f));
    llama_sampler_chain_add(ctx->sampler, llama_sampler_init_greedy());
    LOGI("Sampler initialized (greedy/temperature=0)");

    env->ReleaseStringUTFChars(j_model_path, model_path);
    env->ReleaseStringUTFChars(j_mmproj_path, mmproj_path);

    LOGI("Voxtral initialization complete (handle: %p)", ctx);
    return (jlong)ctx;
}

JNIEXPORT jint JNICALL
Java_com_aimindmesh_mobile_voxtral_VoxtralInferenceEngine_nativeProcessAudio(
    JNIEnv* env,
    jobject thiz,
    jlong j_handle,
    jfloatArray j_audio_samples,
    jint j_n_samples
) {
    voxtral_context* ctx = (voxtral_context*)j_handle;
    if (ctx == nullptr) {
        LOGE("Invalid context handle");
        return VOXTRAL_ERR_NULL_HANDLE;
    }

    // Prevent concurrent processing
    bool expected = false;
    if (!ctx->is_processing.compare_exchange_strong(expected, true)) {
        LOGW("Audio processing already in progress, skipping chunk");
        return VOXTRAL_OK;
    }

    int n_samples_in = (int)j_n_samples;

    // Get samples from JNI array
    jfloat* samples = env->GetFloatArrayElements(j_audio_samples, nullptr);
    if (samples == nullptr) {
        ctx->is_processing.store(false);
        return VOXTRAL_ERR_AUDIO_FAILED;
    }

    // Append to internal buffer
    ctx->audio_buffer.insert(ctx->audio_buffer.end(), samples, samples + n_samples_in);
    env->ReleaseFloatArrayElements(j_audio_samples, samples, JNI_ABORT);

    // Check if we have enough data to process
    if (ctx->audio_buffer.size() < MIN_PROCESS_SAMPLES) {
        ctx->is_processing.store(false);
        return VOXTRAL_ERR_BUFFERING;  // Still buffering
    }

    LOGD("Processing audio buffer: %zu samples (%.2fs)",
         ctx->audio_buffer.size(),
         (float)ctx->audio_buffer.size() / 16000.0f);

    // === STEP 1: Create audio bitmap from PCM samples ===
    mtmd_bitmap* audio_bitmap = mtmd_bitmap_init_from_audio(
        ctx->audio_buffer.size(),
        ctx->audio_buffer.data()
    );

    if (audio_bitmap == nullptr) {
        LOGE("Failed to create audio bitmap from %zu samples", ctx->audio_buffer.size());
        ctx->audio_buffer.clear();
        ctx->is_processing.store(false);
        return VOXTRAL_ERR_AUDIO_FAILED;
    }

    // === STEP 2: Tokenize with media marker ===
    // The prompt contains a media marker that will be replaced with audio tokens
    const char* prompt_text = "<__media__>";
    mtmd_input_text text_input = {
        .text = prompt_text,
        .add_special = true,
        .parse_special = true
    };

    const mtmd_bitmap* bitmaps[] = { audio_bitmap };

    mtmd_input_chunks* chunks = mtmd_input_chunks_init();
    if (chunks == nullptr) {
        LOGE("Failed to init input chunks");
        mtmd_bitmap_free(audio_bitmap);
        ctx->audio_buffer.clear();
        ctx->is_processing.store(false);
        return VOXTRAL_ERR_OOM;
    }

    int32_t tokenize_ret = mtmd_tokenize(ctx->mtmd_ctx, chunks, &text_input, bitmaps, 1);
    mtmd_bitmap_free(audio_bitmap);  // No longer needed after tokenize

    if (tokenize_ret != 0) {
        LOGE("mtmd_tokenize failed with code %d", tokenize_ret);
        mtmd_input_chunks_free(chunks);
        ctx->audio_buffer.clear();
        ctx->is_processing.store(false);
        return VOXTRAL_ERR_ENCODE_FAILED;
    }

    size_t n_chunks = mtmd_input_chunks_size(chunks);
    size_t n_total_tokens = mtmd_helper_get_n_tokens(chunks);
    LOGI("Tokenized audio into %zu chunks, %zu tokens", n_chunks, n_total_tokens);

    // === STEP 3: Clear KV cache for fresh transcription ===
    auto memory = llama_get_memory(ctx->llama_ctx);
    if (memory) {
        llama_memory_clear(memory, true);
    }
    ctx->n_past = 0;

    // === STEP 4: Evaluate chunks (encode audio + decode text + feed to llama) ===
    llama_pos new_n_past = 0;
    int32_t eval_ret = mtmd_helper_eval_chunks(
        ctx->mtmd_ctx,
        ctx->llama_ctx,
        chunks,
        ctx->n_past,   // n_past
        0,             // seq_id
        ctx->n_batch,  // n_batch
        true,          // logits_last (we need logits for sampling)
        &new_n_past
    );

    mtmd_input_chunks_free(chunks);

    if (eval_ret != 0) {
        LOGE("mtmd_helper_eval_chunks failed with code %d", eval_ret);
        ctx->audio_buffer.clear();
        ctx->is_processing.store(false);
        return VOXTRAL_ERR_DECODE_FAILED;
    }

    ctx->n_past = new_n_past;
    LOGI("Audio decoded into llama context, n_past=%d", (int)ctx->n_past);

    // === STEP 5: Run sampling loop to generate text ===
    int n_tokens = run_sampling_loop(ctx);

    if (n_tokens < 0) {
        LOGE("Sampling loop failed with code %d", n_tokens);
        ctx->audio_buffer.clear();
        ctx->is_processing.store(false);
        return n_tokens;  // Return the error code
    }

    LOGI("Generated %d tokens from %zu audio samples", n_tokens, ctx->audio_buffer.size());

    // Clear buffer after processing (non-overlapping chunks for streaming)
    ctx->audio_buffer.clear();
    ctx->is_processing.store(false);

    return n_tokens;
}

JNIEXPORT jstring JNICALL
Java_com_aimindmesh_mobile_voxtral_VoxtralInferenceEngine_nativeGetToken(
    JNIEnv* env,
    jobject thiz,
    jlong j_handle
) {
    voxtral_context* ctx = (voxtral_context*)j_handle;
    if (ctx == nullptr) {
        return nullptr;
    }

    std::lock_guard<std::mutex> lock(ctx->queue_mutex);

    if (ctx->token_queue.empty()) {
        return nullptr;
    }

    std::string token = ctx->token_queue.front();
    ctx->token_queue.pop();

    return env->NewStringUTF(token.c_str());
}

JNIEXPORT void JNICALL
Java_com_aimindmesh_mobile_voxtral_VoxtralInferenceEngine_nativeResetContext(
    JNIEnv* env,
    jobject thiz,
    jlong j_handle
) {
    voxtral_context* ctx = (voxtral_context*)j_handle;
    if (ctx == nullptr) return;

    LOGI("Resetting Voxtral context");

    // Clear KV cache
    auto memory = llama_get_memory(ctx->llama_ctx);
    if (memory) {
        llama_memory_clear(memory, true);
    }
    ctx->n_past = 0;

    // Clear audio buffer
    ctx->audio_buffer.clear();

    // Clear token queue
    {
        std::lock_guard<std::mutex> lock(ctx->queue_mutex);
        while (!ctx->token_queue.empty()) {
            ctx->token_queue.pop();
        }
    }

    LOGI("Context reset complete");
}

JNIEXPORT jboolean JNICALL
Java_com_aimindmesh_mobile_voxtral_VoxtralInferenceEngine_nativeIsModelLoaded(
    JNIEnv* env,
    jobject thiz,
    jlong j_handle
) {
    voxtral_context* ctx = (voxtral_context*)j_handle;
    if (ctx == nullptr) return JNI_FALSE;

    return (ctx->llama_model != nullptr &&
            ctx->llama_ctx != nullptr &&
            ctx->mtmd_ctx != nullptr) ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_com_aimindmesh_mobile_voxtral_VoxtralInferenceEngine_nativeReleaseModel(
    JNIEnv* env,
    jobject thiz,
    jlong j_handle
) {
    voxtral_context* ctx = (voxtral_context*)j_handle;
    if (ctx == nullptr) return;

    LOGI("Releasing Voxtral resources");

    // Wait for any in-progress processing
    while (ctx->is_processing.load()) {
        LOGW("Waiting for processing to complete before release...");
        // Brief sleep to avoid spinning
        struct timespec ts = {0, 10000000}; // 10ms
        nanosleep(&ts, nullptr);
    }

    if (ctx->sampler) {
        llama_sampler_free(ctx->sampler);
        ctx->sampler = nullptr;
    }

    if (ctx->mtmd_ctx) {
        mtmd_free(ctx->mtmd_ctx);
        ctx->mtmd_ctx = nullptr;
    }

    if (ctx->llama_ctx) {
        llama_free(ctx->llama_ctx);
        ctx->llama_ctx = nullptr;
    }

    if (ctx->llama_model) {
        llama_model_free(ctx->llama_model);
        ctx->llama_model = nullptr;
    }

    delete ctx;
    LOGI("Voxtral resources released");
}

} // extern "C"
