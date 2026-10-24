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

# Ищем строки во всех DEX-файлах: реализации может быть больше одного classesN.dex.
DEX_LIST=$(unzip -Z1 "$OUT/installed.apk" | grep -E '^classes([0-9]+)?\.dex$' || true)
if [ -z "$DEX_LIST" ]; then
  echo "::error::В установленном APK нет DEX-файлов"
  exit 1
fi
DEX_TEXT=$(while IFS= read -r dex; do unzip -p "$OUT/installed.apk" "$dex" | strings; done <<< "$DEX_LIST")
if ! grep -q 'browser_create_session' <<< "$DEX_TEXT"; then
  echo "::error::В установленном APK не найден код команды создания браузерной сессии"
  exit 1
fi
if ! grep -q 'android-webview-browser' <<< "$DEX_TEXT"; then
  echo "::error::В установленном APK не найден Android WebView-адаптер браузера"
  exit 1
fi

adb shell dumpsys package "$PKG" | grep -E 'versionName=|versionCode=' > "$OUT/package-version.txt" || true
if ! grep -q 'versionName=2.1.4' "$OUT/package-version.txt"; then
  echo "::error::Установлена не ожидаемая версия 2.1.4"
  cat "$OUT/package-version.txt"
  exit 1
fi

echo "Дымовая проверка пройдена: приложение запущено, не упало, APK версии 2.1.4 содержит адаптер браузера агента"
