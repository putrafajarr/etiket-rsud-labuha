Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
ScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = ScriptDir
WshShell.Run "cmd /c node server/server.js", 0, False
WshShell.Run "cmd /c bin\cloudflared.exe tunnel --url http://localhost:3000", 0, False
