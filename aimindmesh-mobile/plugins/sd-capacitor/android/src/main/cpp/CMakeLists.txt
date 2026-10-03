cmake_minimum_required(VERSION 3.22.1)

project("qnn_sd_jni")

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(qnn_sd_jni SHARED
    qnn_graph_io.cpp
    qnn_sd_engine.cpp
    qnn_sd_jni.cpp
)

target_link_libraries(qnn_sd_jni
    android
    log
    dl
)
