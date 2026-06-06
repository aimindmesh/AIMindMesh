cmake_minimum_required(VERSION 3.10)

project(voxtral_jni)

set(CMAKE_CXX_STANDARD 17)

# Find Android libraries
find_library(LOG_LIB log)
find_library(ANDROID_LIB android)

# Path to llama.cpp sources
set(LLAMACPP_PLUGIN_DIR ${CMAKE_SOURCE_DIR}/../../../../../plugins/llama-cpp-capacitor)
set(LLAMACPP_CPP_DIR ${LLAMACPP_PLUGIN_DIR}/cpp)

if(LLAMACPP_BUILD_OPENCL)
    add_definitions(-DLM_GGML_USE_OPENCL)
    add_definitions(-DLM_GGML_OPENCL_USE_ADRENO_KERNELS)
    add_definitions(-DLM_GGML_OPENCL_EMBED_KERNELS)
    add_definitions(-DLM_GGML_OPENCL_SOA_Q)
    include_directories(${LLAMACPP_CPP_DIR}/opencl-headers)
    include_directories(${LLAMACPP_CPP_DIR}/ggml-opencl/kernels)
    list(APPEND LLAMA_CORE_SOURCES
        ${LLAMACPP_CPP_DIR}/ggml-opencl/ggml-opencl.cpp
    )
endif()

# Include directories
include_directories(
    ${LLAMACPP_CPP_DIR}
    ${LLAMACPP_CPP_DIR}/common
    ${LLAMACPP_CPP_DIR}/ggml-cpu
    ${LLAMACPP_CPP_DIR}/tools/mtmd
)

# Define llama.cpp core source files (complete list from plugin)
set(
    LLAMA_CORE_SOURCES
    # ggml core
    ${LLAMACPP_CPP_DIR}/ggml.c
    ${LLAMACPP_CPP_DIR}/ggml-alloc.c
    ${LLAMACPP_CPP_DIR}/ggml-backend.cpp
    ${LLAMACPP_CPP_DIR}/ggml-backend-reg.cpp
    ${LLAMACPP_CPP_DIR}/ggml-backend-dl.cpp
    ${LLAMACPP_CPP_DIR}/ggml-backend-meta.cpp
    ${LLAMACPP_CPP_DIR}/ggml-opt.cpp
    ${LLAMACPP_CPP_DIR}/ggml-threading.cpp
    ${LLAMACPP_CPP_DIR}/ggml-quants.c
    ${LLAMACPP_CPP_DIR}/gguf.cpp

    # ggml-cpu backend
    ${LLAMACPP_CPP_DIR}/ggml-cpu/amx/amx.cpp
    ${LLAMACPP_CPP_DIR}/ggml-cpu/amx/mmq.cpp
    ${LLAMACPP_CPP_DIR}/ggml-cpu/ggml-cpu.c
    ${LLAMACPP_CPP_DIR}/ggml-cpu/ggml-cpu.cpp
    ${LLAMACPP_CPP_DIR}/ggml-cpu/quants.c
    ${LLAMACPP_CPP_DIR}/ggml-cpu/arch/arm/quants.c
    ${LLAMACPP_CPP_DIR}/ggml-cpu/arch/arm/cpu-feats.cpp
    ${LLAMACPP_CPP_DIR}/ggml-cpu/traits.cpp
    ${LLAMACPP_CPP_DIR}/ggml-cpu/repack.cpp
    ${LLAMACPP_CPP_DIR}/ggml-cpu/unary-ops.cpp
    ${LLAMACPP_CPP_DIR}/ggml-cpu/binary-ops.cpp
    ${LLAMACPP_CPP_DIR}/ggml-cpu/vec.cpp
    ${LLAMACPP_CPP_DIR}/ggml-cpu/ops.cpp

    # llama core
    ${LLAMACPP_CPP_DIR}/llama.cpp
    ${LLAMACPP_CPP_DIR}/llama-impl.cpp
    ${LLAMACPP_CPP_DIR}/llama-arch.cpp
    ${LLAMACPP_CPP_DIR}/llama-adapter.cpp
    ${LLAMACPP_CPP_DIR}/llama-batch.cpp
    ${LLAMACPP_CPP_DIR}/llama-chat.cpp
    ${LLAMACPP_CPP_DIR}/llama-context.cpp
    ${LLAMACPP_CPP_DIR}/llama-cparams.cpp
    ${LLAMACPP_CPP_DIR}/llama-grammar.cpp
    ${LLAMACPP_CPP_DIR}/llama-graph.cpp
    ${LLAMACPP_CPP_DIR}/llama-hparams.cpp
    ${LLAMACPP_CPP_DIR}/llama-io.cpp
    ${LLAMACPP_CPP_DIR}/llama-kv-cache.cpp
    ${LLAMACPP_CPP_DIR}/llama-kv-cache-iswa.cpp
    ${LLAMACPP_CPP_DIR}/llama-memory.cpp
    ${LLAMACPP_CPP_DIR}/llama-memory-hybrid.cpp
    ${LLAMACPP_CPP_DIR}/llama-memory-hybrid-iswa.cpp
    ${LLAMACPP_CPP_DIR}/llama-memory-recurrent.cpp
    ${LLAMACPP_CPP_DIR}/llama-mmap.cpp
    ${LLAMACPP_CPP_DIR}/llama-model.cpp
    ${LLAMACPP_CPP_DIR}/llama-model-loader.cpp
    ${LLAMACPP_CPP_DIR}/llama-model-saver.cpp
    ${LLAMACPP_CPP_DIR}/llama-sampler.cpp
    ${LLAMACPP_CPP_DIR}/llama-vocab.cpp

    # common/ directory (reorganized from llama.rn)
    ${LLAMACPP_CPP_DIR}/common/build-info.cpp
    ${LLAMACPP_CPP_DIR}/common/chat-auto-parser-generator.cpp
    ${LLAMACPP_CPP_DIR}/common/chat-auto-parser-helpers.cpp
    ${LLAMACPP_CPP_DIR}/common/chat.cpp
    ${LLAMACPP_CPP_DIR}/common/chat-diff-analyzer.cpp
    ${LLAMACPP_CPP_DIR}/common/chat-peg-parser.cpp
    ${LLAMACPP_CPP_DIR}/common/common.cpp
    ${LLAMACPP_CPP_DIR}/common/fit.cpp
    ${LLAMACPP_CPP_DIR}/common/json-partial.cpp
    ${LLAMACPP_CPP_DIR}/common/json-schema-to-grammar.cpp
    ${LLAMACPP_CPP_DIR}/common/log.cpp
    ${LLAMACPP_CPP_DIR}/common/ngram-cache.cpp
    ${LLAMACPP_CPP_DIR}/common/ngram-map.cpp
    ${LLAMACPP_CPP_DIR}/common/ngram-mod.cpp
    ${LLAMACPP_CPP_DIR}/common/peg-parser.cpp
    ${LLAMACPP_CPP_DIR}/common/reasoning-budget.cpp
    ${LLAMACPP_CPP_DIR}/common/regex-partial.cpp
    ${LLAMACPP_CPP_DIR}/common/sampling.cpp
    ${LLAMACPP_CPP_DIR}/common/speculative.cpp
    ${LLAMACPP_CPP_DIR}/common/unicode.cpp

    # jinja
    ${LLAMACPP_CPP_DIR}/common/jinja/caps.cpp
    ${LLAMACPP_CPP_DIR}/common/jinja/lexer.cpp
    ${LLAMACPP_CPP_DIR}/common/jinja/parser.cpp
    ${LLAMACPP_CPP_DIR}/common/jinja/runtime.cpp
    ${LLAMACPP_CPP_DIR}/common/jinja/string.cpp
    ${LLAMACPP_CPP_DIR}/common/jinja/value.cpp

    # unicode
    ${LLAMACPP_CPP_DIR}/unicode-data.cpp
    ${LLAMACPP_CPP_DIR}/unicode.cpp
    ${LLAMACPP_CPP_DIR}/anyascii.c

    # models/ directory
    ${LLAMACPP_CPP_DIR}/models/afmoe.cpp
    ${LLAMACPP_CPP_DIR}/models/apertus.cpp
    ${LLAMACPP_CPP_DIR}/models/arcee.cpp
    ${LLAMACPP_CPP_DIR}/models/arctic.cpp
    ${LLAMACPP_CPP_DIR}/models/arwkv7.cpp
    ${LLAMACPP_CPP_DIR}/models/baichuan.cpp
    ${LLAMACPP_CPP_DIR}/models/bailingmoe2.cpp
    ${LLAMACPP_CPP_DIR}/models/bailingmoe.cpp
    ${LLAMACPP_CPP_DIR}/models/bert.cpp
    ${LLAMACPP_CPP_DIR}/models/bitnet.cpp
    ${LLAMACPP_CPP_DIR}/models/bloom.cpp
    ${LLAMACPP_CPP_DIR}/models/chameleon.cpp
    ${LLAMACPP_CPP_DIR}/models/chatglm.cpp
    ${LLAMACPP_CPP_DIR}/models/codeshell.cpp
    ${LLAMACPP_CPP_DIR}/models/cogvlm.cpp
    ${LLAMACPP_CPP_DIR}/models/cohere2.cpp
    ${LLAMACPP_CPP_DIR}/models/command-r.cpp
    ${LLAMACPP_CPP_DIR}/models/dbrx.cpp
    ${LLAMACPP_CPP_DIR}/models/deci.cpp
    ${LLAMACPP_CPP_DIR}/models/deepseek2.cpp
    ${LLAMACPP_CPP_DIR}/models/deepseek2ocr.cpp
    ${LLAMACPP_CPP_DIR}/models/deepseek.cpp
    ${LLAMACPP_CPP_DIR}/models/delta-net-base.cpp
    ${LLAMACPP_CPP_DIR}/models/dots1.cpp
    ${LLAMACPP_CPP_DIR}/models/dream.cpp
    ${LLAMACPP_CPP_DIR}/models/ernie4-5.cpp
    ${LLAMACPP_CPP_DIR}/models/ernie4-5-moe.cpp
    ${LLAMACPP_CPP_DIR}/models/eurobert.cpp
    ${LLAMACPP_CPP_DIR}/models/exaone4.cpp
    ${LLAMACPP_CPP_DIR}/models/exaone.cpp
    ${LLAMACPP_CPP_DIR}/models/exaone-moe.cpp
    ${LLAMACPP_CPP_DIR}/models/falcon.cpp
    ${LLAMACPP_CPP_DIR}/models/falcon-h1.cpp
    ${LLAMACPP_CPP_DIR}/models/gemma2.cpp
    ${LLAMACPP_CPP_DIR}/models/gemma3.cpp
    ${LLAMACPP_CPP_DIR}/models/gemma3n.cpp
    ${LLAMACPP_CPP_DIR}/models/gemma4.cpp
    ${LLAMACPP_CPP_DIR}/models/gemma.cpp
    ${LLAMACPP_CPP_DIR}/models/gemma-embedding.cpp
    ${LLAMACPP_CPP_DIR}/models/glm4.cpp
    ${LLAMACPP_CPP_DIR}/models/glm4-moe.cpp
    ${LLAMACPP_CPP_DIR}/models/glm-dsa.cpp
    ${LLAMACPP_CPP_DIR}/models/gpt2.cpp
    ${LLAMACPP_CPP_DIR}/models/gptneox.cpp
    ${LLAMACPP_CPP_DIR}/models/granite.cpp
    ${LLAMACPP_CPP_DIR}/models/granite-hybrid.cpp
    ${LLAMACPP_CPP_DIR}/models/granite-moe.cpp
    ${LLAMACPP_CPP_DIR}/models/grok.cpp
    ${LLAMACPP_CPP_DIR}/models/grovemoe.cpp
    ${LLAMACPP_CPP_DIR}/models/hunyuan-dense.cpp
    ${LLAMACPP_CPP_DIR}/models/hunyuan-moe.cpp
    ${LLAMACPP_CPP_DIR}/models/hunyuan-vl.cpp
    ${LLAMACPP_CPP_DIR}/models/internlm2.cpp
    ${LLAMACPP_CPP_DIR}/models/jais2.cpp
    ${LLAMACPP_CPP_DIR}/models/jais.cpp
    ${LLAMACPP_CPP_DIR}/models/jamba.cpp
    ${LLAMACPP_CPP_DIR}/models/jina-bert-v2.cpp
    ${LLAMACPP_CPP_DIR}/models/jina-bert-v3.cpp
    ${LLAMACPP_CPP_DIR}/models/kimi-linear.cpp
    ${LLAMACPP_CPP_DIR}/models/lfm2.cpp
    ${LLAMACPP_CPP_DIR}/models/lfm2moe.cpp
    ${LLAMACPP_CPP_DIR}/models/llada.cpp
    ${LLAMACPP_CPP_DIR}/models/llada-moe.cpp
    ${LLAMACPP_CPP_DIR}/models/llama4.cpp
    ${LLAMACPP_CPP_DIR}/models/llama.cpp
    ${LLAMACPP_CPP_DIR}/models/llama-embed.cpp
    ${LLAMACPP_CPP_DIR}/models/maincoder.cpp
    ${LLAMACPP_CPP_DIR}/models/mamba2.cpp
    ${LLAMACPP_CPP_DIR}/models/mamba-base.cpp
    ${LLAMACPP_CPP_DIR}/models/mamba.cpp
    ${LLAMACPP_CPP_DIR}/models/mimo2.cpp
    ${LLAMACPP_CPP_DIR}/models/minicpm3.cpp
    ${LLAMACPP_CPP_DIR}/models/minicpm.cpp
    ${LLAMACPP_CPP_DIR}/models/minimax-m2.cpp
    ${LLAMACPP_CPP_DIR}/models/mistral3.cpp
    ${LLAMACPP_CPP_DIR}/models/mistral4.cpp
    ${LLAMACPP_CPP_DIR}/models/modern-bert.cpp
    ${LLAMACPP_CPP_DIR}/models/mpt.cpp
    ${LLAMACPP_CPP_DIR}/models/nemotron.cpp
    ${LLAMACPP_CPP_DIR}/models/nemotron-h.cpp
    ${LLAMACPP_CPP_DIR}/models/nemotron-h-moe.cpp
    ${LLAMACPP_CPP_DIR}/models/neo-bert.cpp
    ${LLAMACPP_CPP_DIR}/models/nomic-bert.cpp
    ${LLAMACPP_CPP_DIR}/models/nomic-bert-moe.cpp
    ${LLAMACPP_CPP_DIR}/models/olmo2.cpp
    ${LLAMACPP_CPP_DIR}/models/olmo.cpp
    ${LLAMACPP_CPP_DIR}/models/olmoe.cpp
    ${LLAMACPP_CPP_DIR}/models/openai-moe.cpp
    ${LLAMACPP_CPP_DIR}/models/openelm.cpp
    ${LLAMACPP_CPP_DIR}/models/orion.cpp
    ${LLAMACPP_CPP_DIR}/models/paddleocr.cpp
    ${LLAMACPP_CPP_DIR}/models/pangu-embed.cpp
    ${LLAMACPP_CPP_DIR}/models/phi2.cpp
    ${LLAMACPP_CPP_DIR}/models/phi3.cpp
    ${LLAMACPP_CPP_DIR}/models/phimoe.cpp
    ${LLAMACPP_CPP_DIR}/models/plamo2.cpp
    ${LLAMACPP_CPP_DIR}/models/plamo3.cpp
    ${LLAMACPP_CPP_DIR}/models/plamo.cpp
    ${LLAMACPP_CPP_DIR}/models/plm.cpp
    ${LLAMACPP_CPP_DIR}/models/qwen2.cpp
    ${LLAMACPP_CPP_DIR}/models/qwen2moe.cpp
    ${LLAMACPP_CPP_DIR}/models/qwen2vl.cpp
    ${LLAMACPP_CPP_DIR}/models/qwen35.cpp
    ${LLAMACPP_CPP_DIR}/models/qwen35moe.cpp
    ${LLAMACPP_CPP_DIR}/models/qwen3.cpp
    ${LLAMACPP_CPP_DIR}/models/qwen3moe.cpp
    ${LLAMACPP_CPP_DIR}/models/qwen3next.cpp
    ${LLAMACPP_CPP_DIR}/models/qwen3vl.cpp
    ${LLAMACPP_CPP_DIR}/models/qwen3vlmoe.cpp
    ${LLAMACPP_CPP_DIR}/models/qwen.cpp
    ${LLAMACPP_CPP_DIR}/models/refact.cpp
    ${LLAMACPP_CPP_DIR}/models/rnd1.cpp
    ${LLAMACPP_CPP_DIR}/models/rwkv6-base.cpp
    ${LLAMACPP_CPP_DIR}/models/rwkv6.cpp
    ${LLAMACPP_CPP_DIR}/models/rwkv6qwen2.cpp
    ${LLAMACPP_CPP_DIR}/models/rwkv7-base.cpp
    ${LLAMACPP_CPP_DIR}/models/rwkv7.cpp
    ${LLAMACPP_CPP_DIR}/models/seed-oss.cpp
    ${LLAMACPP_CPP_DIR}/models/smallthinker.cpp
    ${LLAMACPP_CPP_DIR}/models/smollm3.cpp
    ${LLAMACPP_CPP_DIR}/models/stablelm.cpp
    ${LLAMACPP_CPP_DIR}/models/starcoder2.cpp
    ${LLAMACPP_CPP_DIR}/models/starcoder.cpp
    ${LLAMACPP_CPP_DIR}/models/step35.cpp
    ${LLAMACPP_CPP_DIR}/models/t5.cpp
    ${LLAMACPP_CPP_DIR}/models/t5encoder.cpp
    ${LLAMACPP_CPP_DIR}/models/wavtokenizer-dec.cpp
    ${LLAMACPP_CPP_DIR}/models/xverse.cpp

    # CLIP and mtmd (critical for audio)
    ${LLAMACPP_CPP_DIR}/tools/mtmd/mtmd.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/mtmd-audio.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/mtmd-image.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/clip.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/mtmd-helper.cpp

    # mtmd models
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/cogvlm.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/conformer.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/deepseekocr.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/dotsocr.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/gemma4a.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/gemma4v.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/glm4v.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/granite-speech.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/hunyuanvl.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/internvl.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/kimik25.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/kimivl.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/llama4.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/llava.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/mimovl.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/minicpmv.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/mobilenetv5.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/nemotron-v2-vl.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/paddleocr.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/pixtral.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/qwen2vl.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/qwen3a.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/qwen3vl.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/siglip.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/step3vl.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/whisper-enc.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/yasa2.cpp
    ${LLAMACPP_CPP_DIR}/tools/mtmd/models/youtuvl.cpp
)

# Build voxtral_jni as shared library with embedded llama.cpp
add_library(
    voxtral_jni
    SHARED
    voxtral_jni.cpp
    ${LLAMA_CORE_SOURCES}
)

# Compile definitions
target_compile_definitions(
    voxtral_jni
    PRIVATE
    -DNDEBUG
    -DGGML_USE_CPU
    -DLM_GGML_USE_CPU
)

# Compile options for ARM64 optimization
target_compile_options(
    voxtral_jni
    PRIVATE
    -O3
    -ffast-math
    -fno-finite-math-only
    -march=armv8.2-a+fp16+dotprod
    -fvisibility=hidden
    -ffunction-sections
    -fdata-sections
)

# Link with Android system libraries
target_link_libraries(
    voxtral_jni
    ${LOG_LIB}
    ${ANDROID_LIB}
)

# Linker optimizations + Android 15 16KB page size alignment
target_link_options(
    voxtral_jni
    PRIVATE
    -Wl,--gc-sections
    -Wl,--exclude-libs,ALL
    -Wl,-z,max-page-size=16384
)

message(STATUS "Voxtral JNI Configuration:")
message(STATUS "  Source: ${CMAKE_CURRENT_SOURCE_DIR}/voxtral_jni.cpp")
message(STATUS "  llama.cpp: ${LLAMACPP_CPP_DIR}")
message(STATUS "  Output: libvoxtral_jni.so")
message(STATUS "  CLIP enabled: YES")
