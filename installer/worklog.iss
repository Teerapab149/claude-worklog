; Inno Setup script for Worklog. Built by tools/build-installer.js, which
; copies the app and Node into the Stage folder and passes AppVersion.
; Installs for the current user only, so no administrator rights are needed.
; Settings and data stay in %LOCALAPPDATA%\Worklog through updates and uninstall.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef Stage
  #define Stage "..\dist\stage"
#endif

[Setup]
AppId={{6D3F2B8A-4C1E-4F7A-9B2D-5E8C1A7F3D90}
AppName=Worklog
AppVersion={#AppVersion}
AppPublisher=Worklog
AppPublisherURL=https://github.com/Teerapab149/claude-worklog
DefaultDirName={localappdata}\Programs\Worklog
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=Worklog-Setup-{#AppVersion}
SetupIconFile={#Stage}\public\icon.ico
UninstallDisplayIcon={app}\public\icon.ico
UninstallDisplayName=Worklog
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[CustomMessages]
DesktopIcon=สร้างไอคอนบนหน้าจอ
HooksTask=ให้ Claude Code เตือนเมื่อสอง session แก้ไฟล์เดียวกัน (ติดตั้ง hook ใน Claude Code)
OpenNow=เปิด Worklog

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcon}"
Name: "hooks"; Description: "{cm:HooksTask}"

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

; Files left from an older version that this one no longer ships.
[InstallDelete]
Type: filesandordirs; Name: "{app}\bin"
Type: filesandordirs; Name: "{app}\src"
Type: filesandordirs; Name: "{app}\public"

[Icons]
Name: "{autoprograms}\Worklog"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Worklog.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\public\icon.ico"; Comment: "งานที่ทำกับ AI ค้างอยู่ตรงไหน"
Name: "{autodesktop}\Worklog"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Worklog.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\public\icon.ico"; Comment: "งานที่ทำกับ AI ค้างอยู่ตรงไหน"; Tasks: desktopicon

[Run]
; Guesses project folders and account names from the logs the first time,
; and keeps what is already set on an update.
Filename: "{app}\node\node.exe"; Parameters: "--disable-warning=ExperimentalWarning ""{app}\bin\setup.js"""; WorkingDir: "{app}"; Flags: runhidden
Filename: "{app}\node\node.exe"; Parameters: "--disable-warning=ExperimentalWarning ""{app}\bin\hooks.js"" install"; WorkingDir: "{app}"; Flags: runhidden; Tasks: hooks
Filename: "{sys}\wscript.exe"; Parameters: """{app}\Worklog.vbs"""; WorkingDir: "{app}"; Description: "{cm:OpenNow}"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{app}\node\node.exe"; Parameters: "--disable-warning=ExperimentalWarning ""{app}\bin\hooks.js"" uninstall"; WorkingDir: "{app}"; Flags: runhidden; RunOnceId: "RemoveHooks"
