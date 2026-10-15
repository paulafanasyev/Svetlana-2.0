# Закреплённые workflow

Подключение к GitHub не может писать в `.github/workflows`, поэтому готовые файлы сначала появляются здесь
и переносятся руками (скопировать файл целиком в одноимённый файл `.github/workflows/`).

| Файл | Что делает |
|---|---|
| `ci.yml` | тесты, сборка сайта, проверка типов, уязвимости (high+ роняет) |
| `build-windows.yml` | тесты Rust, clippy (пока предупреждения), установщик, публикация в Releases |
| `svetlana-android.yml` | тесты Android, APK, подписанный релиз (если задан ключ), публикация в Releases |
| `svetlana-android-emulator.yml` | запуск на эмуляторе Android: не падает, открывает интерфейс (новый файл) |

Релиз: каждый push в основную ветку обновляет релиз `app-v<версия>` файлами
`Svetlana-2.0-Windows-setup.exe` и `Svetlana-2.0-Android.apk` (на них ведут кнопки сайта). Новая версия —
поднять `version` в `package.json` и `src-tauri/tauri.conf.json`.

## Подпись Android (необязательно)

Без ключа в Releases уходит отладочный APK. Для настоящего:

1. Один раз создать ключ и ХРАНИТЬ его (потеряешь — обновления поверх старого приложения ставить нельзя):
   `keytool -genkeypair -v -keystore svetlana.jks -alias svetlana -keyalg RSA -keysize 4096 -validity 10000`
2. Settings → Secrets and variables → Actions → New repository secret:
   - `SVETLANA_KEYSTORE_B64` — содержимое `base64 -w0 svetlana.jks`
   - `SVETLANA_KEYSTORE_PASSWORD`, `SVETLANA_KEY_ALIAS` (`svetlana`), `SVETLANA_KEY_PASSWORD`

Важно: первый подписанный APK не встанет поверх отладочного (разные подписи): старое приложение один раз
нужно удалить (ключи ИИ и CRM на телефоне при этом сотрутся).

Если меняете зависимости Rust в `src-tauri/Cargo.toml`, обновите и `Cargo.lock` (`cargo update -p <имя>`), иначе сборка честно упадёт.
