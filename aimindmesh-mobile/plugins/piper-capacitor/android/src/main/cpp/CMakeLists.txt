cmake_minimum_required(VERSION 3.22.1)

project("piper_jni")

# Include headers
# With Prefab, headers are automatically included via target usage?
# But we need basic JNI headers
# include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include/onnxruntime)

# Include headers (still needed for compilation)
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include/onnxruntime)

# Import libonnxruntime.so (REMOVED - Using dlsym dynamic loading)
# add_library(onnxruntime SHARED IMPORTED)
# set_target_properties(onnxruntime PROPERTIES IMPORTED_LOCATION
#     ${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libonnxruntime.so
# )

add_library(piper_jni SHARED
    piper_jni.cpp
)

target_link_libraries(piper_jni
    android
    log
    dl
)
