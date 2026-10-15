# Закреплённые workflow

Уже применено (15.10.2026): файлы из этой папки лежат в `.github/workflows/`, `src-tauri/Cargo.lock` закоммичен.
Эта папка остаётся зеркалом: подключение к GitHub не может писать в `.github/workflows`, поэтому будущие
правки сначала появляются здесь и переносятся руками (скопировать файл целиком).

- `ci.yml` → `.github/workflows/ci.yml`
- `build-windows.yml` → `.github/workflows/build-windows.yml`
- `svetlana-android.yml` → `.github/workflows/svetlana-android.yml`

Старый `ci/build-windows.yml` устарел.

## Что дают

- Все действия закреплены по SHA коммита (версия в комментарии), Dependabot предлагает обновления отдельными PR.
- Rust 1.99.0 и tauri-cli 2.12.3 точных версий; `cargo test`, `cargo fetch` и `cargo tauri build` идут с `--locked`.
- Модульные тесты Android (`testDebugUnitTest`) перед сборкой APK.
- `npm audit --omit=dev --audit-level=high` роняет CI; `npm run lint` = `tsc --noEmit`.
- `persist-credentials: false`, `permissions: contents: read`.

Если меняете зависимости Rust в `src-tauri/Cargo.toml`, обновите и `Cargo.lock` (`cargo update -p <имя>`), иначе сборка честно упадёт.
