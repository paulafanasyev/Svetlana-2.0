#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${GITHUB_WORKSPACE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
test -n "$REPO_ROOT"
test -d "$REPO_ROOT"
OUT="$REPO_ROOT/plan0-ui-evidence"
APK="$REPO_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
TEST_APK="$REPO_ROOT/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
mkdir -p "$OUT"
test -f "$APK"
test -f "$TEST_APK"

echo "PLAN0_WORKSPACE=PASS"
echo "PLAN0_REPO_ROOT=$REPO_ROOT"
echo "PLAN0_APK_PATH=$APK"
echo "PLAN0_TEST_APK_PATH=$TEST_APK"
echo "emulator_ready=$(date -u +%FT%T.%3NZ)" | tee "$OUT/timestamps.txt"

adb start-server | tee "$OUT/adb-start-server.txt"
adb devices -l | tee "$OUT/adb-devices-initial.txt"

ADB_READY=0
for i in $(seq 1 90); do
  STATE="$(adb -s emulator-5554 get-state 2>/dev/null || true)"
  echo "ADB_WAIT attempt=$i state=${STATE:-unknown}" | tee -a "$OUT/adb-readiness.log"
  if [ "$STATE" = "device" ]; then
    ADB_READY=1
    break
  fi
  sleep 2
done

test "$ADB_READY" = "1"
echo "ADB_DEVICE_STATE=PASS" | tee "$OUT/adb-readiness.log"
adb devices -l | tee "$OUT/adb-online.txt"
echo "adb_online=$(date -u +%FT%T.%3NZ)" | tee -a "$OUT/timestamps.txt"
adb shell getprop sys.boot_completed | tee "$OUT/boot-completed.txt"
adb shell am get-current-user | tee "$OUT/current-user.txt"
adb shell settings get secure enabled_accessibility_services | tee "$OUT/baseline-enabled-services.txt"
adb shell dumpsys accessibility > "$OUT/baseline-accessibility.txt"
adb install -r "$APK" | tee "$OUT/app-install.txt"
adb install -r "$TEST_APK" | tee "$OUT/test-install.txt"
echo "before_instrumentation=$(date -u +%FT%T.%3NZ)" | tee -a "$OUT/timestamps.txt"
set +e
adb shell am instrument -w -r \
  --user current \
  -e class com.svetlana.android.hands.Plan0AccessibilityUiTest#enableSvetlanaAccessibilityThroughSettingsUi \
  com.svetlana.android.hands.test 2>&1 | tee "$OUT/uiautomator-instrumentation.log"
TEST_RC=${PIPESTATUS[0]}
set -e
echo "instrumentation_exit=$TEST_RC" | tee -a "$OUT/timestamps.txt"
echo "after_instrumentation=$(date -u +%FT%T.%3NZ)" | tee -a "$OUT/timestamps.txt"
adb shell settings get secure enabled_accessibility_services | tee "$OUT/final-enabled-services.txt"
adb shell settings get secure accessibility_enabled | tee "$OUT/final-accessibility-enabled.txt"
adb shell dumpsys accessibility > "$OUT/final-accessibility.txt"
adb shell dumpsys package com.svetlana.android.hands > "$OUT/final-package.txt"
adb logcat -d -b all -v threadtime > "$OUT/final-logcat.txt"
grep -iE 'onServiceConnected|AccessibilityManagerService|SvetlanaAccessibilityService' "$OUT/final-logcat.txt" | tail -n 500 > "$OUT/accessibility-logcat.txt" || true
if [ "$TEST_RC" -ne 0 ]; then
  echo "PLAN0_UIAUTOMATOR_RESULT=FAIL"
  exit "$TEST_RC"
fi
if ! grep -qF 'com.svetlana.android.hands/com.svetlana.android.hands.SvetlanaAccessibilityService' "$OUT/final-enabled-services.txt"; then
  echo "PLAN0_UIAUTOMATOR_RESULT=FAIL_NO_ENABLED_SERVICE"
  exit 1
fi
if ! grep -qF 'PLAN0_SERVICE_CONNECTED=PASS' "$OUT/final-logcat.txt"; then
  echo "PLAN0_UIAUTOMATOR_RESULT=FAIL_NO_ON_SERVICE_CONNECTED"
  exit 1
fi
echo "PLAN0_UIAUTOMATOR_RESULT=PASS"
