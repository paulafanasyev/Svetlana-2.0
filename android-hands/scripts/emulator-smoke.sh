#!/usr/bin/env bash
# Дымовая проверка на эмуляторе (svetlana-android-emulator.yml): ставим APK, запускаем, ждём 25 секунд
# и проверяем, что приложение живо, не упало и открыло общий интерфейс (WebView с адресом приложения).
# Скриншот, logcat, UI dump и установленный APK сохраняются в smoke/ для артефакта.
# Дополнительно проверяем, что Android APK действительно содержит адаптер браузера агента.
set -euo pipefail

PKG=ru.svetlana.app
OUT=smoke
mkdir -p "$OUT"

APK=$(ls android-hands/app/build/outputs/apk/debug/*.apk | head -n 1)
echo "APK: $APK"
adb install -r "$APK"
adb logcat -c

# Запуск как с иконки (без привязки к имени класса).
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 25

adb logcat -d > "$OUT/logcat.txt" || true
adb exec-out screencap -p > "$OUT/screen.png" || true

if ! adb shell pidof "$PKG" >/dev/null; then
  echo "::error::Приложение закрылось после запуска"
  exit 1
fi
if grep -E "FATAL EXCEPTION|Process: $PKG" "$OUT/logcat.txt" >/dev/null; then
  echo "::error::В logcat есть падение приложения"
  grep -n -A 20 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -n 60 || true
  exit 1
fi

# На экране должен быть WebView приложения, а не заглушка «Обновите WebView».
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
adb shell cat /sdcard/ui.xml > "$OUT/ui.xml" 2>/dev/null || true
if grep -q "Обновите Android System WebView" "$OUT/ui.xml" 2>/dev/null; then
  echo "::error::Приложение показало заглушку старого WebView"
  exit 1
fi

# Убедиться, что проверяемый установленный APK содержит нативный адаптер браузера агента.
REMOTE_APK=$(adb shell pm path "$PKG" | head -n 1 | tr -d '\r' | sed 's/^package://')
if [ -z "$REMOTE_APK" ]; then
  echo "::error::Не удалось определить путь установленного APK"
  exit 1
fi
adb pull "$REMOTE_APK" "$OUT/installed.apk" >/dev/null
if ! unzip -p "$OUT/installed.apk" classes.dex | strings | grep -q 'browser_create_session'; then
  echo "::error::В установленном APK не найден код команды создания браузерной сессии"
  exit 1
fi
if ! unzip -p "$OUT/installed.apk" classes.dex | strings | grep -q 'android-webview-browser'; then
  echo "::error::В установленном APK не найден Android WebView-адаптер браузера"
  exit 1
fi

adb shell dumpsys package "$PKG" | grep -E 'versionName=|versionCode=' > "$OUT/package-version.txt" || true

echo "Дымовая проверка пройдена: приложение запущено, не упало, APK содержит адаптер браузера агента"
