#include "qnn_graph_io.h"
#include <dlfcn.h>
#include <algorithm>
#include <cmath>
#include <cstring>

#ifdef __ANDROID__
#include <android/log.h>
#define GIO_LOGI(...) __android_log_print(ANDROID_LOG_INFO, "QnnGraphIO", __VA_ARGS__)
#define GIO_LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "QnnGraphIO", __VA_ARGS__)
#else
#include <cstdio>
#define GIO_LOGI(...) (fprintf(stderr, __VA_ARGS__), fputc('\n', stderr))
#define GIO_LOGE(...) (fprintf(stderr, __VA_ARGS__), fputc('\n', stderr))
#endif

size_t TensorSpec::elementCount() const {
    size_t n = 1;
    for (uint32_t d : dims) n *= d;
    return n;
}

size_t TensorSpec::bytesPerElement() const {
    switch (dataType) {
        case QNN_DATATYPE_INT_8: case QNN_DATATYPE_UINT_8: case QNN_DATATYPE_BOOL_8:
        case QNN_DATATYPE_SFIXED_POINT_8: case QNN_DATATYPE_UFIXED_POINT_8: return 1;
        case QNN_DATATYPE_INT_16: case QNN_DATATYPE_UINT_16: case QNN_DATATYPE_FLOAT_16:
        case QNN_DATATYPE_SFIXED_POINT_16: case QNN_DATATYPE_UFIXED_POINT_16: return 2;
        case QNN_DATATYPE_INT_32: case QNN_DATATYPE_UINT_32: case QNN_DATATYPE_FLOAT_32:
        case QNN_DATATYPE_SFIXED_POINT_32: case QNN_DATATYPE_UFIXED_POINT_32: return 4;
        default: return 0;
    }
}

static bool quantRange(Qnn_DataType_t type, double& qmin, double& qmax) {
    switch (type) {
        case QNN_DATATYPE_UFIXED_POINT_8: qmin = 0; qmax = 255; return true;
        case QNN_DATATYPE_UFIXED_POINT_16: qmin = 0; qmax = 65535; return true;
        case QNN_DATATYPE_SFIXED_POINT_8: qmin = -128; qmax = 127; return true;
        case QNN_DATATYPE_SFIXED_POINT_16: qmin = -32768; qmax = 32767; return true;
        default: return false;
    }
}

float TensorSpec::maxRepresentable() const {
    double qmin = 0, qmax = 0;
    if (quantized && quantRange(dataType, qmin, qmax)) return static_cast<float>((qmax + offset) * scale);
    return INFINITY;
}

const TensorSpec* GraphSpec::input(const char* name) const {
    for (const auto& t : inputs) if (t.name == name) return &t;
    return nullptr;
}

// --- Reading the binary info -------------------------------------------------------------

static bool plausibleString(const char* s) {
    if (!s) return false;
    for (int i = 0; i < 256; ++i) {
        unsigned char c = static_cast<unsigned char>(s[i]);
        if (c == 0) return i > 0;
        if (c < 0x20 || c > 0x7e) return false;
    }
    return false;
}

static bool copyTensor(const Qnn_Tensor_t& t, TensorSpec& out) {
    if (t.version != QNN_TENSOR_VERSION_1 && t.version != QNN_TENSOR_VERSION_2) return false;
    const Qnn_TensorV1_t& v = t.v1;
    if (!plausibleString(v.name) || v.rank < 1 || v.rank > 8 || !v.dimensions) return false;
    out.id = v.id;
    out.name = v.name;
    out.version = t.version;
    out.type = v.type;
    out.dataType = v.dataType;
    out.dims.assign(v.dimensions, v.dimensions + v.rank);
    for (uint32_t d : out.dims) if (d == 0 || d > (1u << 20)) return false;
    if (out.bytesPerElement() == 0) return false;
    const Qnn_QuantizeParams_t& q = v.quantizeParams;
    out.quantized = q.encodingDefinition == QNN_DEFINITION_DEFINED;
    if (out.quantized) {
        // Per-axis encodings point into the binary info: not supported (no SD export uses them)
        if (q.quantizationEncoding != QNN_QUANTIZATION_ENCODING_SCALE_OFFSET) return false;
        out.scale = q.scaleOffsetEncoding.scale;
        out.offset = q.scaleOffsetEncoding.offset;
        if (!(out.scale > 0.0f) || !std::isfinite(out.scale)) return false;
    }
    return true;
}

static bool parseGraphInfo(const uint8_t* graphInfo, GraphSpec& out) {
    const auto* g = reinterpret_cast<const QnnSystemContext_GraphInfoPrefix_t*>(graphInfo + QNN_GRAPH_INFO_UNION_OFFSET);
    if (!plausibleString(g->graphName)) return false;
    if (g->numGraphInputs < 1 || g->numGraphInputs > 16 || !g->graphInputs) return false;
    if (g->numGraphOutputs < 1 || g->numGraphOutputs > 16 || !g->graphOutputs) return false;
    GraphSpec spec;
    spec.graphName = g->graphName;
    spec.inputs.resize(g->numGraphInputs);
    spec.outputs.resize(g->numGraphOutputs);
    for (uint32_t i = 0; i < g->numGraphInputs; ++i) if (!copyTensor(g->graphInputs[i], spec.inputs[i])) return false;
    for (uint32_t i = 0; i < g->numGraphOutputs; ++i) if (!copyTensor(g->graphOutputs[i], spec.outputs[i])) return false;
    out = std::move(spec);
    return true;
}

bool QnnSystemReader::init(void* libSystemHandle) {
    m_iface = nullptr;
    if (!libSystemHandle) return false;
    auto getProviders = reinterpret_cast<QnnSystemInterfaceGetProvidersFn_t>(
        dlsym(libSystemHandle, "QnnSystemInterface_getProviders"));
    if (!getProviders) return false;
    const QnnSystemInterface_t** list = nullptr;
    uint32_t count = 0;
    if (getProviders(&list, &count) != QNN_SUCCESS || count == 0 || !list || !list[0]) return false;
    const QnnSystemInterface_t* iface = list[0];
    if (!iface->fn.systemContextCreate || !iface->fn.systemContextGetBinaryInfo || !iface->fn.systemContextFree) return false;
    GIO_LOGI("QNN System API %u.%u.%u", iface->systemApiVersion.major, iface->systemApiVersion.minor, iface->systemApiVersion.patch);
    m_iface = iface;
    return true;
}

bool QnnSystemReader::readGraphSpec(void* binary, size_t size, GraphSpec& out) const {
    if (!m_iface) return false;
    QnnSystemContext_Handle_t sys = nullptr;
    if (m_iface->fn.systemContextCreate(&sys) != QNN_SUCCESS || !sys) return false;

    bool ok = false;
    const void* info = nullptr;
    uint64_t infoSize = 0;
    if (m_iface->fn.systemContextGetBinaryInfo(sys, binary, size, &info, &infoSize) == QNN_SUCCESS && info) {
        const auto* base = static_cast<const uint8_t*>(info);
        const uint32_t version = *reinterpret_cast<const uint32_t*>(base);
        const uint8_t* u = base + QNN_BINARY_INFO_UNION_OFFSET;
        // V1/V2 and V3 keep the graph list at different offsets; a newer version is tried
        // with both and accepted only if what it points to is a well-formed graph description
        const size_t layouts[2][2] = {
            {QNN_BINARY_INFO_V3_NUM_GRAPHS, QNN_BINARY_INFO_V3_GRAPHS},
            {QNN_BINARY_INFO_V1V2_NUM_GRAPHS, QNN_BINARY_INFO_V1V2_GRAPHS},
        };
        for (int i = (version <= 2 ? 1 : 0); i < 2 && !ok; ++i) {
            const uint32_t numGraphs = *reinterpret_cast<const uint32_t*>(u + layouts[i][0]);
            const uint8_t* graphs = *reinterpret_cast<const uint8_t* const*>(u + layouts[i][1]);
            // Stable Diffusion binaries hold one graph each
            if (numGraphs < 1 || numGraphs > 64 || !graphs) continue;
            ok = parseGraphInfo(graphs, out);
            if (ok && numGraphs > 1) GIO_LOGI("Binary holds %u graphs: using '%s'", numGraphs, out.graphName.c_str());
        }
        if (!ok) GIO_LOGE("Unrecognized QNN binary info (version %u)", version);
    }
    m_iface->fn.systemContextFree(sys);
    return ok;
}

// --- Conversions --------------------------------------------------------------------------

static uint16_t floatToHalf(float f) {
    uint32_t x;
    std::memcpy(&x, &f, 4);
    const uint32_t sign = (x >> 16) & 0x8000u;
    int32_t exp = static_cast<int32_t>((x >> 23) & 0xffu) - 127 + 15;
    uint32_t mant = x & 0x7fffffu;
    if (exp <= 0) return static_cast<uint16_t>(sign);                 // flush tiny values
    if (exp >= 31) return static_cast<uint16_t>(sign | 0x7c00u);      // overflow -> inf
    return static_cast<uint16_t>(sign | (exp << 10) | ((mant + 0x1000u) >> 13));
}

static float halfToFloat(uint16_t h) {
    const uint32_t sign = (h & 0x8000u) << 16;
    const uint32_t exp = (h >> 10) & 0x1fu;
    const uint32_t mant = h & 0x3ffu;
    uint32_t x;
    if (exp == 0) x = sign;                                          // zero / subnormal -> 0
    else if (exp == 31) x = sign | 0x7f800000u | (mant << 13);
    else x = sign | ((exp - 15 + 127) << 23) | (mant << 13);
    float f;
    std::memcpy(&f, &x, 4);
    return f;
}

bool packTensor(const TensorSpec& spec, const float* values, size_t count, std::vector<uint8_t>& out) {
    if (count != spec.elementCount()) return false;
    out.resize(count * spec.bytesPerElement());
    double qmin = 0, qmax = 0;
    if (spec.quantized && quantRange(spec.dataType, qmin, qmax)) {
        for (size_t i = 0; i < count; ++i) {
            double q = std::round(values[i] / spec.scale) - spec.offset;
            q = std::min(qmax, std::max(qmin, q));
            switch (spec.dataType) {
                case QNN_DATATYPE_UFIXED_POINT_8: out[i] = static_cast<uint8_t>(q); break;
                case QNN_DATATYPE_SFIXED_POINT_8: out[i] = static_cast<uint8_t>(static_cast<int8_t>(q)); break;
                case QNN_DATATYPE_UFIXED_POINT_16: reinterpret_cast<uint16_t*>(out.data())[i] = static_cast<uint16_t>(q); break;
                default: reinterpret_cast<int16_t*>(out.data())[i] = static_cast<int16_t>(q); break;
            }
        }
        return true;
    }
    switch (spec.dataType) {
        case QNN_DATATYPE_FLOAT_32: std::memcpy(out.data(), values, count * 4); return true;
        case QNN_DATATYPE_FLOAT_16:
            for (size_t i = 0; i < count; ++i) reinterpret_cast<uint16_t*>(out.data())[i] = floatToHalf(values[i]);
            return true;
        default: return false;
    }
}

bool unpackTensor(const TensorSpec& spec, const std::vector<uint8_t>& raw, float* values, size_t count) {
    if (count != spec.elementCount() || raw.size() != count * spec.bytesPerElement()) return false;
    double qmin = 0, qmax = 0;
    if (spec.quantized && quantRange(spec.dataType, qmin, qmax)) {
        for (size_t i = 0; i < count; ++i) {
            double q;
            switch (spec.dataType) {
                case QNN_DATATYPE_UFIXED_POINT_8: q = raw[i]; break;
                case QNN_DATATYPE_SFIXED_POINT_8: q = static_cast<int8_t>(raw[i]); break;
                case QNN_DATATYPE_UFIXED_POINT_16: q = reinterpret_cast<const uint16_t*>(raw.data())[i]; break;
                default: q = reinterpret_cast<const int16_t*>(raw.data())[i]; break;
            }
            values[i] = static_cast<float>((q + spec.offset) * spec.scale);
        }
        return true;
    }
    switch (spec.dataType) {
        case QNN_DATATYPE_FLOAT_32: std::memcpy(values, raw.data(), count * 4); return true;
        case QNN_DATATYPE_FLOAT_16:
            for (size_t i = 0; i < count; ++i) values[i] = halfToFloat(reinterpret_cast<const uint16_t*>(raw.data())[i]);
            return true;
        default: return false;
    }
}

// --- Execution ----------------------------------------------------------------------------

static Qnn_Tensor_t describe(const TensorSpec& spec, std::vector<uint32_t>& dims, void* data, size_t bytes) {
    Qnn_Tensor_t t;
    std::memset(&t, 0, sizeof(t));
    t.version = spec.version;
    Qnn_TensorV1_t& v = t.v1;
    v.id = spec.id;
    v.name = spec.name.c_str();
    v.type = spec.type;
    v.dataFormat = QNN_TENSOR_DATA_FORMAT_FLAT_BUFFER;
    v.dataType = spec.dataType;
    if (spec.quantized) {
        v.quantizeParams.encodingDefinition = QNN_DEFINITION_DEFINED;
        v.quantizeParams.quantizationEncoding = QNN_QUANTIZATION_ENCODING_SCALE_OFFSET;
        v.quantizeParams.scaleOffsetEncoding.scale = spec.scale;
        v.quantizeParams.scaleOffsetEncoding.offset = spec.offset;
    } else {
        v.quantizeParams.encodingDefinition = QNN_DEFINITION_UNDEFINED;
        v.quantizeParams.quantizationEncoding = QNN_QUANTIZATION_ENCODING_UNDEFINED;
    }
    v.rank = static_cast<uint32_t>(dims.size());
    v.dimensions = dims.data();
    v.memType = QNN_TENSORMEMTYPE_RAW;
    v.clientBuf.data = data;
    v.clientBuf.dataSize = static_cast<uint32_t>(bytes);
    return t;
}

bool GraphRunner::run(const std::vector<const void*>& inputs, const std::vector<float*>& outputs) const {
    if (!m_execute || !m_graph || inputs.size() != m_spec.inputs.size() || outputs.size() != m_spec.outputs.size()) return false;

    std::vector<std::vector<uint8_t>> inRaw(inputs.size()), outRaw(outputs.size());
    std::vector<std::vector<uint32_t>> inDims(inputs.size()), outDims(outputs.size());
    std::vector<Qnn_Tensor_t> inTensors, outTensors;
    for (size_t i = 0; i < inputs.size(); ++i) {
        const TensorSpec& s = m_spec.inputs[i];
        if (s.dataType == QNN_DATATYPE_INT_32 || s.dataType == QNN_DATATYPE_UINT_32) {
            inRaw[i].resize(s.elementCount() * 4);
            std::memcpy(inRaw[i].data(), inputs[i], inRaw[i].size());
        } else if (!packTensor(s, static_cast<const float*>(inputs[i]), s.elementCount(), inRaw[i])) {
            GIO_LOGE("Input '%s': unsupported data type 0x%x", s.name.c_str(), s.dataType);
            return false;
        }
        inDims[i] = s.dims;
        inTensors.push_back(describe(s, inDims[i], inRaw[i].data(), inRaw[i].size()));
    }
    for (size_t i = 0; i < outputs.size(); ++i) {
        const TensorSpec& s = m_spec.outputs[i];
        outRaw[i].resize(s.elementCount() * s.bytesPerElement());
        outDims[i] = s.dims;
        outTensors.push_back(describe(s, outDims[i], outRaw[i].data(), outRaw[i].size()));
    }

    Qnn_ErrorHandle_t err = m_execute(m_graph, inTensors.data(), static_cast<uint32_t>(inTensors.size()),
                                      outTensors.data(), static_cast<uint32_t>(outTensors.size()), nullptr, nullptr);
    if (err != QNN_SUCCESS) {
        GIO_LOGE("graphExecute '%s' failed: 0x%llx", m_spec.graphName.c_str(), static_cast<unsigned long long>(err));
        return false;
    }
    for (size_t i = 0; i < outputs.size(); ++i) {
        const TensorSpec& s = m_spec.outputs[i];
        if (!unpackTensor(s, outRaw[i], outputs[i], s.elementCount())) {
            GIO_LOGE("Output '%s': unsupported data type 0x%x", s.name.c_str(), s.dataType);
            return false;
        }
    }
    return true;
}

bool isChannelsFirst(const TensorSpec& spec, uint32_t channels) {
    return spec.dims.size() == 4 && spec.dims[1] == channels && spec.dims[3] != channels;
}

void nchwToNhwc(const float* in, float* out, uint32_t c, uint32_t h, uint32_t w) {
    for (uint32_t ci = 0; ci < c; ++ci)
        for (uint32_t y = 0; y < h; ++y)
            for (uint32_t x = 0; x < w; ++x)
                out[(y * w + x) * c + ci] = in[(ci * h + y) * w + x];
}

void nhwcToNchw(const float* in, float* out, uint32_t c, uint32_t h, uint32_t w) {
    for (uint32_t ci = 0; ci < c; ++ci)
        for (uint32_t y = 0; y < h; ++y)
            for (uint32_t x = 0; x < w; ++x)
                out[(ci * h + y) * w + x] = in[(y * w + x) * c + ci];
}
