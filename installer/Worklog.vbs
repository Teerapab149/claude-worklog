' Opens Worklog in its own window, with the Node that came with the installer.
' A window already open is brought to the front instead of opening a second one.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
If Not shell.AppActivate("Worklog |") Then
	shell.CurrentDirectory = dir
	shell.Run """" & dir & "\node\node.exe"" --disable-warning=ExperimentalWarning """ & dir & "\bin\app.js""", 0, False
End If
