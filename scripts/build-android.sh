#!/usr/bin/env bash
set -euo pipefail

# scripts/build-android.sh — Automated Android AAB & APK packaging and release signing
# Usage: ./scripts/build-android.sh [--apk | --aab]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WEB_DIR="${PROJECT_ROOT}/apps/web"
ANDROID_DIR="${WEB_DIR}/android"
DECISIONS_FILE="${PROJECT_ROOT}/DECISIONS.md"
BUILD_MODE="aab" # Default to Google Play Store Android App Bundle (.aab)

if [[ "${1:-}" == "--apk" ]]; then
  BUILD_MODE="apk"
elif [[ "${1:-}" == "--aab" ]]; then
  BUILD_MODE="aab"
fi

echo "=== Cosmo Ledger Track: Android Packaging Pipeline [Mode: ${BUILD_MODE^^}] ==="

# 1. Enforce strict configuration of PUBLIC_API_BASE for native builds
if [[ -z "${PUBLIC_API_BASE:-}" ]]; then
  echo "ERROR: PUBLIC_API_BASE environment variable is mandatory for native builds (e.g. https://api.cosmo-ledger.com)." >&2
  echo "Aborting build to prevent shipping an application with an unresolvable backend." >&2
  exit 1
fi

echo "API Base URL configured: ${PUBLIC_API_BASE}"

# 2. Gate production store release on AGENTS.md Rule 20
# DECISIONS.md convention (CLT-D-022): each of Q1-Q4 needs a marker line of the form
#   Q1: Status: CONFIRMED
# written by Owner Zia before an .aab (store) build is allowed. APK builds for
# local hardware testing are not gated.
if [[ "${BUILD_MODE}" == "aab" ]]; then
  echo "Verifying AGENTS.md Rule 20 precondition: Owner confirmation of Q1-Q4..."
  for qn in Q1 Q2 Q3 Q4; do
    if ! grep -Eq "^#*\s*${qn}.*Status: CONFIRMED" "${DECISIONS_FILE}"; then
      echo "ERROR: AGENTS.md Rule 20 violation: ${qn} is not confirmed in DECISIONS.md" >&2
      echo "(expected a marker line like '${qn}: Status: CONFIRMED')." >&2
      echo "Owner Zia must confirm business rules Q1-Q4 prior to production store release." >&2
      exit 1
    fi
  done
  echo "AGENTS.md Rule 20 confirmed: All baseline policies approved by Owner."
fi

# 3. Check Java JDK version (JDK 17 or JDK 21)
JAVA_VER=$(javac -version 2>&1 | awk '{print $2}')
echo "Java compiler detected: ${JAVA_VER}"

# 4. Compile static web distribution using adapter-static
echo "Compiling static SvelteKit distribution for Android container..."
export CAPACITOR_BUILD="true"
pnpm --filter @clt/web build

# Verify build output exists
if [[ ! -f "${WEB_DIR}/build/index.html" ]]; then
  echo "ERROR: Static build output not found at ${WEB_DIR}/build/index.html" >&2
  exit 1
fi

# 5. Initialize Android container if not present
cd "${WEB_DIR}"
if [[ ! -d "${ANDROID_DIR}" ]]; then
  echo "Initializing Capacitor Android native container..."
  pnpm exec cap add android
fi

# 6. Generate adaptive icons and splash assets (AFTER container exists)
if [[ -f "${WEB_DIR}/assets/icon.png" && -f "${WEB_DIR}/assets/splash.png" ]]; then
  echo "Generating adaptive launcher icons and splash screens..."
  pnpm --filter @clt/web exec capacitor-assets generate --android
fi

# 7. Apply AndroidManifest.xml template
echo "Applying native Android manifest configuration..."
cp "${WEB_DIR}/android-config/AndroidManifest.xml" "${ANDROID_DIR}/app/src/main/AndroidManifest.xml"

# 8. Synchronize web assets and native plugins
echo "Synchronizing web assets and plugins to Android project..."
pnpm exec cap sync android

# 9. Execute Gradle compilation
cd "${ANDROID_DIR}"
if [[ "${BUILD_MODE}" == "aab" ]]; then
  echo "Building Google Play Android App Bundle (.aab)..."
  ./gradlew bundleRelease

  AAB_OUTPUT="${ANDROID_DIR}/app/build/outputs/bundle/release/app-release.aab"
  if [[ ! -f "${AAB_OUTPUT}" ]]; then
    echo "ERROR: AAB output file not generated at ${AAB_OUTPUT}" >&2
    exit 1
  fi

  # Sign AAB if keystore credentials are provided
  if [[ -n "${RELEASE_KEYSTORE_PATH:-}" && -f "${RELEASE_KEYSTORE_PATH}" ]]; then
    echo "Signing Android App Bundle with release keystore..."
    jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
      -keystore "${RELEASE_KEYSTORE_PATH}" \
      -storepass:env RELEASE_KEYSTORE_PASSWORD \
      -keypass:env RELEASE_KEY_PASSWORD \
      "${AAB_OUTPUT}" "${RELEASE_KEY_ALIAS}"
    echo "AAB signing complete."
  else
    echo "NOTICE: Keystore credentials not provided; generated unsigned AAB at ${AAB_OUTPUT}."
  fi

  echo "SUCCESS: Android App Bundle ready for Google Play Console submission: ${AAB_OUTPUT}"
  sha256sum "${AAB_OUTPUT}"
else
  echo "Building release APK for physical hardware testing..."
  ./gradlew assembleRelease

  UNSIGNED_APK="${ANDROID_DIR}/app/build/outputs/apk/release/app-release-unsigned.apk"
  SIGNED_APK="${ANDROID_DIR}/app/build/outputs/apk/release/app-release-signed.apk"

  if [[ ! -f "${UNSIGNED_APK}" ]]; then
    echo "ERROR: APK output file not generated at ${UNSIGNED_APK}" >&2
    exit 1
  fi

  if [[ -n "${RELEASE_KEYSTORE_PATH:-}" && -f "${RELEASE_KEYSTORE_PATH}" ]]; then
    echo "Signing APK via apksigner..."
    apksigner sign --ks "${RELEASE_KEYSTORE_PATH}" \
      --ks-pass "env:RELEASE_KEYSTORE_PASSWORD" \
      --ks-key-alias "${RELEASE_KEY_ALIAS}" \
      --key-pass "env:RELEASE_KEY_PASSWORD" \
      --out "${SIGNED_APK}" "${UNSIGNED_APK}"
    echo "SUCCESS: Signed APK ready for installation: ${SIGNED_APK}"
    sha256sum "${SIGNED_APK}"
  else
    echo "SUCCESS: Unsigned APK generated at ${UNSIGNED_APK}"
    sha256sum "${UNSIGNED_APK}"
  fi
fi
