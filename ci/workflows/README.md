# Закреплённые workflow (вставить руками)

Подключение к GitHub не может менять папку `.github/workflows`, поэтому готовые файлы лежат здесь.

## Что сделать (5 минут)

1. На GitHub откройте каждый файл из этой папки, нажмите «Copy raw file» и вставьте целиком вместо старого:
   - `ci/workflows/ci.yml` → `.github/workflows/ci.yml`
   - `ci/workflows/build-windows.yml` → `.github/workflows/build-windows.yml`
   - `ci/workflows/svetlana-android.yml` → `.github/workflows/svetlana-android.yml`
2. После первой сборки Windows скачайте артефакт **Cargo-lock** и загрузите файл как `src-tauri/Cargo.lock`
   (Add file → Upload files). С этого момента сборка и тесты идут с `--locked`: версии библиотек
   Rust больше не меняются сами по себе.

Старый `ci/build-windows.yml` больше не нужен, актуальная версия здесь.

## Что меняется

| Было | Стало |
|---|---|
| Действия по тегам (`@v6`, `@v4`), тег можно переписать | Все действия по SHA коммита, версия в комментарии |
| `dtolnay/rust-toolchain@stable` | Rust 1.99.0 через rustup, без стороннего действия |
| `tauri-cli ^2.0.0` (любая свежая) | `tauri-cli 2.12.3` точно |
| Тесты Rust не запускались | `cargo test` перед сборкой установщика |
| Нет Cargo.lock | Артефакт Cargo-lock, после коммита всё с `--locked` |
| Тесты Android не запускались | `testDebugUnitTest` (и так идут перед `assembleDebug`), отчёт при падении |
| `npm audit ... \|\| echo` (никогда не падал) | Уязвимости high+ в зависимостях приложения роняют CI |
| `lint`: `echo 'Lint not configured'` | `lint` = `tsc --noEmit`, без `\|\| echo` |
| Токен checkout оставался в .git | `persist-credentials: false`, `permissions: contents: read` |

Если после замены что-то упадёт (скорее всего тесты Rust или audit найдёт уязвимость), это настоящая
проблема, которую раньше просто не было видно: пришлите ссылку на запуск, починю.
