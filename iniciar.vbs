Dim shell, ruta, rama

Set shell = CreateObject("WScript.Shell")

' Ruta de la carpeta del proyecto
ruta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

' Verificar que la rama activa sea PROD; si no, cambiar a ella
Dim exec
Set exec = shell.Exec("cmd /c cd /d """ & ruta & """ && git rev-parse --abbrev-ref HEAD")
rama = ""
Do While Not exec.StdOut.AtEndOfStream
  rama = rama & exec.StdOut.ReadLine()
Loop
rama = Trim(rama)

If rama <> "PROD" Then
  shell.Run "cmd /c cd /d """ & ruta & """ && git checkout PROD", 1, True
End If

' Iniciar el servidor con auto-actualizador en segundo plano (sin ventana)
shell.Run "cmd /c cd /d """ & ruta & """ && node updater.js > """ & ruta & "\servidor.log"" 2>&1", 0, False

' Iniciar sync con Atlas en segundo plano (sin ventana)
shell.Run "cmd /c cd /d """ & ruta & """ && node sync.js > """ & ruta & "\sync.log"" 2>&1", 0, False

' Esperar a que el servidor responda (máximo 30 segundos)
Dim ps, listo, intentos
intentos = 0
listo = False

Do While Not listo And intentos < 30
  WScript.Sleep 1000
  intentos = intentos + 1
  Set ps = shell.Exec("powershell -Command ""try { Invoke-WebRequest http://localhost:3000 -UseBasicParsing -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }""")
  ps.StdOut.ReadAll()
  If ps.ExitCode = 0 Then listo = True
Loop

' Abrir el POS en el navegador
shell.Run "http://localhost:3000"
