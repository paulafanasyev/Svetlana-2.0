#!/usr/bin/env bash
set -euo pipefail

APK="$GITHUB_WORKSPACE/android-apk/app-debug.apk"

echo '--- Plan 0 runtime APK preflight ---'
echo "PWD=$PWD"
echo "GITHUB_WORKSPACE=$GITHUB_WORKSPACE"
test -f "$APK"
test -s "$APK"
ls -lh "$APK"
sha256sum "$APK" > plan0-runtime-apk-sha256.txt
cat plan0-runtime-apk-sha256.txt

adb install -r "$APK"
adb shell am start -n com.svetlana.android.hands/.MainActivity
adb shell settings put secure enabled_accessibility_services com.svetlana.android.hands/com.svetlana.android.hands.SvetlanaAccessibilityService
adb shell settings put secure accessibility_enabled 1

sleep 3

echo '--- registered/enabled accessibility services ---'
adb shell settings get secure enabled_accessibility_services
adb shell dumpsys accessibility | tee accessibility-dumpsys.txt

grep -q 'com.svetlana.android.hands/com.svetlana.android.hands.SvetlanaAccessibilityService' accessibility-dumpsys.txt
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
