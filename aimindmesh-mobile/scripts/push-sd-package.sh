#!/usr/bin/env bash
# Copies a Stable Diffusion package (Models/<name>: *.bin + metadata.json) into the debug app's
# files/sd-models/<name>/ on the connected phone. Files already identical on the phone (md5) are
# skipped; every copy is verified; nothing else in the folder is touched (backups such as
# text_encoder.bin.random stay). The app reads them at the next load: close and reopen it.
#
#   scripts/push-sd-package.sh Models/sd2.1lora                 # all files
#   scripts/push-sd-package.sh Models/sd2.1lora text_encoder.bin metadata.json
#   scripts/push-sd-package.sh -n Models/sd2.1lora768           # dry run: only show what differs
#   scripts/push-sd-package.sh -s <serial> Models/sd2.1lora_v73  # with more than one phone connected
set -euo pipefail

APP_ID=com.aimindmesh.mobile
TMP_DIR=/data/local/tmp

dry_run=0
while [[ "${1:-}" == -* ]]; do
  case "$1" in
    -n) dry_run=1; shift ;;
    -s) export ANDROID_SERIAL="${2:?-s needs a serial}"; shift 2 ;;
    *) echo "Unknown option $1" >&2; exit 1 ;;
  esac
done
src="${1:?usage: $0 [-n] <package dir> [file ...]}"
shift
[[ -d "$src" ]] || { echo "Not a directory: $src" >&2; exit 1; }
name="$(basename "$(realpath "$src")")"
dest="files/sd-models/$name"

if [[ $# -gt 0 ]]; then
  files=("$@")
else
  mapfile -t files < <(cd "$src" && ls -1 -- *.bin metadata.json 2>/dev/null | sort)
fi
[[ ${#files[@]} -gt 0 ]] || { echo "No *.bin / metadata.json in $src" >&2; exit 1; }

if [[ -n "${ANDROID_SERIAL:-}" ]]; then
  [[ "$(adb get-state 2>/dev/null)" == device ]] || { echo "Phone $ANDROID_SERIAL not connected" >&2; exit 1; }
else
  devices=$(adb devices | awk 'NR > 1 && $2 == "device"' | wc -l)
  [[ "$devices" == 1 ]] || { echo "Expected exactly one phone on adb (use -s <serial>), found $devices" >&2; exit 1; }
fi
adb shell run-as "$APP_ID" true || { echo "run-as $APP_ID failed: debug build not installed?" >&2; exit 1; }

device_md5() { adb shell run-as "$APP_ID" md5sum "$dest/$1" 2>/dev/null | awk '{print $1}' || true; }

todo=()
bytes=0
for f in "${files[@]}"; do
  [[ -f "$src/$f" ]] || { echo "Missing $src/$f" >&2; exit 1; }
  local_md5=$(md5sum "$src/$f" | awk '{print $1}')
  if [[ "$(device_md5 "$f")" == "$local_md5" ]]; then
    echo "  = $f (already on the phone)"
  else
    echo "  + $f ($(du -h "$src/$f" | cut -f1))"
    todo+=("$f")
    bytes=$((bytes + $(stat -c %s "$src/$f")))
  fi
done
if [[ ${#todo[@]} -eq 0 ]]; then echo "$name is up to date on the phone"; exit 0; fi
if [[ $dry_run == 1 ]]; then echo "Dry run: ${#todo[@]} file(s) would be copied to $dest"; exit 0; fi

free_kb=$(adb shell df -k /data | awk 'NR == 2 {print $4}')
if (( free_kb * 1024 < bytes * 2 + 1073741824 )); then
  echo "Not enough space on the phone: $((free_kb / 1024)) MB free, need about $((bytes * 2 / 1048576)) MB" >&2
  exit 1
fi

adb shell run-as "$APP_ID" mkdir -p "$dest"
for f in "${todo[@]}"; do
  tmp="$TMP_DIR/sdpkg_$f"
  echo "Copying $f ..."
  adb push "$src/$f" "$tmp" >/dev/null
  adb shell chmod 644 "$tmp"
  adb shell run-as "$APP_ID" cp "$tmp" "$dest/$f"
  adb shell rm -f "$tmp"
  if [[ "$(device_md5 "$f")" != "$(md5sum "$src/$f" | awk '{print $1}')" ]]; then
    echo "md5 mismatch for $dest/$f" >&2
    exit 1
  fi
  echo "  ok $dest/$f"
done
echo "Done. Reload the model: close the app from recents and reopen it (selecting the same model again does not reload it)."
adb shell run-as "$APP_ID" ls -la "$dest"
