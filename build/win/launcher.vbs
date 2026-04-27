' VoiceScope hidden launcher for Windows.
'
' Invoked by the SFX right after self-extraction completes. Runs
' voicescape-server.exe with no visible console window, sets the env vars
' that tell the server it is in standalone mode, and exits immediately so
' that the user sees only the browser window that the server opens.
'
' Debugging: if the server fails to start, a log file is written to
'   %LOCALAPPDATA%\VoiceScope-app\launcher.log
' and the user can run run-console.cmd (same folder) to see live output.

Option Explicit

Dim shell, fso, scriptDir, env, logPath, logStream

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Write a launcher heartbeat log — useful if the user reports "it didn't open"
logPath = scriptDir & "\launcher.log"
On Error Resume Next
Set logStream = fso.OpenTextFile(logPath, 2, True) ' 2 = ForWriting, overwrite
logStream.WriteLine "[launcher] " & Now & " starting voicescope-server.exe from " & scriptDir
logStream.Close
On Error Goto 0

' Env vars tell the server where the bundled assets live and activate standalone mode.
Set env = shell.Environment("PROCESS")
env("VOICESCOPE_STANDALONE") = "1"
env("VOICESCOPE_CLIENT_DIST") = scriptDir & "\client"
env("VOICESCOPE_SQLJS_WASM") = scriptDir & "\sql-wasm.wasm"
env("VOICESCOPE_SCHEMA_SQL") = scriptDir & "\schema.sql"
env("NODE_ENV") = "production"

shell.CurrentDirectory = scriptDir

' Run the server with no window and don't wait for it.
' Mode 0 = hide window; False = fire and forget.
' The server opens the user's browser itself via platform-paths/launch-browser.
shell.Run """" & scriptDir & "\voicescope-server.exe""", 0, False
