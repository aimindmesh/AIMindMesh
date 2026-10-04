#!/usr/bin/env bash
# Copies the QNN HTP runtime of more Hexagon versions (default v73: Snapdragon 8 Gen 2, Galaxy Z Fold5)
# from a QAIRT SDK into the SD plugin's jniLibs. GenieX's AAR ships libQnnHtp.so with the V79/V81 stub
# and skel only, and a stub/skel must come from the very same QAIRT build as the libQnnHtp.so the app
# loads: the script refuses an SDK whose build differs. The copied files are not versioned (.gitignore).
#
#   scripts/fetch-qnn-htp-libs.sh ~/Scaricati/qairt-2.45.0.260326.zip            # SDK zip
#   scripts/fetch-qnn-htp-libs.sh /opt/qcom/aistack/qairt/2.45.0.260326 v73 v75   # extracted SDK
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$MOBILE_DIR/plugins/sd-capacitor/android/src/main/jniLibs/arm64-v8a"
GENIEX_VERSION=$(grep -oE "geniex-android:[0-9.]+" "$MOBILE_DIR/plugins/sd-capacitor/android/build.gradle" | cut -d: -f2)

sdk="${1:?usage: $0 <QAIRT SDK zip or folder> [v73 v75 ...]}"
shift
archs=("$@")
[[ ${#archs[@]} -gt 0 ]] || archs=(v73)

build_of() { strings "$1" | grep -m1 -oE 'v2\.[0-9]+\.[0-9]+\.[0-9]{12}' || true; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Build of the libQnnHtp.so that GenieX puts in the APK
aar=$(find ~/.gradle/caches/modules-2 -name "geniex-android-$GENIEX_VERSION.aar" 2>/dev/null | head -1)
[[ -n "$aar" ]] || { echo "GenieX $GENIEX_VERSION AAR not in the Gradle cache: build the app once" >&2; exit 1; }
unzip -q -o -j "$aar" jni/arm64-v8a/libQnnHtp.so -d "$work/geniex"
app_build=$(build_of "$work/geniex/libQnnHtp.so")
echo "GenieX $GENIEX_VERSION libQnnHtp.so: $app_build"

# Files wanted from the SDK (relative to its root folder)
wanted=()
for arch in "${archs[@]}"; do
  A="${arch^^}"
  wanted+=("lib/aarch64-android/libQnnHtp${A}Stub.so" "lib/hexagon-${arch}/unsigned/libQnnHtp${A}Skel.so"
           "lib/hexagon-${arch}/unsigned/libQnnHtp${A}.so")
done

fetch() {  # <path in the SDK> <target>
  if [[ -d "$sdk" ]]; then
    [[ -f "$sdk/$1" ]] && cp "$sdk/$1" "$2"
  else
    local entry
    entry=$(unzip -Z1 "$sdk" | grep -E "(^|/)$1\$" | head -1 || true)
    [[ -n "$entry" ]] && unzip -q -o -p "$sdk" "$entry" > "$2"
  fi
}

mkdir -p "$work/sdk"
for path in "${wanted[@]}"; do
  name=$(basename "$path")
  if ! fetch "$path" "$work/sdk/$name" || [[ ! -s "$work/sdk/$name" ]]; then
    rm -f "$work/sdk/$name"
    # libQnnHtpVxx.so is not shipped for every version: stub and skel are mandatory
    [[ "$name" == *Stub.so || "$name" == *Skel.so ]] && { echo "Missing in the SDK: $path" >&2; exit 1; }
    echo "  (no $name in this SDK)"
    continue
  fi
  build=$(build_of "$work/sdk/$name")
  if [[ "$build" != "$app_build" ]]; then
    echo "$name is $build, GenieX's libQnnHtp.so is $app_build: use the QAIRT SDK of that exact build" >&2
    exit 1
  fi
done

mkdir -p "$DEST"
for f in "$work"/sdk/*.so; do
  cp "$f" "$DEST/"
  echo "✓ $(basename "$f") ($(du -h "$f" | cut -f1), $app_build)"
done
echo "Copied to ${DEST#"$MOBILE_DIR"/}: rebuild the APK"
