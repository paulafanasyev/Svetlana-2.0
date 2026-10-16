#!/usr/bin/env bash
# Дымовая проверка на эмуляторе (svetlana-android-emulator.yml): ставим APK, запускаем, ждём 25 секунд
# и проверяем, что приложение живо, не упало, на экране именно оно и это не заглушка «Обновите WebView».
# Скриншот, logcat и дерево экрана сохраняются в smoke/ для артефакта.
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

# Дерево экрана обязательно: без него проверка «не заглушка» ничего не доказывает.
# uiautomator иногда не дожидается покоя экрана, поэтому до 3 попыток.
dumped=0
for attempt in 1 2 3; do
  if adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 \
    && adb shell cat /sdcard/ui.xml > "$OUT/ui.xml" \
    && [ -s "$OUT/ui.xml" ] && grep -q '<hierarchy' "$OUT/ui.xml"; then
    dumped=1
    break
  fi
  echo "Дерево экрана не снялось (попытка $attempt), жду"
  sleep 5
done
if [ "$dumped" != 1 ]; then
  echo "::error::Не удалось снять дерево экрана (uiautomator)"
  exit 1
fi
if ! grep -q "package=\"$PKG\"" "$OUT/ui.xml"; then
  echo "::error::На экране не приложение Светланы"
  exit 1
fi
if grep -q "Обновите Android System WebView" "$OUT/ui.xml"; then
  echo "::error::Приложение показало заглушку старого WebView"
  exit 1
fi

echo "Дымовая проверка пройдена: приложение запущено, на экране и работает"
