# Сборка установщика Светланы для Windows: модель речи + Node + ядро -> Svetlana.exe (PyInstaller) -> SvetlanaSetup-X.Y.Z.exe (Inno Setup).
# Запуск из папки core\desktop-agent:  pwsh -File packaging\build_windows.ps1
$ErrorActionPreference = "Stop"
$script:stepName = "start"
function Step($name) { $script:stepName = $name; Write-Host "==> $name" }
Set-Location (Join-Path $PSScriptRoot "..")
$ver = (python -c "import version; print(version.VERSION)").Trim()
Write-Host "Svetlana $ver"
New-Item -ItemType Directory -Force build | Out-Null

try {
# 1) Russian offline speech model (~45 MB) goes inside the installer
Step "speech model"
$modelName = "vosk-model-small-ru-0.22"
if (-not (Test-Path "build\model\am")) {
  Invoke-WebRequest "https://alphacephei.com/vosk/models/$modelName.zip" -OutFile "build\model.zip"
  if (Test-Path "build\$modelName") { Remove-Item -Recurse -Force "build\$modelName" }
  Expand-Archive "build\model.zip" -DestinationPath "build" -Force
  if (Test-Path "build\model") { Remove-Item -Recurse -Force "build\model" }
  Move-Item "build\$modelName" "build\model"
  Remove-Item "build\model.zip"
}

# 2) Portable Node.js: the Svetlana core runs on this PC (local mode), no system Node needed.
#    Only node.exe is taken from the zip (the full archive has npm with very long paths).
$nodeVer = "v22.12.0"
if (-not (Test-Path "build\node\node.exe")) {
  Step "download node $nodeVer"
  Invoke-WebRequest "https://nodejs.org/dist/$nodeVer/node-$nodeVer-win-x64.zip" -OutFile "build\node.zip"
  New-Item -ItemType Directory -Force "build\node" | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path "build\node.zip").Path)
  try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq "node-$nodeVer-win-x64/node.exe" } | Select-Object -First 1
    if (-not $entry) { throw "node.exe not found inside node zip" }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path (Get-Location) "build\node\node.exe"), $true)
  } finally { $zip.Dispose() }
  Remove-Item -Force "build\node.zip"
}
& "build\node\node.exe" --version
if ($LASTEXITCODE -ne 0) { throw "bundled node.exe does not run" }

Step "copy core"
# 3) Svetlana core (server + web app), without tests, training data and this desktop agent
if (Test-Path "build\core") { Remove-Item -Recurse -Force "build\core" }
New-Item -ItemType Directory -Force "build\core" | Out-Null
$skip = @("desktop-agent", "test", "training", "Dockerfile", "docker-compose.yml", ".dockerignore", ".env.example", ".gitignore")
Get-ChildItem ".." -Force | Where-Object { $skip -notcontains $_.Name } | ForEach-Object { Copy-Item $_.FullName "build\core\$($_.Name)" -Recurse }
if (Test-Path "build\core\server.mjs") { Get-ChildItem "build\core" | ForEach-Object { Write-Host "  core: $($_.Name)" } }
Push-Location "build\core"
& "..\node\node.exe" "scripts\restore-assets.mjs"
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "restore-assets failed" }
Pop-Location
if (-not (Test-Path "build\core\server.mjs")) { throw "core was not copied" }

# 4) Icon
Step "icon"
python packaging\make_icon.py build\svetlana.ico

# 5) App
Step "pyinstaller"
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
Step "smoke test (bundled core)"
$ErrorActionPreference = "Continue"
$smoke = & python ..\test\local_core_check.py 2>&1 | ForEach-Object { "$_" }
$smokeCode = $LASTEXITCODE
$ErrorActionPreference = "Stop"
$smoke | ForEach-Object { Write-Host $_ }
if ($smokeCode -ne 0) { Get-ChildItem -Recurse -Filter core.log $env:APPDATA, $env:TEMP, "build" -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { $tail = (Get-Content $_.FullName -Tail 15) -join " | "; Write-Host "::error title=core.log::$tail" } }
if ($smokeCode -ne 0) { throw ("local core smoke test failed: " + (($smoke | Select-Object -Last 12) -join " | ")) }
Remove-Item Env:SVETLANA_NODE, Env:SVETLANA_CORE_DIR, Env:SVETLANA_AGENT_DIR

Step "inno setup"
# 7) Installer (Inno Setup needs UTF-8 with BOM for Cyrillic)
$iscc = Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"
if (-not (Test-Path $iscc)) { choco install innosetup -y --no-progress | Out-Null }
$iss = Get-Content "packaging\installer.iss" -Raw -Encoding UTF8
[IO.File]::WriteAllText((Join-Path (Get-Location) "packaging\installer.bom.iss"), $iss, (New-Object System.Text.UTF8Encoding $true))
& $iscc "/DMyAppVersion=$ver" "packaging\installer.bom.iss"
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed" }
Get-ChildItem "packaging\Output\*.exe" | ForEach-Object { Write-Host "Done: $($_.FullName) ($([math]::Round($_.Length/1MB,1)) MB)" }
} catch {
  $msg = "$($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))" -replace "[\r\n]+", " | "
  Write-Host "::error title=build_windows step $($script:stepName)::$msg"
  exit 1
}
