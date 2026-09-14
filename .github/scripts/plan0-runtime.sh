#!/usr/bin/env bash
set -euo pipefail

APK="$GITHUB_WORKSPACE/android-apk/app-debug.apk"
SERVICE='com.svetlana.android.hands/com.svetlana.android.hands.SvetlanaAccessibilityService'
PACKAGE='com.svetlana.android.hands'
APP_OP_NAME='BIND_ACCESSIBILITY_SERVICE'
APP_OP_ID='73'

echo '--- Plan 0 runtime APK preflight ---'
test -f "$APK"
test -s "$APK"
ls -lh "$APK"
sha256sum "$APK" > plan0-runtime-apk-sha256.txt
cat plan0-runtime-apk-sha256.txt
adb install -r "$APK"

echo '--- Plan 0 AppOps grant ---'
echo "package=$PACKAGE appop=$APP_OP_NAME id=$APP_OP_ID"
# Android's public AppOps name for OPSTR_BIND_ACCESSIBILITY_SERVICE is
# BIND_ACCESSIBILITY_SERVICE. On API 35 the operation is enum 73.
# The previous canonical-string command produced "No operations" and did
# not create a package-specific grant, so use the public op name and verify
# the persisted result before attempting to enable the service.
adb shell appops set "$PACKAGE" "$APP_OP_NAME" allow
appops_state="$(adb shell appops get "$PACKAGE" "$APP_OP_NAME" | tr -d '\r')"
echo "appops_state_by_name=$appops_state"
printf '%s\n' "$appops_state" > plan0-appops.txt
if ! printf '%s\n' "$appops_state" | grep -qi 'allow'; then
  echo 'Named AppOp did not persist; retrying with API-35 numeric op 73'
  adb shell appops set "$PACKAGE" "$APP_OP_ID" allow
  appops_state="$(adb shell appops get "$PACKAGE" "$APP_OP_NAME" | tr -d '\r')"
  echo "appops_state_after_numeric=$appops_state"
  printf '%s\n' "$appops_state" >> plan0-appops.txt
fi
grep -qi 'allow' plan0-appops.txt

echo '--- Plan 0 AppOps dump ---'
adb shell dumpsys appops | grep -A8 -B2 "$PACKAGE" | tee plan0-appops-dumpsys.txt || true

adb shell am start -n "$PACKAGE/.MainActivity"
adb shell settings --user 0 put secure enabled_accessibility_services "$SERVICE"
adb shell settings --user 0 put secure accessibility_enabled 1
for i in $(seq 1 20); do
  enabled="$(adb shell settings --user 0 get secure enabled_accessibility_services | tr -d '\r')"
  echo "poll=$i enabled_setting=$enabled"
  if adb shell dumpsys accessibility | tee accessibility-dumpsys.txt | grep -q "Enabled services:.*$SERVICE"; then
    echo 'PLAN0_ACCESSIBILITY_MANAGER_ENABLED=PASS'
    break
  fi
  sleep 1
done
enabled="$(adb shell settings --user 0 get secure enabled_accessibility_services | tr -d '\r')"
echo "final_enabled_setting=$enabled"
adb shell dumpsys accessibility | tee accessibility-dumpsys.txt
if ! grep -q "Enabled services:.*$SERVICE" accessibility-dumpsys.txt; then
  echo 'PLAN0_ACCESSIBILITY_MANAGER_ENABLED=FAIL'
  adb shell dumpsys package "$PACKAGE" | tee plan0-package-dumpsys.txt
  adb shell appops get "$PACKAGE" "$APP_OP_NAME" | tee plan0-appops-final.txt
  adb logcat -d -b all -v threadtime | grep -iE 'AccessibilityManager|AccessibilityService|AccessibilitySecurityPolicy|Svetlana|bind.*access|AppOps' | tail -n 300 | tee plan0-accessibility-logcat.txt || true
  exit 1
fi
adb logcat -d -s SvetlanaPlan0:I '*:S' > service-logcat.txt
grep -q 'PLAN0_SERVICE_CONNECTED=PASS' service-logcat.txt
adb shell uiautomator dump /sdcard/window.xml >/dev/null
adb shell cat /sdcard/window.xml | tee window.xml
grep -q 'PLAN0_STATUS=ACTION_PERFORMED' window.xml
adb logcat -d -s SvetlanaPlan0:I '*:S' | tee plan0-logcat.txt
grep -q 'PLAN0_NODE_FOUND=PASS' plan0-logcat.txt
grep -q 'PLAN0_ACTION_CLICK=PASS' plan0-logcat.txt
grep -q 'PLAN0_REAL_ANDROID_ACTION=PASS' plan0-logcat.txt
