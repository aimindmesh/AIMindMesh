
// OpenCL Loader for Android (Proxy)
// Dynamically loads the system's OpenCL driver, bypassing namespace restrictions.

#include <stdlib.h>
#include <dlfcn.h>
#include <android/log.h>
#include <stdio.h>
#include <unistd.h>
#include <fcntl.h>
#include <string.h>
#include <errno.h>
#include <sys/stat.h>

#define CL_TARGET_OPENCL_VERSION 300
#include <CL/cl.h>

#define TAG "OpenCL_Proxy"

static void* so_handle = NULL;
static int load_attempted = 0;

// Helper to copy file
static int copy_file(const char* src, const char* dst) {
    int fd_src = open(src, O_RDONLY);
    if (fd_src < 0) return 0;

    int fd_dst = open(dst, O_WRONLY | O_CREAT | O_TRUNC, 0755);
    if (fd_dst < 0) {
        close(fd_src);
        return 0;
    }

    char buf[8192];
    ssize_t len;
    while ((len = read(fd_src, buf, sizeof(buf))) > 0) {
        write(fd_dst, buf, len);
    }

    close(fd_src);
    close(fd_dst);
    return 1;
}

static int load_opencl() {
    if (so_handle) return 1;
    if (load_attempted) return (so_handle != NULL);
    load_attempted = 1;
    
    // Potentially valid system paths
    const char* paths[] = {
        "/system/vendor/lib64/libOpenCL.so",
        "/vendor/lib64/libOpenCL.so",
        "/system/lib64/libOpenCL.so",
        "/system/vendor/lib64/egl/libGLES_mali.so",
        "/vendor/lib64/egl/libGLES_mali.so", 
        NULL
    };

    // 1. Try direct dlopen (works if allowed by namespace or on some devices)
    for (int i = 0; paths[i]; i++) {
        so_handle = dlopen(paths[i], RTLD_LAZY);
        if (so_handle) {
            __android_log_print(ANDROID_LOG_INFO, TAG, "Loaded system OpenCL directly from %s", paths[i]);
            return 1;
        }
    }

    // 2. Try generic "libOpenCL.so" - ONLY if it's NOT resolving to ourselves.
    // Since we renamed ourselves to libOpenCL_proxy.so, this is safe to try.
    // It might load system lib if namespace allows.
    so_handle = dlopen("libOpenCL.so", RTLD_LAZY);
    if (so_handle) {
        __android_log_print(ANDROID_LOG_INFO, TAG, "Loaded OpenCL via lookup 'libOpenCL.so'");
        return 1;
    }

    // 3. NUCLEAR OPTION: Namespace Bypass via File Copy.
    // If we can read the file but not dlopen it, copy it to private storage and dlopen the copy.
    __android_log_print(ANDROID_LOG_WARN, TAG, "Direct load failed. Attempting Namespace Bypass via copy...");
    
    // Hardcoded path to app's cache directory (best guess, safer than assumes)
    // /data/user/0/com.aimindmesh.mobile/cache/libOpenCL_system.so
    const char* dest_path = "/data/data/com.aimindmesh.mobile/cache/libOpenCL_system.copy.so";
    
    // Create cache dir if needed (chmod 700 usually)
    struct stat st = {0};
    if (stat("/data/data/com.aimindmesh.mobile/cache", &st) == -1) {
        mkdir("/data/data/com.aimindmesh.mobile/cache", 0700);
    }

    for (int i = 0; paths[i]; i++) {
        // Try to access specifically
        if (access(paths[i], R_OK) == 0) {
            __android_log_print(ANDROID_LOG_INFO, TAG, "Found readable system lib at %s. Copying...", paths[i]);
            if (copy_file(paths[i], dest_path)) {
                so_handle = dlopen(dest_path, RTLD_LAZY);
                if (so_handle) {
                    __android_log_print(ANDROID_LOG_INFO, TAG, "SUCCESS: Loaded OpenCL from local copy %s", dest_path);
                    return 1;
                } else {
                    __android_log_print(ANDROID_LOG_ERROR, TAG, "Failed to dlopen local copy: %s", dlerror());
                }
            }
        }
    }
    
    __android_log_print(ANDROID_LOG_ERROR, TAG, "FATAL: Could not load OpenCL driver via any method.");
    return 0;
}


// Macro for forwarding functions with return type and ERROR HANDLING
#define CL_FUNC(ret, name, args_def, args_call, err_val) \
    typedef ret (*pfn_##name) args_def; \
    CL_API_ENTRY ret CL_API_CALL name args_def { \
        if (!load_opencl()) return (ret)err_val; \
        static pfn_##name func = NULL; \
        if (!func) func = (pfn_##name)dlsym(so_handle, #name); \
        if (!func) { \
            __android_log_print(ANDROID_LOG_ERROR, TAG, "Symbol not found: %s", #name); \
            return (ret)err_val; \
        } \
        return func args_call; \
    }

#define CL_FUNC_ERR(ret, name, args_def, args_call) CL_FUNC(ret, name, args_def, args_call, -1)
#define CL_FUNC_NULL(ret, name, args_def, args_call) CL_FUNC(ret, name, args_def, args_call, NULL)

// Special handling for clGetPlatformIDs to allow graceful fallback
CL_API_ENTRY cl_int CL_API_CALL clGetPlatformIDs(cl_uint num_entries, cl_platform_id *platforms, cl_uint *num_platforms) {
    typedef cl_int (*pfn_clGetPlatformIDs)(cl_uint, cl_platform_id*, cl_uint*);
    if (!load_opencl()) {
        if (num_platforms) *num_platforms = 0;
        return CL_SUCCESS; // Pretend success but 0 platforms
    }
    static pfn_clGetPlatformIDs func = NULL;
    if (!func) {
        func = (pfn_clGetPlatformIDs)dlsym(so_handle, "clGetPlatformIDs");
    }
    if (!func) {
        if (num_platforms) *num_platforms = 0;
        return CL_SUCCESS;
    }
    return func(num_entries, platforms, num_platforms);
}

// Special handling for clGetDeviceIDs
CL_API_ENTRY cl_int CL_API_CALL clGetDeviceIDs(cl_platform_id platform, cl_device_type device_type, cl_uint num_entries, cl_device_id *devices, cl_uint *num_devices) {
     typedef cl_int (*pfn_clGetDeviceIDs)(cl_platform_id, cl_device_type, cl_uint, cl_device_id*, cl_uint*);
     if (!load_opencl()) return CL_DEVICE_NOT_FOUND;
     static pfn_clGetDeviceIDs func = NULL;
     if (!func) func = (pfn_clGetDeviceIDs)dlsym(so_handle, "clGetDeviceIDs");
     if (!func) return CL_DEVICE_NOT_FOUND;
     return func(platform, device_type, num_entries, devices, num_devices);
}


CL_FUNC_ERR(cl_int, clGetDeviceInfo,
    (cl_device_id device, cl_device_info param_name, size_t param_value_size, void *param_value, size_t *param_value_size_ret),
    (device, param_name, param_value_size, param_value, param_value_size_ret))

CL_FUNC_NULL(cl_context, clCreateContext,
    (const cl_context_properties *properties, cl_uint num_devices, const cl_device_id *devices, void (CL_CALLBACK *pfn_notify)(const char *, const void *, size_t, void *), void *user_data, cl_int *errcode_ret),
    (properties, num_devices, devices, pfn_notify, user_data, errcode_ret))

CL_FUNC_NULL(cl_command_queue, clCreateCommandQueue,
    (cl_context context, cl_device_id device, cl_command_queue_properties properties, cl_int *errcode_ret),
    (context, device, properties, errcode_ret))

CL_FUNC_NULL(cl_mem, clCreateBuffer,
    (cl_context context, cl_mem_flags flags, size_t size, void *host_ptr, cl_int *errcode_ret),
    (context, flags, size, host_ptr, errcode_ret))

CL_FUNC_NULL(cl_mem, clCreateBufferWithProperties,
    (cl_context context, const cl_mem_properties *properties, cl_mem_flags flags, size_t size, void *host_ptr, cl_int *errcode_ret),
    (context, properties, flags, size, host_ptr, errcode_ret))

CL_FUNC_NULL(cl_program, clCreateProgramWithSource,
    (cl_context context, cl_uint count, const char **strings, const size_t *lengths, cl_int *errcode_ret),
    (context, count, strings, lengths, errcode_ret))

CL_FUNC_ERR(cl_int, clBuildProgram,
    (cl_program program, cl_uint num_devices, const cl_device_id *device_list, const char *options, void (CL_CALLBACK *pfn_notify)(cl_program, void *), void *user_data),
    (program, num_devices, device_list, options, pfn_notify, user_data))

CL_FUNC_ERR(cl_int, clGetProgramBuildInfo,
    (cl_program program, cl_device_id device, cl_program_build_info param_name, size_t param_value_size, void *param_value, size_t *param_value_size_ret),
    (program, device, param_name, param_value_size, param_value, param_value_size_ret))

CL_FUNC_NULL(cl_kernel, clCreateKernel,
    (cl_program program, const char *kernel_name, cl_int *errcode_ret),
    (program, kernel_name, errcode_ret))

CL_FUNC_ERR(cl_int, clSetKernelArg,
    (cl_kernel kernel, cl_uint arg_index, size_t arg_size, const void *arg_value),
    (kernel, arg_index, arg_size, arg_value))

CL_FUNC_ERR(cl_int, clEnqueueNDRangeKernel,
    (cl_command_queue command_queue, cl_kernel kernel, cl_uint work_dim, const size_t *global_work_offset, const size_t *global_work_size, const size_t *local_work_size, cl_uint num_events_in_wait_list, const cl_event *event_wait_list, cl_event *event),
    (command_queue, kernel, work_dim, global_work_offset, global_work_size, local_work_size, num_events_in_wait_list, event_wait_list, event))

CL_FUNC_ERR(cl_int, clEnqueueReadBuffer,
    (cl_command_queue command_queue, cl_mem buffer, cl_bool blocking_read, size_t offset, size_t size, void *ptr, cl_uint num_events_in_wait_list, const cl_event *event_wait_list, cl_event *event),
    (command_queue, buffer, blocking_read, offset, size, ptr, num_events_in_wait_list, event_wait_list, event))

CL_FUNC_ERR(cl_int, clEnqueueWriteBuffer,
    (cl_command_queue command_queue, cl_mem buffer, cl_bool blocking_write, size_t offset, size_t size, const void *ptr, cl_uint num_events_in_wait_list, const cl_event *event_wait_list, cl_event *event),
    (command_queue, buffer, blocking_write, offset, size, ptr, num_events_in_wait_list, event_wait_list, event))

CL_FUNC_ERR(cl_int, clFlush, (cl_command_queue command_queue), (command_queue))
CL_FUNC_ERR(cl_int, clFinish, (cl_command_queue command_queue), (command_queue))
CL_FUNC_ERR(cl_int, clReleaseKernel, (cl_kernel kernel), (kernel))
CL_FUNC_ERR(cl_int, clReleaseProgram, (cl_program program), (program))
CL_FUNC_ERR(cl_int, clReleaseMemObject, (cl_mem memobj), (memobj))
CL_FUNC_ERR(cl_int, clReleaseCommandQueue, (cl_command_queue command_queue), (command_queue))
CL_FUNC_ERR(cl_int, clReleaseContext, (cl_context context), (context))
CL_FUNC_ERR(cl_int, clWaitForEvents, (cl_uint num_events, const cl_event *event_list), (num_events, event_list))
CL_FUNC_ERR(cl_int, clReleaseEvent, (cl_event event), (event))
CL_FUNC_ERR(cl_int, clGetEventProfilingInfo,
    (cl_event event, cl_profiling_info param_name, size_t param_value_size, void *param_value, size_t *param_value_size_ret),
    (event, param_name, param_value_size, param_value, param_value_size_ret))
    
CL_FUNC_ERR(cl_int, clGetPlatformInfo,
    (cl_platform_id platform, cl_platform_info param_name, size_t param_value_size, void *param_value, size_t *param_value_size_ret),
    (platform, param_name, param_value_size, param_value, param_value_size_ret))

CL_FUNC_NULL(cl_mem, clCreateImage,
    (cl_context context, cl_mem_flags flags, const cl_image_format *image_format, const cl_image_desc *image_desc, void *host_ptr, cl_int *errcode_ret),
    (context, flags, image_format, image_desc, host_ptr, errcode_ret))
    
CL_FUNC_NULL(cl_mem, clCreateSubBuffer,
    (cl_mem buffer, cl_mem_flags flags, cl_buffer_create_type buffer_create_type, const void *buffer_create_info, cl_int *errcode_ret),
    (buffer, flags, buffer_create_type, buffer_create_info, errcode_ret))
    
CL_FUNC_ERR(cl_int, clEnqueueBarrierWithWaitList,
    (cl_command_queue command_queue, cl_uint num_events_in_wait_list, const cl_event *event_wait_list, cl_event *event),
    (command_queue, num_events_in_wait_list, event_wait_list, event))
    
CL_FUNC_ERR(cl_int, clEnqueueCopyBuffer,
    (cl_command_queue command_queue, cl_mem src_buffer, cl_mem dst_buffer, size_t src_offset, size_t dst_offset, size_t size, cl_uint num_events_in_wait_list, const cl_event *event_wait_list, cl_event *event),
    (command_queue, src_buffer, dst_buffer, src_offset, dst_offset, size, num_events_in_wait_list, event_wait_list, event))
    
CL_FUNC_ERR(cl_int, clEnqueueFillBuffer,
    (cl_command_queue command_queue, cl_mem buffer, const void *pattern, size_t pattern_size, size_t offset, size_t size, cl_uint num_events_in_wait_list, const cl_event *event_wait_list, cl_event *event),
    (command_queue, buffer, pattern, pattern_size, offset, size, num_events_in_wait_list, event_wait_list, event))
    
CL_FUNC_ERR(cl_int, clEnqueueMarkerWithWaitList,
    (cl_command_queue command_queue, cl_uint num_events_in_wait_list, const cl_event *event_wait_list, cl_event *event),
    (command_queue, num_events_in_wait_list, event_wait_list, event))

CL_FUNC_ERR(cl_int, clGetKernelInfo,
    (cl_kernel kernel, cl_kernel_info param_name, size_t param_value_size, void *param_value, size_t *param_value_size_ret),
    (kernel, param_name, param_value_size, param_value, param_value_size_ret))
    
CL_FUNC_ERR(cl_int, clGetKernelWorkGroupInfo,
    (cl_kernel kernel, cl_device_id device, cl_kernel_work_group_info param_name, size_t param_value_size, void *param_value, size_t *param_value_size_ret),
    (kernel, device, param_name, param_value_size, param_value, param_value_size_ret))

CL_FUNC_ERR(cl_int, clGetKernelSubGroupInfo,
    (cl_kernel kernel, cl_device_id device, cl_kernel_sub_group_info param_name, size_t input_value_size, const void *input_value, size_t param_value_size, void *param_value, size_t *param_value_size_ret),
    (kernel, device, param_name, input_value_size, input_value, param_value_size, param_value, param_value_size_ret))

CL_FUNC_ERR(cl_int, clRetainEvent, (cl_event event), (event))
CL_FUNC_ERR(cl_int, clRetainMemObject, (cl_mem memobj), (memobj))
CL_FUNC_ERR(cl_int, clRetainKernel, (cl_kernel kernel), (kernel))
CL_FUNC_ERR(cl_int, clRetainCommandQueue, (cl_command_queue command_queue), (command_queue))
CL_FUNC_ERR(cl_int, clRetainContext, (cl_context context), (context))
CL_FUNC_ERR(cl_int, clRetainProgram, (cl_program program), (program))
CL_FUNC_ERR(cl_int, clUnloadPlatformCompiler, (cl_platform_id platform), (platform))
