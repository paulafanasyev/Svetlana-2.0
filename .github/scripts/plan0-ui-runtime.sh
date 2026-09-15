#!/usr/bin/env bash
set -euo pipefail

# Plan 0 runtime: UIAutomator must perform the Accessibility Settings toggle.
# This script never enables the service through `settings put`.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT="$REPO_ROOT/plan0-ui-evidence"
mkdir -p "$OUT"

APK="$REPO_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
TEST_APK="$REPO_ROOT/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
test -f "$APK"
test -f "$TEST_APK"

adb devices | tee "$OUT/adb-devices-before.txt"
adb -s emulator-5554 wait-for-device

BOOT_READY=0
for i in $(seq 1 120); do
  BOOT="$(adb -s emulator-5554 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' | tr -d '[:space:]' || true)"
  echo "BOOT_WAIT attempt=$i sys.boot_completed=${BOOT:-unknown}" | tee -a "$OUT/boot-readiness.log"
  if [ "$BOOT" = "1" ]; then
    BOOT_READY=1
    break
  fi
  sleep 2
done

test "$BOOT_READY" = "1"
echo "ANDROID_BOOT_COMPLETED=PASS" | tee -a "$OUT/boot-readiness.log"
adb shell getprop sys.boot_completed | tee "$OUT/boot-completed.txt"

CURRENT_USER="$(adb shell am get-current-user | tr -d '\r' | tr -d '[:space:]')"
printf '%s\n' "$CURRENT_USER" | grep -Eq '^[0-9]+$'
echo "PLAN0_CURRENT_USER=$CURRENT_USER" | tee "$OUT/current-user.txt"

adb shell settings get secure enabled_accessibility_services | tee "$OUT/baseline-enabled-services.txt"
adb shell dumpsys accessibility > "$OUT/baseline-accessibility.txt"
adb install -r "$APK" | tee "$OUT/app-install.txt"
adb install -r "$TEST_APK" | tee "$OUT/test-install.txt"
echo "before_instrumentation=$(date -u +%FT%T.%3NZ)" | tee -a "$OUT/timestamps.txt"

set +e
adb shell am instrument --user "$CURRENT_USER" -w -r \
  -e class com.svetlana.android.hands.Plan0UiAutomatorTest \
  com.svetlana.android.hands.test/androidx.test.runner.AndroidJUnitRunner \
  2>&1 | tee "$OUT/instrumentation.txt"
INSTRUMENTATION_EXIT=${PIPESTATUS[0]}
set -e

echo "instrumentation_exit=$INSTRUMENTATION_EXIT" | tee "$OUT/instrumentation-exit.txt"
if grep -Eq 'commandError=true|Invalid userId|Error: Invalid userId' "$OUT/instrumentation.txt"; then
  echo "FAIL_INSTRUMENTATION_COMMAND_ERROR=1" | tee -a "$OUT/result.txt"
  exit 1
fi
if ! grep -q 'PLAN0_UIAUTOMATOR=RESULT=PASS' "$OUT/instrumentation.txt"; then
  echo "FAIL_TEST_RESULT_NOT_PROVEN=1" | tee -a "$OUT/result.txt"
  exit 1
fi

echo "PLAN0_UIAUTOMATOR_RESULT=PASS" | tee -a "$OUT/result.txt"

FINAL_ENABLED="$(adb shell settings --user "$CURRENT_USER" get secure enabled_accessibility_services | tr -d '\r')"
printf '%s\n' "$FINAL_ENABLED" | tee "$OUT/final-enabled-services.txt"
adb shell dumpsys accessibility > "$OUT/final-accessibility.txt"
adb logcat -d -s SvetlanaPlan0:* AccessibilityManagerService:* | tee "$OUT/plan0-logcat.txt"

echo "after_instrumentation=$(date -u +%FT%T.%3NZ)" | tee -a "$OUT/timestamps.txt"

echo "$FINAL_ENABLED" | grep -Fq 'com.svetlana.android.hands/.SvetlanaAccessibilityService'
echo "PLAN0_ACCESSIBILITY_ENABLED=PASS" | tee -a "$OUT/result.txt"
grep -q 'PLAN0_SERVICE_CONNECTED=PASS' "$OUT/plan0-logcat.txt"
echo "PLAN0_SERVICE_CONNECTED=PASS" | tee -a "$OUT/result.txt"

grep -q 'PLAN0_NODE_FOUND=PASS' "$OUT/plan0-logcat.txt"
grep -q 'PLAN0_ACTION_CLICK=PASS' "$OUT/plan0-logcat.txt"
grep -q 'PLAN0_REAL_ANDROID_ACTION=PASS' "$OUT/plan0-logcat.txt"
echo "PLAN0_REAL_ANDROID_ACTION=PASS" | tee -a "$OUT/result.txt"
