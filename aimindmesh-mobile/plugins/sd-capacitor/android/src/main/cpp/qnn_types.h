#pragma once

#include <cstdint>
#include <cstddef>

// Minimal, hand-written mirror of the QNN C ABI (the SDK headers are not redistributable).
// Every layout below is checked by the static_asserts at the end; the offsets were verified
// against QAIRT 2.31 headers (LP64: identical on arm64 and x86_64), the HTP perf infrastructure
// against QAIRT 2.45. The QNN interface tables
// only grow at the end across 2.x releases, so these prefixes stay valid for 2.45.

#ifdef __cplusplus
extern "C" {
#endif

typedef uint64_t Qnn_ErrorHandle_t;
#define QNN_SUCCESS 0

typedef void* Qnn_BackendHandle_t;
typedef void* Qnn_DeviceHandle_t;
typedef void* Qnn_ContextHandle_t;
typedef void* Qnn_GraphHandle_t;
typedef void* Qnn_ProfileHandle_t;
typedef void* Qnn_SignalHandle_t;
typedef void* QnnSystemContext_Handle_t;

typedef enum {
    QNN_DATATYPE_INT_8 = 0x0008,
    QNN_DATATYPE_INT_16 = 0x0016,
    QNN_DATATYPE_INT_32 = 0x0032,
    QNN_DATATYPE_INT_64 = 0x0064,
    QNN_DATATYPE_UINT_8 = 0x0108,
    QNN_DATATYPE_UINT_16 = 0x0116,
    QNN_DATATYPE_UINT_32 = 0x0132,
    QNN_DATATYPE_UINT_64 = 0x0164,
    QNN_DATATYPE_FLOAT_16 = 0x0216,
    QNN_DATATYPE_FLOAT_32 = 0x0232,
    QNN_DATATYPE_FLOAT_64 = 0x0264,
    QNN_DATATYPE_SFIXED_POINT_8 = 0x0308,
    QNN_DATATYPE_SFIXED_POINT_16 = 0x0316,
    QNN_DATATYPE_SFIXED_POINT_32 = 0x0332,
    QNN_DATATYPE_UFIXED_POINT_8 = 0x0408,
    QNN_DATATYPE_UFIXED_POINT_16 = 0x0416,
    QNN_DATATYPE_UFIXED_POINT_32 = 0x0432,
    QNN_DATATYPE_BOOL_8 = 0x0508,
    QNN_DATATYPE_UNDEFINED = 0x7FFFFFFF
} Qnn_DataType_t;

typedef enum {
    QNN_TENSOR_TYPE_APP_WRITE = 0,
    QNN_TENSOR_TYPE_APP_READ = 1,
    QNN_TENSOR_TYPE_APP_READWRITE = 2,
    QNN_TENSOR_TYPE_NATIVE = 3,
    QNN_TENSOR_TYPE_STATIC = 4,
    QNN_TENSOR_TYPE_UNDEFINED = 0x7FFFFFFF
} Qnn_TensorType_t;

typedef enum {
    QNN_TENSOR_DATA_FORMAT_FLAT_BUFFER = 0,
} Qnn_TensorDataFormat_t;

typedef enum {
    QNN_DEFINITION_IMPL_GENERATED = 0,
    QNN_DEFINITION_DEFINED = 1,
    QNN_DEFINITION_UNDEFINED = 0x7FFFFFFF
} Qnn_Definition_t;

typedef enum {
    QNN_QUANTIZATION_ENCODING_SCALE_OFFSET = 0,
    QNN_QUANTIZATION_ENCODING_AXIS_SCALE_OFFSET = 1,
    QNN_QUANTIZATION_ENCODING_UNDEFINED = 0x7FFFFFFF
} Qnn_QuantizationEncoding_t;

/** real value = (quantized + offset) * scale  (offset is minus the zero point) */
typedef struct {
    float scale;
    int32_t offset;
} Qnn_ScaleOffset_t;

typedef struct {
    Qnn_Definition_t encodingDefinition;
    Qnn_QuantizationEncoding_t quantizationEncoding;
    union {
        Qnn_ScaleOffset_t scaleOffsetEncoding;
        void* other[4];  // per-axis / block encodings (pointers): size and alignment only
    };
} Qnn_QuantizeParams_t;

typedef enum {
    QNN_TENSORMEMTYPE_RAW = 0,
    QNN_TENSORMEMTYPE_MEMHANDLE = 1,
} Qnn_TensorMemType_t;

typedef struct {
    void* data;
    uint32_t dataSize;
} Qnn_ClientBuffer_t;

typedef struct {
    uint32_t id;
    const char* name;
    Qnn_TensorType_t type;
    Qnn_TensorDataFormat_t dataFormat;
    Qnn_DataType_t dataType;
    Qnn_QuantizeParams_t quantizeParams;
    uint32_t rank;
    uint32_t* dimensions;
    Qnn_TensorMemType_t memType;
    union {
        Qnn_ClientBuffer_t clientBuf;
        void* memHandle;
    };
} Qnn_TensorV1_t;

typedef struct {
    Qnn_TensorV1_t base;            // the V2 struct starts with every V1 field
    uint8_t* isDynamicDimensions;
    uint8_t sparseParams[12];
    uint8_t isProduced;
} Qnn_TensorV2_t;

typedef enum {
    QNN_TENSOR_VERSION_1 = 1,
    QNN_TENSOR_VERSION_2 = 2,
} Qnn_TensorVersion_t;

typedef struct {
    Qnn_TensorVersion_t version;
    union {
        Qnn_TensorV1_t v1;
        Qnn_TensorV2_t v2;
    };
} Qnn_Tensor_t;

typedef struct {
    uint32_t major;
    uint32_t minor;
    uint32_t patch;
} Qnn_Version_t;

typedef struct {
    Qnn_Version_t coreApiVersion;
    Qnn_Version_t backendApiVersion;
} Qnn_ApiVersion_t;

// QNN HTP backend custom configuration
typedef enum {
    QNN_BACKEND_CONFIG_OPTION_CUSTOM = 0,
} QnnBackend_ConfigOption_t;

typedef enum {
    QNN_HTP_BACKEND_CONFIG_OPTION_SIGNED_PD = 3,
} QnnHtpBackend_ConfigOption_t;

typedef struct {
    QnnHtpBackend_ConfigOption_t option;
    union {
        uint32_t signedPD; // 0 for unsigned PD
        void* custom;
    };
} QnnHtpBackend_CustomConfig_t;

typedef struct {
    QnnBackend_ConfigOption_t option;
    union {
        const QnnHtpBackend_CustomConfig_t* customConfig;
    };
} QnnBackend_Config_t;

typedef Qnn_ErrorHandle_t (*QnnBackend_CreateFn_t)(void*, const QnnBackend_Config_t**, Qnn_BackendHandle_t*);
typedef Qnn_ErrorHandle_t (*QnnBackend_FreeFn_t)(Qnn_BackendHandle_t);
typedef Qnn_ErrorHandle_t (*QnnContext_CreateFromBinaryFn_t)(
    Qnn_BackendHandle_t, Qnn_DeviceHandle_t, const void**, const void*, uint64_t,
    Qnn_ContextHandle_t*, Qnn_ProfileHandle_t);
typedef Qnn_ErrorHandle_t (*QnnContext_FreeFn_t)(Qnn_ContextHandle_t, Qnn_ProfileHandle_t);
typedef Qnn_ErrorHandle_t (*QnnGraph_RetrieveFn_t)(Qnn_ContextHandle_t, const char*, Qnn_GraphHandle_t*);
typedef Qnn_ErrorHandle_t (*QnnGraph_ExecuteFn_t)(
    Qnn_GraphHandle_t, const Qnn_Tensor_t*, uint32_t, Qnn_Tensor_t*, uint32_t,
    Qnn_ProfileHandle_t, Qnn_SignalHandle_t);

// HTP performance infrastructure (QnnHtpPerfInfrastructure.h / QnnHtpDevice.h, offsets checked
// against the QAIRT 2.45 headers): power votes for the NPU clocks while generating
typedef enum {
    QNN_HTP_PERF_INFRASTRUCTURE_POWER_CONFIGOPTION_DCVS_V3 = 1,
    QNN_HTP_PERF_INFRASTRUCTURE_POWER_CONFIGOPTION_RPC_CONTROL_LATENCY = 2,
    QNN_HTP_PERF_INFRASTRUCTURE_POWER_CONFIGOPTION_RPC_POLLING_TIME = 3,
    QNN_HTP_PERF_INFRASTRUCTURE_POWER_CONFIGOPTION_HMX_V2 = 5,
    QNN_HTP_PERF_INFRASTRUCTURE_POWER_CONFIGOPTION_UNKNOWN = 0x7fffffff
} QnnHtpPerfInfrastructure_PowerConfigOption_t;

#define QNN_HTP_PERF_INFRASTRUCTURE_POWERMODE_PERFORMANCE_MODE 0x10
#define DCVS_VOLTAGE_VCORNER_MAX_VOLTAGE_CORNER 0xA0
#define DCVS_EXP_VCORNER_TUR 0x280
#define QNN_HTP_PERF_INFRASTRUCTURE_CLK_PERF_HIGH 0

typedef struct {
    uint32_t contextId;
    uint32_t setDcvsEnable;
    uint32_t dcvsEnable;
    uint32_t powerMode;
    uint32_t setSleepLatency;
    uint32_t sleepLatency;
    uint32_t setSleepDisable;
    uint32_t sleepDisable;
    uint32_t setBusParams;
    uint32_t busVoltageCornerMin;
    uint32_t busVoltageCornerTarget;
    uint32_t busVoltageCornerMax;
    uint32_t setCoreParams;
    uint32_t coreVoltageCornerMin;
    uint32_t coreVoltageCornerTarget;
    uint32_t coreVoltageCornerMax;
} QnnHtpPerfInfrastructure_DcvsV3_t;

typedef struct {
    uint32_t hmxPickDefault;
    uint32_t hmxVoltageCornerMin;
    uint32_t hmxVoltageCornerTarget;
    uint32_t hmxVoltageCornerMax;
    uint32_t hmxPerfMode;
} QnnHtpPerfInfrastructure_HmxV2_t;

typedef struct {
    QnnHtpPerfInfrastructure_PowerConfigOption_t option;
    union {
        QnnHtpPerfInfrastructure_DcvsV3_t dcvsV3Config;
        uint32_t rpcControlLatencyConfig;
        uint32_t rpcPollingTimeConfig;
        QnnHtpPerfInfrastructure_HmxV2_t hmxV2Config;
    };
} QnnHtpPerfInfrastructure_PowerConfig_t;

typedef Qnn_ErrorHandle_t (*QnnHtpPerfInfrastructure_CreatePowerConfigIdFn_t)(uint32_t, uint32_t, uint32_t*);
typedef Qnn_ErrorHandle_t (*QnnHtpPerfInfrastructure_DestroyPowerConfigIdFn_t)(uint32_t);
typedef Qnn_ErrorHandle_t (*QnnHtpPerfInfrastructure_SetPowerConfigFn_t)(
    uint32_t, const QnnHtpPerfInfrastructure_PowerConfig_t**);

typedef struct {
    QnnHtpPerfInfrastructure_CreatePowerConfigIdFn_t createPowerConfigId;
    QnnHtpPerfInfrastructure_DestroyPowerConfigIdFn_t destroyPowerConfigId;
    QnnHtpPerfInfrastructure_SetPowerConfigFn_t setPowerConfig;
    void* setMemoryConfig;
} QnnHtpDevice_PerfInfrastructure_t;

#define QNN_HTP_DEVICE_INFRASTRUCTURE_TYPE_PERF 0
typedef struct {
    uint32_t infraType;
    union {
        QnnHtpDevice_PerfInfrastructure_t perfInfra;
    };
} QnnHtpDevice_Infrastructure_t;

typedef void* QnnDevice_Infrastructure_t;
typedef Qnn_ErrorHandle_t (*QnnDevice_GetInfrastructureFn_t)(const QnnDevice_Infrastructure_t*);

/** Prefix of QnnInterface_t (core API 2.x): only the entries up to deviceGetInfrastructure are used. */
typedef struct {
    uint32_t backendId;
    const char* providerName;
    Qnn_ApiVersion_t apiVersion;
    struct {
        void* propertyHasCapability;
        QnnBackend_CreateFn_t backendCreate;
        void* backendSetConfig;
        void* backendGetApiVersion;
        void* backendGetBuildId;
        void* backendRegisterOpPackage;
        void* backendGetSupportedOperations;
        void* backendValidateOpConfig;
        QnnBackend_FreeFn_t backendFree;
        void* contextCreate;
        void* contextSetConfig;
        void* contextGetBinarySize;
        void* contextGetBinary;
        QnnContext_CreateFromBinaryFn_t contextCreateFromBinary;
        QnnContext_FreeFn_t contextFree;
        void* graphCreate;
        void* graphCreateSubgraph;
        void* graphSetConfig;
        void* graphAddNode;
        void* graphFinalize;
        QnnGraph_RetrieveFn_t graphRetrieve;
        QnnGraph_ExecuteFn_t graphExecute;
        void* graphExecuteAsync;
        void* tensorCreateContextTensor;
        void* tensorCreateGraphTensor;
        void* logCreate;
        void* logSetLogLevel;
        void* logFree;
        void* profileCreate;
        void* profileSetConfig;
        void* profileGetEvents;
        void* profileGetSubEvents;
        void* profileGetEventData;
        void* profileGetExtendedEventData;
        void* profileFree;
        void* memRegister;
        void* memDeRegister;
        void* deviceGetPlatformInfo;
        void* deviceFreePlatformInfo;
        QnnDevice_GetInfrastructureFn_t deviceGetInfrastructure;
    } fn;
} QnnInterface_t;

typedef Qnn_ErrorHandle_t (*QnnInterfaceGetProvidersFn_t)(const QnnInterface_t***, uint32_t*);

// QNN System API (libQnnSystem.so): reads the graph and tensor descriptions of a context binary
typedef Qnn_ErrorHandle_t (*QnnSystemContext_CreateFn_t)(QnnSystemContext_Handle_t*);
/** binaryInfo points to a QnnSystemContext_BinaryInfo_t owned by the system context */
typedef Qnn_ErrorHandle_t (*QnnSystemContext_GetBinaryInfoFn_t)(
    QnnSystemContext_Handle_t, void* binary, uint64_t binarySize,
    const void** binaryInfo, uint64_t* binaryInfoSize);
typedef Qnn_ErrorHandle_t (*QnnSystemContext_FreeFn_t)(QnnSystemContext_Handle_t);

/** Prefix of QnnSystemInterface_t (system API 1.x) */
typedef struct {
    uint32_t backendId;
    const char* providerName;
    Qnn_Version_t systemApiVersion;
    struct {
        QnnSystemContext_CreateFn_t systemContextCreate;
        QnnSystemContext_GetBinaryInfoFn_t systemContextGetBinaryInfo;
        void* systemContextGetMetaData;
        QnnSystemContext_FreeFn_t systemContextFree;
    } fn;
} QnnSystemInterface_t;

typedef Qnn_ErrorHandle_t (*QnnSystemInterfaceGetProvidersFn_t)(const QnnSystemInterface_t***, uint32_t*);

// QnnSystemContext_BinaryInfo_t: { uint32 version; union at 8 { V1, V2, V3 } }.
// numGraphs (uint32) and graphs (QnnSystemContext_GraphInfo_t*) sit at these union offsets:
#define QNN_BINARY_INFO_UNION_OFFSET 8
#define QNN_BINARY_INFO_V1V2_NUM_GRAPHS 0x70
#define QNN_BINARY_INFO_V1V2_GRAPHS 0x78
#define QNN_BINARY_INFO_V3_NUM_GRAPHS 0x58
#define QNN_BINARY_INFO_V3_GRAPHS 0x60

// QnnSystemContext_GraphInfo_t: { uint32 version; union at 8 { V1, V2, V3 } }. Every version
// starts with: const char* graphName; uint32 numGraphInputs; Qnn_Tensor_t* graphInputs;
// uint32 numGraphOutputs; Qnn_Tensor_t* graphOutputs.
typedef struct {
    const char* graphName;
    uint32_t numGraphInputs;
    Qnn_Tensor_t* graphInputs;
    uint32_t numGraphOutputs;
    Qnn_Tensor_t* graphOutputs;
} QnnSystemContext_GraphInfoPrefix_t;
#define QNN_GRAPH_INFO_UNION_OFFSET 8

#ifdef __cplusplus
}

// The QNN runtime ships for 64-bit Android only (the app packages arm64-v8a): 32-bit builds of
// this plugin compile but never load a backend, so the layout is only checked on LP64
#if defined(__LP64__)
static_assert(sizeof(Qnn_QuantizeParams_t) == 40, "Qnn_QuantizeParams_t layout");
static_assert(offsetof(Qnn_TensorV1_t, name) == 0x08, "Qnn_TensorV1_t.name");
static_assert(offsetof(Qnn_TensorV1_t, dataType) == 0x18, "Qnn_TensorV1_t.dataType");
static_assert(offsetof(Qnn_TensorV1_t, quantizeParams) == 0x20, "Qnn_TensorV1_t.quantizeParams");
static_assert(offsetof(Qnn_TensorV1_t, rank) == 0x48, "Qnn_TensorV1_t.rank");
static_assert(offsetof(Qnn_TensorV1_t, dimensions) == 0x50, "Qnn_TensorV1_t.dimensions");
static_assert(offsetof(Qnn_TensorV1_t, memType) == 0x58, "Qnn_TensorV1_t.memType");
static_assert(offsetof(Qnn_TensorV1_t, clientBuf) == 0x60, "Qnn_TensorV1_t.clientBuf");
static_assert(sizeof(Qnn_TensorV1_t) == 112, "Qnn_TensorV1_t size");
static_assert(offsetof(Qnn_TensorV2_t, isDynamicDimensions) == 0x70, "Qnn_TensorV2_t.isDynamicDimensions");
static_assert(offsetof(Qnn_TensorV2_t, isProduced) == 0x84, "Qnn_TensorV2_t.isProduced");
static_assert(sizeof(Qnn_TensorV2_t) == 136, "Qnn_TensorV2_t size");
static_assert(offsetof(Qnn_Tensor_t, v1) == 8 && sizeof(Qnn_Tensor_t) == 144, "Qnn_Tensor_t layout");
static_assert(offsetof(QnnInterface_t, apiVersion) == 0x10, "QnnInterface_t.apiVersion");
static_assert(offsetof(QnnInterface_t, fn.backendCreate) == 0x30, "QnnInterface_t.backendCreate");
static_assert(offsetof(QnnInterface_t, fn.backendFree) == 0x68, "QnnInterface_t.backendFree");
static_assert(offsetof(QnnInterface_t, fn.contextCreateFromBinary) == 0x90, "QnnInterface_t.contextCreateFromBinary");
static_assert(offsetof(QnnInterface_t, fn.contextFree) == 0x98, "QnnInterface_t.contextFree");
static_assert(offsetof(QnnInterface_t, fn.graphRetrieve) == 0xc8, "QnnInterface_t.graphRetrieve");
static_assert(offsetof(QnnInterface_t, fn.graphExecute) == 0xd0, "QnnInterface_t.graphExecute");
static_assert(offsetof(QnnInterface_t, fn.deviceGetInfrastructure) == 0x160, "QnnInterface_t.deviceGetInfrastructure");
static_assert(sizeof(QnnHtpPerfInfrastructure_DcvsV3_t) == 64, "DcvsV3 size");
static_assert(offsetof(QnnHtpPerfInfrastructure_DcvsV3_t, powerMode) == 0x0c, "DcvsV3.powerMode");
static_assert(offsetof(QnnHtpPerfInfrastructure_DcvsV3_t, sleepLatency) == 0x14, "DcvsV3.sleepLatency");
static_assert(offsetof(QnnHtpPerfInfrastructure_DcvsV3_t, busVoltageCornerMin) == 0x24, "DcvsV3.busVoltageCornerMin");
static_assert(offsetof(QnnHtpPerfInfrastructure_DcvsV3_t, coreVoltageCornerMax) == 0x3c, "DcvsV3.coreVoltageCornerMax");
static_assert(sizeof(QnnHtpPerfInfrastructure_HmxV2_t) == 20, "HmxV2 size");
static_assert(sizeof(QnnHtpPerfInfrastructure_PowerConfig_t) == 68, "PowerConfig size");
static_assert(offsetof(QnnHtpPerfInfrastructure_PowerConfig_t, dcvsV3Config) == 4, "PowerConfig union");
static_assert(offsetof(QnnHtpDevice_PerfInfrastructure_t, setPowerConfig) == 0x10, "PerfInfrastructure.setPowerConfig");
static_assert(offsetof(QnnHtpDevice_Infrastructure_t, perfInfra) == 8 && sizeof(QnnHtpDevice_Infrastructure_t) == 40,
              "QnnHtpDevice_Infrastructure_t layout");
static_assert(offsetof(QnnSystemInterface_t, fn.systemContextCreate) == 0x20, "QnnSystemInterface_t.create");
static_assert(offsetof(QnnSystemInterface_t, fn.systemContextGetBinaryInfo) == 0x28, "QnnSystemInterface_t.getBinaryInfo");
static_assert(offsetof(QnnSystemInterface_t, fn.systemContextFree) == 0x38, "QnnSystemInterface_t.free");
static_assert(offsetof(QnnSystemContext_GraphInfoPrefix_t, graphInputs) == 0x10, "GraphInfo.graphInputs");
static_assert(offsetof(QnnSystemContext_GraphInfoPrefix_t, graphOutputs) == 0x20, "GraphInfo.graphOutputs");
#endif
#endif
