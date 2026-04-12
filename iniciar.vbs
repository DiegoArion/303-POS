Dim shell, ruta

Set shell = CreateObject("WScript.Shell")

' Ruta de la carpeta del proyecto
ruta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

' Iniciar el servidor con auto-actualizador en segundo plano (sin ventana)
shell.Run "cmd /c cd /d """ & ruta & """ && node updater.js > """ & ruta & "\servidor.log"" 2>&1", 0, False

' Iniciar sync con Atlas en segundo plano (sin ventana)
shell.Run "cmd /c cd /d """ & ruta & """ && node sync.js > """ & ruta & "\sync.log"" 2>&1", 0, False

' Esperar 2 segundos a que arranque
WScript.Sleep 2000

' Abrir el POS en el navegador
shell.Run "http://localhost:3000"
