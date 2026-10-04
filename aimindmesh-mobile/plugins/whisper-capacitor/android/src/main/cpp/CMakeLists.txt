cmake_minimum_required(VERSION 3.10)
project(whisper_capacitor)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ============================================================================
# ARM64 Android Optimizations
# These flags benefit Snapdragon 8 Gen 2 (Z Fold 5) and 8 Elite (Z Fold 7)
# ============================================================================
if(ANDROID)
    if(ANDROID_ABI STREQUAL "arm64-v8a")
        # Optimize every build type, debug APKs included: unoptimized whisper.cpp runs at a
        # fraction of real time, which makes post-meeting transcription unusable.
        foreach(cfg DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
            set(CMAKE_C_FLAGS_${cfg} "-O3 -DNDEBUG")
            set(CMAKE_CXX_FLAGS_${cfg} "-O3 -DNDEBUG")
        endforeach()

        # NEON dot-product and fp16 kernels (ARMv8.2: every Snapdragon since the 845).
        # WhisperContext checks the CPU for them before loading the library.
        set(GGML_CPU_ARM_ARCH "armv8.2-a+dotprod+fp16" CACHE STRING "" FORCE)

        message(STATUS "ARM64 optimization flags enabled for Android")
    endif()

    # Enable OpenMP for multi-threaded inference (critical for performance)
    set(GGML_OPENMP ON CACHE BOOL "Enable OpenMP" FORCE)
endif()

# Define whisper source root
# We are in plugins/whisper-capacitor/android/src/main/cpp
# Source is in plugins/whisper-capacitor/cpp
get_filename_component(WHISPER_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../../../cpp" ABSOLUTE)

message(STATUS "Whisper root: ${WHISPER_ROOT}")

# Whisper build options
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_SDL2 OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE) # Avoid -march=native on Android cross-compile
set(WHISPER_NO_AVX ON CACHE BOOL "" FORCE)
set(WHISPER_NO_AVX2 ON CACHE BOOL "" FORCE)
set(WHISPER_NO_FMA ON CACHE BOOL "" FORCE)
set(WHISPER_NO_F16C ON CACHE BOOL "" FORCE)

# whisper and its ggml (0.9.5) are linked STATICALLY into libwhisper-capacitor.so.
# Shared, they shipped libggml*.so files that collided with the newer ggml of the GenieX
# SDK in the APK (pickFirst kept whisper's copies and broke Genie's GGUF/OpenCL path).
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
add_compile_options(-ffunction-sections -fdata-sections)

# include whisper.cpp project
add_subdirectory(${WHISPER_ROOT} whisper_build)

# Create our JNI library
add_library(whisper-capacitor SHARED native-lib.cpp)

# Include directories
target_include_directories(whisper-capacitor PRIVATE
    ${WHISPER_ROOT}/include
    ${WHISPER_ROOT}/ggml/include
    ${WHISPER_ROOT}/src
)

find_library(log-lib log)

target_link_libraries(whisper-capacitor
    whisper
    ${log-lib}
)

# Android 15 16KB page size alignment.
# --exclude-libs,ALL keeps the static ggml symbols private: only the JNI entry points are
# exported, so they can never interpose with GenieX's libggml loaded in the same process.
target_link_options(whisper-capacitor PRIVATE
    -Wl,-z,max-page-size=16384
    -Wl,--exclude-libs,ALL
    -Wl,--gc-sections
)
