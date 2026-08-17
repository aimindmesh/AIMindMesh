#include "qnn_sd_engine.h"
#include <android/log.h>
#include <dlfcn.h>
#include <fstream>
#include <cmath>
#include <algorithm>
#include <cstring>

#define TAG "QnnSdEngineNative"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

static inline uint16_t quantizeToU16(float val, float scale, int32_t offset) {
    int32_t q = static_cast<int32_t>(std::round(val / scale)) + offset;
    return static_cast<uint16_t>(std::max(0, std::min(65535, q)));
}

static inline float dequantizeFromU16(uint16_t uval, float scale, int32_t offset) {
    return (static_cast<float>(uval) - static_cast<float>(offset)) * scale;
}

QnnSdEngine::QnnSdEngine() {}

QnnSdEngine::~QnnSdEngine() {
    release();
}

void QnnSdEngine::release() {
    if (m_fnContextFree) {
        if (m_textEncCtx) {
            m_fnContextFree(m_textEncCtx, nullptr);
            m_textEncCtx = nullptr;
        }
        if (m_unetCtx) {
            m_fnContextFree(m_unetCtx, nullptr);
            m_unetCtx = nullptr;
        }
        if (m_vaeCtx) {
            m_fnContextFree(m_vaeCtx, nullptr);
            m_vaeCtx = nullptr;
        }
        if (m_vaeEncCtx) {
            m_fnContextFree(m_vaeEncCtx, nullptr);
            m_vaeEncCtx = nullptr;
        }
        if (m_srCtx) {
            m_fnContextFree(m_srCtx, nullptr);
            m_srCtx = nullptr;
        }
    }
    m_textEncGraph = nullptr;
    m_unetGraph = nullptr;
    m_vaeGraph = nullptr;
    m_vaeEncGraph = nullptr;
    m_srGraph = nullptr;
    if (m_backend && m_fnBackendFree) {
        m_fnBackendFree(m_backend);
        m_backend = nullptr;
    }
    m_device = nullptr;

    if (m_libHtp) {
        dlclose(m_libHtp);
        m_libHtp = nullptr;
    }
    if (m_libSystem) {
        dlclose(m_libSystem);
        m_libSystem = nullptr;
    }

    m_isReady = false;
    LOGI("QNN Stable Diffusion Native Engine released");
}

bool QnnSdEngine::loadLibraries(const std::string& nativeLibDir) {
    if (!nativeLibDir.empty()) {
        std::string dspPath = nativeLibDir + ";/dsp;/vendor/dsp/cdsp;/vendor/lib/rfsa/adsp;/system/lib/rfsa/adsp;/dsp/cdsp";
        setenv("ADSP_LIBRARY_PATH", dspPath.c_str(), 1);
        LOGI("Configured ADSP_LIBRARY_PATH: %s", dspPath.c_str());
    }

    // Pre-load vendor FastRPC CDSP communication library exclusively (domain 3) for Hexagon NPU
    const char* fastRpcLibs[] = {
        "/vendor/lib64/libcdsprpc.so",
        "libcdsprpc.so",
        nullptr
    };
    for (int i = 0; fastRpcLibs[i] != nullptr; ++i) {
        void* rpcHandle = dlopen(fastRpcLibs[i], RTLD_NOW | RTLD_GLOBAL);
        if (rpcHandle) {
            LOGI("Pre-loaded CDSP FastRPC library: %s", fastRpcLibs[i]);
            break;
        }
    }

    // Pre-load QNN helper stubs and tools
    if (!nativeLibDir.empty()) {
        dlopen((nativeLibDir + "/libPlatformValidatorShared.so").c_str(), RTLD_NOW | RTLD_GLOBAL);
        dlopen((nativeLibDir + "/libQnnHtpPrepare.so").c_str(), RTLD_NOW | RTLD_GLOBAL);
        dlopen((nativeLibDir + "/libQnnHtpV79Stub.so").c_str(), RTLD_NOW | RTLD_GLOBAL);
        m_libSystem = dlopen((nativeLibDir + "/libQnnSystem.so").c_str(), RTLD_NOW | RTLD_GLOBAL);
    }
    if (!m_libSystem) {
        m_libSystem = dlopen("libQnnSystem.so", RTLD_NOW | RTLD_GLOBAL);
    }

    std::string htpPath = !nativeLibDir.empty() ? (nativeLibDir + "/libQnnHtp.so") : "libQnnHtp.so";
    m_libHtp = dlopen(htpPath.c_str(), RTLD_NOW | RTLD_GLOBAL);
    if (!m_libHtp) {
        m_libHtp = dlopen("libQnnHtp.so", RTLD_NOW | RTLD_GLOBAL);
    }

    if (!m_libHtp) {
        LOGE("Failed to dlopen libQnnHtp.so: %s", dlerror());
        return false;
    }
    LOGI("Loaded QNN HTP dispatcher: %s", htpPath.c_str());

    auto getProviders = (QnnInterfaceGetProvidersFn_t)dlsym(m_libHtp, "QnnInterface_getProviders");
    if (!getProviders) {
        LOGE("dlsym QnnInterface_getProviders failed: %s", dlerror());
        return false;
    }

    const QnnInterface_t** providerList = nullptr;
    uint32_t numProviders = 0;
    if (getProviders(&providerList, &numProviders) != QNN_SUCCESS || numProviders == 0 || !providerList || !providerList[0]) {
        LOGE("getProviders returned no available QNN interfaces");
        return false;
    }

    // Iterate through providers to find compatible QNN interface
    for (uint32_t i = 0; i < numProviders; ++i) {
        if (!providerList[i]) continue;
        const uint8_t* pBytes = reinterpret_cast<const uint8_t*>(providerList[i]);
        LOGI("Evaluating QNN Provider [%u]: %p", i, pBytes);

        m_fnBackendCreate = *reinterpret_cast<QnnBackend_CreateFn_t const*>(pBytes + 0x30);
        m_fnBackendFree = *reinterpret_cast<QnnBackend_FreeFn_t const*>(pBytes + 0x38);
        m_fnContextCreateFromBinary = *reinterpret_cast<QnnContext_CreateFromBinaryFn_t const*>(pBytes + 0x90);
        m_fnContextFree = *reinterpret_cast<QnnContext_FreeFn_t const*>(pBytes + 0xb8);
        m_fnGraphRetrieve = *reinterpret_cast<QnnGraph_RetrieveFn_t const*>(pBytes + 0xc8);
        m_fnGraphExecute = *reinterpret_cast<QnnGraph_ExecuteFn_t const*>(pBytes + 0xd0);

        LOGI("QNN Function Pointers: backendCreate=%p, contextCreateFromBinary=%p, graphRetrieve=%p, graphExecute=%p",
             m_fnBackendCreate, m_fnContextCreateFromBinary, m_fnGraphRetrieve, m_fnGraphExecute);

        if (reinterpret_cast<uintptr_t>(m_fnBackendCreate) > 0x10000) {
            QnnHtpBackend_CustomConfig_t customConfig;
            memset(&customConfig, 0, sizeof(customConfig));
            customConfig.option = QNN_HTP_BACKEND_CONFIG_OPTION_SIGNED_PD;
            customConfig.signedPD = 0; // 0 = false (unsigned PD for Android commercial devices)

            QnnBackend_Config_t backendConfig;
            memset(&backendConfig, 0, sizeof(backendConfig));
            backendConfig.option = QNN_BACKEND_CONFIG_OPTION_CUSTOM;
            backendConfig.customConfig = &customConfig;

            const QnnBackend_Config_t* configs[] = { &backendConfig, nullptr };

            Qnn_ErrorHandle_t createErr = m_fnBackendCreate(nullptr, configs, &m_backend);
            LOGI("backendCreate with unsignedPD config on provider [%u] returned: 0x%x, handle: %p", i, createErr, m_backend);

            if (createErr != QNN_SUCCESS || !m_backend) {
                createErr = m_fnBackendCreate(nullptr, nullptr, &m_backend);
                LOGI("backendCreate (nullptr config fallback) on provider [%u] returned: 0x%x, handle: %p", i, createErr, m_backend);
            }

            if (createErr == QNN_SUCCESS && m_backend) {
                LOGI("QNN HTP Backend successfully initialized on Hexagon NPU: %p", m_backend);
                return true;
            }
        }
    }

    LOGE("No QNN HTP provider could successfully create backend handle");
    return false;
}

bool QnnSdEngine::loadContextBinary(const std::string& path, Qnn_ContextHandle_t* outCtx, Qnn_GraphHandle_t* outGraph) {
    if (!m_backend || !m_fnContextCreateFromBinary) {
        LOGE("QnnSdEngine not ready for loadContextBinary: backend=%p, fn=%p", m_backend, m_fnContextCreateFromBinary);
        return false;
    }

    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) {
        LOGE("Failed to open QNN binary: %s", path.c_str());
        return false;
    }

    std::streamsize size = file.tellg();
    file.seekg(0, std::ios::beg);

    std::vector<char> buffer(size);
    if (!file.read(buffer.data(), size)) {
        LOGE("Failed to read QNN binary data: %s", path.c_str());
        return false;
    }

    *outCtx = nullptr;
    *outGraph = nullptr;
    LOGI("Creating QNN context from binary (%zu bytes): %s", buffer.size(), path.c_str());
    Qnn_ErrorHandle_t err = m_fnContextCreateFromBinary(
        m_backend,
        nullptr,
        nullptr,
        buffer.data(),
        buffer.size(),
        outCtx,
        nullptr
    );
    LOGI("contextCreateFromBinary for %s returned: 0x%x, handle: %p", path.c_str(), err, *outCtx);

    if (err != QNN_SUCCESS || !*outCtx) {
        LOGE("contextCreateFromBinary failed with code 0x%x for %s", err, path.c_str());
        return false;
    }

    if (m_fnGraphRetrieve && *outCtx) {
        // --- Step 1: scan first 4KB of binary for 'graph_*' names ---
        // Qualcomm AI Hub compiled binaries embed the graph name as a plain ASCII
        // string in the header (confirmed by direct inspection of vae_encoder.bin).
        std::vector<std::string> candidateNames;
        {
            const size_t scanLen = std::min(buffer.size(), static_cast<size_t>(4096));
            const char* prefix = "graph_";
            const size_t prefixLen = 6;
            for (size_t i = 0; i + prefixLen < scanLen; ++i) {
                if (memcmp(buffer.data() + i, prefix, prefixLen) == 0) {
                    // Read the full name (alphanumeric + underscore)
                    std::string name;
                    for (size_t j = i; j < scanLen; ++j) {
                        char c = buffer[j];
                        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_') {
                            name += c;
                        } else {
                            break;
                        }
                    }
                    if (name.size() > prefixLen) {
                        // Avoid duplicates
                        if (std::find(candidateNames.begin(), candidateNames.end(), name)
                            == candidateNames.end()) {
                            candidateNames.push_back(name);
                            LOGI("Binary scan found graph name: '%s'", name.c_str());
                        }
                    }
                }
            }
        }

        // --- Step 2: append classic fallback names ---
        std::string baseName = path.substr(path.find_last_of("/\\") + 1);
        size_t dotPos = baseName.find_last_of('.');
        if (dotPos != std::string::npos) baseName = baseName.substr(0, dotPos);
        candidateNames.push_back("stable_diffusion_v2_1_" + baseName);
        candidateNames.push_back(baseName);
        candidateNames.push_back("main");
        candidateNames.push_back("model");

        // --- Step 3: try each name ---
        for (const auto& name : candidateNames) {
            Qnn_ErrorHandle_t rErr = m_fnGraphRetrieve(*outCtx, name.c_str(), outGraph);
            LOGI("graphRetrieve ('%s') for %s returned: 0x%x, graph: %p",
                 name.c_str(), path.c_str(), rErr, *outGraph);
            if (rErr == QNN_SUCCESS && *outGraph) {
                break;
            }
        }
    }

    if (!*outGraph) {
        LOGE("Failed to retrieve valid graph handle for %s", path.c_str());
        return false;
    }

    LOGI("Successfully loaded QNN context and graph from %s (graph: %p)", path.c_str(), *outGraph);
    return true;
}

bool QnnSdEngine::init(const std::string& modelDir, const std::string& nativeLibDir) {
    release();

    if (!nativeLibDir.empty()) {
        std::string dspPath = nativeLibDir + ";/vendor/dsp/cdsp;/vendor/lib/rfsa/adsp;/system/lib/rfsa/adsp";
        setenv("ADSP_LIBRARY_PATH", dspPath.c_str(), 1);
        LOGI("Set ADSP_LIBRARY_PATH: %s", dspPath.c_str());
    }

    loadLibraries(nativeLibDir);

    std::string textEncPath = modelDir + "/text_encoder.bin";
    std::string unetPath = modelDir + "/unet.bin";
    std::string vaePath = modelDir + "/vae.bin";
    std::string vaeEncPath = modelDir + "/vae_encoder.bin";
    std::string srPath = modelDir + "/realesrgan_x4plus.bin";

    bool textOk = loadContextBinary(textEncPath, &m_textEncCtx, &m_textEncGraph);
    bool unetOk = loadContextBinary(unetPath, &m_unetCtx, &m_unetGraph);
    bool vaeOk = loadContextBinary(vaePath, &m_vaeCtx, &m_vaeGraph);
    bool vaeEncOk = loadContextBinary(vaeEncPath, &m_vaeEncCtx, &m_vaeEncGraph);
    bool srOk = loadContextBinary(srPath, &m_srCtx, &m_srGraph);
    if (!srOk) {
        // Fallback name check
        srOk = loadContextBinary(modelDir + "/sr.bin", &m_srCtx, &m_srGraph);
    }

    // VAE encoder and Super Resolution are optional modules
    m_isReady = textOk && unetOk && vaeOk;
    LOGI("QnnSdEngine init complete. isReady: %d (text: %d, unet: %d, vae: %d, vaeEnc: %d, sr: %d)",
         m_isReady ? 1 : 0, textOk ? 1 : 0, unetOk ? 1 : 0, vaeOk ? 1 : 0, vaeEncOk ? 1 : 0, srOk ? 1 : 0);
    if (!vaeEncOk) {
        LOGW("VAE encoder not loaded - img2img will not be available");
    }
    if (!srOk) {
        LOGW("Real-ESRGAN not loaded - AI super-resolution will use bilinear fallback");
    }
    return m_isReady;
}

static inline Qnn_Tensor_t makeQuantTensor(uint32_t id, const char* name, Qnn_TensorType_t type,
                                           uint32_t rank, uint32_t* dims, void* data, size_t dataSize,
                                           float scale, int32_t offset) {
    Qnn_Tensor_t t = {};
    t.version = QNN_TENSOR_VERSION_1;
    t.v1.id = id;
    t.v1.name = name;
    t.v1.type = type;
    t.v1.dataFormat = QNN_TENSOR_DATA_FORMAT_FLAT_BUFFER;
    t.v1.dataType = QNN_DATATYPE_UFIXED_POINT_16;
    t.v1.quantization.encodingDefinition = QNN_QUANTIZATION_ENCODING_SCALE_OFFSET;
    t.v1.quantization.scaleOffsetEncoding.scale = scale;
    t.v1.quantization.scaleOffsetEncoding.offset = offset;
    t.v1.rank = rank;
    t.v1.dimensions = dims;
    t.v1.clientBuf.data = data;
    t.v1.clientBuf.dataSize = dataSize;
    return t;
}

static inline Qnn_Tensor_t makeFloat32Tensor(uint32_t id, const char* name, Qnn_TensorType_t type,
                                             uint32_t rank, uint32_t* dims, void* data, size_t dataSize) {
    Qnn_Tensor_t t = {};
    t.version = QNN_TENSOR_VERSION_2;
    t.v1.id = id;
    t.v1.name = name;
    t.v1.type = type;
    t.v1.dataFormat = QNN_TENSOR_DATA_FORMAT_FLAT_BUFFER;
    t.v1.dataType = QNN_DATATYPE_FLOAT_32;
    t.v1.quantization.encodingDefinition = QNN_QUANTIZATION_ENCODING_UNDEFINED;
    t.v1.rank = rank;
    t.v1.dimensions = dims;
    t.v1.clientBuf.data = data;
    t.v1.clientBuf.dataSize = dataSize;
    return t;
}

bool QnnSdEngine::runTextEncoder(const int32_t* tokens, float* outEmbedding) {
    if (!m_isReady || !m_textEncGraph || !m_fnGraphExecute) return false;

    uint32_t inDims[2] = {1, 77};
    uint32_t outDims[3] = {1, 77, 1024};
    std::vector<uint16_t> rawOutput(77 * 1024);

    Qnn_Tensor_t inTensor = {};
    inTensor.version = QNN_TENSOR_VERSION_1;
    inTensor.v1.id = 2;
    inTensor.v1.name = "tokens";
    inTensor.v1.type = QNN_TENSOR_TYPE_APP_WRITE;
    inTensor.v1.dataFormat = QNN_TENSOR_DATA_FORMAT_FLAT_BUFFER;
    inTensor.v1.dataType = QNN_DATATYPE_INT_32;
    inTensor.v1.quantization.encodingDefinition = QNN_QUANTIZATION_ENCODING_UNDEFINED;
    inTensor.v1.rank = 2;
    inTensor.v1.dimensions = inDims;
    inTensor.v1.clientBuf.data = const_cast<int32_t*>(tokens);
    inTensor.v1.clientBuf.dataSize = 77 * sizeof(int32_t);

    Qnn_Tensor_t outTensor = makeQuantTensor(1505, "text_embedding", QNN_TENSOR_TYPE_APP_READ,
                                             3, outDims, rawOutput.data(), rawOutput.size() * sizeof(uint16_t),
                                             0.00036118616f, 25953);

    Qnn_ErrorHandle_t err = m_fnGraphExecute(m_textEncGraph, &inTensor, 1, &outTensor, 1, nullptr, nullptr);
    if (err == QNN_SUCCESS) {
        for (size_t i = 0; i < 77 * 1024; ++i) {
            outEmbedding[i] = dequantizeFromU16(rawOutput[i], 0.00036118616f, 25953);
        }
        return true;
    }
    LOGE("TextEncoder graphExecute failed: 0x%x", err);
    return false;
}

bool QnnSdEngine::runUnet(const float* inLatent, float timestep, const float* inTextEmb, float* outLatent) {
    if (!m_isReady || !m_unetGraph || !m_fnGraphExecute) return false;

    uint32_t latentDims[4] = {1, 64, 64, 4};
    uint32_t timestepDims[2] = {1, 1};
    uint32_t textEmbDims[3] = {1, 77, 1024};
    size_t latentSize = 1 * 64 * 64 * 4;
    size_t textEmbSize = 1 * 77 * 1024;

    std::vector<uint16_t> qLatent(latentSize), qTimestep(1), qTextEmb(textEmbSize), qOutLatent(latentSize);
    for (size_t i = 0; i < latentSize; ++i) qLatent[i] = quantizeToU16(inLatent[i], 0.0003935263f, 36942);
    qTimestep[0] = quantizeToU16(timestep, 0.01451133f, 0);
    for (size_t i = 0; i < textEmbSize; ++i) qTextEmb[i] = quantizeToU16(inTextEmb[i], 0.0003388274f, 23954);

    Qnn_Tensor_t inTensors[3] = {
        makeQuantTensor(1, "timestep", QNN_TENSOR_TYPE_APP_WRITE, 2, timestepDims, qTimestep.data(), sizeof(uint16_t), 0.01451133f, 0),
        makeQuantTensor(20, "latent", QNN_TENSOR_TYPE_APP_WRITE, 4, latentDims, qLatent.data(), latentSize * sizeof(uint16_t), 0.0003935263f, 36942),
        makeQuantTensor(229, "text_emb", QNN_TENSOR_TYPE_APP_WRITE, 3, textEmbDims, qTextEmb.data(), textEmbSize * sizeof(uint16_t), 0.0003388274f, 23954)
    };

    Qnn_Tensor_t outTensor = makeQuantTensor(12793, "output_latent", QNN_TENSOR_TYPE_APP_READ,
                                             4, latentDims, qOutLatent.data(), latentSize * sizeof(uint16_t),
                                             0.0003243993f, 26599);

    Qnn_ErrorHandle_t err = m_fnGraphExecute(m_unetGraph, inTensors, 3, &outTensor, 1, nullptr, nullptr);
    if (err == QNN_SUCCESS) {
        for (size_t i = 0; i < latentSize; ++i) {
            outLatent[i] = dequantizeFromU16(qOutLatent[i], 0.0003243993f, 26599);
        }
        return true;
    }
    LOGE("UNet graphExecute failed: 0x%x", err);
    return false;
}

bool QnnSdEngine::runVae(const float* inLatent, uint8_t* outRgb) {
    if (!m_isReady || !m_vaeGraph || !m_fnGraphExecute) return false;

    uint32_t latentDims[4] = {1, 64, 64, 4};
    uint32_t imageDims[4] = {1, 512, 512, 3};
    size_t latentSize = 1 * 64 * 64 * 4;
    size_t imageSize = 1 * 512 * 512 * 3;

    std::vector<uint16_t> qLatent(latentSize), qImage(imageSize);
    for (size_t i = 0; i < latentSize; ++i) qLatent[i] = quantizeToU16(inLatent[i], 0.0004164104f, 34999);

    Qnn_Tensor_t inTensor = makeQuantTensor(1, "latent", QNN_TENSOR_TYPE_APP_WRITE,
                                           4, latentDims, qLatent.data(), latentSize * sizeof(uint16_t),
                                           0.0004164104f, 34999);
    Qnn_Tensor_t outTensor = makeQuantTensor(434, "image", QNN_TENSOR_TYPE_APP_READ,
                                            4, imageDims, qImage.data(), imageSize * sizeof(uint16_t),
                                            0.000015259021893143654f, 0);

    Qnn_ErrorHandle_t err = m_fnGraphExecute(m_vaeGraph, &inTensor, 1, &outTensor, 1, nullptr, nullptr);
    if (err == QNN_SUCCESS) {
        for (size_t i = 0; i < imageSize; ++i) {
            float pixelFloat = dequantizeFromU16(qImage[i], 0.00001525902f, 0);
            int32_t p = static_cast<int32_t>(pixelFloat * 255.0f);
            outRgb[i] = static_cast<uint8_t>(std::max(0, std::min(255, p)));
        }
        return true;
    }
    LOGE("VAE graphExecute failed: 0x%x", err);
    return false;
}

bool QnnSdEngine::runVaeEncoder(const float* inRgb, float* outLatent) {
    if (!m_isReady || !m_vaeEncGraph || !m_fnGraphExecute) return false;

    uint32_t inDims[4]  = {1, 512, 512, 3};
    uint32_t outDims[4] = {1, 64, 64, 4};

    Qnn_Tensor_t inTensor = makeFloat32Tensor(1, "image", QNN_TENSOR_TYPE_APP_WRITE,
                                             4, inDims, const_cast<float*>(inRgb), 512 * 512 * 3 * sizeof(float));
    Qnn_Tensor_t outTensor = makeFloat32Tensor(375, "output_0", QNN_TENSOR_TYPE_APP_READ,
                                              4, outDims, outLatent, 64 * 64 * 4 * sizeof(float));

    Qnn_ErrorHandle_t err = m_fnGraphExecute(m_vaeEncGraph, &inTensor, 1, &outTensor, 1, nullptr, nullptr);
    if (err == QNN_SUCCESS) {
        LOGI("VAE Encoder OK: latent[0]=%f latent[1]=%f", outLatent[0], outLatent[1]);
        return true;
    }
    LOGE("VAE Encoder graphExecute failed: 0x%x", err);
    return false;
}

bool QnnSdEngine::runSuperResolution(const float* inRgb512, float* outRgb2048) {
    if (!m_isReady || !m_srGraph || !m_fnGraphExecute) {
        LOGE("SuperResolution engine not ready or graph missing");
        return false;
    }

    uint32_t inDims[4]  = {1, 512, 512, 3};
    uint32_t outDims[4] = {1, 2048, 2048, 3};

    Qnn_Tensor_t inTensor = makeFloat32Tensor(1, "image", QNN_TENSOR_TYPE_APP_WRITE,
                                             4, inDims, const_cast<float*>(inRgb512), 512 * 512 * 3 * sizeof(float));
    Qnn_Tensor_t outTensor = makeFloat32Tensor(3062, "output_0", QNN_TENSOR_TYPE_APP_READ,
                                              4, outDims, outRgb2048, 2048 * 2048 * 3 * sizeof(float));

    Qnn_ErrorHandle_t err = m_fnGraphExecute(m_srGraph, &inTensor, 1, &outTensor, 1, nullptr, nullptr);
    if (err == QNN_SUCCESS) {
        LOGI("SuperResolution OK: out[0]=%f out[1]=%f", outRgb2048[0], outRgb2048[1]);
        return true;
    }
    LOGE("SuperResolution graphExecute failed: 0x%x", err);
    return false;
}
