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
        # Aggressive optimization flags for release builds
        set(CMAKE_C_FLAGS_RELEASE "${CMAKE_C_FLAGS_RELEASE} -O3 -ffast-math -fno-finite-math-only -fvectorize -funroll-loops -finline-functions")
        set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -O3 -ffast-math -fno-finite-math-only -fvectorize -funroll-loops -finline-functions")
        
        # RelWithDebInfo also gets optimizations
        set(CMAKE_C_FLAGS_RELWITHDEBINFO "${CMAKE_C_FLAGS_RELWITHDEBINFO} -O3 -ffast-math -fno-finite-math-only -fvectorize -funroll-loops")
        set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} -O3 -ffast-math -fno-finite-math-only -fvectorize -funroll-loops")
        
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
set(GGML_ native OFF CACHE BOOL "" FORCE) # Avoid -march=native on Android cross-compile
set(WHISPER_NO_AVX ON CACHE BOOL "" FORCE)
set(WHISPER_NO_AVX2 ON CACHE BOOL "" FORCE)
set(WHISPER_NO_FMA ON CACHE BOOL "" FORCE)
set(WHISPER_NO_F16C ON CACHE BOOL "" FORCE)

# include whisper.cpp project
add_subdirectory(${WHISPER_ROOT} whisper_build)

# Create our JNI library
add_library(whisper-capacitor SHARED native-lib.cpp)

# Include directories
target_include_directories(whisper-capacitor PRIVATE
    ${WHISPER_ROOT}/include
    ${WHISPER_ROOT}/examples
    ${WHISPER_ROOT}/ggml/include
    ${WHISPER_ROOT}/src
)

find_library(log-lib log)

target_link_libraries(whisper-capacitor
    whisper
    ${log-lib}
)

# Android 15 16KB page size alignment
target_link_options(whisper-capacitor PRIVATE
    -Wl,-z,max-page-size=16384
)
