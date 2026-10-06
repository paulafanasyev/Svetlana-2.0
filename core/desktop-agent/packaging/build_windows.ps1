# Сборка установщика Светланы для Windows: модель речи -> Svetlana.exe (PyInstaller) -> SvetlanaSetup-X.Y.Z.exe (Inno Setup).
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

# 2) Icon
python packaging\make_icon.py build\svetlana.ico

# 3) App
python -m PyInstaller --noconfirm --clean --windowed --name Svetlana `
  --icon build\svetlana.ico `
  --add-data "build\model;model" `
  --add-data "build\svetlana.ico;." `
  --collect-all vosk `
  --collect-all uiautomation `
  --hidden-import pystray._win32 `
  --hidden-import pyttsx3.drivers `
  --hidden-import pyttsx3.drivers.sapi5 `
  --hidden-import agent --hidden-import commands --hidden-import ui_tree `
  svetlana_desktop.py
if (-not (Test-Path "dist\Svetlana\Svetlana.exe")) { throw "PyInstaller did not build Svetlana.exe" }

# 4) Installer (Inno Setup needs UTF-8 with BOM for Cyrillic)
$iscc = Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"
if (-not (Test-Path $iscc)) { choco install innosetup -y --no-progress | Out-Null }
$iss = Get-Content "packaging\installer.iss" -Raw -Encoding UTF8
[IO.File]::WriteAllText((Join-Path (Get-Location) "packaging\installer.bom.iss"), $iss, (New-Object System.Text.UTF8Encoding $true))
& $iscc "/DMyAppVersion=$ver" "packaging\installer.bom.iss"
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed" }
Get-ChildItem "packaging\Output\*.exe" | ForEach-Object { Write-Host "Done: $($_.FullName) ($([math]::Round($_.Length/1MB,1)) MB)" }
