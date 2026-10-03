# Vendored code: whisper.cpp

`cpp/` is a trimmed copy of upstream [whisper.cpp](https://github.com/ggml-org/whisper.cpp).

| | |
|---|---|
| Upstream version | whisper.cpp **v1.8.3** (ggml **0.9.5**) |
| Build entry point | `android/src/main/cpp/CMakeLists.txt` → `add_subdirectory(cpp)` with examples/tests OFF |
| Local patches | none |

## Removed (not used by the Android build)
Kept: `CMakeLists.txt`, `cmake/`, `include/`, `src/`, `ggml/` (CMake, include, common sources, `ggml-cpu/`), `LICENSE`, `AUTHORS`, `README.md`.

Removed from the upstream tree:
- `bindings/`, `examples/`, `tests/`, `samples/`, `scripts/`, `ci/`, `.github/`, `.devops/`, `grammars/`
- `Makefile`, `README_sycl.md`, `build-xcframework.sh`, `close-issue.yml`, `.dockerignore`
- ggml backends other than CPU: `ggml/src/ggml-{blas,cann,cuda,hexagon,hip,metal,musa,opencl,rpc,sycl,vulkan,webgpu,zdnn,zendnn}/`
  (each one is compiled only when its `GGML_<BACKEND>` option is ON; all are OFF on Android).

## Updating
Copy the new upstream release over `cpp/`, delete the same paths again, then build the app (`./gradlew assembleDebug`).
Enabling a GPU backend for whisper requires restoring its `ggml/src/ggml-<backend>/` directory.
