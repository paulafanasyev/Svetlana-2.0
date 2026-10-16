# Светлана 2.0 для Android

Тот же интерфейс, что у сайта и Windows: при сборке корень репозитория собирается (`npm run build`)
и кладётся в APK, WebView открывает его через WebViewAssetLoader. Нативная часть даёт голос,
распознавание речи на телефоне (GigaAM), защищённое хранение ключей (Android Keystore) и печать.

- **Сборка:** `gradle testDebugUnitTest assembleDebug` (нужен Node.js 22+ для интерфейса).
- **CI:** `svetlana-android.yml` (тесты, APK, публикация в Releases как `Svetlana-2.0-Android.apk`)
  и `svetlana-android-emulator.yml` (запуск на эмуляторе, скрипт `scripts/emulator-smoke.sh`).
- **Подпись:** если в секретах репозитория заданы `SVETLANA_KEYSTORE_B64`, `SVETLANA_KEYSTORE_PASSWORD`,
  `SVETLANA_KEY_ALIAS` и `SVETLANA_KEY_PASSWORD`, в Releases уходит подписанный релизный APK. Ключ в git не лежит
  (см. `ci/workflows/README.md`).
