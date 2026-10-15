# Закреплённые workflow

Подключение к GitHub не может писать в `.github/workflows`, поэтому готовые файлы сначала появляются здесь
и переносятся руками (скопировать файл целиком в одноимённый файл `.github/workflows/`).

| Файл | Что делает |
|---|---|
| `ci.yml` | тесты, сборка сайта, проверка типов, уязвимости (high+ роняет) |
| `build-windows.yml` | тесты Rust, clippy (пока предупреждения), установщик, публикация в Releases |
| `svetlana-android.yml` | тесты Android, APK, подписанный релиз (если задан ключ), публикация в Releases |
| `svetlana-android-emulator.yml` | запуск на эмуляторе Android: не падает, открывает интерфейс |
| `svetlana-android-keygen.yml` | один раз вручную: создаёт ключ подписи Android в зашифрованном архиве (новый файл) |

Релиз: каждый push в основную ветку обновляет релиз `app-v<версия>` файлами
`Svetlana-2.0-Windows-setup.exe` и `Svetlana-2.0-Android.apk` (на них ведут кнопки сайта). Новая версия —
поднять `version` в `package.json` и `src-tauri/tauri.conf.json`.

## Подпись Android (необязательно)

Без ключа в Releases уходит отладочный APK. Для настоящего есть два пути.

### А. Автоматически (svetlana-android-keygen.yml)

Репозиторий публичный: артефакты может скачать любой вошедший в GitHub. Поэтому ключ уходит только
в архиве 7z (AES-256, имена файлов тоже зашифрованы), артефакт живёт 1 день.

1. Settings → Secrets and variables → Actions → New repository secret: `SVETLANA_KEYGEN_PASSPHRASE`,
   пароль от архива, минимум 20 символов (лучше из менеджера паролей).
2. Actions → svetlana-android-keygen → Run workflow, в поле написать `СОЗДАТЬ`.
   Если секрет `SVETLANA_KEYSTORE_B64` уже есть, запуск откажется: замена ключа ломает обновления.
3. Скачать артефакт `svetlana-android-key-encrypted`, открыть `svetlana-android-key.7z` в 7-Zip этим паролем.
4. Внутри 4 файла `SVETLANA_*.txt`: создать 4 секрета, имя = имя файла без `.txt`, значение = содержимое.
5. Удалить артефакт со страницы запуска и секрет `SVETLANA_KEYGEN_PASSPHRASE`.
6. `svetlana.jks` и пароль хранить в двух местах (менеджер паролей + флешка). Из секретов GitHub его уже не достать.

### Б. Вручную (ключ никогда не попадает на чужой компьютер)

1. `keytool -genkeypair -v -keystore svetlana.jks -storetype PKCS12 -alias svetlana -keyalg RSA -keysize 4096 -validity 10000`
2. Секреты: `SVETLANA_KEYSTORE_B64` (содержимое `base64 -w0 svetlana.jks`), `SVETLANA_KEYSTORE_PASSWORD`,
   `SVETLANA_KEY_ALIAS` (`svetlana`), `SVETLANA_KEY_PASSWORD` (для PKCS12 тот же пароль).

Важно: первый подписанный APK не встанет поверх отладочного (разные подписи): старое приложение один раз
нужно удалить (ключи ИИ и CRM на телефоне при этом сотрутся).

Если меняете зависимости Rust в `src-tauri/Cargo.toml`, обновите и `Cargo.lock` (`cargo update -p <имя>`), иначе сборка честно упадёт.
