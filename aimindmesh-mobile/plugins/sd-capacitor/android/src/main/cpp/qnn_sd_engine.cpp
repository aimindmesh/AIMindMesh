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
    }
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
        std::string baseName = path.substr(path.find_last_of("/\\") + 1);
        size_t dotPos = baseName.find_last_of('.');
        if (dotPos != std::string::npos) baseName = baseName.substr(0, dotPos);

        std::vector<std::string> candidateNames = {
            "stable_diffusion_v2_1_" + baseName,
            baseName,
            "main",
            "model"
        };

        for (const auto& name : candidateNames) {
            Qnn_ErrorHandle_t rErr = m_fnGraphRetrieve(*outCtx, name.c_str(), outGraph);
            LOGI("graphRetrieve ('%s') for %s returned: 0x%x, graph: %p", name.c_str(), path.c_str(), rErr, *outGraph);
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

    bool textOk = loadContextBinary(textEncPath, &m_textEncCtx, &m_textEncGraph);
    bool unetOk = loadContextBinary(unetPath, &m_unetCtx, &m_unetGraph);
    bool vaeOk = loadContextBinary(vaePath, &m_vaeCtx, &m_vaeGraph);

    m_isReady = textOk && unetOk && vaeOk;
    LOGI("QnnSdEngine init complete. isReady: %d (text: %d, unet: %d, vae: %d)", m_isReady ? 1 : 0, textOk ? 1 : 0, unetOk ? 1 : 0, vaeOk ? 1 : 0);
    return m_isReady;
}

bool QnnSdEngine::runTextEncoder(const int32_t* tokens, float* outEmbedding) {
    if (!m_isReady || !m_textEncGraph || !m_fnGraphExecute) {
        return false;
    }

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
    inTensor.v1.rank = 2;
    inTensor.v1.dimensions = inDims;
    inTensor.v1.clientBuf.data = const_cast<int32_t*>(tokens);
    inTensor.v1.clientBuf.dataSize = 77 * sizeof(int32_t);

    Qnn_Tensor_t outTensor = {};
    outTensor.version = QNN_TENSOR_VERSION_1;
    outTensor.v1.id = 1505;
    outTensor.v1.name = "text_embedding";
    outTensor.v1.type = QNN_TENSOR_TYPE_APP_READ;
    outTensor.v1.dataFormat = QNN_TENSOR_DATA_FORMAT_FLAT_BUFFER;
    outTensor.v1.dataType = QNN_DATATYPE_UFIXED_POINT_16;
    outTensor.v1.quantization.encodingDefinition = QNN_QUANTIZATION_ENCODING_SCALE_OFFSET;
    outTensor.v1.quantization.scaleOffsetEncoding.scale = 0.00036118616f;
    outTensor.v1.quantization.scaleOffsetEncoding.offset = 25953;
    outTensor.v1.rank = 3;
    outTensor.v1.dimensions = outDims;
    outTensor.v1.clientBuf.data = rawOutput.data();
    outTensor.v1.clientBuf.dataSize = rawOutput.size() * sizeof(uint16_t);

    Qnn_ErrorHandle_t err = m_fnGraphExecute(
        m_textEncGraph,
        &inTensor,
        1,
        &outTensor,
        1,
        nullptr,
        nullptr
    );

    if (err == QNN_SUCCESS) {
        for (size_t i = 0; i < rawOutput.size(); ++i) {
            outEmbedding[i] = dequantizeFromU16(rawOutput[i], 0.00036118616f, 25953);
        }
        return true;
    }

    LOGE("TextEncoder graphExecute failed with error 0x%x", err);
    return false;
}

bool QnnSdEngine::runUnet(const float* inLatent, float timestep, const float* inTextEmb, float* outLatent) {
    if (!m_isReady || !m_unetGraph || !m_fnGraphExecute) {
        return false;
    }

    uint32_t latentDims[4] = {1, 64, 64, 4};
    uint32_t timestepDims[2] = {1, 1};
    uint32_t textEmbDims[3] = {1, 77, 1024};

    size_t latentSize = 1 * 64 * 64 * 4;
    size_t textEmbSize = 1 * 77 * 1024;

    std::vector<uint16_t> qLatent(latentSize);
    std::vector<uint16_t> qTimestep(1);
    std::vector<uint16_t> qTextEmb(textEmbSize);
    std::vector<uint16_t> qOutLatent(latentSize);

    for (size_t i = 0; i < latentSize; ++i) {
        qLatent[i] = quantizeToU16(inLatent[i], 0.0003935263f, 36942);
    }
    qTimestep[0] = quantizeToU16(timestep, 0.01451133f, 0);
    for (size_t i = 0; i < textEmbSize; ++i) {
        qTextEmb[i] = quantizeToU16(inTextEmb[i], 0.0003388274f, 23954);
    }

    Qnn_Tensor_t inTensors[3] = {};
    // 0: timestep
    inTensors[0].version = QNN_TENSOR_VERSION_1;
    inTensors[0].v1.id = 1;
    inTensors[0].v1.name = "timestep";
    inTensors[0].v1.type = QNN_TENSOR_TYPE_APP_WRITE;
    inTensors[0].v1.dataFormat = QNN_TENSOR_DATA_FORMAT_FLAT_BUFFER;
    inTensors[0].v1.dataType = QNN_DATATYPE_UFIXED_POINT_16;
    inTensors[0].v1.quantization.encodingDefinition = QNN_QUANTIZATION_ENCODING_SCALE_OFFSET;
    inTensors[0].v1.quantization.scaleOffsetEncoding.scale = 0.01451133f;
    inTensors[0].v1.quantization.scaleOffsetEncoding.offset = 0;
    inTensors[0].v1.rank = 2;
    inTensors[0].v1.dimensions = timestepDims;
    inTensors[0].v1.clientBuf.data = qTimestep.data();
    inTensors[0].v1.clientBuf.dataSize = sizeof(uint16_t);

    // 1: latent
    inTensors[1].version = QNN_TENSOR_VERSION_1;
    inTensors[1].v1.id = 20;
    inTensors[1].v1.name = "latent";
    inTensors[1].v1.type = QNN_TENSOR_TYPE_APP_WRITE;
    inTensors[1].v1.dataFormat = QNN_TENSOR_DATA_FORMAT_FLAT_BUFFER;
    inTensors[1].v1.dataType = QNN_DATATYPE_UFIXED_POINT_16;
    inTensors[1].v1.quantization.encodingDefinition = QNN_QUANTIZATION_ENCODING_SCALE_OFFSET;
    inTensors[1].v1.quantization.scaleOffsetEncoding.scale = 0.0003935263f;
    inTensors[1].v1.quantization.scaleOffsetEncoding.offset = 36942;
    inTensors[1].v1.rank = 4;
    inTensors[1].v1.dimensions = latentDims;
    inTensors[1].v1.clientBuf.data = qLatent.data();
    inTensors[1].v1.clientBuf.dataSize = latentSize * sizeof(uint16_t);

    // 2: text_emb
    inTensors[2].version = QNN_TENSOR_VERSION_1;
    inTensors[2].v1.id = 229;
    inTensors[2].v1.name = "text_emb";
    inTensors[2].v1.type = QNN_TENSOR_TYPE_APP_WRITE;
    inTensors[2].v1.dataFormat = QNN_TENSOR_DATA_FORMAT_FLAT_BUFFER;
    inTensors[2].v1.dataType = QNN_DATATYPE_UFIXED_POINT_16;
    inTensors[2].v1.quantization.encodingDefinition = QNN_QUANTIZATION_ENCODING_SCALE_OFFSET;
    inTensors[2].v1.quantization.scaleOffsetEncoding.scale = 0.0003388274f;
    inTensors[2].v1.quantization.scaleOffsetEncoding.offset = 23954;
    inTensors[2].v1.rank = 3;
    inTensors[2].v1.dimensions = textEmbDims;
    inTensors[2].v1.clientBuf.data = qTextEmb.data();
    inTensors[2].v1.clientBuf.dataSize = textEmbSize * sizeof(uint16_t);

    Qnn_Tensor_t outTensor = {};
    outTensor.version = QNN_TENSOR_VERSION_1;
    outTensor.v1.id = 12793;
    outTensor.v1.name = "output_latent";
    outTensor.v1.type = QNN_TENSOR_TYPE_APP_READ;
    outTensor.v1.dataFormat = QNN_TENSOR_DATA_FORMAT_FLAT_BUFFER;
    outTensor.v1.dataType = QNN_DATATYPE_UFIXED_POINT_16;
    outTensor.v1.quantization.encodingDefinition = QNN_QUANTIZATION_ENCODING_SCALE_OFFSET;
    outTensor.v1.quantization.scaleOffsetEncoding.scale = 0.0003243993f;
    outTensor.v1.quantization.scaleOffsetEncoding.offset = 26599;
    outTensor.v1.rank = 4;
    outTensor.v1.dimensions = latentDims;
    outTensor.v1.clientBuf.data = qOutLatent.data();
    outTensor.v1.clientBuf.dataSize = latentSize * sizeof(uint16_t);

    Qnn_ErrorHandle_t err = m_fnGraphExecute(
        m_unetGraph,
        inTensors,
        3,
        &outTensor,
        1,
        nullptr,
        nullptr
    );

    if (err == QNN_SUCCESS) {
        for (size_t i = 0; i < latentSize; ++i) {
            outLatent[i] = dequantizeFromU16(qOutLatent[i], 0.0003243993f, 26599);
        }
        return true;
    }

    LOGE("UNet graphExecute failed with error 0x%x", err);
    return false;
}

bool QnnSdEngine::runVae(const float* inLatent, uint8_t* outRgb) {
    if (!m_isReady || !m_vaeGraph || !m_fnGraphExecute) {
        return false;
    }

    uint32_t latentDims[4] = {1, 64, 64, 4};
    uint32_t imageDims[4] = {1, 512, 512, 3};

    size_t latentSize = 1 * 64 * 64 * 4;
    size_t imageSize = 1 * 512 * 512 * 3;

    std::vector<uint16_t> qLatent(latentSize);
    std::vector<uint16_t> qImage(imageSize);

    for (size_t i = 0; i < latentSize; ++i) {
        qLatent[i] = quantizeToU16(inLatent[i], 0.0004164104f, 34999);
    }

    Qnn_Tensor_t inTensor = {};
    inTensor.version = QNN_TENSOR_VERSION_1;
    inTensor.v1.id = 1;
    inTensor.v1.name = "latent";
    inTensor.v1.type = QNN_TENSOR_TYPE_APP_WRITE;
    inTensor.v1.dataFormat = QNN_TENSOR_DATA_FORMAT_FLAT_BUFFER;
    inTensor.v1.dataType = QNN_DATATYPE_UFIXED_POINT_16;
    inTensor.v1.quantization.encodingDefinition = QNN_QUANTIZATION_ENCODING_SCALE_OFFSET;
    inTensor.v1.quantization.scaleOffsetEncoding.scale = 0.0004164104f;
    inTensor.v1.quantization.scaleOffsetEncoding.offset = 34999;
    inTensor.v1.rank = 4;
    inTensor.v1.dimensions = latentDims;
    inTensor.v1.clientBuf.data = qLatent.data();
    inTensor.v1.clientBuf.dataSize = latentSize * sizeof(uint16_t);

    Qnn_Tensor_t outTensor = {};
    outTensor.version = QNN_TENSOR_VERSION_1;
    outTensor.v1.id = 434;
    outTensor.v1.name = "image";
    outTensor.v1.type = QNN_TENSOR_TYPE_APP_READ;
    outTensor.v1.dataFormat = QNN_TENSOR_DATA_FORMAT_FLAT_BUFFER;
    outTensor.v1.dataType = QNN_DATATYPE_UFIXED_POINT_16;
    outTensor.v1.quantization.encodingDefinition = QNN_QUANTIZATION_ENCODING_SCALE_OFFSET;
    outTensor.v1.quantization.scaleOffsetEncoding.scale = 0.000015259021893143654f;
    outTensor.v1.quantization.scaleOffsetEncoding.offset = 0;
    outTensor.v1.rank = 4;
    outTensor.v1.dimensions = imageDims;
    outTensor.v1.clientBuf.data = qImage.data();
    outTensor.v1.clientBuf.dataSize = imageSize * sizeof(uint16_t);

    Qnn_ErrorHandle_t err = m_fnGraphExecute(
        m_vaeGraph,
        &inTensor,
        1,
        &outTensor,
        1,
        nullptr,
        nullptr
    );

    if (err == QNN_SUCCESS) {
        for (size_t i = 0; i < imageSize; ++i) {
            float pixelFloat = dequantizeFromU16(qImage[i], 0.00001525902f, 0);
            int32_t p = static_cast<int32_t>(pixelFloat * 255.0f);
            outRgb[i] = static_cast<uint8_t>(std::max(0, std::min(255, p)));
        }
        return true;
    }

    LOGE("VAE graphExecute failed with error 0x%x", err);
    return false;
}
