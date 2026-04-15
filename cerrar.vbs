Dim shell, ruta
Set shell = CreateObject("WScript.Shell")
ruta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

Dim scripts(2)
scripts(0) = "updater.js"
scripts(1) = "server.js"
scripts(2) = "sync.js"

Dim cerrados
cerrados = 0

Dim i
For i = 0 To 2
  Dim cmd, exec, pid
  cmd = "wmic process where ""name='node.exe' and commandline like '%" & scripts(i) & "%'"" get processid /value"
  Set exec = shell.Exec("cmd /c " & cmd)
  Dim salida
  salida = exec.StdOut.ReadAll()

  ' Extraer cada ProcessId y matarlo
  Dim lineas, j
  lineas = Split(salida, vbCrLf)
  For j = 0 To UBound(lineas)
    Dim linea
    linea = Trim(lineas(j))
    If Left(linea, 10) = "ProcessId=" Then
      pid = Trim(Mid(linea, 11))
      If pid <> "" And pid <> "0" Then
        shell.Run "cmd /c taskkill /PID " & pid & " /F", 0, True
        cerrados = cerrados + 1
      End If
    End If
  Next
Next

If cerrados > 0 Then
  MsgBox "✔ POS cerrado — " & cerrados & " proceso(s) terminado(s).", 64, "POS"
Else
  MsgBox "ℹ️ No había procesos del POS corriendo.", 64, "POS"
End If
