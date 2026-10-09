# Сборка установщика Светланы для Windows: модель речи + Node + ядро -> Svetlana.exe (PyInstaller) -> SvetlanaSetup-X.Y.Z.exe (Inno Setup).
# Запуск из папки core\desktop-agent:  pwsh -File packaging\build_windows.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$ver = (python -c "import version; print(version.VERSION)").Trim()
Write-Host "Svetlana $ver"
New-Item -ItemType Directory -Force build | Out-Null

# 1) Russian offline speech model (~45 MB) goes inside the installer
$modelName = "vosk-model-small-ru-0.22"
if (-not (Test-Path "build\model\am")) {
  Invoke-WebRequest "https://alphacephei.com/vosk/models/$modelName.zip" -OutFile "build\model.zip"
  if (Test-Path "build\$modelName") { Remove-Item -Recurse -Force "build\$modelName" }
  Expand-Archive "build\model.zip" -DestinationPath "build" -Force
  if (Test-Path "build\model") { Remove-Item -Recurse -Force "build\model" }
  Move-Item "build\$modelName" "build\model"
  Remove-Item "build\model.zip"
}

# 2) Portable Node.js: the Svetlana core runs on this PC (local mode), no system Node needed
$nodeVer = "v22.12.0"
if (-not (Test-Path "build\node\node.exe")) {
  Invoke-WebRequest "https://nodejs.org/dist/$nodeVer/node-$nodeVer-win-x64.zip" -OutFile "build\node.zip"
  Expand-Archive "build\node.zip" -DestinationPath "build" -Force
  New-Item -ItemType Directory -Force "build\node" | Out-Null
  Copy-Item "build\node-$nodeVer-win-x64\node.exe" "build\node\node.exe"
  Remove-Item -Recurse -Force "build\node-$nodeVer-win-x64", "build\node.zip"
}
& "build\node\node.exe" --version
if ($LASTEXITCODE -ne 0) { throw "bundled node.exe does not run" }

# 3) Svetlana core (server + web app), without tests, training data and this desktop agent
if (Test-Path "build\core") { Remove-Item -Recurse -Force "build\core" }
New-Item -ItemType Directory -Force "build\core" | Out-Null
foreach ($item in @("server.mjs", "package.json", "lib", "web", "knowledge", "connectors", "scripts")) {
  if (Test-Path "..\$item") { Copy-Item "..\$item" "build\core\$item" -Recurse }
}
Push-Location "build\core"
& "..\node\node.exe" "scripts\restore-assets.mjs"
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "restore-assets failed" }
Pop-Location
if (-not (Test-Path "build\core\server.mjs")) { throw "core was not copied" }

# 4) Icon
python packaging\make_icon.py build\svetlana.ico

# 5) App
python -m PyInstaller --noconfirm --clean --windowed --name Svetlana `
  --icon build\svetlana.ico `
  --add-data "build\model;model" `
  --add-data "build\node;node" `
  --add-data "build\core;core" `
  --add-data "build\svetlana.ico;." `
  --collect-all vosk `
  --collect-all uiautomation `
  --hidden-import pystray._win32 `
  --hidden-import pyttsx3.drivers `
  --hidden-import pyttsx3.drivers.sapi5 `
  --hidden-import agent --hidden-import commands --hidden-import ui_tree --hidden-import local_core `
  svetlana_desktop.py
if (-not (Test-Path "dist\Svetlana\Svetlana.exe")) { throw "PyInstaller did not build Svetlana.exe" }
$bundled = Get-ChildItem -Recurse -Filter "server.mjs" "dist\Svetlana" | Select-Object -First 1
if (-not $bundled) { throw "core is missing inside the app bundle" }

# 6) Smoke test: the bundled core really starts on this Windows runner and pairs the desktop device
$env:SVETLANA_NODE = (Resolve-Path "build\node\node.exe").Path
$env:SVETLANA_CORE_DIR = (Resolve-Path "build\core").Path
$env:SVETLANA_AGENT_DIR = (Get-Location).Path
python ..\test\local_core_check.py
if ($LASTEXITCODE -ne 0) { throw "local core smoke test failed" }
Remove-Item Env:SVETLANA_NODE, Env:SVETLANA_CORE_DIR, Env:SVETLANA_AGENT_DIR

# 7) Installer (Inno Setup needs UTF-8 with BOM for Cyrillic)
$iscc = Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"
if (-not (Test-Path $iscc)) { choco install innosetup -y --no-progress | Out-Null }
$iss = Get-Content "packaging\installer.iss" -Raw -Encoding UTF8
[IO.File]::WriteAllText((Join-Path (Get-Location) "packaging\installer.bom.iss"), $iss, (New-Object System.Text.UTF8Encoding $true))
& $iscc "/DMyAppVersion=$ver" "packaging\installer.bom.iss"
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed" }
Get-ChildItem "packaging\Output\*.exe" | ForEach-Object { Write-Host "Done: $($_.FullName) ($([math]::Round($_.Length/1MB,1)) MB)" }
