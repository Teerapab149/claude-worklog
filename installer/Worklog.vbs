' Opens Worklog with the Node that came with the installer, with no console window.
' bin\app.js decides whether to bring an open Worklog window forward or start one;
' it finds that window by its process, never by its title, so a stale window or a
' browser tab with the same title can never stand in for the real one.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = dir
shell.Run """" & dir & "\node\node.exe"" --disable-warning=ExperimentalWarning """ & dir & "\bin\app.js""", 0, False
