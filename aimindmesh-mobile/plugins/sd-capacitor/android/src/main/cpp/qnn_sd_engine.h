#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include "qnn_types.h"

class QnnSdEngine {
public:
    QnnSdEngine();
    ~QnnSdEngine();

    bool init(const std::string& modelDir, const std::string& nativeLibDir = "");
    bool isReady() const { return m_isReady; }
    void release();

    bool runTextEncoder(const int32_t* tokens, float* outEmbedding);
    bool runUnet(const float* inLatent, float timestep, const float* inTextEmb, float* outLatent);
    bool runVae(const float* inLatent, uint8_t* outRgb);
    bool runVaeEncoder(const float* inRgb, float* outLatent);
    bool hasVaeEncoder() const { return m_vaeEncGraph != nullptr; }

    bool runSuperResolution(const float* inRgb512, float* outRgb2048);
    bool hasSuperResolution() const { return m_srGraph != nullptr; }

private:
    void* m_libHtp = nullptr;
    void* m_libSystem = nullptr;

    const QnnInterface_t* m_qnn = nullptr;
    Qnn_BackendHandle_t m_backend = nullptr;
    Qnn_DeviceHandle_t m_device = nullptr;

    Qnn_ContextHandle_t m_textEncCtx = nullptr;
    Qnn_GraphHandle_t m_textEncGraph = nullptr;

    Qnn_ContextHandle_t m_unetCtx = nullptr;
    Qnn_GraphHandle_t m_unetGraph = nullptr;

    Qnn_ContextHandle_t m_vaeCtx = nullptr;
    Qnn_GraphHandle_t m_vaeGraph = nullptr;

    Qnn_ContextHandle_t m_vaeEncCtx = nullptr;
    Qnn_GraphHandle_t m_vaeEncGraph = nullptr;

    Qnn_ContextHandle_t m_srCtx = nullptr;
    Qnn_GraphHandle_t m_srGraph = nullptr;

    bool m_isReady = false;

    QnnBackend_CreateFn_t m_fnBackendCreate = nullptr;
    QnnBackend_FreeFn_t m_fnBackendFree = nullptr;
    QnnContext_CreateFromBinaryFn_t m_fnContextCreateFromBinary = nullptr;
    QnnContext_FreeFn_t m_fnContextFree = nullptr;
    QnnGraph_RetrieveFn_t m_fnGraphRetrieve = nullptr;
    QnnGraph_ExecuteFn_t m_fnGraphExecute = nullptr;

    bool loadLibraries(const std::string& nativeLibDir = "");
    bool loadContextBinary(const std::string& path, Qnn_ContextHandle_t* outCtx, Qnn_GraphHandle_t* outGraph);
};
