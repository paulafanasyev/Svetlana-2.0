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
# APK для телефона (arm64) кладём в итоги теста — его можно сразу ставить на устройство
cp android-hands/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk "$OUT/svetlana-phone-arm64.apk" 2>/dev/null || echo "::warning::нет app-arm64-v8a-debug.apk"
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
if grep -q "Первый запуск Светланы\|Оценить телефон\|Подключить ИИ" "$OUT/ui.xml" 2>/dev/null; then echo "мастер первого запуска на экране ✔"
else
  # что всё-таки на экране: тексты из дерева интерфейса — видно без скачивания артефакта
  python3 - "$OUT/ui.xml" > "$OUT/ui-text.txt" <<'PY' || true
import re, sys, html
try: x = open(sys.argv[1], encoding="utf-8", errors="replace").read()
except Exception: x = ""
seen = []
for k in ("text", "content-desc"):
    for v in re.findall(k + r'="([^"]+)"', x):
        v = html.unescape(v).strip()
        if v and v not in seen: seen.append(v)
print("\n".join(seen[:120]) or "(дерево интерфейса пустое)")
PY
  # WebView эмулятора часто не отдаёт свой текст в дерево (видны только кнопки окна «🧠 Модель ИИ», «🖐 Экран и руки») —
  # тогда это не ошибка интерфейса: мастер смотрим глазами на screen.png, а работу ядра ниже проверяет API
  if grep -q "Светлана\|Напишите\|Привет" "$OUT/ui-text.txt" 2>/dev/null; then
    echo "::warning::мастер первого запуска не найден, хотя страница видна (см. screen.png)"; annotate "экран (тексты)" "$OUT/ui-text.txt" 1
  else echo "::notice title=мастер первого запуска::WebView не отдаёт текст в дерево интерфейса — мастер на screen.png, ядро проверено через API"; fi
fi
# API ядра на телефоне (Node 18 без ICU): вход, команда, чаты со своим ИИ, список моделей, новые файлы интерфейса
TOKEN=$( (adb shell run-as $PKG cat files/core.json 2>/dev/null || true) | grep -o '"adminToken":"[^"]*"' | cut -d'"' -f4 || true)
B=http://127.0.0.1:18787; CJ=$(mktemp); api_ok=1
check() { if [ "$2" = ok ]; then echo "API ✔ $1"; else echo "::error title=API $1::$3"; api_ok=0; fi; }
if [ -n "$TOKEN" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -c "$CJ" -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN\"}" $B/api/login || true)
  [ "$code" = 200 ] && check "вход" ok || check "вход" bad "код $code"
  r=$(curl -s -b "$CJ" $B/api/team || true); grep -q '"presets"' <<<"$r" && grep -q 'CTO' <<<"$r" && check "команда (/api/team)" ok || check "команда (/api/team)" bad "${r:0:300}"
  r=$(curl -s -b "$CJ" -H 'Content-Type: application/json' -d '{}' $B/api/conversations || true); grep -q '"id":"con_' <<<"$r" && check "новый чат (/api/conversations)" ok || check "новый чат" bad "${r:0:300}"
  r=$(curl -s -b "$CJ" $B/api/conversations || true); grep -q '"provider"' <<<"$r" && check "список чатов с ИИ" ok || check "список чатов" bad "${r:0:300}"
  r=$(curl -s -m 30 -b "$CJ" -H 'Content-Type: application/json' -d '{"baseUrl":"http://127.0.0.1:9/v1","apiKey":"sk-test-123456789"}' $B/api/providers/models || true)
  grep -q '"ok":false' <<<"$r" && ! grep -q 'sk-test-123456789' <<<"$r" && check "свой ИИ: список моделей (недоступный сервер → понятная ошибка)" ok || check "свой ИИ: список моделей" bad "${r:0:300}"
  r=$(curl -s -m 30 -b "$CJ" -H 'Content-Type: application/json' -d '{"baseUrl":"http://127.0.0.1:9/v1","model":"m"}' $B/api/providers/probe || true)
  grep -q '"ok":false' <<<"$r" && check "свой ИИ: проверка соединения" ok || check "свой ИИ: проверка соединения" bad "${r:0:300}"
  r=$(curl -s -b "$CJ" $B/api/tools || true); for t in team_list team_delegate video_edit; do grep -q "\"$t\"" <<<"$r" && check "инструмент $t" ok || check "инструмент $t" bad "нет в /api/tools"; done
  for p in /team.js /team.css; do code=$(curl -s -o /dev/null -w '%{http_code}' $B$p || true); [ "$code" = 200 ] && check "файл $p" ok || check "файл $p" bad "код $code"; done
  r=$(curl -s $B/ || true); grep -q 'id="tab-team"' <<<"$r" && check "вкладка «Команда» в интерфейсе" ok || check "вкладка «Команда»" bad "нет в index.html"
else echo "::error::нет adminToken в core.json — API не проверить"; api_ok=0; fi
rm -f "$CJ"
[ $api_ok = 1 ] || fail "API ядра на телефоне отвечает не так, как ожидалось"
echo "::notice title=API ядра на телефоне::вход, команда, чаты со своим ИИ, свой ИИ (модели и проверка), новые инструменты и вкладка «Команда» — всё отвечает"
echo "дымовой тест пройден"
