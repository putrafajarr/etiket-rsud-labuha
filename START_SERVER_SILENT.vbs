Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "d:\project\IT\Etiket"
WshShell.Run "cmd /c node server/server.js", 0, False
WshShell.Run "cmd /c bin\cloudflared.exe tunnel --url http://localhost:3000", 0, False
