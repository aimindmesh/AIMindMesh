/*
 * LLMInference.h - Core LLM inference implementation based on SmolChat-Android
 * 
 * This provides a clean, efficient interface for token-by-token generation
 * with proper chat template handling and performance metrics.
 */

#pragma once

#include "common/chat.h"
#include "common/common.h"
#include "llama.h"
#include "ggml.h"
#include "ggml-backend.h"
#include "cap-mtmd.hpp"
#include <string>
#include <vector>
#include <map>
#include <atomic>

class LLMInference {
    // llama.cpp-specific types
    llama_context* _ctx = nullptr;
    llama_model*   _model = nullptr;
    common_sampler* _sampler = nullptr;
    llama_token    _currToken = 0;
    llama_batch*   _batch = nullptr;

    // Multimodal context wrapper
    capllama::llama_cap_context_mtmd* _mtmd = nullptr;
    bool _hasMultimodal = false;

    // Container to store user/assistant messages in the chat
    std::vector<llama_chat_message> _messages;
    // Stores the string generated after applying the chat-template to all messages
    std::vector<char> _formattedMessages;
    // Stores the tokens for the last query appended to `_messages`
    std::vector<llama_token> _promptTokens;
    // Stores tokens for the current batch (text + images)
    std::vector<llama_token> _embd;
    
    // Position of the past tokens in the context
    int _nPast = 0;

    const char* _chatTemplate = nullptr;

    // Stores the complete response for the given query
    std::string _response;
    // Buffer for incomplete UTF-8 sequences
    std::string _cacheResponseTokens;
    // Whether to cache previous messages in `_messages`
    bool _storeChats = true;

    // Response generation metrics
    int64_t _responseGenerationTime = 0;
    int64_t _timeToFirstToken = 0;
    long    _responseNumTokens = 0;

    // Length of context window consumed during the conversation
    int _nCtxUsed = 0;

    // Current token index for decoding large prompts in chunks
    size_t _evalIndex = 0;

    // Interrupt flag for stopping generation
    std::atomic<bool> _interrupted{false};

    // Validates if a string contains valid UTF-8 bytes
    bool _isValidUtf8(const char* response);

    // [New] Store previous tokens to calculate common prefix for context reuse
    std::vector<llama_token> _prevTokens;
    
    // [New] Number of messages in the current context
    int _messageCount = 0;

    // Track consecutive incomplete/invalid UTF-8 pieces
    int _incompleteTokensCount = 0;

public:
    /**
     * Loads the GGUF model with specified parameters.
     * 
     * @param modelPath Path to the GGUF model file
     * @param multimodalProj Path to the multimodal projector file (optional)
     * @param minP Minimum probability for sampling (top-p)
     * @param temperature Sampling temperature
     * @param storeChats Whether to maintain conversation history
     * @param contextSize Maximum context window size
     * @param chatTemplate Jinja chat template (null to use model's default)
     * @param nThreads Number of CPU threads for inference
     * @param useMmap Whether to use memory-mapped I/O
     * @param useMlock Whether to lock model memory
     * @param useVulkan Whether to use Vulkan for GPU acceleration (optional)
     * @param useOpenCL Whether to use OpenCL for GPU acceleration (optional, preferred on Adreno GPUs)
     * @param nBatch Batch size for prompt processing (default: 512)
     * @param nUBatch Micro-batch size (default: 512)
     * @param flashAttn Whether to enable flash attention (default: false)
     * @param cacheTypeK KV cache quantization type for keys (default: "f16")
     * @param cacheTypeV KV cache quantization type for values (default: "f16")
     * @param nGpuLayers Number of layers to offload to GPU (default: 0, 99 = all)
     */
    void loadModel(const char* modelPath, const char* multimodalProj, float minP, float temperature, 
                   bool storeChats, long contextSize, const char* chatTemplate, 
                   int nThreads, bool useMmap, bool useMlock, bool useVulkan = false, bool useOpenCL = false, bool useHexagon = false,
                   int nBatch = 512, int nUBatch = 512, bool flashAttn = false,
                   const char* cacheTypeK = "f16", const char* cacheTypeV = "f16", int nGpuLayers = 0);

    /**
     * Adds a message to the conversation history.
     * 
     * @param message The message content
     * @param role The role ("system", "user", or "assistant")
     */
    void addChatMessage(const char* message, const char* role);

    /**
     * Returns the generation speed in tokens per second.
     */
    float getResponseGenerationTime() const;

    /**
     * Returns a map of current performance metrics.
     */
    std::map<std::string, double> getMetrics() const;

    /**
     * Returns the number of tokens currently used in the context window.
     */
    int getContextSizeUsed() const;

    /**
     * Returns the number of messages in the current conversation history.
     */
    int getMessageCount() const;

    /**
     * Explicitly resets the context (clears history and KV cache).
     */
    void resetContext();

    /**
     * Prepares for completion with the given user query.
     * This tokenizes the query and sets up the batch for decoding.
     * 
     * @param query The user's input message
     * @param images Optional vector of image paths or base64 data
     */
    void startCompletion(const char* query, const std::vector<std::string>& images = {});

    /**
     * Formats an array of messages into a single prompt string using the model's chat template.
     * 
     * @param messages JSON string array of message objects: [{"role":"...", "content":"..."}]
     * @param chatTemplate Optional custom Jinja template (uses model's default if empty)
     * @return The formatted prompt
     */
    std::string getFormattedChat(const std::string& messages, const std::string& chatTemplate = "") const;

    /**
     * Generates the next token(s) and returns text when valid UTF-8 is available.
     * 
     * @return The generated text piece, "[EOG]" when complete, or "" if buffering UTF-8
     */
    std::string completionLoop();

    /**
     * Interrupts the current generation.
     */
    void interrupt();

    /**
     * Cleans up after completion, optionally storing the response in history.
     */
    void stopCompletion();

    /**
     * Checks if the model is ready for inference.
     */
    bool isModelLoaded() const;

    /**
     * Destructor - cleans up all llama.cpp resources.
     */
    ~LLMInference();
};
