#include "qnn_sd_engine.h"
#include <android/log.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <algorithm>
#include <cmath>
#include <cstring>

#define TAG "QnnSdEngineNative"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

QnnSdEngine::~QnnSdEngine() {
    release();
}

void QnnSdEngine::release() {
    for (auto& part : m_parts) {
        if (part.ctx && m_fnContextFree) {
            Qnn_ErrorHandle_t err = m_fnContextFree(part.ctx, nullptr);
            if (err != QNN_SUCCESS) LOGW("contextFree returned 0x%llx", static_cast<unsigned long long>(err));
        }
        part = Component();
    }
    if (m_backend && m_fnBackendFree) {
        Qnn_ErrorHandle_t err = m_fnBackendFree(m_backend);
        if (err != QNN_SUCCESS) LOGW("backendFree returned 0x%llx", static_cast<unsigned long long>(err));
    }
    m_backend = nullptr;
    m_fnBackendCreate = nullptr;
    m_fnBackendFree = nullptr;
    m_fnContextCreateFromBinary = nullptr;
    m_fnContextFree = nullptr;
    m_fnGraphRetrieve = nullptr;
    m_fnGraphExecute = nullptr;
    m_system = QnnSystemReader();

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

    // Pre-load the vendor FastRPC CDSP communication library (domain 3) for the Hexagon NPU
    for (const char* rpc : {"/vendor/lib64/libcdsprpc.so", "libcdsprpc.so"}) {
        if (dlopen(rpc, RTLD_NOW | RTLD_GLOBAL)) {
            LOGI("Pre-loaded CDSP FastRPC library: %s", rpc);
            break;
        }
    }

    if (!nativeLibDir.empty()) {
        dlopen((nativeLibDir + "/libPlatformValidatorShared.so").c_str(), RTLD_NOW | RTLD_GLOBAL);
        dlopen((nativeLibDir + "/libQnnHtpPrepare.so").c_str(), RTLD_NOW | RTLD_GLOBAL);
        dlopen((nativeLibDir + "/libQnnHtpV79Stub.so").c_str(), RTLD_NOW | RTLD_GLOBAL);
        m_libSystem = dlopen((nativeLibDir + "/libQnnSystem.so").c_str(), RTLD_NOW | RTLD_GLOBAL);
    }
    if (!m_libSystem) m_libSystem = dlopen("libQnnSystem.so", RTLD_NOW | RTLD_GLOBAL);
    if (!m_system.init(m_libSystem)) {
        LOGW("QNN System API unavailable: falling back to the built-in Qualcomm SD 2.1 tensor layout");
    }

    std::string htpPath = !nativeLibDir.empty() ? (nativeLibDir + "/libQnnHtp.so") : "libQnnHtp.so";
    m_libHtp = dlopen(htpPath.c_str(), RTLD_NOW | RTLD_GLOBAL);
    if (!m_libHtp) m_libHtp = dlopen("libQnnHtp.so", RTLD_NOW | RTLD_GLOBAL);
    if (!m_libHtp) {
        LOGE("Failed to dlopen libQnnHtp.so: %s", dlerror());
        return false;
    }

    auto getProviders = reinterpret_cast<QnnInterfaceGetProvidersFn_t>(dlsym(m_libHtp, "QnnInterface_getProviders"));
    const QnnInterface_t** providers = nullptr;
    uint32_t count = 0;
    if (!getProviders || getProviders(&providers, &count) != QNN_SUCCESS || count == 0 || !providers) {
        LOGE("QnnInterface_getProviders returned no QNN interface");
        return false;
    }

    for (uint32_t i = 0; i < count; ++i) {
        const QnnInterface_t* p = providers[i];
        if (!p || !p->fn.backendCreate) continue;
        LOGI("QNN provider [%u]: core API %u.%u.%u", i, p->apiVersion.coreApiVersion.major,
             p->apiVersion.coreApiVersion.minor, p->apiVersion.coreApiVersion.patch);

        QnnHtpBackend_CustomConfig_t customConfig;
        memset(&customConfig, 0, sizeof(customConfig));
        customConfig.option = QNN_HTP_BACKEND_CONFIG_OPTION_SIGNED_PD;
        customConfig.signedPD = 0; // unsigned PD on commercial Android devices
        QnnBackend_Config_t backendConfig;
        memset(&backendConfig, 0, sizeof(backendConfig));
        backendConfig.option = QNN_BACKEND_CONFIG_OPTION_CUSTOM;
        backendConfig.customConfig = &customConfig;
        const QnnBackend_Config_t* configs[] = {&backendConfig, nullptr};

        Qnn_ErrorHandle_t err = p->fn.backendCreate(nullptr, configs, &m_backend);
        if (err != QNN_SUCCESS || !m_backend) err = p->fn.backendCreate(nullptr, nullptr, &m_backend);
        if (err == QNN_SUCCESS && m_backend) {
            m_fnBackendCreate = p->fn.backendCreate;
            m_fnBackendFree = p->fn.backendFree;
            m_fnContextCreateFromBinary = p->fn.contextCreateFromBinary;
            m_fnContextFree = p->fn.contextFree;
            m_fnGraphRetrieve = p->fn.graphRetrieve;
            m_fnGraphExecute = p->fn.graphExecute;
            LOGI("QNN HTP backend initialized on the Hexagon NPU");
            return true;
        }
    }
    LOGE("No QNN HTP provider could create a backend");
    return false;
}

/** Tensor layout of the Qualcomm AI Hub SD 2.1 package, used only without the System API */
static bool legacySpec(const std::string& file, GraphSpec& spec) {
    auto t = [](uint32_t id, const char* name, Qnn_TensorType_t type, Qnn_DataType_t dt, float scale, int32_t offset,
                std::vector<uint32_t> dims) {
        TensorSpec s;
        s.id = id; s.name = name; s.type = type; s.dataType = dt; s.dims = std::move(dims);
        s.quantized = dt == QNN_DATATYPE_UFIXED_POINT_16;
        s.scale = scale; s.offset = offset;
        return s;
    };
    const auto W = QNN_TENSOR_TYPE_APP_WRITE, R = QNN_TENSOR_TYPE_APP_READ;
    const auto U16 = QNN_DATATYPE_UFIXED_POINT_16, F32 = QNN_DATATYPE_FLOAT_32;
    if (file == "text_encoder") {
        spec.inputs = {t(2, "tokens", W, QNN_DATATYPE_INT_32, 1, 0, {1, 77})};
        spec.outputs = {t(1505, "text_embedding", R, U16, 0.00036118616f, -25953, {1, 77, 1024})};
    } else if (file == "unet") {
        spec.inputs = {t(1, "timestep", W, U16, 0.01451133f, 0, {1, 1}),
                       t(20, "latent", W, U16, 0.0003935263f, -36942, {1, 64, 64, 4}),
                       t(229, "text_emb", W, U16, 0.0003388274f, -23954, {1, 77, 1024})};
        spec.outputs = {t(12793, "output_latent", R, U16, 0.0003243993f, -26599, {1, 64, 64, 4})};
    } else if (file == "vae") {
        spec.inputs = {t(1, "latent", W, U16, 0.0004164104f, -34999, {1, 64, 64, 4})};
        spec.outputs = {t(434, "image", R, U16, 1.0f / 65535.0f, 0, {1, 512, 512, 3})};
    } else if (file == "vae_encoder") {
        spec.inputs = {t(1, "image", W, F32, 1, 0, {1, 512, 512, 3})};
        spec.outputs = {t(375, "output_0", R, F32, 1, 0, {1, 64, 64, 4})};
    } else if (file == "realesrgan_x4plus" || file == "sr") {
        spec.inputs = {t(1, "image", W, F32, 1, 0, {1, 512, 512, 3})};
        spec.outputs = {t(3062, "output_0", R, F32, 1, 0, {1, 2048, 2048, 3})};
    } else {
        return false;
    }
    return true;
}

/** Graph names AI Hub embeds in the binary header, for loads without the System API */
static std::vector<std::string> scanGraphNames(const uint8_t* data, size_t size, const std::string& file) {
    std::vector<std::string> names;
    const size_t scanLen = std::min(size, static_cast<size_t>(4096));
    for (size_t i = 0; i + 6 < scanLen; ++i) {
        if (memcmp(data + i, "graph_", 6) != 0) continue;
        std::string name;
        for (size_t j = i; j < scanLen; ++j) {
            char c = static_cast<char>(data[j]);
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_') name += c; else break;
        }
        if (name.size() > 6 && std::find(names.begin(), names.end(), name) == names.end()) names.push_back(name);
    }
    for (const std::string& n : {"stable_diffusion_v2_1_" + file, file, std::string("main"), std::string("model")}) names.push_back(n);
    return names;
}

bool QnnSdEngine::loadComponent(const std::string& path, Part part) {
    Component& c = m_parts[part];
    int fd = open(path.c_str(), O_RDONLY);
    if (fd < 0) return false;
    struct stat st{};
    if (fstat(fd, &st) != 0 || st.st_size <= 0) {
        close(fd);
        return false;
    }
    const size_t size = static_cast<size_t>(st.st_size);
    // Mapped, not copied: a 1.7 GB UNet must not need 1.7 GB of heap on top of the NPU context
    void* data = mmap(nullptr, size, PROT_READ | PROT_WRITE, MAP_PRIVATE, fd, 0);
    close(fd);
    if (data == MAP_FAILED) {
        LOGE("mmap failed for %s", path.c_str());
        return false;
    }

    std::string file = path.substr(path.find_last_of("/\\") + 1);
    file = file.substr(0, file.find_last_of('.'));
    c.specFromBinary = m_system.readGraphSpec(data, size, c.spec);
    if (!c.specFromBinary && !legacySpec(file, c.spec)) {
        LOGE("No tensor description for %s", path.c_str());
        munmap(data, size);
        return false;
    }

    LOGI("Creating QNN context from %s (%zu bytes)", path.c_str(), size);
    Qnn_ErrorHandle_t err = m_fnContextCreateFromBinary(m_backend, nullptr, nullptr, data, size, &c.ctx, nullptr);
    if (err != QNN_SUCCESS || !c.ctx) {
        LOGE("contextCreateFromBinary failed (0x%llx) for %s", static_cast<unsigned long long>(err), path.c_str());
        munmap(data, size);
        c = Component();
        return false;
    }

    std::vector<std::string> names;
    if (c.specFromBinary) names.push_back(c.spec.graphName);
    for (const auto& n : scanGraphNames(static_cast<const uint8_t*>(data), size, file)) names.push_back(n);
    munmap(data, size);
    for (const auto& name : names) {
        if (m_fnGraphRetrieve(c.ctx, name.c_str(), &c.graph) == QNN_SUCCESS && c.graph) {
            c.spec.graphName = name;
            break;
        }
        c.graph = nullptr;
    }
    if (!c.graph) {
        LOGE("No graph found in %s", path.c_str());
        m_fnContextFree(c.ctx, nullptr);
        c = Component();
        return false;
    }
    LOGI("Loaded graph '%s' from %s (tensors from %s)", c.spec.graphName.c_str(), path.c_str(),
         c.specFromBinary ? "binary" : "built-in layout");
    for (const auto* list : {&c.spec.inputs, &c.spec.outputs}) {
        for (const auto& t : *list) {
            LOGI("  %s '%s' id=%u type=0x%x quant=%d scale=%g offset=%d elements=%zu",
                 list == &c.spec.inputs ? "in " : "out", t.name.c_str(), t.id, t.dataType, t.quantized ? 1 : 0,
                 t.scale, t.offset, t.elementCount());
        }
    }
    return true;
}

static int findInput(const GraphSpec& spec, const char* name, size_t rank, size_t elements) {
    for (size_t i = 0; i < spec.inputs.size(); ++i) if (spec.inputs[i].name == name) return static_cast<int>(i);
    for (size_t i = 0; i < spec.inputs.size(); ++i) {
        const auto& t = spec.inputs[i];
        if (t.dims.size() == rank && (elements == 0 || t.elementCount() == elements)) return static_cast<int>(i);
    }
    return -1;
}

/** Derives the pipeline shapes from the graphs and checks that they fit together. */
bool QnnSdEngine::configureShapes() {
    const GraphSpec& text = m_parts[TEXT_ENCODER].spec;
    const GraphSpec& unet = m_parts[UNET].spec;
    const GraphSpec& vae = m_parts[VAE_DECODER].spec;
    if (text.inputs.size() != 1 || text.outputs.empty() || text.outputs[0].dims.size() != 3) return false;
    m_seqLen = text.outputs[0].dims[1];
    m_embedDim = text.outputs[0].dims[2];
    if (text.inputs[0].elementCount() != m_seqLen) return false;

    m_unetLatent = findInput(unet, "latent", 4, 0);
    m_unetTimestep = findInput(unet, "timestep", 2, 1);
    m_unetText = findInput(unet, "text_emb", 3, size_t(m_seqLen) * m_embedDim);
    if (m_unetLatent < 0 || m_unetTimestep < 0 || m_unetText < 0 || unet.outputs.empty()) return false;
    const TensorSpec& latent = unet.inputs[m_unetLatent];
    const bool nchw = isChannelsFirst(latent, 4);
    m_latentC = 4;
    m_latentH = nchw ? latent.dims[2] : latent.dims[1];
    m_latentW = nchw ? latent.dims[3] : latent.dims[2];
    if (unet.inputs[m_unetText].elementCount() != size_t(m_seqLen) * m_embedDim) return false;
    if (unet.outputs[0].elementCount() != latentSize()) return false;
    m_timestepMax = std::min(999.0f, unet.inputs[m_unetTimestep].maxRepresentable());

    if (vae.inputs.size() != 1 || vae.outputs.empty() || vae.inputs[0].elementCount() != latentSize()) return false;
    const TensorSpec& image = vae.outputs[0];
    if (image.dims.size() != 4) return false;
    const bool imgNchw = isChannelsFirst(image, 3);
    m_imageH = imgNchw ? image.dims[2] : image.dims[1];
    m_imageW = imgNchw ? image.dims[3] : image.dims[2];
    if (image.elementCount() != imageBytes()) return false;

    Component& enc = m_parts[VAE_ENCODER];
    if (enc.graph && (enc.spec.inputs.size() != 1 || enc.spec.inputs[0].elementCount() != imageBytes() ||
                      enc.spec.outputs.empty() || enc.spec.outputs[0].elementCount() != latentSize())) {
        LOGW("vae_encoder.bin does not match this pipeline: image editing disabled");
        m_fnContextFree(enc.ctx, nullptr);
        enc = Component();
    }
    Component& sr = m_parts[SUPER_RES];
    if (sr.graph) {
        const TensorSpec* out = sr.spec.outputs.empty() ? nullptr : &sr.spec.outputs[0];
        if (sr.spec.inputs.size() != 1 || sr.spec.inputs[0].elementCount() != imageBytes() || !out || out->dims.size() != 4) {
            LOGW("Super-resolution model does not match this pipeline: disabled");
            m_fnContextFree(sr.ctx, nullptr);
            sr = Component();
        } else {
            const bool srNchw = isChannelsFirst(*out, 3);
            m_srH = srNchw ? out->dims[2] : out->dims[1];
            m_srW = srNchw ? out->dims[3] : out->dims[2];
        }
    }
    return true;
}

bool QnnSdEngine::init(const std::string& modelDir, const std::string& nativeLibDir) {
    release();
    if (!loadLibraries(nativeLibDir)) {
        release();
        return false;
    }

    bool required = loadComponent(modelDir + "/text_encoder.bin", TEXT_ENCODER) &&
                    loadComponent(modelDir + "/unet.bin", UNET) &&
                    loadComponent(modelDir + "/vae.bin", VAE_DECODER);
    if (required) {
        // Optional modules: image editing and AI upscaling
        if (!loadComponent(modelDir + "/vae_encoder.bin", VAE_ENCODER)) LOGW("VAE encoder not loaded: img2img unavailable");
        if (!loadComponent(modelDir + "/realesrgan_x4plus.bin", SUPER_RES) && !loadComponent(modelDir + "/sr.bin", SUPER_RES)) {
            LOGW("Real-ESRGAN not loaded: upscaling uses bilinear filtering");
        }
        required = configureShapes();
        if (!required) LOGE("The model files do not form a consistent Stable Diffusion pipeline");
    }
    if (!required) {
        release(); // nothing half-loaded stays in NPU memory
        return false;
    }
    m_isReady = true;
    LOGI("QnnSdEngine ready: %s", modelInfoJson().c_str());
    return true;
}

std::string QnnSdEngine::modelInfoJson() const {
    char buf[512];
    snprintf(buf, sizeof(buf),
             "{\"specsFromBinary\":%s,\"seqLen\":%u,\"embedDim\":%u,\"latentChannels\":%u,\"latentHeight\":%u,"
             "\"latentWidth\":%u,\"imageWidth\":%u,\"imageHeight\":%u,\"timestepMax\":%.3f,\"hasVaeEncoder\":%s,"
             "\"hasSuperResolution\":%s,\"superResolutionWidth\":%u,\"superResolutionHeight\":%u,\"unetQuantized\":%s}",
             m_parts[UNET].specFromBinary ? "true" : "false", m_seqLen, m_embedDim, m_latentC, m_latentH, m_latentW,
             m_imageW, m_imageH, m_timestepMax, hasVaeEncoder() ? "true" : "false",
             hasSuperResolution() ? "true" : "false", m_srW, m_srH,
             (m_unetLatent >= 0 && m_parts[UNET].spec.inputs[m_unetLatent].quantized) ? "true" : "false");
    return buf;
}

bool QnnSdEngine::runSingle(Part part, const void* input, float* output) const {
    const Component& c = m_parts[part];
    if (!m_isReady || !c.graph) return false;
    GraphRunner runner(m_fnGraphExecute, c.graph, c.spec);
    return runner.run({input}, {output});
}

bool QnnSdEngine::runTextEncoder(const int32_t* tokens, float* outEmbedding) {
    return runSingle(TEXT_ENCODER, tokens, outEmbedding);
}

bool QnnSdEngine::runUnet(const float* latentNhwc, float timestep, const float* textEmb, float* outNhwc) {
    const Component& c = m_parts[UNET];
    if (!m_isReady || !c.graph) return false;
    const bool nchw = isChannelsFirst(c.spec.inputs[m_unetLatent], m_latentC);
    std::vector<float> latentIn(latentSize()), out(latentSize());
    if (nchw) nhwcToNchw(latentNhwc, latentIn.data(), m_latentC, m_latentH, m_latentW);
    else std::copy(latentNhwc, latentNhwc + latentSize(), latentIn.begin());

    std::vector<const void*> inputs(c.spec.inputs.size(), nullptr);
    inputs[m_unetLatent] = latentIn.data();
    inputs[m_unetTimestep] = &timestep;
    inputs[m_unetText] = textEmb;
    GraphRunner runner(m_fnGraphExecute, c.graph, c.spec);
    if (!runner.run(inputs, {out.data()})) return false;
    if (isChannelsFirst(c.spec.outputs[0], m_latentC)) nchwToNhwc(out.data(), outNhwc, m_latentC, m_latentH, m_latentW);
    else std::copy(out.begin(), out.end(), outNhwc);
    return true;
}

static inline uint8_t toByte(float v) {
    return static_cast<uint8_t>(std::lround(std::min(1.0f, std::max(0.0f, v)) * 255.0f));
}

/** Converts graph images ([0,1] floats, NHWC or NCHW) to RGB bytes and back. */
static void imageToBytes(const TensorSpec& spec, const std::vector<float>& img, uint8_t* rgb, uint32_t h, uint32_t w) {
    if (isChannelsFirst(spec, 3)) {
        std::vector<float> nhwc(img.size());
        nchwToNhwc(img.data(), nhwc.data(), 3, h, w);
        for (size_t i = 0; i < nhwc.size(); ++i) rgb[i] = toByte(nhwc[i]);
    } else {
        for (size_t i = 0; i < img.size(); ++i) rgb[i] = toByte(img[i]);
    }
}

static std::vector<float> bytesToImage(const TensorSpec& spec, const uint8_t* rgb, uint32_t h, uint32_t w) {
    std::vector<float> nhwc(size_t(h) * w * 3);
    for (size_t i = 0; i < nhwc.size(); ++i) nhwc[i] = rgb[i] / 255.0f;
    if (!isChannelsFirst(spec, 3)) return nhwc;
    std::vector<float> nchw(nhwc.size());
    nhwcToNchw(nhwc.data(), nchw.data(), 3, h, w);
    return nchw;
}

bool QnnSdEngine::runVae(const float* latentNhwc, uint8_t* outRgb) {
    const Component& c = m_parts[VAE_DECODER];
    if (!m_isReady || !c.graph) return false;
    std::vector<float> latentIn(latentNhwc, latentNhwc + latentSize());
    if (isChannelsFirst(c.spec.inputs[0], m_latentC)) nhwcToNchw(latentNhwc, latentIn.data(), m_latentC, m_latentH, m_latentW);
    std::vector<float> img(imageBytes());
    if (!runSingle(VAE_DECODER, latentIn.data(), img.data())) return false;
    imageToBytes(c.spec.outputs[0], img, outRgb, m_imageH, m_imageW);
    return true;
}

bool QnnSdEngine::runVaeEncoder(const uint8_t* rgb, float* outLatentNhwc) {
    const Component& c = m_parts[VAE_ENCODER];
    if (!hasVaeEncoder()) return false;
    std::vector<float> img = bytesToImage(c.spec.inputs[0], rgb, m_imageH, m_imageW);
    std::vector<float> latent(latentSize());
    if (!runSingle(VAE_ENCODER, img.data(), latent.data())) return false;
    if (isChannelsFirst(c.spec.outputs[0], m_latentC)) nchwToNhwc(latent.data(), outLatentNhwc, m_latentC, m_latentH, m_latentW);
    else std::copy(latent.begin(), latent.end(), outLatentNhwc);
    return true;
}

bool QnnSdEngine::runSuperResolution(const uint8_t* rgb, uint8_t* outRgb) {
    const Component& c = m_parts[SUPER_RES];
    if (!hasSuperResolution()) return false;
    std::vector<float> img = bytesToImage(c.spec.inputs[0], rgb, m_imageH, m_imageW);
    std::vector<float> out(srImageBytes());
    if (!runSingle(SUPER_RES, img.data(), out.data())) return false;
    imageToBytes(c.spec.outputs[0], out, outRgb, m_srH, m_srW);
    return true;
}
