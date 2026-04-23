Dim shell
Set shell = CreateObject("WScript.Shell")

shell.Run "cmd /c taskkill /F /IM node.exe >/dev/null 2>&1", 0, True

MsgBox "POS detenido.", vbInformation, "ShopPOS"
