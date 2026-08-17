#pragma once

#include <cstdint>
#include <cstddef>

#ifdef __cplusplus
extern "C" {
#endif

typedef uint32_t Qnn_ErrorHandle_t;
#define QNN_SUCCESS 0

typedef void* Qnn_BackendHandle_t;
typedef void* Qnn_DeviceHandle_t;
typedef void* Qnn_ContextHandle_t;
typedef void* Qnn_GraphHandle_t;
typedef void* Qnn_ProfileHandle_t;
typedef void* Qnn_SignalHandle_t;
typedef void* QnnSystemContext_Handle_t;

typedef enum {
    QNN_DATATYPE_INT_8 = 0x0108,
    QNN_DATATYPE_INT_16 = 0x0116,
    QNN_DATATYPE_INT_32 = 0x0132,
    QNN_DATATYPE_UINT_8 = 0x0208,
    QNN_DATATYPE_UINT_16 = 0x0216,
    QNN_DATATYPE_UINT_32 = 0x0232,
    QNN_DATATYPE_FLOAT_16 = 0x0316,
    QNN_DATATYPE_FLOAT_32 = 0x0332,
    QNN_DATATYPE_UFIXED_POINT_8 = 0x0408,
    QNN_DATATYPE_UFIXED_POINT_16 = 0x0416,
    QNN_DATATYPE_SFIXED_POINT_8 = 0x0508,
    QNN_DATATYPE_SFIXED_POINT_16 = 0x0516,
    QNN_DATATYPE_SFIXED_POINT_32 = 0x0532,
} Qnn_DataType_t;

typedef enum {
    QNN_TENSOR_TYPE_APP_WRITE = 0,
    QNN_TENSOR_TYPE_APP_READ = 1,
    QNN_TENSOR_TYPE_STATIC = 2,
    QNN_TENSOR_TYPE_NATIVE = 3,
} Qnn_TensorType_t;

typedef enum {
    QNN_TENSOR_DATA_FORMAT_FLAT_BUFFER = 0,
    QNN_TENSOR_DATA_FORMAT_DENSE = 1,
} Qnn_TensorDataFormat_t;

typedef enum {
    QNN_QUANTIZATION_ENCODING_UNDEFINED = 0,
    QNN_QUANTIZATION_ENCODING_SCALE_OFFSET = 1,
    QNN_QUANTIZATION_ENCODING_AXIS_SCALE_OFFSET = 2,
} Qnn_QuantizationEncoding_t;

typedef struct {
    float scale;
    int32_t offset;
} Qnn_ScaleOffset_t;

typedef struct {
    Qnn_QuantizationEncoding_t encodingDefinition;
    uint32_t reserved;
    union {
        Qnn_ScaleOffset_t scaleOffsetEncoding;
        uint8_t raw[32];
    };
} Qnn_Quantization_t;

typedef struct {
    void* data;
    uint32_t dataSize;
    uint32_t reserved;
} Qnn_ClientBuffer_t;

typedef enum {
    QNN_TENSOR_VERSION_1 = 1,
    QNN_TENSOR_VERSION_2 = 2,
    QNN_TENSOR_VERSION_UNDEFINED = 0x7fffffff
} Qnn_TensorVersion_t;

typedef struct {
    uint32_t id;
    uint32_t reserved0;
    const char* name;
    Qnn_TensorType_t type;
    Qnn_TensorDataFormat_t dataFormat;
    Qnn_DataType_t dataType;
    uint32_t reserved1;
    Qnn_Quantization_t quantization;
    uint32_t rank;
    uint32_t reserved2;
    uint32_t* dimensions;
    uint8_t* isDynamicDimensions;
    Qnn_ClientBuffer_t clientBuf;
#if defined(__aarch64__) || defined(__x86_64__)
    uint8_t padding[24];
#else
    uint8_t padding[40];
#endif
} Qnn_Tensor_v1_t;

typedef struct {
    Qnn_TensorVersion_t version;
    uint32_t reserved;
    union {
        Qnn_Tensor_v1_t v1;
        Qnn_Tensor_v1_t v2;
    };
} Qnn_Tensor_t;

static_assert(sizeof(Qnn_Tensor_t) == 144, "Qnn_Tensor_t size must be exactly 144 bytes (0x90)");

typedef struct {
    uint32_t major;
    uint32_t minor;
    uint32_t patch;
} Qnn_Version_t;

typedef struct {
    Qnn_Version_t coreApiVersion;
    Qnn_Version_t backendApiVersion;
} Qnn_ApiVersion_t;

// QNN HTP Backend Custom Configuration
typedef enum {
    QNN_BACKEND_CONFIG_OPTION_CUSTOM = 0,
    QNN_BACKEND_CONFIG_OPTION_PLATFORM_INFO = 1,
    QNN_BACKEND_CONFIG_OPTION_UNKNOWN = 0x7fffffff
} QnnBackend_ConfigOption_t;

typedef enum {
    QNN_HTP_BACKEND_CONFIG_OPTION_CUSTOM = 0,
    QNN_HTP_BACKEND_CONFIG_OPTION_PERF_PROFILE = 1,
    QNN_HTP_BACKEND_CONFIG_OPTION_DEVICE_INFO = 2,
    QNN_HTP_BACKEND_CONFIG_OPTION_SIGNED_PD = 3,
    QNN_HTP_BACKEND_CONFIG_OPTION_PLATFORM_INFO = 4,
    QNN_HTP_BACKEND_CONFIG_OPTION_UNKNOWN = 0x7fffffff
} QnnHtpBackend_ConfigOption_t;

typedef struct {
    QnnHtpBackend_ConfigOption_t option;
    union {
        uint32_t signedPD; // 0 for unsigned PD
        uint32_t perfProfile;
        void* custom;
    };
} QnnHtpBackend_CustomConfig_t;

typedef struct {
    QnnBackend_ConfigOption_t option;
    union {
        const QnnHtpBackend_CustomConfig_t* customConfig;
    };
} QnnBackend_Config_t;

// QNN Function Pointer Definitions
typedef Qnn_ErrorHandle_t (*QnnBackend_InitializeFn_t)(const void**);
typedef Qnn_ErrorHandle_t (*QnnBackend_CreateFn_t)(void*, const QnnBackend_Config_t**, Qnn_BackendHandle_t*);
typedef Qnn_ErrorHandle_t (*QnnBackend_FreeFn_t)(Qnn_BackendHandle_t);
typedef Qnn_ErrorHandle_t (*QnnDevice_CreateFn_t)(void*, const void**, Qnn_DeviceHandle_t*);
typedef Qnn_ErrorHandle_t (*QnnDevice_FreeFn_t)(Qnn_DeviceHandle_t);
typedef Qnn_ErrorHandle_t (*QnnContext_CreateFromBinaryFn_t)(
    Qnn_BackendHandle_t,
    Qnn_DeviceHandle_t,
    const void**,
    const void*,
    uint64_t,
    Qnn_ContextHandle_t*,
    Qnn_ProfileHandle_t
);
typedef Qnn_ErrorHandle_t (*QnnContext_FreeFn_t)(Qnn_ContextHandle_t, Qnn_ProfileHandle_t);
typedef Qnn_ErrorHandle_t (*QnnGraph_RetrieveFn_t)(Qnn_ContextHandle_t, const char*, Qnn_GraphHandle_t*);
typedef Qnn_ErrorHandle_t (*QnnGraph_ExecuteFn_t)(
    Qnn_GraphHandle_t,
    const Qnn_Tensor_t*,
    uint32_t,
    Qnn_Tensor_t*,
    uint32_t,
    Qnn_ProfileHandle_t,
    Qnn_SignalHandle_t
);

typedef struct {
    Qnn_ApiVersion_t apiVersion;
    uint32_t backendId;
    uint32_t reserved;
    uint64_t interfaceVersion;
    struct {
        QnnBackend_InitializeFn_t backendInitialize;
        QnnBackend_CreateFn_t backendCreate;
        QnnBackend_FreeFn_t backendFree;
        void* backendRegisterOpPackage;
        void* backendValidateOpConfig;
        void* backendGetProperty;
        void* contextCreate;
        QnnContext_CreateFromBinaryFn_t contextCreateFromBinary;
        void* contextCreateFromBinaryListAsync;
        void* contextGetBinarySize;
        void* contextGetBinary;
        QnnContext_FreeFn_t contextFree;
        QnnGraph_RetrieveFn_t graphRetrieve;
        QnnGraph_ExecuteFn_t graphExecute;
        void* graphExecuteAsync;
        void* tensorCreate;
        void* tensorCreateContextBatch;
    } QNN_INTERFACE_VER_NAME;
} QnnInterface_t;

typedef Qnn_ErrorHandle_t (*QnnInterfaceGetProvidersFn_t)(const QnnInterface_t***, uint32_t*);

// QNN System Interface provider - libQnnSystem.so exports QnnSystemInterface_getProviders
// The provider vtable layout (observed from SDK): each entry is a function pointer
// SystemContext functions are accessed at fixed offsets within the interface struct
typedef struct {
    Qnn_ApiVersion_t apiVersion;
    uint32_t backendId;
    uint32_t reserved;
    uint64_t interfaceVersion;
    struct {
        void* systemContextCreate;           // offset 0x00
        void* systemContextGetBinaryInfo;    // offset 0x08 - QnnSystemContext_getMetadataFromBinary
        void* systemContextFree;             // offset 0x10
    } QNN_SYSTEM_INTERFACE_VER_NAME;
} QnnSystemInterface_t;
typedef Qnn_ErrorHandle_t (*QnnSystemInterfaceGetProvidersFn_t)(const QnnSystemInterface_t***, uint32_t*);

// Graph info structures returned by systemContextGetBinaryInfo
typedef enum {
    QNN_SYSTEM_CONTEXT_GRAPH_INFO_VERSION_1 = 1,
} QnnSystemContextGraphInfoVersion_t;
typedef struct {
    const char* graphName;
    const void* graphInputs;
    uint32_t    numGraphInputs;
    const void* graphOutputs;
    uint32_t    numGraphOutputs;
} QnnSystemContext_GraphInfo_v1_t;
typedef struct {
    QnnSystemContextGraphInfoVersion_t version;
    union {
        QnnSystemContext_GraphInfo_v1_t v1;
    };
} QnnSystemContext_GraphInfo_t;
typedef Qnn_ErrorHandle_t (*QnnSystemContext_CreateFn_t)(QnnSystemContext_Handle_t*);
typedef Qnn_ErrorHandle_t (*QnnSystemContext_GetBinaryInfoFn_t)(
    QnnSystemContext_Handle_t,
    const void*,
    uint64_t,
    const QnnSystemContext_GraphInfo_t**,
    uint32_t*
);
typedef Qnn_ErrorHandle_t (*QnnSystemContext_FreeFn_t)(QnnSystemContext_Handle_t);

#ifdef __cplusplus
}
#endif
