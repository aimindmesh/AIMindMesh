cmake_minimum_required(VERSION 3.10)

project(llama_cpp)

set(CMAKE_CXX_STANDARD 17)

# Force Release build for performance and to reduce debug overhead
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE "Release")
endif()

# CPU Performance Optimizations
add_definitions(-DNDEBUG)
add_definitions(-DGGML_USE_CPU)
add_definitions(-DLM_GGML_OPENCL_SOA_Q)

# Enabling ARMv8.2-A features (fp16, dotprod) is CRITICAL for inference speed on modern Android
add_compile_options(-O3 -ffast-math -march=armv8.2-a+fp16+dotprod)
set(LLAMACPP_LIB_DIR ${CMAKE_SOURCE_DIR}/../../../cpp)

include_directories(
    ${LLAMACPP_LIB_DIR}
    ${LLAMACPP_LIB_DIR}/common
    ${LLAMACPP_LIB_DIR}/ggml-cpu
    ${LLAMACPP_LIB_DIR}/ggml-vulkan
    ${LLAMACPP_LIB_DIR}/tools/mtmd
    ${LLAMACPP_LIB_DIR}/opencl-headers
    ${LLAMACPP_LIB_DIR}/ggml-opencl/kernels
    ${CMAKE_CURRENT_SOURCE_DIR}/../../vulkan-hpp
    ${CMAKE_SOURCE_DIR}/cpp
)

# Core llama.cpp source files (upgraded from llama.rn v0.12.4)
set(
    LLAMA_SOURCE_FILES
    # ggml core
    ${LLAMACPP_LIB_DIR}/ggml.c
    ${LLAMACPP_LIB_DIR}/ggml-alloc.c
    ${LLAMACPP_LIB_DIR}/ggml-backend.cpp
    ${LLAMACPP_LIB_DIR}/ggml-backend-reg.cpp
    ${LLAMACPP_LIB_DIR}/ggml-backend-dl.cpp
    ${LLAMACPP_LIB_DIR}/ggml-backend-meta.cpp
    ${LLAMACPP_LIB_DIR}/ggml-opt.cpp
    ${LLAMACPP_LIB_DIR}/ggml-threading.cpp
    ${LLAMACPP_LIB_DIR}/ggml-quants.c
    ${LLAMACPP_LIB_DIR}/gguf.cpp

    # ggml-cpu backend
    ${LLAMACPP_LIB_DIR}/ggml-cpu/amx/amx.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/amx/mmq.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/ggml-cpu.c
    ${LLAMACPP_LIB_DIR}/ggml-cpu/ggml-cpu.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/quants.c
    ${LLAMACPP_LIB_DIR}/ggml-cpu/arch/arm/quants.c
    ${LLAMACPP_LIB_DIR}/ggml-cpu/arch/arm/cpu-feats.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/traits.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/repack.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/unary-ops.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/binary-ops.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/vec.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/ops.cpp

    # llama core
    ${LLAMACPP_LIB_DIR}/llama.cpp
    ${LLAMACPP_LIB_DIR}/llama-impl.cpp
    ${LLAMACPP_LIB_DIR}/llama-arch.cpp
    ${LLAMACPP_LIB_DIR}/llama-adapter.cpp
    ${LLAMACPP_LIB_DIR}/llama-batch.cpp
    ${LLAMACPP_LIB_DIR}/llama-chat.cpp
    ${LLAMACPP_LIB_DIR}/llama-context.cpp
    ${LLAMACPP_LIB_DIR}/llama-cparams.cpp
    ${LLAMACPP_LIB_DIR}/llama-grammar.cpp
    ${LLAMACPP_LIB_DIR}/llama-graph.cpp
    ${LLAMACPP_LIB_DIR}/llama-hparams.cpp
    ${LLAMACPP_LIB_DIR}/llama-io.cpp
    ${LLAMACPP_LIB_DIR}/llama-kv-cache.cpp
    ${LLAMACPP_LIB_DIR}/llama-kv-cache-iswa.cpp
    ${LLAMACPP_LIB_DIR}/llama-memory.cpp
    ${LLAMACPP_LIB_DIR}/llama-memory-hybrid.cpp
    ${LLAMACPP_LIB_DIR}/llama-memory-hybrid-iswa.cpp
    ${LLAMACPP_LIB_DIR}/llama-memory-recurrent.cpp
    ${LLAMACPP_LIB_DIR}/llama-mmap.cpp
    ${LLAMACPP_LIB_DIR}/llama-model.cpp
    ${LLAMACPP_LIB_DIR}/llama-model-loader.cpp
    ${LLAMACPP_LIB_DIR}/llama-model-saver.cpp
    ${LLAMACPP_LIB_DIR}/llama-sampler.cpp
    ${LLAMACPP_LIB_DIR}/llama-vocab.cpp

    # common/ directory (reorganized from llama.rn)
    ${LLAMACPP_LIB_DIR}/common/build-info.cpp
    ${LLAMACPP_LIB_DIR}/common/chat-auto-parser-generator.cpp
    ${LLAMACPP_LIB_DIR}/common/chat-auto-parser-helpers.cpp
    ${LLAMACPP_LIB_DIR}/common/chat.cpp
    ${LLAMACPP_LIB_DIR}/common/chat-diff-analyzer.cpp
    ${LLAMACPP_LIB_DIR}/common/chat-peg-parser.cpp
    ${LLAMACPP_LIB_DIR}/common/common.cpp
    ${LLAMACPP_LIB_DIR}/common/fit.cpp
    ${LLAMACPP_LIB_DIR}/common/json-partial.cpp
    ${LLAMACPP_LIB_DIR}/common/json-schema-to-grammar.cpp
    ${LLAMACPP_LIB_DIR}/common/log.cpp
    ${LLAMACPP_LIB_DIR}/common/ngram-cache.cpp
    ${LLAMACPP_LIB_DIR}/common/ngram-map.cpp
    ${LLAMACPP_LIB_DIR}/common/ngram-mod.cpp
    ${LLAMACPP_LIB_DIR}/common/peg-parser.cpp
    ${LLAMACPP_LIB_DIR}/common/reasoning-budget.cpp
    ${LLAMACPP_LIB_DIR}/common/regex-partial.cpp
    ${LLAMACPP_LIB_DIR}/common/sampling.cpp
    ${LLAMACPP_LIB_DIR}/common/speculative.cpp
    ${LLAMACPP_LIB_DIR}/common/unicode.cpp

    # jinja
    ${LLAMACPP_LIB_DIR}/common/jinja/caps.cpp
    ${LLAMACPP_LIB_DIR}/common/jinja/lexer.cpp
    ${LLAMACPP_LIB_DIR}/common/jinja/parser.cpp
    ${LLAMACPP_LIB_DIR}/common/jinja/runtime.cpp
    ${LLAMACPP_LIB_DIR}/common/jinja/string.cpp
    ${LLAMACPP_LIB_DIR}/common/jinja/value.cpp

    # unicode
    ${LLAMACPP_LIB_DIR}/unicode-data.cpp
    ${LLAMACPP_LIB_DIR}/unicode.cpp
    ${LLAMACPP_LIB_DIR}/anyascii.c

    # models/ directory
    ${LLAMACPP_LIB_DIR}/models/afmoe.cpp
    ${LLAMACPP_LIB_DIR}/models/apertus.cpp
    ${LLAMACPP_LIB_DIR}/models/arcee.cpp
    ${LLAMACPP_LIB_DIR}/models/arctic.cpp
    ${LLAMACPP_LIB_DIR}/models/arwkv7.cpp
    ${LLAMACPP_LIB_DIR}/models/baichuan.cpp
    ${LLAMACPP_LIB_DIR}/models/bailingmoe2.cpp
    ${LLAMACPP_LIB_DIR}/models/bailingmoe.cpp
    ${LLAMACPP_LIB_DIR}/models/bert.cpp
    ${LLAMACPP_LIB_DIR}/models/bitnet.cpp
    ${LLAMACPP_LIB_DIR}/models/bloom.cpp
    ${LLAMACPP_LIB_DIR}/models/chameleon.cpp
    ${LLAMACPP_LIB_DIR}/models/chatglm.cpp
    ${LLAMACPP_LIB_DIR}/models/codeshell.cpp
    ${LLAMACPP_LIB_DIR}/models/cogvlm.cpp
    ${LLAMACPP_LIB_DIR}/models/cohere2.cpp
    ${LLAMACPP_LIB_DIR}/models/command-r.cpp
    ${LLAMACPP_LIB_DIR}/models/dbrx.cpp
    ${LLAMACPP_LIB_DIR}/models/deci.cpp
    ${LLAMACPP_LIB_DIR}/models/deepseek2.cpp
    ${LLAMACPP_LIB_DIR}/models/deepseek2ocr.cpp
    ${LLAMACPP_LIB_DIR}/models/deepseek.cpp
    ${LLAMACPP_LIB_DIR}/models/delta-net-base.cpp
    ${LLAMACPP_LIB_DIR}/models/dots1.cpp
    ${LLAMACPP_LIB_DIR}/models/dream.cpp
    ${LLAMACPP_LIB_DIR}/models/ernie4-5.cpp
    ${LLAMACPP_LIB_DIR}/models/ernie4-5-moe.cpp
    ${LLAMACPP_LIB_DIR}/models/eurobert.cpp
    ${LLAMACPP_LIB_DIR}/models/exaone4.cpp
    ${LLAMACPP_LIB_DIR}/models/exaone.cpp
    ${LLAMACPP_LIB_DIR}/models/exaone-moe.cpp
    ${LLAMACPP_LIB_DIR}/models/falcon.cpp
    ${LLAMACPP_LIB_DIR}/models/falcon-h1.cpp
    ${LLAMACPP_LIB_DIR}/models/gemma2.cpp
    ${LLAMACPP_LIB_DIR}/models/gemma3.cpp
    ${LLAMACPP_LIB_DIR}/models/gemma3n.cpp
    ${LLAMACPP_LIB_DIR}/models/gemma4.cpp
    ${LLAMACPP_LIB_DIR}/models/gemma.cpp
    ${LLAMACPP_LIB_DIR}/models/gemma-embedding.cpp
    ${LLAMACPP_LIB_DIR}/models/glm4.cpp
    ${LLAMACPP_LIB_DIR}/models/glm4-moe.cpp
    ${LLAMACPP_LIB_DIR}/models/glm-dsa.cpp
    ${LLAMACPP_LIB_DIR}/models/gpt2.cpp
    ${LLAMACPP_LIB_DIR}/models/gptneox.cpp
    ${LLAMACPP_LIB_DIR}/models/granite.cpp
    ${LLAMACPP_LIB_DIR}/models/granite-hybrid.cpp
    ${LLAMACPP_LIB_DIR}/models/granite-moe.cpp
    ${LLAMACPP_LIB_DIR}/models/grok.cpp
    ${LLAMACPP_LIB_DIR}/models/grovemoe.cpp
    ${LLAMACPP_LIB_DIR}/models/hunyuan-dense.cpp
    ${LLAMACPP_LIB_DIR}/models/hunyuan-moe.cpp
    ${LLAMACPP_LIB_DIR}/models/hunyuan-vl.cpp
    ${LLAMACPP_LIB_DIR}/models/internlm2.cpp
    ${LLAMACPP_LIB_DIR}/models/jais2.cpp
    ${LLAMACPP_LIB_DIR}/models/jais.cpp
    ${LLAMACPP_LIB_DIR}/models/jamba.cpp
    ${LLAMACPP_LIB_DIR}/models/jina-bert-v2.cpp
    ${LLAMACPP_LIB_DIR}/models/jina-bert-v3.cpp
    ${LLAMACPP_LIB_DIR}/models/kimi-linear.cpp
    ${LLAMACPP_LIB_DIR}/models/lfm2.cpp
    ${LLAMACPP_LIB_DIR}/models/lfm2moe.cpp
    ${LLAMACPP_LIB_DIR}/models/llada.cpp
    ${LLAMACPP_LIB_DIR}/models/llada-moe.cpp
    ${LLAMACPP_LIB_DIR}/models/llama4.cpp
    ${LLAMACPP_LIB_DIR}/models/llama.cpp
    ${LLAMACPP_LIB_DIR}/models/llama-embed.cpp
    ${LLAMACPP_LIB_DIR}/models/maincoder.cpp
    ${LLAMACPP_LIB_DIR}/models/mamba2.cpp
    ${LLAMACPP_LIB_DIR}/models/mamba-base.cpp
    ${LLAMACPP_LIB_DIR}/models/mamba.cpp
    ${LLAMACPP_LIB_DIR}/models/mimo2.cpp
    ${LLAMACPP_LIB_DIR}/models/minicpm3.cpp
    ${LLAMACPP_LIB_DIR}/models/minicpm.cpp
    ${LLAMACPP_LIB_DIR}/models/minimax-m2.cpp
    ${LLAMACPP_LIB_DIR}/models/mistral3.cpp
    ${LLAMACPP_LIB_DIR}/models/mistral4.cpp
    ${LLAMACPP_LIB_DIR}/models/modern-bert.cpp
    ${LLAMACPP_LIB_DIR}/models/mpt.cpp
    ${LLAMACPP_LIB_DIR}/models/nemotron.cpp
    ${LLAMACPP_LIB_DIR}/models/nemotron-h.cpp
    ${LLAMACPP_LIB_DIR}/models/nemotron-h-moe.cpp
    ${LLAMACPP_LIB_DIR}/models/neo-bert.cpp
    ${LLAMACPP_LIB_DIR}/models/nomic-bert.cpp
    ${LLAMACPP_LIB_DIR}/models/nomic-bert-moe.cpp
    ${LLAMACPP_LIB_DIR}/models/olmo2.cpp
    ${LLAMACPP_LIB_DIR}/models/olmo.cpp
    ${LLAMACPP_LIB_DIR}/models/olmoe.cpp
    ${LLAMACPP_LIB_DIR}/models/openai-moe.cpp
    ${LLAMACPP_LIB_DIR}/models/openelm.cpp
    ${LLAMACPP_LIB_DIR}/models/orion.cpp
    ${LLAMACPP_LIB_DIR}/models/paddleocr.cpp
    ${LLAMACPP_LIB_DIR}/models/pangu-embed.cpp
    ${LLAMACPP_LIB_DIR}/models/phi2.cpp
    ${LLAMACPP_LIB_DIR}/models/phi3.cpp
    ${LLAMACPP_LIB_DIR}/models/phimoe.cpp
    ${LLAMACPP_LIB_DIR}/models/plamo2.cpp
    ${LLAMACPP_LIB_DIR}/models/plamo3.cpp
    ${LLAMACPP_LIB_DIR}/models/plamo.cpp
    ${LLAMACPP_LIB_DIR}/models/plm.cpp
    ${LLAMACPP_LIB_DIR}/models/qwen2.cpp
    ${LLAMACPP_LIB_DIR}/models/qwen2moe.cpp
    ${LLAMACPP_LIB_DIR}/models/qwen2vl.cpp
    ${LLAMACPP_LIB_DIR}/models/qwen35.cpp
    ${LLAMACPP_LIB_DIR}/models/qwen35moe.cpp
    ${LLAMACPP_LIB_DIR}/models/qwen3.cpp
    ${LLAMACPP_LIB_DIR}/models/qwen3moe.cpp
    ${LLAMACPP_LIB_DIR}/models/qwen3next.cpp
    ${LLAMACPP_LIB_DIR}/models/qwen3vl.cpp
    ${LLAMACPP_LIB_DIR}/models/qwen3vlmoe.cpp
    ${LLAMACPP_LIB_DIR}/models/qwen.cpp
    ${LLAMACPP_LIB_DIR}/models/refact.cpp
    ${LLAMACPP_LIB_DIR}/models/rnd1.cpp
    ${LLAMACPP_LIB_DIR}/models/rwkv6-base.cpp
    ${LLAMACPP_LIB_DIR}/models/rwkv6.cpp
    ${LLAMACPP_LIB_DIR}/models/rwkv6qwen2.cpp
    ${LLAMACPP_LIB_DIR}/models/rwkv7-base.cpp
    ${LLAMACPP_LIB_DIR}/models/rwkv7.cpp
    ${LLAMACPP_LIB_DIR}/models/seed-oss.cpp
    ${LLAMACPP_LIB_DIR}/models/smallthinker.cpp
    ${LLAMACPP_LIB_DIR}/models/smollm3.cpp
    ${LLAMACPP_LIB_DIR}/models/stablelm.cpp
    ${LLAMACPP_LIB_DIR}/models/starcoder2.cpp
    ${LLAMACPP_LIB_DIR}/models/starcoder.cpp
    ${LLAMACPP_LIB_DIR}/models/step35.cpp
    ${LLAMACPP_LIB_DIR}/models/t5.cpp
    ${LLAMACPP_LIB_DIR}/models/t5encoder.cpp
    ${LLAMACPP_LIB_DIR}/models/wavtokenizer-dec.cpp
    ${LLAMACPP_LIB_DIR}/models/xverse.cpp

    # CLIP and mtmd (critical for audio)
    ${LLAMACPP_LIB_DIR}/tools/mtmd/mtmd.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/mtmd-audio.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/mtmd-image.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/clip.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/mtmd-helper.cpp

    # mtmd models
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/cogvlm.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/conformer.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/deepseekocr.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/dotsocr.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/gemma4a.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/gemma4v.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/glm4v.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/granite-speech.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/hunyuanvl.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/internvl.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/kimik25.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/kimivl.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/llama4.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/llava.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/mimovl.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/minicpmv.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/mobilenetv5.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/nemotron-v2-vl.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/paddleocr.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/pixtral.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/qwen2vl.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/qwen3a.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/qwen3vl.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/siglip.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/step3vl.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/whisper-enc.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/yasa2.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/models/youtuvl.cpp

    # Vulkan Support
    ${LLAMACPP_LIB_DIR}/ggml-vulkan/ggml-vulkan.cpp
    ${LLAMACPP_LIB_DIR}/ggml-vulkan/ggml-vulkan-shaders.cpp

    # OpenCL Support (Qualcomm Adreno-optimized)
    ${LLAMACPP_LIB_DIR}/ggml-opencl/ggml-opencl.cpp
    
    # Capacitor Plugin Source Files
    ${LLAMACPP_LIB_DIR}/cap-llama.cpp
    ${LLAMACPP_LIB_DIR}/cap-completion.cpp
    ${LLAMACPP_LIB_DIR}/cap-tts.cpp
    ${CMAKE_SOURCE_DIR}/jni-utils.h
    ${CMAKE_SOURCE_DIR}/jni.cpp
    
    # llama.cpp Native Inference JNI
    ${CMAKE_SOURCE_DIR}/cpp/llama_inference_jni.cpp
    ${CMAKE_SOURCE_DIR}/cpp/LLMInference.cpp
)

# Find Android libraries
find_library(LOG_LIB log)
find_library(ANDROID_LIB android)

# =============================================================================
# Multi-Library Build Functions (based on SmolChat-Android)
# =============================================================================

# Base library build function
function(build_llama_cpp_library target_name)
    add_library(
        ${target_name}
        SHARED
        ${LLAMA_SOURCE_FILES}
    )
    
    target_include_directories(
        ${target_name}
        PUBLIC
        ${LLAMACPP_LIB_DIR}
        ${LLAMACPP_LIB_DIR}/ggml-cpu
        ${LLAMACPP_LIB_DIR}/ggml-vulkan
        ${LLAMACPP_LIB_DIR}/tools/mtmd
        ${LLAMACPP_LIB_DIR}/opencl-headers
        ${CMAKE_CURRENT_SOURCE_DIR}/../../vulkan-hpp
    )
    
    # Common compile options
    target_compile_options(
        ${target_name}
        PUBLIC
        -fvisibility=hidden
        -fvisibility-inlines-hidden
        -ffunction-sections
        -fdata-sections
        -O3
        -DNDEBUG
        # OpenCL disabled for CPU-only SmolChat-style build
        # -DLM_GGML_USE_OPENCL
        # -DLM_GGML_OPENCL_USE_ADRENO_KERNELS
        # -DLM_GGML_OPENCL_EMBED_KERNELS
        -DLM_GGML_USE_CPU
        -fno-finite-math-only
        -funroll-loops
        -ftree-vectorize
        -DGGML_VULKAN=1
        -DGGML_VULKAN_ANDROID=1
        # OpenCL backend for Qualcomm Adreno GPU
        -DLM_GGML_USE_OPENCL
        -DLM_GGML_OPENCL_USE_ADRENO_KERNELS
        -DLM_GGML_OPENCL_EMBED_KERNELS
        -DLM_GGML_OPENCL_TARGET_VERSION=300
    )

    # OpenCL stub: allows runtime dlopen of OpenCL without linking to libOpenCL.so
    if(NOT TARGET OpenCL_stub)
        add_library(OpenCL_stub SHARED "${LLAMACPP_LIB_DIR}/opencl_stub.c")
        set_target_properties(OpenCL_stub PROPERTIES OUTPUT_NAME "OpenCL_proxy")
        target_link_libraries(OpenCL_stub PRIVATE ${LOG_LIB} dl)
        target_link_options(OpenCL_stub PRIVATE -Wl,-z,max-page-size=16384)
    endif()

    # Link libraries (CPU + Vulkan + OpenCL stub)
    target_link_libraries(
        ${target_name}
        ${LOG_LIB}
        ${ANDROID_LIB}
        vulkan
        OpenCL_stub
    )
    
    # Linker optimizations + Android 15 16KB page size alignment
    target_link_options(
        ${target_name}
        PRIVATE
        -Wl,--gc-sections
        -Wl,--exclude-libs,ALL
        -Wl,-z,max-page-size=16384
    )
endfunction()

# ARM64 base (ARMv8-A)
function(build_llama_cpp_arm64_v8 target_name)
    build_llama_cpp_library(${target_name})
    target_compile_options(
        ${target_name}
        PUBLIC
        -march=armv8-a
        -mtune=cortex-a76
    )
endfunction()

# ARM64 with FP16 (ARMv8.2-A)
function(build_llama_cpp_arm64_v8_2_fp16 target_name)
    build_llama_cpp_library(${target_name})
    target_compile_options(
        ${target_name}
        PUBLIC
        -march=armv8.2-a+fp16
        -mtune=cortex-a76
    )
endfunction()

# ARM64 with FP16 + DotProd (ARMv8.2-A)
function(build_llama_cpp_arm64_v8_2_fp16_dotprod target_name)
    build_llama_cpp_library(${target_name})
    target_compile_options(
        ${target_name}
        PUBLIC
        -march=armv8.2-a+fp16+dotprod
        -mtune=cortex-a77
    )
endfunction()

# ARM64 with FP16 + DotProd (ARMv8.4-A)
function(build_llama_cpp_arm64_v8_4_fp16_dotprod target_name)
    build_llama_cpp_library(${target_name})
    target_compile_options(
        ${target_name}
        PUBLIC
        -march=armv8.4-a+fp16+dotprod
        -mtune=cortex-x2
    )
endfunction()

# ARM64 with FP16 + DotProd + I8MM (ARMv8.4-A) - for Snapdragon 8 Gen 2
function(build_llama_cpp_arm64_v8_4_fp16_dotprod_i8mm target_name)
    build_llama_cpp_library(${target_name})
    target_compile_options(
        ${target_name}
        PUBLIC
        -march=armv8.4-a+fp16+dotprod+i8mm
        -mtune=cortex-x3
    )
endfunction()

# ARM64 with FP16 + DotProd + SVE (ARMv8.4-A)
function(build_llama_cpp_arm64_v8_4_fp16_dotprod_sve target_name)
    build_llama_cpp_library(${target_name})
    target_compile_options(
        ${target_name}
        PUBLIC
        -march=armv8.4-a+fp16+dotprod+sve
        -mtune=cortex-x3
    )
endfunction()

# ARM64 with FP16 + DotProd + I8MM + SVE (ARMv8.4-A) - Maximum optimization
function(build_llama_cpp_arm64_v8_4_fp16_dotprod_i8mm_sve target_name)
    build_llama_cpp_library(${target_name})
    target_compile_options(
        ${target_name}
        PUBLIC
        -march=armv8.4-a+fp16+dotprod+i8mm+sve
        -mtune=cortex-x4
    )
endfunction()

# ARMv7a (32-bit)
function(build_llama_cpp_armv7a target_name)
    build_llama_cpp_library(${target_name})
    target_compile_options(
        ${target_name}
        PUBLIC
        -march=armv7-a
        -mfpu=neon-vfpv4
        -mfloat-abi=softfp
    )
endfunction()

# =============================================================================
# Build all library variants
# =============================================================================

# Universal fallback (for emulators and unsupported devices)
build_llama_cpp_library("llama_cpp")
# Rename to llama-cpp-arm64 for backward compatibility with Java loading code
set_target_properties(llama_cpp PROPERTIES OUTPUT_NAME "llama-cpp-arm64")

if (${ANDROID_ABI} STREQUAL "armeabi-v7a")
    # 32-bit ARM
    build_llama_cpp_armv7a("llama_cpp_v7a")
    message(STATUS "Building LlamaCpp for ARMv7a (32-bit)")
endif()

if (${ANDROID_ABI} STREQUAL "arm64-v8a")
    # ARM64 variants
    build_llama_cpp_arm64_v8("llama_cpp_v8")
    build_llama_cpp_arm64_v8_2_fp16("llama_cpp_v8_2_fp16")
    build_llama_cpp_arm64_v8_2_fp16_dotprod("llama_cpp_v8_2_fp16_dotprod")
    build_llama_cpp_arm64_v8_4_fp16_dotprod("llama_cpp_v8_4_fp16_dotprod")
    build_llama_cpp_arm64_v8_4_fp16_dotprod_i8mm("llama_cpp_v8_4_fp16_dotprod_i8mm")
    build_llama_cpp_arm64_v8_4_fp16_dotprod_sve("llama_cpp_v8_4_fp16_dotprod_sve")
    build_llama_cpp_arm64_v8_4_fp16_dotprod_i8mm_sve("llama_cpp_v8_4_fp16_dotprod_i8mm_sve")
    
    message(STATUS "Building LlamaCpp for ARM64 with multiple CPU optimization variants:")
    message(STATUS "  - smollm (universal fallback)")
    message(STATUS "  - llama_cpp_v8 (ARMv8-A base)")
    message(STATUS "  - llama_cpp_v8_2_fp16 (ARMv8.2-A + FP16)")
    message(STATUS "  - llama_cpp_v8_2_fp16_dotprod (ARMv8.2-A + FP16 + DotProd)")
    message(STATUS "  - llama_cpp_v8_4_fp16_dotprod (ARMv8.4-A + FP16 + DotProd)")
    message(STATUS "  - llama_cpp_v8_4_fp16_dotprod_i8mm (ARMv8.4-A + I8MM - for 8 Gen 2)")
    message(STATUS "  - llama_cpp_v8_4_fp16_dotprod_sve (ARMv8.4-A + SVE)")
    message(STATUS "  - llama_cpp_v8_4_fp16_dotprod_i8mm_sve (ARMv8.4-A + I8MM + SVE - Maximum)")
endif()

message(STATUS "LlamaCpp source directory: ${LLAMACPP_LIB_DIR}")
message(STATUS "LlamaCpp JNI directory: ${CMAKE_SOURCE_DIR}/cpp")
