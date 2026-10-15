#!/usr/bin/env bash
# Дымовая проверка на эмуляторе (svetlana-android-emulator.yml): ставим APK, запускаем, ждём 25 секунд
# и проверяем, что приложение живо, не упало и открыло общий интерфейс (WebView с адресом приложения).
# Скриншот и logcat сохраняются в smoke/ для артефакта.
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

echo "Дымовая проверка пройдена: приложение запущено и работает"
