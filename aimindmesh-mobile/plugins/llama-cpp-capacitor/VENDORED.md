# Vendored code: llama.cpp (via llama.rn)

`cpp/` is a copy of the llama.cpp sources shipped by [llama.rn](https://github.com/mybigday/llama.rn), adapted for Capacitor.
The same tree is also compiled (CPU only) by the app's Voxtral module (`aimindmesh-mobile/android/app/src/main/cpp/CMakeLists.txt`).

| | |
|---|---|
| Upstream | llama.rn **v0.12.4** → llama.cpp build **b9309** (commit `6d57c26`, see `cpp/common/build-info.cpp`) |
| Plugin package | `llama-cpp-capacitor` 0.0.22 (fork of the arusatech package, namespace renamed) |
| Build entry point | `android/src/main/CMakeLists.txt` (explicit source list: CPU, OpenCL and Vulkan backends) |
| Vulkan headers | `android/vulkan-hpp/vulkan/` (Vulkan-Hpp, Apache-2.0, `android/vulkan-hpp/LICENSE.txt`) |

## Local patches
- `cpp/chat.cpp.patch` — adds `extra_fields` to multimodal content parts in `common/chat.cpp`. **Already applied**; kept as a record to re-apply after an update.
- `rn-*` files from llama.rn were replaced by the Capacitor bridge `cap-*` files.

## Removed (not used by the Android build)
- `cpp/ggml-metal/`, `cpp/ggml-metal.m` (iOS), `cpp/ggml-hexagon/`, `cpp/ggml-blas/`, `cpp/jsi/` (React Native)
- `cpp/kernels/` (stale duplicate of `cpp/ggml-opencl/kernels/`), the top-level `cpp/ggml-opencl.cpp` (stale duplicate)
- `cpp/rn-*` (llama.rn bridge, superseded by `cap-*`)
- `cpp/Vulkan-Hpp/` (identical duplicate of `android/vulkan-hpp/`, which is the one on the include path)
- `cpp/opencl-libs/` (a 14-byte failed download; the OpenCL stub is built from `opencl_stub.c` and loads the device's `libOpenCL.so`)
- `android/vulkan-hpp/` everything except `vulkan/` and `LICENSE.txt` (generator sources, samples, tests)

The headers `ggml-metal.h`, `ggml-blas.h`, `ggml-hexagon.h` are kept because common sources include them.

## Updating
Copy the new llama.rn `cpp/` over this one, re-apply `chat.cpp.patch`, delete the paths above, keep the `cap-*` files,
update the source list in `android/src/main/CMakeLists.txt` (and the Voxtral one), then build the app.
