Dim shell
Set shell = CreateObject("WScript.Shell")

' Matar procesos node del POS y liberar puerto 3000
Dim ps
ps = "powershell -NoProfile -Command """ & _
  "$ruta = '" & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "';" & _
  "$scripts = @('updater.js','server.js','sync.js');" & _
  "$cerrados = 0;" & _
  "Get-WmiObject Win32_Process -Filter `""name='node.exe'`"" | ForEach-Object {" & _
    "foreach ($s in $scripts) {" & _
      "if ($_.CommandLine -like `""*$s*`"") {" & _
        "Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue;" & _
        "$cerrados++; break" & _
      "}" & _
    "}" & _
  "};" & _
  "exit $cerrados" & _
  """"

Dim exec
Set exec = shell.Exec("cmd /c " & ps)
exec.StdOut.ReadAll()
Dim cerrados
cerrados = exec.ExitCode

' Por si acaso, liberar el puerto 3000 directamente
shell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /PID %a /F", 0, True

If cerrados > 0 Then
  MsgBox "Procesos del POS cerrados correctamente.", 64, "POS"
Else
  MsgBox "No se encontraron procesos del POS corriendo.", 64, "POS"
End If
