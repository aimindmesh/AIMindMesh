/*
 * LLMInference.cpp - Core LLM inference implementation based on SmolChat-Android
 * 
 * Token-by-token streaming with proper chat template handling,
 * UTF-8 validation, and performance metrics.
 */

#include "LLMInference.h"
#include <android/log.h>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include "nlohmann/json.hpp"
#include "common/sampling.h"
#include <mutex>

#define TAG "[LLMInference-Cpp]"
#define LOGi(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGe(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)
#define LOGw(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)
#define LOGd(...) __android_log_print(ANDROID_LOG_DEBUG, TAG, __VA_ARGS__)

static std::once_flag backend_init_flag;

// Helper to parse cache type string to ggml_type
static enum lm_ggml_type parse_cache_type(const char* typeStr) {
    if (!typeStr || strlen(typeStr) == 0) return LM_GGML_TYPE_F16;
    
    if (strcmp(typeStr, "f16") == 0) return LM_GGML_TYPE_F16;
    if (strcmp(typeStr, "f32") == 0) return LM_GGML_TYPE_F32;
    if (strcmp(typeStr, "q8_0") == 0) return LM_GGML_TYPE_Q8_0;
    if (strcmp(typeStr, "q4_0") == 0) return LM_GGML_TYPE_Q4_0;
    if (strcmp(typeStr, "q4_1") == 0) return LM_GGML_TYPE_Q4_1;
    if (strcmp(typeStr, "q5_0") == 0) return LM_GGML_TYPE_Q5_0;
    if (strcmp(typeStr, "q5_1") == 0) return LM_GGML_TYPE_Q5_1;
    
    LOGi("Unknown cache type '%s', defaulting to f16", typeStr);
    return LM_GGML_TYPE_F16;
}

void LLMInference::loadModel(const char* model_path, const char* multimodalProj, float minP, float temperature, 
                              bool storeChats, long contextSize, const char* chatTemplate,
                              int nThreads, bool useMmap, bool useMlock, bool useVulkan, bool useOpenCL, bool useHexagon,
                              int nBatch, int nUBatch, bool flashAttn,
                              const char* cacheTypeK, const char* cacheTypeV, int nGpuLayers) {
    LOGi("Loading model with:"
         "\n\tmodel_path = %s"
         "\n\tmultimodalProj = %s"
         "\n\tminP = %f"
         "\n\ttemperature = %f"
         "\n\tstoreChats = %d"
         "\n\tcontextSize = %ld"
         "\n\tchatTemplate = %s"
         "\n\tnThreads = %d"
         "\n\tuseMmap = %d"
         "\n\tuseMlock = %d"
         "\n\tuseVulkan = %d"
         "\n\tuseOpenCL = %d"
         "\n\tnBatch = %d"
         "\n\tnUBatch = %d"
         "\n\tflashAttn = %d"
         "\n\tcacheTypeK = %s"
         "\n\tcacheTypeV = %s"
         "\n\tnGpuLayers = %d",
         model_path, multimodalProj ? multimodalProj : "(none)", minP, temperature, storeChats, contextSize, 
         chatTemplate ? chatTemplate : "(auto)", nThreads, useMmap, useMlock, useVulkan, useOpenCL,
         nBatch, nUBatch, flashAttn,
         cacheTypeK ? cacheTypeK : "f16", cacheTypeV ? cacheTypeV : "f16", nGpuLayers);

    // Initialize the backend and f16 tables exactly once per process
    std::call_once(backend_init_flag, []() {
        llama_backend_init();
        LOGi("llama_backend_init() called successfully");
    });

    // Load dynamic backends (CPU, Vulkan, OpenCL if compiled)
    lm_ggml_backend_load_all();

    // Create an instance of llama_model
    llama_model_params model_params = llama_model_default_params();
    model_params.use_mmap = useMmap;
    model_params.use_mlock = useMlock;
    
    // GPU layer offloading: user-specified value takes priority.
    model_params.n_gpu_layers = nGpuLayers;
    if (nGpuLayers > 0) {
        LOGi("GPU offload: %d layers", nGpuLayers);
    } else {
        LOGi("CPU-only mode (GPU layers set to 0)");
    }
    
    // Set device hints for OpenCL if enabled and actually offloading
    if (useOpenCL && nGpuLayers > 0) {
        setenv("GGML_OPENCL_PLATFORM", "0", 1);
        setenv("GGML_OPENCL_DEVICE", "0", 1);
        LOGi("OpenCL device hints set for Adreno GPU");
    }
    
    _model = llama_model_load_from_file(model_path, model_params);
    if (!_model) {
        LOGe("Failed to load model from %s", model_path);
        throw std::runtime_error("loadModel() failed");
    }
    LOGi("Model loaded successfully");

    // Create an instance of llama_context
    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = contextSize;
    ctx_params.n_batch = nBatch;
    ctx_params.n_ubatch = nUBatch;
    ctx_params.n_threads = nThreads;
    ctx_params.flash_attn_type = flashAttn ? LLAMA_FLASH_ATTN_TYPE_ENABLED : LLAMA_FLASH_ATTN_TYPE_DISABLED;
    ctx_params.type_k = parse_cache_type(cacheTypeK);
    ctx_params.type_v = parse_cache_type(cacheTypeV);
    ctx_params.no_perf = true; // Disable performance metrics overhead
    
    LOGi("Context params: n_ctx=%ld, n_batch=%d, n_ubatch=%d, flash_attn=%d, type_k=%d, type_v=%d",
         contextSize, nBatch, nUBatch, flashAttn, ctx_params.type_k, ctx_params.type_v);
    
    _ctx = llama_init_from_model(_model, ctx_params);
    if (!_ctx) {
        LOGe("llama_init_from_model() returned null");
        llama_model_free(_model);
        _model = nullptr;
        throw std::runtime_error("llama_init_from_model() returned null");
    }
    LOGi("Context created with %ld tokens", contextSize);

    // Initialize Multimodal Context if projector path is provided
    if (multimodalProj && strlen(multimodalProj) > 0) {
        try {
            common_params common_defaults; // Use defaults
            common_defaults.cpuparams.n_threads = nThreads;
            
            _mtmd = new capllama::llama_cap_context_mtmd(
                multimodalProj,
                useVulkan, // use_gpu
                _model,
                _ctx,
                common_defaults,
                _hasMultimodal,
                common_defaults // mutable params - unused here but required by signature
            );
            LOGi("Multimodal context initialized");
        } catch (const std::exception& e) {
            LOGe("Failed to initialize multimodal context: %s", e.what());
            // Don't fail the whole load, just disable multimodal
            _mtmd = nullptr;
            _hasMultimodal = false;
        }
    }

    // Initialize common_sampler to support EOG and complex penalties correctly
    common_params_sampling sparams;
    sparams.temp = temperature;
    sparams.min_p = minP;
    sparams.seed = LLAMA_DEFAULT_SEED;
    
    _sampler = common_sampler_init(_model, sparams);
    LOGi("common_sampler initialized with temp=%.2f, minP=%.2f", temperature, minP);

    _formattedMessages = std::vector<char>(llama_n_ctx(_ctx));
    _messages.clear();

    // Use model's chat template if none provided
    if (chatTemplate == nullptr || strlen(chatTemplate) == 0) {
        const char* model_template = llama_model_chat_template(_model, nullptr);
        if (model_template) {
            _chatTemplate = strdup(model_template);
            LOGi("Using model's chat template");
        } else {
            // Default fallback template (ChatML-style)
            _chatTemplate = strdup(
                "{% for message in messages %}"
                "{% if loop.first and messages[0]['role'] != 'system' %}"
                "{{ '<|im_start|>system You are a helpful AI assistant<|im_end|> ' }}"
                "{% endif %}"
                "{{'<|im_start|>' + message['role'] + ' ' + message['content'] + '<|im_end|>' + ' '}}"
                "{% endfor %}"
                "{% if add_generation_prompt %}{{ '<|im_start|>assistant ' }}{% endif %}"
            );
            LOGi("Using default ChatML template");
        }
    } else {
        _chatTemplate = strdup(chatTemplate);
        LOGi("Using provided chat template");
    }
    
    this->_storeChats = storeChats;
    _interrupted.store(false);
    _nPast = 0;
    _prevTokens.clear();
    _messageCount = 0;
    
    LOGi("Model initialization complete");
}


void LLMInference::addChatMessage(const char* message, const char* role) {
    _messages.push_back({strdup(role), strdup(message)});
    _messageCount++;
    LOGi("Added %s message (%zu chars). Total messages: %d", role, strlen(message), _messageCount);
}

float LLMInference::getResponseGenerationTime() const {
    if (_responseGenerationTime == 0) return 0.0f;
    return (float)_responseNumTokens / (_responseGenerationTime / 1e6);
}

int LLMInference::getContextSizeUsed() const {
    return _nCtxUsed;
}

void LLMInference::startCompletion(const char* query, const std::vector<std::string>& images) {
    bool context_full = false;
    
    if (!_model || !_ctx) {
        throw std::runtime_error("Model not initialized");
    }

    if (!_storeChats) {
        _formattedMessages.clear();
        _formattedMessages = std::vector<char>(llama_n_ctx(_ctx));
        
        // Critical Fix: Clear message history and KV cache in stateless mode
        for (llama_chat_message& message : _messages) {
            free(const_cast<char*>(message.role));
            free(const_cast<char*>(message.content));
        }
        _messages.clear();
        
        // Clear KV cache using new API
        auto memory = llama_get_memory(_ctx);
        if (memory) {
            llama_memory_clear(memory, true); // Clear all memory/KV cache
        }
        _nPast = 0;
    }
    
    _responseGenerationTime = 0;
    _responseNumTokens = 0;
    _timeToFirstToken = 0;
    _response.clear();
    _cacheResponseTokens.clear();
    _interrupted.store(false);

    // Reset sampler penalty history before each new inference turn.
    // We will re-populate it with only the relevant context tokens below.
    if (_sampler) {
        common_sampler_reset(_sampler);
    }
    
    // Add user message to history
    // addChatMessage(query, "user"); // DISABLED: Frontend sends formatted prompt

    // Multimodal Processing or Text-Only Processing
    if (!images.empty() && _mtmd != nullptr) {
        LOGi("Processing multimodal query with %zu images", images.size());
        
        // Adapt common_sampler to pointer for helper
        // common_sampler* raw_sampler = (common_sampler*)_sampler; 
        
        llama_pos n_past_ref = _nPast;
        
        try {
             _mtmd->processMedia(
                _ctx,
                query,
                images,
                llama_n_ctx(_ctx),
                llama_n_ctx(_ctx), // Batch size same as context for simplicity or 512
                n_past_ref,
                _embd,
                context_full,
                nullptr // ctx_sampling - we'll handle update manually
            );
            _nPast = n_past_ref;
            
            // Manually accept tokens into sampler
            for (auto & token : _embd) {
                if (token == LLAMA_TOKEN_NULL) continue;
                common_sampler_accept(_sampler, token, true);
            }
            
            LOGi("Multimodal processing complete. New n_past: %d", _nPast);
            
        } catch (std::exception& e) {
            LOGe("Multimodal processing failed: %s", e.what());
            throw;
        }

    } else {
        // Text-only path (Legacy/Fast)
        
        // Use raw query as prompt (Frontend handles formatting)
        std::string prompt = query;
        
        LOGi("Using raw prompt (%zu chars)", prompt.length());
        
        // Tokenize the prompt
        std::vector<llama_token> full_prompt_tokens = common_tokenize(llama_model_get_vocab(_model), prompt, true, true);
        _promptTokens = full_prompt_tokens;
        
        // Critical Safety Check: Prevent buffer overflow if prompt exceeds context
        if (full_prompt_tokens.size() > (size_t)llama_n_ctx(_ctx)) {
             std::string error_msg = "Prompt size (" + std::to_string(full_prompt_tokens.size()) + 
                                     ") exceeds context window (" + std::to_string(llama_n_ctx(_ctx)) + ")";
             LOGe("%s", error_msg.c_str());
             throw std::runtime_error(error_msg);
        }
        
        LOGi("Tokenized into %zu tokens", full_prompt_tokens.size());
        
        if (_storeChats) {
             // Calculate common prefix to reuse KV cache
             size_t common_part = 0;
             size_t n_prev = _prevTokens.size();
             size_t n_curr = full_prompt_tokens.size();
             
             for (size_t i = 0; i < n_prev && i < n_curr; i++) {
                 if (_prevTokens[i] == full_prompt_tokens[i]) {
                     common_part++;
                 } else {
                     break;
                 }
             }
             
             if (common_part > 0) {
                 LOGi("Reusing %zu tokens from KV cache", common_part);
                 _nPast = common_part;

                 // Critical Fix: Explicitly remove trailing KV cache to prevent "inconsistent sequence positions"
                 // when the new prompt diverges from the cached path.
                 auto memory = llama_get_memory(_ctx);
                 if (memory) {
                     // Remove properties for all sequences (-1), from position 'common_part' to end (-1)
                     llama_memory_seq_rm(memory, -1, common_part, -1);
                 }
                 
                 // Re-accept the cached prefix tokens into the sampler so that the
                 // repetition/frequency penalty history reflects the conversation context.
                 // These tokens are already decoded in the KV cache; we only inform the
                 // sampler about them — we do NOT decode them again.
                 for (size_t i = 0; i < common_part; i++) {
                     common_sampler_accept(_sampler, _prevTokens[i], false);
                 }
                 
                 // Prune embed to only new tokens (not yet decoded)
                 _embd.clear();
                 for (size_t i = common_part; i < n_curr; i++) {
                     _embd.push_back(full_prompt_tokens[i]);
                 }
             } else {
                 // No matching prefix, clear and start over
                 LOGi("No common prefix found, clearing KV cache");
                 _nPast = 0;
                 auto memory = llama_get_memory(_ctx);
                 if (memory) {
                     llama_memory_clear(memory, true);
                 }
                 _embd = full_prompt_tokens;
             }
             
             // Update prevTokens for next turn
             _prevTokens = full_prompt_tokens;
             
        } else {
            // Stateless: _nPast is 0 and KV cleared at start of function
            _embd = full_prompt_tokens;
            _prevTokens.clear();
        }
        // NOTE: Do NOT pre-accept _embd tokens here.
        // New tokens are accepted in completionLoop() after each llama_decode() call,
        // which is the only correct place to ensure no double-acceptance.
    }

    // Initialize batch if needed
    if (!_batch) {
        _batch = new llama_batch;
        *_batch = llama_batch_init(llama_n_ctx(_ctx), 0, 1);
    }
    
    // Prepare the batch for the new tokens
    if (!images.empty() && _mtmd != nullptr) {
        // Tokens already processed (decoded) by processMedia!
        _batch->n_tokens = 0; 
    } else {
        // Text only path: We need to decode _embd (which now contains only new tokens).
        // Instead of doing it all here, we just initialize _evalIndex and let completionLoop
        // process it in chunks to avoid native OOM.
        _evalIndex = 0;
        _batch->n_tokens = 0;
    }
}

bool LLMInference::_isValidUtf8(const char* response) {
    if (!response) {
        return true;
    }
    const unsigned char* bytes = (const unsigned char*)response;
    while (*bytes) {
        if ((*bytes & 0b10000000) == 0b00000000) {
            bytes++;
        } else if ((*bytes & 0b11100000) == 0b11000000) {
            if ((bytes[1] & 0b11000000) != 0b10000000) return false;
            bytes += 2;
        } else if ((*bytes & 0b11110000) == 0b11100000) {
            if ((bytes[1] & 0b11000000) != 0b10000000 || (bytes[2] & 0b11000000) != 0b10000000) return false;
            bytes += 3;
        } else if ((*bytes & 0b11111000) == 0b11110000) {
            if ((bytes[1] & 0b11000000) != 0b10000000 || (bytes[2] & 0b11000000) != 0b10000000 || (bytes[3] & 0b11000000) != 0b10000000) return false;
            bytes += 4;
        } else {
            return false;
        }
    }
    return true;
}

int LLMInference::getMessageCount() const {
    return _messageCount;
}

void LLMInference::resetContext() {
    _messages.clear();
    _formattedMessages.clear();
    _prevTokens.clear();
    _messageCount = 0;
    _nPast = 0;
    _evalIndex = 0;
    
    // Clear KV cache using llama_memory_seq_rm on the context's memory
    if (_ctx) {
        llama_memory_seq_rm(llama_get_memory(_ctx), -1, 0, -1);
    }
    
    if (_sampler) {
        common_sampler_reset(_sampler);
    }
    
    LOGi("Context explicitly reset");
}


std::string LLMInference::completionLoop() {
    // Check for interrupt
    if (_interrupted.load()) {
        LOGi("Generation interrupted by user");
        return "[EOG]";
    }
    
    // If we have pending tokens in _embd to evaluate (from the initial prompt)
    if (_evalIndex < _embd.size()) {
        int n_eval = _embd.size() - _evalIndex;
        int n_batch = llama_n_batch(_ctx);

        if (n_eval > n_batch) {
            n_eval = n_batch;
        }

        LOGi("[LLM_CHAIN] Prompt chunk decoding: evalIndex=%zu, embd.size()=%zu, n_eval=%d, n_batch=%d", _evalIndex, _embd.size(), n_eval, n_batch);

        _batch->n_tokens = n_eval;
        for (int i = 0; i < n_eval; i++) {
            _batch->token[i] = _embd[_evalIndex + i];
            _batch->pos[i] = _nPast + i;
            _batch->n_seq_id[i] = 1;
            _batch->seq_id[i][0] = 0;
            // Only calculate logits for the very last token of the entire prompt
            _batch->logits[i] = (_evalIndex + i == _embd.size() - 1);
        }

        if (_nPast + n_eval > llama_n_ctx(_ctx)) {
            LOGe("[LLM_CHAIN] Context size reached during prompt decode. _nPast=%d, n_eval=%d, ctx=%d", _nPast, n_eval, llama_n_ctx(_ctx));
            throw std::runtime_error("context size reached");
        }

        LOGd("[LLM_CHAIN] Calling llama_decode for prompt chunk...");
        if (llama_decode(_ctx, *_batch) < 0) {
            LOGe("[LLM_CHAIN] llama_decode() failed during prompt decode");
            throw std::runtime_error("llama_decode() failed");
        }

        _nPast += n_eval;
        _evalIndex += n_eval;
        LOGd("[LLM_CHAIN] Prompt chunk decoded. _nPast=%d, _evalIndex=%zu", _nPast, _evalIndex);

        // Accept newly decoded prompt tokens into the sampler.
        // This is the ONLY place where new tokens are accepted to avoid double-acceptance.
        for (int i = 0; i < n_eval; i++) {
             common_sampler_accept(_sampler, _batch->token[i], false);
        }

        _batch->n_tokens = 0; // Clear batch after decode

        // If we still have more chunks to process, return empty string to indicate we are still buffering
        if (_evalIndex < _embd.size()) {
            LOGd("[LLM_CHAIN] Returning empty string to process next chunk of prompt");
            return "";
        }
    } else if (_batch->n_tokens > 0) {
        LOGd("[LLM_CHAIN] Decoding generated token...");
        // This handles normal single-token generation decoding
        if (_nPast > llama_n_ctx(_ctx)) {
             LOGe("[LLM_CHAIN] Context size reached during generation");
             throw std::runtime_error("context size reached");
        }
        
        if (llama_decode(_ctx, *_batch) < 0) {
            LOGe("[LLM_CHAIN] llama_decode() failed during generation");
            throw std::runtime_error("llama_decode() failed");
        }
        _batch->n_tokens = 0; // Clear batch after decode
    }

    auto start = lm_ggml_time_us();

    // Sample a token
    _currToken = common_sampler_sample(_sampler, _ctx, -1);
    LOGd("[LLM_CHAIN] Sampled token ID: %d", _currToken);
    
    // Accept token (update sampler state)
    common_sampler_accept(_sampler, _currToken, true);

    const llama_vocab* vocab = llama_model_get_vocab(_model);
    if (llama_vocab_is_eog(vocab, _currToken)) {
        LOGi("[LLM_CHAIN] Token is EOG! End of generation reached.");
        if (_storeChats && !_response.empty()) {
            addChatMessage(strdup(_response.data()), "assistant");
        }
        _response.clear();
        return "[EOG]";
    }
    
    // Convert token to text piece
    std::string piece = common_token_to_piece(_ctx, _currToken, true);
    LOGd("[LLM_CHAIN] Converted token %d to piece: [%s]", _currToken, piece.c_str());

    if (piece.empty()) {
        LOGw("[LLM_CHAIN] WARNING: Converted piece is empty string for token %d", _currToken);
    }
    
    auto end = lm_ggml_time_us();
    int64_t step_time = end - start;
    _responseGenerationTime += step_time;
    if (_responseNumTokens == 0) {
        _timeToFirstToken = _responseGenerationTime;
    }
    _responseNumTokens += 1;
    _cacheResponseTokens += piece;

    // Prepare batch for next token (the one we just sampled)
    _batch->token[0] = _currToken;
    _batch->n_tokens = 1;
    
    // Position is n_past (since n_past counts all processed tokens)
    _batch->pos[0] = _nPast; 
    _batch->n_seq_id[0] = 1;
    _batch->seq_id[0][0] = 0;
    _batch->logits[0] = true;
    
    _nPast += 1;

    // Only emit when we have valid UTF-8
    if (_isValidUtf8(_cacheResponseTokens.c_str())) {
        _response += _cacheResponseTokens;
        std::string valid_utf8_piece = _cacheResponseTokens;
        _cacheResponseTokens.clear();
        _incompleteTokensCount = 0;
        LOGi("Emit Piece: [%s]", valid_utf8_piece.c_str());
        return valid_utf8_piece;
    }

    _incompleteTokensCount++;
    LOGw("Invalid UTF-8 Sequence detected. _cacheResponseTokens hex: ");
    for (char c : _cacheResponseTokens) {
        LOGw("  %02X", (unsigned char)c);
    }
    LOGw("Incomplete sequence count: %d", _incompleteTokensCount);

    if (_incompleteTokensCount >= 100) {
        LOGe("FATAL: Stuck in incomplete UTF-8 sequence for 100 iterations. Aborting generation loop natively to prevent UI hang.");
        return "[EOG]"; // Force EOG to unblock the UI
    }

    // Return empty string while buffering incomplete UTF-8 sequences
    return "";
}

// New method to get current metrics
std::map<std::string, double> LLMInference::getMetrics() const {
    std::map<std::string, double> metrics;
    metrics["response_time_ms"] = _responseGenerationTime / 1000.0;
    metrics["token_count"] = (double)_responseNumTokens;
    metrics["tokens_per_second"] = getResponseGenerationTime();
    metrics["time_to_first_token_ms"] = _timeToFirstToken / 1000.0;
    return metrics;
}

void LLMInference::interrupt() {
    _interrupted.store(true);
    LOGi("Interrupt requested");
}

void LLMInference::stopCompletion() {
    if (_storeChats && !_response.empty()) {
        addChatMessage(_response.c_str(), "assistant");
    }
    _response.clear();
    _cacheResponseTokens.clear();
    LOGi("Completion stopped, generated %ld tokens at %.2f tok/s", 
         _responseNumTokens, getResponseGenerationTime());
    if (_ctx) {
        llama_perf_context_print(_ctx);
    }
}

bool LLMInference::isModelLoaded() const {
    return _model != nullptr && _ctx != nullptr;
}

std::string LLMInference::getFormattedChat(const std::string& messages, const std::string& chatTemplate) const {
    if (!_model) {
        throw std::runtime_error("Model not loaded");
    }

    common_chat_templates_inputs inputs;
    inputs.messages = common_chat_msgs_parse_oaicompat(nlohmann::ordered_json::parse(messages));
    
    // Jinja template support is enabled by default to match PocketPal
    inputs.use_jinja = true;

    // Use requested template if provided, else fall back to the one stored during loadModel
    std::string tmpl_to_use = !chatTemplate.empty() ? chatTemplate : (_chatTemplate != nullptr ? _chatTemplate : "");

    if (!tmpl_to_use.empty()) {
        auto tmps = common_chat_templates_init(_model, tmpl_to_use);
        if (tmps) {
            return common_chat_templates_apply(tmps.get(), inputs).prompt;
        }
    }
    
    // Fall back to the model's default template if our init failed or tmpl_to_use was empty
    auto default_tmps = common_chat_templates_init(_model, "");
    if (default_tmps) {
        return common_chat_templates_apply(default_tmps.get(), inputs).prompt;
    }

    throw std::runtime_error("Failed to apply chat template");
}

LLMInference::~LLMInference() {
    LOGi("Cleaning up LLMInference resources");
    
    if (_mtmd) {
        delete _mtmd;
        _mtmd = nullptr;
    }

    // Free message text (as we used strdup)
    for (llama_chat_message& message : _messages) {
        free(const_cast<char*>(message.role));
        free(const_cast<char*>(message.content));
    }
    _messages.clear();
    
    // Free chat template
    if (_chatTemplate) {
        free(const_cast<char*>(_chatTemplate));
        _chatTemplate = nullptr;
    }
    
    // Free llama resources
    if (_batch) {
        llama_batch_free(*_batch);
        delete _batch;
        _batch = nullptr;
    }
    
    if (_sampler) {
        common_sampler_free(_sampler);
        _sampler = nullptr;
    }
    
    if (_ctx) {
        llama_free(_ctx);
        _ctx = nullptr;
    }
    
    if (_model) {
        llama_model_free(_model);
        _model = nullptr;
    }
    
    LOGi("LLMInference cleanup complete");
}
