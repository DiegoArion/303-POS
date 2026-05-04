Dim shell, ruta, log
Set shell = CreateObject("WScript.Shell")
ruta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
log = ruta & "\bajar_prod.log"

shell.Run "cmd /c cd /d """ & ruta & """ && node bajar_prod.js > """ & log & """ 2>&1", 1, True

MsgBox "Descarga completada. Revisa bajar_prod.log si hubo errores.", vbInformation, "ShopPOS"
