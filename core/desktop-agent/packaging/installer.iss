; Установщик «Светлана для Windows» (Inno Setup 6). Собирается в GitHub Actions: .github/workflows/svetlana-windows.yml
; build_windows.ps1 перед сборкой пересохраняет этот файл в UTF-8 с BOM (иначе Inno Setup не поймёт кириллицу).
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

[Setup]
AppId={{8F3C2A1E-6B7D-4C1A-9E2F-5A3B7C9D1E42}
AppName=Светлана
AppVersion={#MyAppVersion}
AppVerName=Светлана {#MyAppVersion}
AppPublisher=Павел Афанасьев
AppPublisherURL=https://github.com/paulafanasyev/Svetlana-2.0
DefaultDirName={autopf}\Svetlana
DefaultGroupName=Светлана
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=SvetlanaSetup-{#MyAppVersion}
SetupIconFile=..\build\svetlana.ico
UninstallDisplayIcon={app}\Svetlana.exe
UninstallDisplayName=Светлана
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
VersionInfoVersion={#MyAppVersion}
VersionInfoDescription=Светлана: ИИ-помощница, голос, руки и глаза на компьютере

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Значок на рабочем столе"; GroupDescription: "Дополнительно:"
Name: "autostart"; Description: "Запускать Светлану при входе в Windows"; GroupDescription: "Дополнительно:"

[InstallDelete]
; обновление поверх старой версии: библиотеки прошлой сборки не смешиваются с новыми (данные пользователя — в %APPDATA%)
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "..\dist\Svetlana\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Светлана"; Filename: "{app}\Svetlana.exe"
Name: "{group}\Удалить Светлану"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Светлана"; Filename: "{app}\Svetlana.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Svetlana"; ValueData: """{app}\Svetlana.exe"" --minimized"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\Svetlana.exe"; Description: "Запустить Светлану"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /T /IM Svetlana.exe"; Flags: runhidden; RunOnceId: "KillSvetlana"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
// Обновление поверх запущенной Светланы: окно по крестику уходит в трей, поэтому
// CloseApplications его не закрывает. Перед копированием файлов завершаем процесс
// (вместе с дочерним node.exe, ядро и так убивается Job Object'ом).
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM Svetlana.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(1000);
  Result := '';
end;
