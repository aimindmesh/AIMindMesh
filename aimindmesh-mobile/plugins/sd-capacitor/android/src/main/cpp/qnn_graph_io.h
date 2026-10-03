#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include "qnn_types.h"

/**
 * Graph inputs/outputs of a QNN context binary as the binary declares them (ids, names,
 * data types, quantization, shapes), read with the QNN System API. Nothing is hardcoded per
 * model: a Qualcomm AI Hub w8a16 package (uint16 tensors) and a float export (float32 tensors,
 * other ids) run through the same code.
 */
struct TensorSpec {
    uint32_t id = 0;
    std::string name;
    Qnn_TensorVersion_t version = QNN_TENSOR_VERSION_1;
    Qnn_TensorType_t type = QNN_TENSOR_TYPE_APP_WRITE;
    Qnn_DataType_t dataType = QNN_DATATYPE_FLOAT_32;
    bool quantized = false;
    float scale = 1.0f;
    int32_t offset = 0;   // QNN convention: real = (q + offset) * scale
    std::vector<uint32_t> dims;

    size_t elementCount() const;
    size_t bytesPerElement() const;
    /** Largest real value the tensor can carry (e.g. the calibrated timestep range) */
    float maxRepresentable() const;
};

struct GraphSpec {
    std::string graphName;
    std::vector<TensorSpec> inputs;
    std::vector<TensorSpec> outputs;

    const TensorSpec* input(const char* name) const;
};

/** Loads libQnnSystem's interface once; returns false if the System API is unavailable. */
class QnnSystemReader {
public:
    bool init(void* libSystemHandle);
    bool readGraphSpec(void* binary, size_t size, GraphSpec& out) const;
    bool isReady() const { return m_iface != nullptr; }
private:
    const QnnSystemInterface_t* m_iface = nullptr;
};

/** Value conversions between app floats and the tensor's own data type. */
bool packTensor(const TensorSpec& spec, const float* values, size_t count, std::vector<uint8_t>& out);
bool unpackTensor(const TensorSpec& spec, const std::vector<uint8_t>& raw, float* values, size_t count);

/** Executes one graph: every input is given as floats (token ids as int32) in the spec's layout. */
class GraphRunner {
public:
    GraphRunner(QnnGraph_ExecuteFn_t execute, Qnn_GraphHandle_t graph, const GraphSpec& spec)
        : m_execute(execute), m_graph(graph), m_spec(spec) {}

    /** inputs[i] belongs to spec.inputs[i] (floats; INT_32 inputs as int32), outputs as floats */
    bool run(const std::vector<const void*>& inputs, const std::vector<float*>& outputs) const;

private:
    QnnGraph_ExecuteFn_t m_execute;
    Qnn_GraphHandle_t m_graph;
    const GraphSpec& m_spec;
};

/** Float layout helpers: the app works in NHWC; a graph may declare NCHW. */
bool isChannelsFirst(const TensorSpec& spec, uint32_t channels);
void nchwToNhwc(const float* in, float* out, uint32_t c, uint32_t h, uint32_t w);
void nhwcToNchw(const float* in, float* out, uint32_t c, uint32_t h, uint32_t w);
