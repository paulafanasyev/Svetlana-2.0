#!/usr/bin/env bash
set -u
APK="$GITHUB_WORKSPACE/android-apk/app-debug.apk"
PACKAGE='com.svetlana.android.hands'
SERVICE="$PACKAGE/com.svetlana.android.hands.SvetlanaAccessibilityService"
OUT="$GITHUB_WORKSPACE/plan0-ui-evidence"
mkdir -p "$OUT"

snapshot() {
  local tag="$1"
  {
    echo "===== $tag $(date -u +%FT%T.%3NZ) ====="
    echo '--- secure settings ---'
    adb shell settings --user 0 get secure enabled_accessibility_services
    adb shell settings --user 0 get secure accessibility_enabled
    echo '--- dumpsys accessibility ---'
    adb shell dumpsys accessibility
    echo '--- appops ---'
    adb shell appops get "$PACKAGE" BIND_ACCESSIBILITY_SERVICE
    echo '--- relevant framework logcat ---'
    adb logcat -d -b all -v threadtime | grep -iE 'AccessibilityManagerService|AccessibilitySecurityPolicy|AccessibilityService|AppOpsService|PermissionManager|system_server|Svetlana' | tail -n 500 || true
  } > "$OUT/$tag.txt" 2>&1
}

cleanup() {
  snapshot final || true
  adb shell dumpsys accessibility > "$OUT/accessibility-final.txt" 2>&1 || true
  adb shell dumpsys appops > "$OUT/appops-final.txt" 2>&1 || true
  adb logcat -d -b all -v threadtime > "$OUT/logcat-full.txt" 2>&1 || true
  adb shell dumpsys cpuinfo > "$OUT/cpuinfo-final.txt" 2>&1 || true
  adb shell dumpsys meminfo system_server > "$OUT/system-server-meminfo.txt" 2>&1 || true
  adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || true
  adb shell cat /sdcard/window.xml > "$OUT/window-final.xml" 2>&1 || true
}
trap cleanup EXIT

set -x
test -s "$APK"
adb install -r "$APK"
snapshot baseline

baseline="$(adb shell settings --user 0 get secure enabled_accessibility_services | tr -d '\r')"
if printf '%s' "$baseline" | grep -qF "$SERVICE"; then
  echo 'BASELINE_INVALID: Svetlana already enabled' >&2
  exit 2
fi

# Clean experiment: open real Android Accessibility Settings.
# Deliberately NO settings put secure enabled_accessibility_services.
adb shell am start -a android.settings.ACCESSIBILITY_SETTINGS
sleep 3
adb shell uiautomator dump /sdcard/settings.xml >/dev/null 2>&1 || true
adb shell cat /sdcard/settings.xml > "$OUT/settings.xml" 2>&1 || true

# Find the Svetlana row in the real Settings UI and tap its center.
python3 - "$OUT/settings.xml" <<'PY' > "$OUT/service-row.txt"
import re,sys
s=open(sys.argv[1],errors='ignore').read()
for label in ('Svetlana','Светлана'):
    for m in re.finditer(r'<node[^>]*(?:text|content-desc)="'+re.escape(label)+r'"[^>]*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]"',s,re.I):
        x1,y1,x2,y2=map(int,m.groups())
        print((x1+x2)//2,(y1+y2)//2)
        raise SystemExit
raise SystemExit('SERVICE_LABEL_NOT_FOUND')
PY
read X Y < "$OUT/service-row.txt"
adb shell input tap "$X" "$Y"
sleep 2
adb shell uiautomator dump /sdcard/service.xml >/dev/null 2>&1 || true
adb shell cat /sdcard/service.xml > "$OUT/service.xml" 2>&1 || true

# Locate a checkable/switch node from the service detail page and tap it.
python3 - "$OUT/service.xml" <<'PY' > "$OUT/toggle.txt"
import re,sys
s=open(sys.argv[1],errors='ignore').read()
pat=r'<node[^>]*(?:checkable="true"|class="android.widget.Switch")[^>]*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]"'
m=re.search(pat,s,re.I)
if not m:
    raise SystemExit('TOGGLE_NOT_FOUND')
x1,y1,x2,y2=map(int,m.groups())
print((x1+x2)//2,(y1+y2)//2)
PY
read TX TY < "$OUT/toggle.txt"
adb shell input tap "$TX" "$TY"

# Observe for 60 seconds. No secure-setting mutation is performed.
: > "$OUT/observation.log"
for i in $(seq 0 60); do
  ts="$(date -u +%FT%T.%3NZ)"
  enabled="$(adb shell settings --user 0 get secure enabled_accessibility_services | tr -d '\r')"
  ae="$(adb shell settings --user 0 get secure accessibility_enabled | tr -d '\r')"
  state="$(adb shell dumpsys accessibility | grep -E 'Enabled services:|Bound services:|ServiceRecord' | tr '\n' ' ' || true)"
  echo "$ts poll=$i enabled_accessibility_services=[$enabled] accessibility_enabled=[$ae] framework=[$state]" | tee -a "$OUT/observation.log"
  sleep 1
done
