#!/usr/bin/env bash
# Дымовой тест «Светланы» на эмуляторе: ставим APK, запускаем, ждём, что ядро (Node) поднялось и ответило на /healthz,
# снимаем экран, дерево интерфейса, logcat и журналы ядра. Запуск из корня репозитория: bash android-hands/ci/emulator-smoke.sh
# (у android-emulator-runner каждая строка script — отдельная команда, поэтому вся логика здесь, одним файлом.)
set -Eeuo pipefail
PKG=ru.svetlana.app
OUT=emulator-evidence; mkdir -p "$OUT"
fail() { echo "::error::$1"; set +e; collect; exit 1; }
collect() {
  adb exec-out screencap -p > "$OUT/screen.png" 2>/dev/null || true
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1 || true
  adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
  for f in core.log core-service.log llama.log core.json llm-status.json; do adb shell run-as $PKG cat files/$f > "$OUT/$f" 2>/dev/null || true; done
  sed -i 's/"adminToken":"[^"]*"/"adminToken":"***"/; s/"secret":"[^"]*"/"secret":"***"/; s/"pdfToken":"[^"]*"/"pdfToken":"***"/' "$OUT/core.json" 2>/dev/null || true
  adb shell ps -A | grep -i svetlana > "$OUT/ps.txt" 2>/dev/null || true
  echo "---- core.log (хвост) ----"; tail -n 60 "$OUT/core.log" 2>/dev/null || true
  echo "---- core-service.log ----"; tail -n 30 "$OUT/core-service.log" 2>/dev/null || true
  echo "---- logcat: Svetlana / падения ----"; grep -E "SvetlanaCore|FATAL EXCEPTION|Fatal signal|AndroidRuntime|$PKG" "$OUT/logcat.txt" | tail -n 80 || true
  grep -E "SvetlanaCore|FATAL EXCEPTION|Fatal signal|AndroidRuntime|DEBUG|nodejs|libnode|svbridge|$PKG" "$OUT/logcat.txt" | tail -n 60 > "$OUT/logcat-app.txt" 2>/dev/null || true
  # журналы — в аннотации: их видно в API без входа, по ним разбираем падение
  annotate "core.log" "$OUT/core.log" 3; annotate "core-service.log" "$OUT/core-service.log" 1; annotate "logcat" "$OUT/logcat-app.txt" 2
}
# хвост файла → до N аннотаций по 3000 символов (переводы строк кодируются по правилам GitHub)
annotate() {
  local title=$1 f=$2 n=$3
  [ -s "$f" ] || { echo "::warning title=$title::(пусто)"; return 0; }
  python3 - "$title" "$f" "$n" <<'PY' || true
import sys
t, f, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
d = open(f, encoding="utf-8", errors="replace").read()[-3000 * n:]
for i in range(0, len(d), 3000):
    c = d[i:i + 3000].replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::warning title={t} {i // 3000 + 1}::{c}")
PY
}
APK=""
for c in android-hands/app/build/outputs/apk/debug/app-x86_64-debug.apk android-hands/app/build/outputs/apk/debug/app-universal-debug.apk; do
  if [ -s "$c" ]; then APK="$c"; break; fi
done
[ -n "$APK" ] || fail "APK не найден"
echo "APK: $APK"
adb wait-for-device
for i in $(seq 1 60); do if [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)" = 1 ]; then break; fi; sleep 5; done
adb shell getprop ro.product.cpu.abilist || true
adb logcat -c || true
adb install -r -g "$APK" || fail "APK не установился"
adb shell run-as $PKG true >/dev/null 2>&1 || fail "run-as недоступен: нужен отладочный (debuggable) APK"
adb shell am start -W -n $PKG/ru.svetlana.hands.MainActivity || fail "окно не открылось"
# ядро: ждём ответ /healthz на порту из core.json (до 4 минут — на эмуляторе с трансляцией ARM ядро стартует медленно)
ok=0
for i in $(seq 1 80); do
  PORT=$( (adb shell run-as $PKG cat files/core.json 2>/dev/null || true) | grep -o '"port":[0-9]*' | cut -d: -f2 || true)
  if [ -n "$PORT" ]; then
    adb forward --remove tcp:18787 >/dev/null 2>&1 || true
    if adb forward tcp:18787 "tcp:$PORT" >/dev/null 2>&1 && curl -fsS -m 3 http://127.0.0.1:18787/healthz >/dev/null 2>&1; then
      ok=1; echo "ядро ответило через $((i*3)) с (порт $PORT)"; break
    fi
  fi
  if ! adb shell pidof $PKG >/dev/null 2>&1; then fail "приложение закрылось"; fi
  sleep 3
done
[ $ok = 1 ] || fail "ядро не ответило за 4 минуты"
sleep 15 # чат и мастер первого запуска успевают загрузиться
collect
# падение именно нашего приложения: в блоке после FATAL/Fatal signal (до 40 строк) встречается имя пакета (как подстрока, не регэксп)
if awk -v pkg="$PKG" '
  /FATAL EXCEPTION|Fatal signal/ { if (block && hit) { found=1 } block=1; hit=0; n=0 }
  block { if (index($0, pkg)) hit=1; n++; if (n > 40) { if (hit) found=1; block=0 } }
  END { if (block && hit) found=1; exit found ? 0 : 1 }
' "$OUT/logcat.txt"; then fail "падение приложения в logcat"; fi
if grep -q "Первый запуск Светланы\|Оценить телефон\|Подключить ИИ" "$OUT/ui.xml" 2>/dev/null; then echo "мастер первого запуска на экране ✔"; else echo "::warning::мастер первого запуска не найден в дереве интерфейса (см. screen.png)"; fi
echo "дымовой тест пройден"
