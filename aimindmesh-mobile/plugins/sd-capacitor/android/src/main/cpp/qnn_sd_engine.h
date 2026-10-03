#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include "qnn_types.h"
#include "qnn_graph_io.h"

/**
 * Stable Diffusion on the Hexagon NPU: text encoder, UNet, VAE decoder (required), VAE encoder
 * and Real-ESRGAN (optional). Tensor layouts and data types come from each context binary, so
 * quantized (Qualcomm AI Hub w8a16) and float exports both run. The app always works in NHWC
 * float latents and RGB bytes; conversions to what a graph declares happen here.
 */
class QnnSdEngine {
public:
    QnnSdEngine() = default;
    ~QnnSdEngine();

    bool init(const std::string& modelDir, const std::string& nativeLibDir = "");
    bool isReady() const { return m_isReady; }
    void release();

    /** Shapes and capabilities of the loaded package, as JSON for the Kotlin side */
    std::string modelInfoJson() const;
    uint32_t seqLen() const { return m_seqLen; }
    uint32_t embedDim() const { return m_embedDim; }
    size_t latentSize() const { return size_t(m_latentH) * m_latentW * m_latentC; }
    size_t imageBytes() const { return size_t(m_imageH) * m_imageW * 3; }
    size_t srImageBytes() const { return size_t(m_srH) * m_srW * 3; }

    bool runTextEncoder(const int32_t* tokens, float* outEmbedding);
    bool runUnet(const float* latentNhwc, float timestep, const float* textEmb, float* outNhwc);
    bool runVae(const float* latentNhwc, uint8_t* outRgb);
    bool runVaeEncoder(const uint8_t* rgb, float* outLatentNhwc);
    bool runSuperResolution(const uint8_t* rgb, uint8_t* outRgb);
    bool hasVaeEncoder() const { return m_isReady && m_parts[VAE_ENCODER].graph != nullptr; }
    bool hasSuperResolution() const { return m_isReady && m_parts[SUPER_RES].graph != nullptr; }

private:
    enum Part { TEXT_ENCODER = 0, UNET, VAE_DECODER, VAE_ENCODER, SUPER_RES, PART_COUNT };
    struct Component {
        Qnn_ContextHandle_t ctx = nullptr;
        Qnn_GraphHandle_t graph = nullptr;
        GraphSpec spec;
        bool specFromBinary = false;
    };

    void* m_libHtp = nullptr;
    void* m_libSystem = nullptr;
    Qnn_BackendHandle_t m_backend = nullptr;
    QnnSystemReader m_system;

    QnnBackend_CreateFn_t m_fnBackendCreate = nullptr;
    QnnBackend_FreeFn_t m_fnBackendFree = nullptr;
    QnnContext_CreateFromBinaryFn_t m_fnContextCreateFromBinary = nullptr;
    QnnContext_FreeFn_t m_fnContextFree = nullptr;
    QnnGraph_RetrieveFn_t m_fnGraphRetrieve = nullptr;
    QnnGraph_ExecuteFn_t m_fnGraphExecute = nullptr;

    Component m_parts[PART_COUNT];
    bool m_isReady = false;

    // UNet input positions in its spec
    int m_unetLatent = -1, m_unetTimestep = -1, m_unetText = -1;
    uint32_t m_seqLen = 0, m_embedDim = 0;
    uint32_t m_latentH = 0, m_latentW = 0, m_latentC = 0;
    uint32_t m_imageH = 0, m_imageW = 0, m_srH = 0, m_srW = 0;
    float m_timestepMax = 999.0f;

    bool loadLibraries(const std::string& nativeLibDir);
    bool loadComponent(const std::string& path, Part part);
    bool configureShapes();
    bool runSingle(Part part, const void* input, float* output) const;
};
