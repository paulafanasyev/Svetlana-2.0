#!/usr/bin/env bash
set -euo pipefail

APK="$GITHUB_WORKSPACE/android-apk/app-debug.apk"
SERVICE='com.svetlana.android.hands/com.svetlana.android.hands.SvetlanaAccessibilityService'
PACKAGE='com.svetlana.android.hands'

 echo '--- Plan 0 runtime APK preflight ---'
echo "PWD=$PWD"
echo "GITHUB_WORKSPACE=$GITHUB_WORKSPACE"
test -f "$APK"
test -s "$APK"
ls -lh "$APK"
sha256sum "$APK" > plan0-runtime-apk-sha256.txt
cat plan0-runtime-apk-sha256.txt

adb install -r "$APK"
adb shell appops set "$PACKAGE" BIND_ACCESSIBILITY_SERVICE allow
adb shell appops get "$PACKAGE" | tee plan0-appops.txt
grep -q 'BIND_ACCESSIBILITY_SERVICE: allow' plan0-appops.txt
adb shell am start -n "$PACKAGE/.MainActivity"
adb shell settings --user 0 put secure enabled_accessibility_services "$SERVICE"
adb shell settings --user 0 put secure accessibility_enabled 1

echo '--- registered/enabled accessibility services ---'
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
  echo '--- package/service diagnostics ---'
  adb shell dumpsys package "$PACKAGE" | tee plan0-package-dumpsys.txt
  echo '--- accessibility-related logcat ---'
  adb logcat -d -b all -v threadtime | grep -iE 'AccessibilityManager|AccessibilityService|AccessibilitySecurityPolicy|Svetlana|bind.*access|AppOps' | tail -n 300 | tee plan0-accessibility-logcat.txt || true
  exit 1
fi

adb logcat -d -s SvetlanaPlan0:I '*:S' > service-logcat.txt
grep -q 'PLAN0_SERVICE_CONNECTED=PASS' service-logcat.txt

echo '--- UI state after AccessibilityService action ---'
adb shell uiautomator dump /sdcard/window.xml >/dev/null
adb shell cat /sdcard/window.xml | tee window.xml
grep -q 'PLAN0_STATUS=ACTION_PERFORMED' window.xml

echo '--- Plan 0 runtime evidence ---'
adb logcat -d -s SvetlanaPlan0:I '*:S' | tee plan0-logcat.txt
grep -q 'PLAN0_NODE_FOUND=PASS' plan0-logcat.txt
grep -q 'PLAN0_ACTION_CLICK=PASS' plan0-logcat.txt
grep -q 'PLAN0_REAL_ANDROID_ACTION=PASS' plan0-logcat.txt
